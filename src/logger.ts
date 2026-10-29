import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config';

// Any run of 9 to 18 digits is treated as a bank-account number and masked before it is logged (VP-182).
const ACCOUNT_PATTERN = /\b\d{9,18}\b/g;

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(ACCOUNT_PATTERN, (m) => `**** ${m.slice(-4)}`);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v)]));
  }
  return value;
}

let fileReady = false;
export function log(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify(redact({ ts: new Date().toISOString(), level, message, sha: config.gitSha, ...fields }));
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
  try {
    if (!fileReady) { mkdirSync(dirname(config.logFile), { recursive: true }); fileReady = true; }
    appendFileSync(config.logFile, line + '\n');
  } catch {
    // File logging is best-effort; stdout remains the primary sink.
  }
}
