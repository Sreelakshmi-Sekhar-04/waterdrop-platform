import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { indianMobileSchema } from '@wtrdrop/shared';
import type { Database } from '../../db/client';
import type { Env } from '../../config/env';
import { AppError, errors } from '../../lib/errors';
import { requireAuth, requireRole, tenant } from '../../middleware/auth';
import { parse } from '../../middleware/validate';
import {
  changeAdminPassword,
  refreshSession,
  requestOtp,
  setFirstAdminPassword,
  setStaffPin,
  signOut,
  staffPinSignIn,
  verifyOtpAndSignIn,
  type AuthDeps,
  type SessionTokens,
} from './auth.service';

/** The admin portal keeps its refresh token in an httpOnly cookie, out of reach of page scripts. */
export const ADMIN_COOKIE = 'wtrdrop_admin_rt';
const COOKIE_PATH = '/api/v1/auth';
/** Cookie-based calls must carry this header; browsers cannot add it cross-site without CORS. */
export const ADMIN_CLIENT_HEADER = 'x-wtrdrop-client';

const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,100}$/, 'Invalid device id');
const requestSchema = z.object({ phone: indianMobileSchema });
const verifySchema = z.object({
  app: z.enum(['customer', 'staff', 'admin']),
  phone: indianMobileSchema,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  deviceId: deviceIdSchema.optional(),
  password: z.string().max(128).optional(),
});

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.header('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function authRoutes(db: Database, env: Env, deps: AuthDeps): Router {
  const r = Router();
  const secure = env.NODE_ENV === 'production';
  const isAdminClient = (req: Request) => req.header(ADMIN_CLIENT_HEADER) === 'admin';

  /** Mobile apps get the refresh token in the body; the admin portal gets a cookie instead. */
  const sendTokens = (req: Request, res: Response, t: SessionTokens, extra: object) => {
    if (isAdminClient(req)) {
      res.cookie(ADMIN_COOKIE, t.refreshToken, {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: COOKIE_PATH,
        expires: new Date(t.refreshTokenExpiresAt),
      });
      const { refreshToken: _omit, ...rest } = t;
      return res.json({ ...extra, ...rest });
    }
    return res.json({ ...extra, ...t });
  };
  const ua = (req: Request) => req.header('user-agent') ?? undefined;

  r.post('/auth/otp/request', async (req, res) => {
    const { phone } = parse(requestSchema, req.body);
    res.json(await requestOtp(deps, { phone, ip: req.ctx.ip }));
  });

  r.post('/auth/otp/verify', async (req, res) => {
    const input = parse(verifySchema, req.body);
    if (input.app === 'admin' && !isAdminClient(req)) throw errors.forbidden();
    const result = await verifyOtpAndSignIn(deps, {
      ...input,
      userAgent: ua(req),
      ip: req.ctx.ip,
      requestId: req.ctx.requestId,
    });
    if (result.status !== 'signed_in') return res.json(result);
    const { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, ...extra } =
      result;
    return sendTokens(
      req,
      res,
      { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt },
      extra,
    );
  });

  r.post('/auth/admin/password/setup', async (req, res) => {
    if (!isAdminClient(req)) throw errors.forbidden();
    const body = parse(
      z.object({ setupToken: z.string().min(10), password: z.string() }),
      req.body,
    );
    const { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, ...extra } =
      await setFirstAdminPassword(deps, {
        ...body,
        userAgent: ua(req),
        ip: req.ctx.ip,
        requestId: req.ctx.requestId,
      });
    return sendTokens(
      req,
      res,
      { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt },
      extra,
    );
  });

  r.post('/auth/admin/password/change', requireRole('admin', 'owner'), async (req, res) => {
    const body = parse(
      z.object({ currentPassword: z.string().max(128), newPassword: z.string() }),
      req.body,
    );
    await changeAdminPassword(db, tenant(req), body);
    res.json({ ok: true });
  });

  r.post('/auth/staff/pin', requireRole('staff'), async (req, res) => {
    const { pin } = parse(z.object({ pin: z.string() }), req.body);
    await setStaffPin(db, tenant(req), pin);
    res.json({ ok: true });
  });

  r.post('/auth/staff/pin/sign-in', async (req, res) => {
    const body = parse(
      z.object({
        phone: indianMobileSchema,
        deviceId: deviceIdSchema,
        pin: z.string().regex(/^\d{4}$/, 'Use 4 digits'),
      }),
      req.body,
    );
    const { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt, ...extra } =
      await staffPinSignIn(deps, { ...body, userAgent: ua(req) });
    return sendTokens(
      req,
      res,
      { accessToken, accessTokenExpiresIn, refreshToken, refreshTokenExpiresAt },
      extra,
    );
  });

  r.post('/auth/refresh', async (req, res) => {
    let token: string | undefined;
    if (isAdminClient(req)) token = readCookie(req, ADMIN_COOKIE);
    else
      token = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body).refreshToken;
    if (!token) throw errors.unauthenticated();
    try {
      return sendTokens(req, res, await refreshSession(deps, token, ua(req)), {});
    } catch (e) {
      if (e instanceof AppError && isAdminClient(req))
        res.clearCookie(ADMIN_COOKIE, { path: COOKIE_PATH });
      throw e;
    }
  });

  r.post('/auth/sign-out', requireAuth, async (req, res) => {
    await signOut(db, tenant(req).sessionId);
    if (isAdminClient(req)) res.clearCookie(ADMIN_COOKIE, { path: COOKIE_PATH });
    res.json({ ok: true });
  });

  return r;
}
