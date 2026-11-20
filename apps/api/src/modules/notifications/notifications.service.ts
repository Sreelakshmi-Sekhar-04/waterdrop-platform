/**
 * Messages to customers (Phase 7). An event writes a `notifications` row in its own transaction
 * (an outbox), so a message is never lost and never sent for something that was rolled back.
 * After each request the dispatcher sends what is waiting as a push; the app lists every message
 * too, so a customer without push still sees them.
 */
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  DUES_REMINDER_GAP_HOURS,
  formatINR,
  type FailureReason,
  type Language,
  type NotificationKind,
} from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import { customers, notifications, pushTokens, users } from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import type { PushProvider } from '../../providers/push';

export interface NotificationParams {
  orderNo?: number;
  cans?: number;
  amountPaise?: number;
  duePaise?: number;
  reason?: FailureReason | string;
  category?: string;
  resolution?: string;
}

export async function queueNotification(
  tx: DbOrTx,
  n: {
    supplierId: string;
    userId: string;
    kind: NotificationKind;
    params: NotificationParams;
    orderId?: string | null;
  },
) {
  await tx.insert(notifications).values({
    supplierId: n.supplierId,
    userId: n.userId,
    kind: n.kind,
    params: n.params,
    orderId: n.orderId ?? null,
  });
}

/** The user behind a customer, for messages. */
export async function customerUserId(tx: DbOrTx, customerId: string) {
  const [c] = await tx
    .select({ userId: customers.userId })
    .from(customers)
    .where(eq(customers.id, customerId));
  return c?.userId ?? null;
}

// ---------------------------------------------------------------- texts

const REASON: Record<Language, Record<string, string>> = {
  en: {
    NOT_HOME: 'no one was home',
    LOCKED: 'the gate was locked',
    REFUSED: 'the order was refused',
    WRONG_ADDRESS: 'we could not find the address',
    OUT_OF_STOCK: 'the van ran out of cans',
    OTHER: 'something went wrong',
  },
  ml: {
    NOT_HOME: 'വീട്ടിൽ ആരുമില്ലായിരുന്നു',
    LOCKED: 'ഗേറ്റ് പൂട്ടിയിരുന്നു',
    REFUSED: 'ഓർഡർ നിരസിച്ചു',
    WRONG_ADDRESS: 'വിലാസം കണ്ടെത്താനായില്ല',
    OUT_OF_STOCK: 'വാനിൽ ക്യാനുകൾ തീർന്നു',
    OTHER: 'ഒരു പ്രശ്നമുണ്ടായി',
  },
};

/** Title and text of a message in the reader's language. */
export function messageText(
  kind: NotificationKind,
  p: NotificationParams,
  lang: Language,
): { title: string; body: string } {
  const no = p.orderNo ? `WD-${p.orderNo}` : '';
  const money = (v?: number) => formatINR(Math.max(0, v ?? 0));
  const ml = lang === 'ml';
  const cans = (n = 0) => (ml ? `${n} ക്യാൻ` : n === 1 ? '1 can' : `${n} cans`);
  switch (kind) {
    case 'out_for_delivery':
      return ml
        ? {
            title: 'വെള്ളം വഴിയിലാണ്',
            body: `${no}: ${cans(p.cans)} ഇന്ന് എത്തും. ഒഴിഞ്ഞ ക്യാനുകൾ തയ്യാറാക്കി വെക്കുക.`,
          }
        : {
            title: 'Your water is on the way',
            body: `${no}: ${cans(p.cans)} arriving today. Please keep your empty cans ready.`,
          };
    case 'delivered':
      return ml
        ? {
            title: 'ഡെലിവർ ചെയ്തു',
            body: `${no}: ${cans(p.cans)} നൽകി.${p.amountPaise ? ` ${money(p.amountPaise)} ലഭിച്ചു.` : ''}${(p.duePaise ?? 0) > 0 ? ` കുടിശ്ശിക ${money(p.duePaise)}.` : ''}`,
          }
        : {
            title: 'Delivered',
            body: `${no}: ${cans(p.cans)} delivered.${p.amountPaise ? ` ${money(p.amountPaise)} received.` : ''}${(p.duePaise ?? 0) > 0 ? ` Amount due ${money(p.duePaise)}.` : ''}`,
          };
    case 'not_delivered': {
      const why = REASON[lang][p.reason ?? 'OTHER'] ?? REASON[lang].OTHER;
      return ml
        ? { title: 'ഡെലിവർ ചെയ്യാനായില്ല', body: `${no}: ${why}. ഞങ്ങൾ പുതിയ സമയം അറിയിക്കും.` }
        : {
            title: "We couldn't deliver",
            body: `${no}: ${why}. We will call you to fix a new time.`,
          };
    }
    case 'order_cancelled':
      return ml
        ? { title: 'ഓർഡർ റദ്ദാക്കി', body: `${no} റദ്ദാക്കി. സംശയങ്ങൾക്ക് ഞങ്ങളെ വിളിക്കുക.` }
        : {
            title: 'Order cancelled',
            body: `${no} was cancelled. Call us if you have a question.`,
          };
    case 'dues_reminder':
      return ml
        ? {
            title: 'കുടിശ്ശിക ഓർമ്മപ്പെടുത്തൽ',
            body: `നിങ്ങളുടെ കുടിശ്ശിക ${money(p.duePaise)}. അടുത്ത ഡെലിവറിയിലോ UPI വഴിയോ അടയ്ക്കുക. നന്ദി.`,
          }
        : {
            title: 'Payment reminder',
            body: `Your amount due is ${money(p.duePaise)}. Please pay on the next delivery or by UPI. Thank you.`,
          };
    case 'complaint_resolved':
      return ml
        ? { title: 'നിങ്ങളുടെ പരാതി', body: `പരിഹരിച്ചു: ${p.resolution ?? ''}` }
        : { title: 'Your complaint', body: `Resolved: ${p.resolution ?? ''}` };
  }
}

// ---------------------------------------------------------------- the app's list

export async function listMessages(db: Database, ctx: TenantContext) {
  const [me] = await db
    .select({ lang: users.preferredLanguage })
    .from(users)
    .where(eq(users.id, ctx.userId));
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      params: notifications.params,
      orderId: notifications.orderId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), eq(notifications.supplierId, ctx.supplierId)))
    .orderBy(desc(notifications.id))
    .limit(50);
  const lang = me?.lang ?? 'en';
  return {
    messages: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      orderId: r.orderId,
      read: !!r.readAt,
      createdAt: r.createdAt,
      ...messageText(r.kind, r.params as NotificationParams, lang),
    })),
    unread: rows.filter((r) => !r.readAt).length,
  };
}

/** Marks every message up to `upToId` as read. */
export async function markRead(db: Database, ctx: TenantContext, upToId: number, now: Date) {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.userId, ctx.userId),
        eq(notifications.supplierId, ctx.supplierId),
        lte(notifications.id, upToId),
        isNull(notifications.readAt),
      ),
    );
}

export async function savePushToken(
  db: Database,
  userId: string,
  input: { token: string; platform: string },
) {
  await db
    .insert(pushTokens)
    .values({ userId, token: input.token, platform: input.platform })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId, platform: input.platform, lastSeenAt: new Date() },
    });
}

export async function dropPushToken(db: Database, userId: string, token: string) {
  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}

// ---------------------------------------------------------------- dues reminder

/** The office reminds one customer about their dues, at most once a day (D-03 follow-up). */
export async function remindDues(db: Database, ctx: TenantContext, customerId: string, now: Date) {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ userId: customers.userId, balancePaise: customers.balancePaise })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.supplierId, ctx.supplierId)))
      .for('update');
    if (!c) throw errors.notFound('Customer');
    if (c.balancePaise <= 0)
      throw new AppError(422, 'NOTHING_DUE', 'This customer does not owe anything.');
    const since = new Date(now.getTime() - DUES_REMINDER_GAP_HOURS * 3_600_000);
    const [recent] = await tx
      .select({ at: notifications.createdAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.supplierId, ctx.supplierId),
          eq(notifications.userId, c.userId),
          eq(notifications.kind, 'dues_reminder'),
          gte(notifications.createdAt, since),
        ),
      )
      .limit(1);
    if (recent)
      throw new AppError(409, 'REMINDED_RECENTLY', 'A reminder was already sent today.', {
        at: recent.at,
      });
    await tx.insert(notifications).values({
      supplierId: ctx.supplierId,
      userId: c.userId,
      kind: 'dues_reminder',
      params: { duePaise: c.balancePaise },
      createdAt: now,
    });
    await recordAudit(tx, ctx, {
      action: 'dues.reminded',
      entityType: 'customer',
      entityId: customerId,
      after: { duePaise: c.balancePaise },
    });
    return { duePaise: c.balancePaise, at: now };
  });
}

// ---------------------------------------------------------------- dispatcher

/**
 * Sends waiting messages as pushes. Runs after each request and once a minute; rows are claimed
 * with SKIP LOCKED, so two servers never send the same message. A send that fails stays `failed`
 * (the message is still in the app); it is not retried, so nobody gets the same push twice.
 */
export class PushDispatcher {
  private running: Promise<void> | null = null;
  private again = false;
  constructor(
    private readonly db: Database,
    private readonly push: PushProvider | null,
  ) {}

  /** Starts a flush unless one is running (then it runs once more after it). */
  kick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.flushOnce();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async flushOnce() {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: notifications.id,
          userId: notifications.userId,
          kind: notifications.kind,
          params: notifications.params,
          orderId: notifications.orderId,
          lang: users.preferredLanguage,
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .where(eq(notifications.pushStatus, 'pending'))
        .orderBy(notifications.id)
        .limit(200)
        .for('update', { of: notifications, skipLocked: true });
      if (rows.length === 0) return;
      const tokens = await tx
        .select({ userId: pushTokens.userId, token: pushTokens.token })
        .from(pushTokens)
        .where(
          inArray(
            pushTokens.userId,
            rows.map((r) => r.userId),
          ),
        );
      const messages: { id: number; token: string }[] = [];
      const payload = [];
      for (const r of rows) {
        for (const t of tokens.filter((x) => x.userId === r.userId)) {
          const text = messageText(r.kind, r.params as NotificationParams, r.lang);
          messages.push({ id: r.id, token: t.token });
          payload.push({
            token: t.token,
            ...text,
            data: { kind: r.kind, messageId: r.id, ...(r.orderId ? { orderId: r.orderId } : {}) },
          });
        }
      }
      const results =
        this.push && payload.length ? await this.push.send(payload) : payload.map(() => 'failed');
      const now = new Date();
      for (const r of rows) {
        const mine = messages
          .map((m, i) => ({ ...m, result: results[i] }))
          .filter((m) => m.id === r.id);
        const status =
          !this.push || mine.length === 0
            ? 'no_device'
            : mine.some((m) => m.result === 'sent')
              ? 'sent'
              : 'failed';
        await tx
          .update(notifications)
          .set({ pushStatus: status, pushedAt: status === 'sent' ? now : null })
          .where(eq(notifications.id, r.id));
      }
      const gone = messages.filter((_, i) => results[i] === 'gone').map((m) => m.token);
      if (gone.length) await tx.delete(pushTokens).where(inArray(pushTokens.token, gone));
    });
  }
}
