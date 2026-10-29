import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { pool } from './db/pool';
import { HttpError } from './errors';

export type Role = 'FINANCE_OPS' | 'FINANCE_APPROVER' | 'PROCUREMENT' | 'AUDITOR';
export interface User { id: number; username: string; displayName: string; role: Role }

declare module 'express-serve-static-core' {
  interface Request { user?: User }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (body: string) => createHmac('sha256', config.tokenSecret).update(body).digest('base64url');

/** Issues a signed bearer token: base64url(payload).signature */
export function issueToken(user: User): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + config.tokenTtlSeconds;
  const body = b64(JSON.stringify({ sub: user.username, role: user.role, exp }));
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

function readToken(token: string): { sub: string; exp: number } | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function findUser(username: string): Promise<(User & { passwordHash: string }) | null> {
  const r = await pool.query('SELECT id, username, display_name, role, password_hash FROM users WHERE username = $1', [username]);
  if (!r.rowCount) return null;
  const u = r.rows[0];
  return { id: u.id, username: u.username, displayName: u.display_name, role: u.role, passwordHash: u.password_hash };
}

/** Requires a valid bearer token and loads the current user from the database. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = token ? readToken(token) : null;
    if (!payload) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    const user = await findUser(payload.sub);
    if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    const { passwordHash: _ignored, ...safe } = user;
    req.user = safe;
    next();
  } catch (err) {
    next(err);
  }
}

/** Allows the request only for the listed roles; anything else gets 403 FORBIDDEN_ROLE. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(new HttpError(403, 'FORBIDDEN_ROLE', `This action needs one of: ${roles.join(', ')}`));
      return;
    }
    next();
  };
}
