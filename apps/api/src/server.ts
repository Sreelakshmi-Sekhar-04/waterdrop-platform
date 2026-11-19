import { loadEnv } from './config/env';
import { createDb } from './db/client';
import { createLogger } from './lib/logger';
import { createApp } from './app';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const { db, close } = createDb(env.DATABASE_URL);
const app = createApp({ env, db, logger });

const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'WtrDrop API listening'));

function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
