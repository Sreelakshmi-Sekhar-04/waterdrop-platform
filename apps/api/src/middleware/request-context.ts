import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Gives every request an id (echoed in X-Request-Id and in error bodies) and a context object. */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.ctx = { requestId, ip: req.ip };
  res.setHeader('X-Request-Id', requestId);
  next();
};
