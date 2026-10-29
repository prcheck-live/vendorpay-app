import { Router } from 'express';
import { config } from '../config';
import { pool } from '../db/pool';
import { handle } from '../errors';

export const metaRouter = Router();

metaRouter.get('/health', handle(async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
}));

/**
 * Build identity. QIVVRA calls this before running verifiers to confirm the
 * QE environment is running exactly the pull request's commit.
 */
metaRouter.get('/version', (_req, res) => {
  res.json({ app: 'vendorpay', version: config.appVersion, gitSha: config.gitSha, builtAt: config.builtAt, environment: config.environment });
});
