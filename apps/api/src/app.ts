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
import { authRoutes, ADMIN_CLIENT_HEADER } from './modules/auth/auth.routes';
import { sessionIsOpen, type AuthDeps } from './modules/auth/auth.service';
import { createOtpProvider, type OtpProvider } from './providers/otp';
import { profileRoutes } from './modules/customers/profile.routes';
import { adminPeopleRoutes } from './modules/people/people.routes';
import { serviceAreaRoutes } from './modules/service-areas/service-areas.routes';
import { orderingRoutes, type Clock } from './modules/ordering/ordering.routes';

export const API_VERSION = '0.1.0';

export interface AppDeps {
  env: Env;
  db: Database;
  logger: Logger;
  /** Tests pass their own provider to read the code; otherwise chosen by OTP_PROVIDER. */
  otpProvider?: OtpProvider;
  /** Tests pass a fixed clock to check cut-off times; otherwise the real time. */
  clock?: Clock;
}

export function createApp({ env, db, logger, otpProvider, clock }: AppDeps): Express {
  const app = express();
  const tokens = new TokenService(env.JWT_SECRET);
  const authDeps: AuthDeps = {
    db,
    tokens,
    otp: otpProvider ?? createOtpProvider(env),
    // A separate key derived from the JWT secret, so code hashes and tokens never share a key.
    otpSecret: `${env.JWT_SECRET}:otp-v1`,
    supplierSlug: env.DEFAULT_SUPPLIER_SLUG,
    otpPerIpPerHour: env.OTP_PER_IP_PER_HOUR,
  };

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
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'X-Request-Id',
        ADMIN_CLIENT_HEADER,
      ],
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
  app.use(authenticate(tokens, (id) => sessionIsOpen(db, id)));

  const v1 = express.Router();
  v1.use(healthRoutes(db, API_VERSION));
  v1.use(meRoutes(db));
  v1.use(auditRoutes(db));
  v1.use(settingsRoutes(db));
  v1.use(authRoutes(db, env, authDeps));
  v1.use(profileRoutes(db));
  v1.use(serviceAreaRoutes(db));
  v1.use(adminPeopleRoutes(db));
  v1.use(orderingRoutes(db, clock ?? (() => new Date())));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
