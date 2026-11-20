/**
 * Sign-in (Phase 3, decisions D-01 and D-02).
 *
 * - Everyone proves their phone number with a 6-digit SMS code.
 * - Customers: the code is enough. First sign-in creates their customer record.
 * - Staff: the code once per phone, then a 4-digit PIN on that phone each day.
 * - Admin and owner: the code plus a password. The first sign-in sets the password.
 *
 * Sessions are a short access token (15 min) plus a rotating refresh token.
 * Re-using an old refresh token signs out every session from that sign-in.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Language, Role } from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import {
  customers,
  otpRequests,
  sessions,
  staffDevices,
  suppliers,
  userRoles,
  users,
} from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import {
  hashOtp,
  hashRefreshToken,
  hashSecret,
  isWeakPin,
  newOtpCode,
  newRefreshToken,
  safeEqualHex,
  verifySecret,
} from '../../lib/credentials';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import { ACCESS_TOKEN_TTL_SECONDS, type TokenService } from '../../lib/tokens';
import { OtpDeliveryError, type OtpProvider } from '../../providers/otp';

export const OTP = {
  ttlSeconds: 5 * 60,
  maxAttempts: 5,
  resendAfterSeconds: 30,
  perPhonePer10Min: 3,
  perPhonePerDay: 10,
} as const;
export const PIN_MAX_ATTEMPTS = 5;

const DAY = 24 * 60 * 60 * 1000;
/** How long a sign-in lasts. Staff enter their PIN each working day. */
export const SESSION_TTL_MS: Record<Role, number> = {
  customer: 90 * DAY,
  staff: 16 * 60 * 60 * 1000,
  admin: 12 * 60 * 60 * 1000,
  owner: 12 * 60 * 60 * 1000,
};
/** Customer sign-ins extend with use; staff and admin sign-ins end at a fixed time. */
const SLIDING: Record<Role, boolean> = { customer: true, staff: false, admin: false, owner: false };

export type AppKind = 'customer' | 'staff' | 'admin';
export const ADMIN_PASSWORD_STEP = 'admin-password-setup';

export interface AuthDeps {
  db: Database;
  tokens: TokenService;
  otp: OtpProvider;
  otpSecret: string;
  supplierSlug: string;
  /** Codes one network address may request per hour (shared Wi-Fi and mobile NAT need headroom). */
  otpPerIpPerHour: number;
}

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

const codeWrong = (attemptsLeft: number) =>
  new AppError(400, 'OTP_INVALID', 'The code is wrong or has expired.', { attemptsLeft });

async function activeSupplier(db: DbOrTx, slug: string) {
  const [s] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.slug, slug), eq(suppliers.status, 'active')));
  if (!s) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Sign-in is not available right now.');
  return s.id;
}

// ------------------------------------------------------------------ codes

export async function requestOtp(deps: AuthDeps, input: { phone: string; ip?: string }) {
  const { db } = deps;
  const now = Date.now();
  const count = async (where: ReturnType<typeof and>) => {
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpRequests)
      .where(where);
    return r?.n ?? 0;
  };
  const since = (ms: number) => new Date(now - ms);

  const [last] = await db
    .select({ createdAt: otpRequests.createdAt })
    .from(otpRequests)
    .where(eq(otpRequests.phone, input.phone))
    .orderBy(desc(otpRequests.createdAt))
    .limit(1);
  if (last && now - last.createdAt.getTime() < OTP.resendAfterSeconds * 1000) {
    const wait = Math.ceil(
      (OTP.resendAfterSeconds * 1000 - (now - last.createdAt.getTime())) / 1000,
    );
    throw errors.tooMany('OTP_RESEND_TOO_SOON', 'Please wait before asking for a new code.', {
      retryAfterSeconds: wait,
    });
  }
  if (
    (await count(
      and(eq(otpRequests.phone, input.phone), gte(otpRequests.createdAt, since(10 * 60_000))),
    )) >= OTP.perPhonePer10Min ||
    (await count(
      and(eq(otpRequests.phone, input.phone), gte(otpRequests.createdAt, since(DAY))),
    )) >= OTP.perPhonePerDay
  ) {
    throw errors.tooMany('OTP_LIMIT', 'Too many codes for this number. Please try again later.');
  }
  if (
    input.ip &&
    (await count(
      and(eq(otpRequests.ip, input.ip), gte(otpRequests.createdAt, since(60 * 60_000))),
    )) >= deps.otpPerIpPerHour
  ) {
    throw errors.tooMany('OTP_LIMIT', 'Too many codes requested. Please try again later.');
  }

  const code = newOtpCode();
  const [row] = await db
    .insert(otpRequests)
    .values({
      phone: input.phone,
      codeHash: hashOtp(deps.otpSecret, input.phone, code),
      expiresAt: new Date(now + OTP.ttlSeconds * 1000),
      ip: input.ip ?? null,
    })
    .returning({ id: otpRequests.id });

  const [u] = await db
    .select({ lang: users.preferredLanguage })
    .from(users)
    .where(eq(users.phone, input.phone));
  try {
    await deps.otp.send({ phone: input.phone, code, language: (u?.lang ?? 'en') as Language });
  } catch (err) {
    // A code that never arrived must not stay usable.
    await db.update(otpRequests).set({ consumedAt: new Date() }).where(eq(otpRequests.id, row!.id));
    if (err instanceof OtpDeliveryError) {
      throw new AppError(503, 'OTP_SEND_FAILED', 'We could not send the code. Please try again.');
    }
    throw err;
  }
  // Same answer whether or not the number has an account, so numbers cannot be probed.
  return { expiresInSeconds: OTP.ttlSeconds, resendAfterSeconds: OTP.resendAfterSeconds };
}

/**
 * Checks a code. The attempt is counted before comparing, in one atomic update,
 * so parallel guesses cannot exceed the limit. Returns a function that marks
 * the code used, so callers can run extra checks (admin password) first.
 */
async function checkOtp(deps: AuthDeps, phone: string, code: string) {
  const { db } = deps;
  const [current] = await db
    .select({ id: otpRequests.id })
    .from(otpRequests)
    .where(
      and(
        eq(otpRequests.phone, phone),
        isNull(otpRequests.consumedAt),
        gt(otpRequests.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpRequests.createdAt))
    .limit(1);
  if (!current) throw codeWrong(0);

  const [counted] = await db
    .update(otpRequests)
    .set({ attempts: sql`${otpRequests.attempts} + 1` })
    .where(and(eq(otpRequests.id, current.id), sql`${otpRequests.attempts} < ${OTP.maxAttempts}`))
    .returning({ attempts: otpRequests.attempts, codeHash: otpRequests.codeHash });
  if (!counted) {
    throw errors.tooMany(
      'OTP_TOO_MANY_ATTEMPTS',
      'Too many wrong codes. Please ask for a new code.',
    );
  }
  const attemptsLeft = OTP.maxAttempts - counted.attempts;
  if (!safeEqualHex(counted.codeHash, hashOtp(deps.otpSecret, phone, code))) {
    throw codeWrong(attemptsLeft);
  }
  return {
    attemptsLeft,
    consume: async () => {
      const [used] = await db
        .update(otpRequests)
        .set({ consumedAt: new Date() })
        .where(and(eq(otpRequests.id, current.id), isNull(otpRequests.consumedAt)))
        .returning({ id: otpRequests.id });
      // Two requests with the same code at once: only one wins.
      if (!used) throw codeWrong(0);
    },
  };
}

// --------------------------------------------------------------- sessions

async function createSession(
  deps: AuthDeps,
  db: DbOrTx,
  s: {
    userId: string;
    supplierId: string;
    role: Role;
    familyId?: string;
    deviceId?: string | null;
    userAgent?: string;
    expiresAt?: Date;
  },
): Promise<SessionTokens> {
  const refreshToken = newRefreshToken();
  const expiresAt = s.expiresAt ?? new Date(Date.now() + SESSION_TTL_MS[s.role]);
  const [row] = await db
    .insert(sessions)
    .values({
      userId: s.userId,
      supplierId: s.supplierId,
      role: s.role,
      familyId: s.familyId ?? randomUUID(),
      refreshTokenHash: hashRefreshToken(refreshToken),
      deviceId: s.deviceId ?? null,
      userAgent: s.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    })
    .returning({ id: sessions.id });
  const accessToken = await deps.tokens.issueAccessToken({
    userId: s.userId,
    supplierId: s.supplierId,
    role: s.role,
    sessionId: row!.id,
  });
  return {
    accessToken,
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresAt: expiresAt.toISOString(),
  };
}

/** True while the user, the role and the supplier are all still active. */
async function stillAllowed(db: DbOrTx, userId: string, supplierId: string, role: Role) {
  const [row] = await db
    .select({ u: users.status, s: suppliers.status, r: userRoles.status })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(suppliers, eq(suppliers.id, userRoles.supplierId))
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.supplierId, supplierId),
        eq(userRoles.role, role),
      ),
    );
  return row?.u === 'active' && row.s === 'active' && row.r === 'active';
}

export async function refreshSession(deps: AuthDeps, token: string, userAgent?: string) {
  const { db } = deps;
  const outcome = await db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, hashRefreshToken(token)))
      .for('update');
    if (!s) return { kind: 'unknown' as const };
    if (s.revokedAt) {
      // An already-used token came back: it may have been stolen. End the whole sign-in.
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt)));
      return { kind: 'reused' as const };
    }
    // Rotate: this token is used up whatever happens next.
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, s.id));
    if (
      s.expiresAt.getTime() <= Date.now() ||
      !(await stillAllowed(tx, s.userId, s.supplierId, s.role))
    ) {
      return { kind: 'ended' as const };
    }
    const tokens = await createSession(deps, tx, {
      userId: s.userId,
      supplierId: s.supplierId,
      role: s.role,
      familyId: s.familyId,
      deviceId: s.deviceId,
      userAgent,
      expiresAt: SLIDING[s.role] ? undefined : s.expiresAt,
    });
    return { kind: 'ok' as const, tokens };
  });
  // Errors are raised after the commit, so the revocations above are kept.
  if (outcome.kind === 'reused')
    throw new AppError(401, 'SESSION_REVOKED', 'Please sign in again.');
  if (outcome.kind !== 'ok') throw errors.unauthenticated();
  return outcome.tokens;
}

/** Signing out ends this sign-in on this device (the whole rotation family). */
export async function signOut(db: Database, sessionId: string) {
  const [s] = await db
    .select({ familyId: sessions.familyId })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!s) return;
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.familyId, s.familyId), isNull(sessions.revokedAt)));
}

/** Used by the auth middleware: an access token only works while its session is open. */
export async function sessionIsOpen(db: Database, sessionId: string): Promise<boolean> {
  const [s] = await db
    .select({ revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return !!s && !s.revokedAt && s.expiresAt.getTime() > Date.now();
}

// ------------------------------------------------------------ sign-in by app

export interface VerifyInput {
  app: AppKind;
  phone: string;
  code: string;
  deviceId?: string;
  password?: string;
  userAgent?: string;
  ip?: string;
  requestId: string;
}

export type VerifyResult =
  | ({ status: 'signed_in'; role: Role; next: NextSteps } & SessionTokens)
  | { status: 'password_setup_required'; setupToken: string };

export interface NextSteps {
  profileComplete?: boolean;
  hasAddress?: boolean;
  pinSet?: boolean;
}

export async function verifyOtpAndSignIn(
  deps: AuthDeps,
  input: VerifyInput,
): Promise<VerifyResult> {
  const { db } = deps;
  const supplierId = await activeSupplier(db, deps.supplierSlug);
  const check = await checkOtp(deps, input.phone, input.code);

  if (input.app === 'customer') {
    await check.consume();
    return db.transaction(async (tx) => {
      await tx.insert(users).values({ phone: input.phone }).onConflictDoNothing();
      const [u] = await tx
        .select({ id: users.id, status: users.status, name: users.name })
        .from(users)
        .where(eq(users.phone, input.phone));
      if (!u || u.status !== 'active') throw accountDisabled();
      await tx
        .insert(userRoles)
        .values({ userId: u.id, supplierId, role: 'customer' })
        .onConflictDoNothing();
      const [role] = await tx
        .select({ status: userRoles.status })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, u.id),
            eq(userRoles.supplierId, supplierId),
            eq(userRoles.role, 'customer'),
          ),
        );
      if (role?.status !== 'active') throw accountDisabled();
      await tx
        .insert(customers)
        .values({ userId: u.id, supplierId, createdBy: u.id })
        .onConflictDoNothing();
      const [c] = await tx
        .select({
          id: customers.id,
          status: customers.status,
          privacyAcceptedAt: customers.privacyAcceptedAt,
        })
        .from(customers)
        .where(and(eq(customers.userId, u.id), eq(customers.supplierId, supplierId)));
      if (!c || c.status !== 'active') throw accountDisabled();
      const [a] = await tx
        .execute<{ n: number }>(
          sql`select count(*)::int as n from addresses where customer_id = ${c.id} and archived_at is null`,
        )
        .then((r) => r.rows);
      const tokens = await createSession(deps, tx, {
        userId: u.id,
        supplierId,
        role: 'customer',
        userAgent: input.userAgent,
      });
      return {
        status: 'signed_in' as const,
        role: 'customer' as const,
        next: { profileComplete: !!u.name && !!c.privacyAcceptedAt, hasAddress: (a?.n ?? 0) > 0 },
        ...tokens,
      };
    });
  }

  const wanted: Role[] = input.app === 'staff' ? ['staff'] : ['owner', 'admin'];
  const rows = await db
    .select({
      id: users.id,
      userStatus: users.status,
      roleStatus: userRoles.status,
      passwordHash: users.passwordHash,
      role: userRoles.role,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(users.phone, input.phone),
        eq(userRoles.supplierId, supplierId),
        inArray(userRoles.role, wanted),
      ),
    );
  // owner before admin when someone has both.
  const found = rows
    .filter((x) => x.roleStatus === 'active')
    .sort((x, y) => wanted.indexOf(x.role) - wanted.indexOf(y.role))[0];
  const row = found && { ...found, status: found.userStatus };
  const switchedOff = !found && rows.length > 0;

  if (input.app === 'staff') {
    if (switchedOff) {
      await check.consume();
      throw accountDisabled();
    }
    if (!row) {
      await check.consume();
      throw new AppError(
        403,
        'NOT_STAFF',
        'This number is not registered as delivery staff. Please ask the office.',
      );
    }
    if (row.status !== 'active') {
      await check.consume();
      throw accountDisabled();
    }
    if (!input.deviceId) throw errors.validation([{ path: 'deviceId', message: 'Required' }]);
    await check.consume();
    const [device] = await db
      .select({ id: staffDevices.id })
      .from(staffDevices)
      .where(
        and(
          eq(staffDevices.userId, row.id),
          eq(staffDevices.supplierId, supplierId),
          eq(staffDevices.deviceId, input.deviceId),
          isNull(staffDevices.revokedAt),
        ),
      );
    const tokens = await createSession(deps, db, {
      userId: row.id,
      supplierId,
      role: 'staff',
      deviceId: input.deviceId,
      userAgent: input.userAgent,
    });
    return { status: 'signed_in', role: 'staff', next: { pinSet: !!device }, ...tokens };
  }

  // Admin portal: SMS code + password. Same message for every failure, so nothing is revealed.
  const adminFailed = () =>
    new AppError(401, 'ADMIN_SIGN_IN_FAILED', 'The code or password is wrong.', {
      attemptsLeft: check.attemptsLeft,
    });
  if (!row || row.status !== 'active') {
    await verifySecret(DUMMY_HASH, input.password ?? ''); // same timing as a real check
    throw adminFailed();
  }
  if (row.passwordHash) {
    if (!input.password || !(await verifySecret(row.passwordHash, input.password)))
      throw adminFailed();
    await check.consume();
    const tokens = await createSession(deps, db, {
      userId: row.id,
      supplierId,
      role: row.role,
      userAgent: input.userAgent,
    });
    return { status: 'signed_in', role: row.role, next: {}, ...tokens };
  }
  await check.consume();
  const setupToken = await deps.tokens.issueStepToken(ADMIN_PASSWORD_STEP, {
    userId: row.id,
    supplierId,
    role: row.role,
  });
  return { status: 'password_setup_required', setupToken };
}

const accountDisabled = () =>
  new AppError(403, 'ACCOUNT_DISABLED', 'This account is switched off. Please contact the office.');

// Precomputed so a missing account costs the same time as a wrong password.
let DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000';
void hashSecret('not-a-real-password').then((h) => (DUMMY_HASH = h));

// ---------------------------------------------------------- admin password

export function checkPasswordStrength(pw: string): string | null {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  if (/^(.)\1+$/.test(pw)) return 'Do not repeat one character.';
  if (/^\d+$/.test(pw)) return 'Do not use only numbers.';
  return null;
}

export async function setFirstAdminPassword(
  deps: AuthDeps,
  input: {
    setupToken: string;
    password: string;
    userAgent?: string;
    ip?: string;
    requestId: string;
  },
) {
  const claims = await deps.tokens.verifyStepToken(ADMIN_PASSWORD_STEP, input.setupToken);
  if (!claims)
    throw new AppError(401, 'SETUP_EXPIRED', 'This step has expired. Please sign in again.');
  const weak = checkPasswordStrength(input.password);
  if (weak) throw errors.validation([{ path: 'password', message: weak }]);
  const hashed = await hashSecret(input.password);
  return deps.db.transaction(async (tx) => {
    // Only the first time: a password that is already set is changed from Settings instead.
    const [u] = await tx
      .update(users)
      .set({ passwordHash: hashed, updatedAt: new Date() })
      .where(and(eq(users.id, claims.userId), isNull(users.passwordHash)))
      .returning({ id: users.id });
    if (!u)
      throw new AppError(409, 'PASSWORD_ALREADY_SET', 'A password is already set. Please sign in.');
    const tokens = await createSession(deps, tx, { ...claims, userAgent: input.userAgent });
    await recordAudit(
      tx,
      { ...claims, sessionId: '', requestId: input.requestId, ip: input.ip },
      { action: 'admin.password_set', entityType: 'user', entityId: claims.userId },
    );
    return { status: 'signed_in' as const, role: claims.role, next: {}, ...tokens };
  });
}

export async function changeAdminPassword(
  db: Database,
  ctx: TenantContext,
  input: { currentPassword: string; newPassword: string },
) {
  const [u] = await db
    .select({ h: users.passwordHash })
    .from(users)
    .where(eq(users.id, ctx.userId));
  if (!u?.h || !(await verifySecret(u.h, input.currentPassword))) {
    throw new AppError(400, 'PASSWORD_WRONG', 'The current password is wrong.');
  }
  const weak = checkPasswordStrength(input.newPassword);
  if (weak) throw errors.validation([{ path: 'newPassword', message: weak }]);
  const hashed = await hashSecret(input.newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: hashed, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));
    // Other signed-in browsers must sign in again with the new password.
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, ctx.userId),
          isNull(sessions.revokedAt),
          sql`${sessions.id} <> ${ctx.sessionId}`,
        ),
      );
    await recordAudit(tx, ctx, {
      action: 'admin.password_changed',
      entityType: 'user',
      entityId: ctx.userId,
    });
  });
}

// ---------------------------------------------------------------- staff PIN

export async function setStaffPin(db: Database, ctx: TenantContext, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw errors.validation([{ path: 'pin', message: 'Use 4 digits.' }]);
  if (isWeakPin(pin))
    throw new AppError(
      400,
      'PIN_TOO_SIMPLE',
      'This PIN is too easy to guess. Please choose another.',
    );
  const [s] = await db
    .select({ deviceId: sessions.deviceId })
    .from(sessions)
    .where(eq(sessions.id, ctx.sessionId));
  if (!s?.deviceId)
    throw new AppError(400, 'DEVICE_REQUIRED', 'Please sign in on the staff app first.');
  const pinHash = await hashSecret(pin);
  await db.transaction(async (tx) => {
    await tx
      .update(staffDevices)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(staffDevices.userId, ctx.userId),
          eq(staffDevices.supplierId, ctx.supplierId),
          eq(staffDevices.deviceId, s.deviceId!),
          isNull(staffDevices.revokedAt),
        ),
      );
    await tx.insert(staffDevices).values({
      userId: ctx.userId,
      supplierId: ctx.supplierId,
      deviceId: s.deviceId!,
      pinHash,
    });
    await recordAudit(tx, ctx, {
      action: 'staff.pin_set',
      entityType: 'user',
      entityId: ctx.userId,
    });
  });
}

export async function staffPinSignIn(
  deps: AuthDeps,
  input: { phone: string; deviceId: string; pin: string; userAgent?: string },
) {
  const { db } = deps;
  const supplierId = await activeSupplier(db, deps.supplierSlug);
  const useCode = () =>
    new AppError(401, 'PIN_NOT_SET', 'Please sign in with an SMS code on this phone.');
  const [row] = await db
    .select({
      deviceRowId: staffDevices.id,
      pinHash: staffDevices.pinHash,
      failed: staffDevices.failedAttempts,
      userId: users.id,
    })
    .from(staffDevices)
    .innerJoin(users, eq(users.id, staffDevices.userId))
    .where(
      and(
        eq(users.phone, input.phone),
        eq(staffDevices.supplierId, supplierId),
        eq(staffDevices.deviceId, input.deviceId),
        isNull(staffDevices.revokedAt),
      ),
    );
  if (!row) {
    await verifySecret(DUMMY_HASH, input.pin);
    throw useCode();
  }
  if (!(await stillAllowed(db, row.userId, supplierId, 'staff'))) throw accountDisabled();

  // Count first, atomically, so parallel guesses cannot exceed the limit.
  const [counted] = await db
    .update(staffDevices)
    .set({ failedAttempts: sql`${staffDevices.failedAttempts} + 1` })
    .where(
      and(
        eq(staffDevices.id, row.deviceRowId),
        sql`${staffDevices.failedAttempts} < ${PIN_MAX_ATTEMPTS}`,
      ),
    )
    .returning({ failed: staffDevices.failedAttempts });
  if (!counted) throw pinLocked();
  if (!(await verifySecret(row.pinHash, input.pin))) {
    const left = PIN_MAX_ATTEMPTS - counted.failed;
    if (left <= 0) {
      await db
        .update(staffDevices)
        .set({ revokedAt: new Date() })
        .where(eq(staffDevices.id, row.deviceRowId));
      throw pinLocked();
    }
    throw new AppError(401, 'PIN_WRONG', 'Wrong PIN.', { attemptsLeft: left });
  }
  await db
    .update(staffDevices)
    .set({ failedAttempts: 0, lastUsedAt: new Date() })
    .where(eq(staffDevices.id, row.deviceRowId));
  const tokens = await createSession(deps, db, {
    userId: row.userId,
    supplierId,
    role: 'staff',
    deviceId: input.deviceId,
    userAgent: input.userAgent,
  });
  return {
    status: 'signed_in' as const,
    role: 'staff' as const,
    next: { pinSet: true },
    ...tokens,
  };
}

const pinLocked = () =>
  new AppError(423, 'PIN_LOCKED', 'Too many wrong PINs. Please sign in with an SMS code.');
