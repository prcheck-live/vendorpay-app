import { pool } from './pool';
import { migrate } from './migrate';
import { seed } from './seed';
import { log } from '../logger';

// Drops everything and reloads demo data. Never run against a shared environment.
(async () => {
  if (process.env.APP_ENV === 'production') throw new Error('db:reset is disabled in production');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await seed();
  log('info', 'database reset with demo data');
  await pool.end();
})().catch((err) => {
  log('error', 'reset failed', { error: String(err) });
  process.exit(1);
});
