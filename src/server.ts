import { createApp } from './app';
import { config } from './config';
import { pool } from './db/pool';
import { log } from './logger';

const server = createApp().listen(config.port, () => {
  log('info', 'VendorPay started', { port: config.port, version: config.appVersion, environment: config.environment });
});

function shutdown(signal: string) {
  log('info', 'shutting down', { signal });
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
