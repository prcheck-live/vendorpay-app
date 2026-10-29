import { Router } from 'express';
import { authenticate, findUser, issueToken, verifyPassword } from '../auth';
import { badRequest, handle, HttpError } from '../errors';
import { log } from '../logger';

export const authRouter = Router();

authRouter.post('/login', handle(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw badRequest('VALIDATION_FAILED', 'username and password are required');
  }
  const user = await findUser(username.trim().toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    log('warn', 'sign-in failed', { username });
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect');
  }
  const { passwordHash: _ignored, ...safe } = user;
  const { token, expiresAt } = issueToken(safe);
  log('info', 'signed in', { username: safe.username, role: safe.role });
  res.json({ token, expiresAt, user: safe });
}));

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});
