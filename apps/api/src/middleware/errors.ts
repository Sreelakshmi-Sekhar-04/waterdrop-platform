import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@wtrdrop/shared';
import { AppError } from '../lib/errors';

export const notFoundHandler: RequestHandler = (req) => {
  throw new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`);
};

/** The only place error responses are written. Internal details never reach the client. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.ctx?.requestId;
  let status = 500;
  let body: ApiError = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      requestId,
    },
  };

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, requestId, details: err.details } };
  } else if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.parse.failed'
  ) {
    status = 400;
    body = {
      error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.', requestId },
    };
  } else if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    (err as { type?: string }).type === 'entity.too.large'
  ) {
    status = 413;
    body = {
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.', requestId },
    };
  }

  if (status >= 500) req.log?.error({ err }, 'unhandled error');
  if (res.headersSent) return;
  res.status(status).json(body);
};
