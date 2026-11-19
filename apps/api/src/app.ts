import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import type { Database } from './db/client';
import type { Env } from './config/env';
import type { Logger } from './lib/logger';
import { TokenService } from './lib/tokens';
import { requestContext } from './middleware/request-context';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { healthRoutes } from './modules/health/health.routes';
import { meRoutes } from './modules/me/me.routes';
import { auditRoutes } from './modules/audit/audit.routes';
import { settingsRoutes } from './modules/settings/settings.routes';

export const API_VERSION = '0.1.0';

export interface AppDeps {
  env: Env;
  db: Database;
  logger: Logger;
}

export function createApp({ env, db, logger }: AppDeps): Express {
  const app = express();
  const tokens = new TokenService(env.JWT_SECRET);

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).ctx.requestId,
      autoLogging: env.NODE_ENV !== 'test',
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      credentials: true,
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: env.RATE_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please wait a minute and try again.',
            requestId: req.ctx.requestId,
          },
        });
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(authenticate(tokens));

  const v1 = express.Router();
  v1.use(healthRoutes(db, API_VERSION));
  v1.use(meRoutes(db));
  v1.use(auditRoutes(db));
  v1.use(settingsRoutes(db));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
