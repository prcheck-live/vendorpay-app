import { readFileSync } from 'fs';
import { join } from 'path';

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://vendorpay:vendorpay@localhost:5432/vendorpay',
  tokenSecret: process.env.TOKEN_SECRET ?? 'dev-only-secret-change-me',
  tokenTtlSeconds: Number(process.env.TOKEN_TTL_SECONDS ?? 8 * 3600),
  // Commit and build identity: QIVVRA uses /version to confirm the QE environment runs the PR's exact commit.
  gitSha: process.env.GIT_SHA ?? 'local',
  builtAt: process.env.BUILT_AT ?? new Date().toISOString(),
  environment: process.env.APP_ENV ?? 'local',
  appVersion: packageVersion(),
  logFile: process.env.LOG_FILE ?? 'logs/app.log',
};
