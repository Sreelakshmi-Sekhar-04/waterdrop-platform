/**
 * Duplicate-request protection (QA scenarios 4 and 8).
 *
 * Mobile networks drop responses, so apps retry. A client sends the same
 * Idempotency-Key header on every retry of one action. The first request runs;
 * later ones get the stored response instead of running again.
 *
 * - Same key, same request, finished  → stored response, header Idempotent-Replayed: true
 * - Same key, same request, running   → 409 REQUEST_IN_PROGRESS
 * - Same key, different request       → 422 IDEMPOTENCY_KEY_REUSED
 * - Server errors (5xx) are not stored, so the client can safely retry.
 *
 * Keys are scoped to the signed-in user and kept for 24 hours. Business tables
 * add their own unique constraints as the final guard (e.g. orders.client_request_id).
 */
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { and, eq, lt } from 'drizzle-orm';
import { idempotencyKeySchema } from '@wtrdrop/shared';
import type { Database } from '../db/client';
import { idempotencyKeys } from '../db/schema';
import { AppError, errors } from '../lib/errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hashRequest(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method}\n${path}\n${JSON.stringify(body ?? null)}`)
    .digest('hex');
}

export function idempotency(db: Database, opts: { required?: boolean } = {}): RequestHandler {
  return async (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    const header = req.header('idempotency-key');
    if (!header) {
      if (opts.required) {
        throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required.');
      }
      return next();
    }
    const auth = req.ctx.auth;
    if (!auth) throw errors.unauthenticated();
    const parsed = idempotencyKeySchema.safeParse(header);
    if (!parsed.success) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key header is invalid.');
    }
    const key = parsed.data;
    const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
    const requestHash = hashRequest(req.method, path, req.body);

    // Forget expired keys for this user/key so they can be reused.
    await db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, auth.userId),
          eq(idempotencyKeys.key, key),
          lt(idempotencyKeys.expiresAt, new Date()),
        ),
      );

    const inserted = await db
      .insert(idempotencyKeys)
      .values({ userId: auth.userId, key, method: req.method, path, requestHash })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });

    if (inserted.length === 0) {
      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, auth.userId), eq(idempotencyKeys.key, key)));
      if (!existing || existing.requestHash !== requestHash) {
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request.',
        );
      }
      if (existing.state === 'in_progress') {
        throw errors.conflict('REQUEST_IN_PROGRESS', 'This request is still being processed.');
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.responseStatus ?? 200).json(existing.responseBody);
      return;
    }

    const rowId = inserted[0]!.id;
    const originalJson = res.json.bind(res);
    // Store the result before the client receives it, so an immediate retry sees it.
    res.json = ((body: unknown) => {
      const status = res.statusCode;
      const persist =
        status >= 500
          ? db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, rowId))
          : db
              .update(idempotencyKeys)
              .set({ state: 'completed', responseStatus: status, responseBody: body ?? null })
              .where(eq(idempotencyKeys.id, rowId));
      persist.then(
        () => originalJson(body),
        (err: unknown) => {
          req.log?.error({ err }, 'failed to store idempotent response');
          originalJson(body);
        },
      );
      return res;
    }) as typeof res.json;
    next();
  };
}
