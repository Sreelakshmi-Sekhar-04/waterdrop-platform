import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Env } from '../../config/env';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, string | number>;
}

/** The result for each message, in the same order. `gone` means the phone dropped the token. */
export type PushResult = 'sent' | 'gone' | 'failed';

/** Sends pushes to phones. Implementations must never log message text or tokens in full. */
export interface PushProvider {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

/**
 * DEVELOPMENT ONLY: appends each push to a local file so a developer or a test can read it.
 * Refused in production (config/env.ts).
 */
export class DevOutboxPushProvider implements PushProvider {
  readonly name = 'dev-outbox';
  constructor(private readonly file: string) {}
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const at = new Date().toISOString();
    const lines = messages.map((m) => JSON.stringify({ at, ...m })).join('\n');
    if (lines) await appendFile(this.file, `${lines}\n`, { mode: 0o600 });
    return messages.map(() => 'sent');
  }
}

/**
 * Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/), up to
 * 100 messages per request. Not yet tested against the real service: that needs the app built
 * with an EAS project (Phase 8).
 */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  constructor(
    private readonly opts: { accessToken?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
  ) {}
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const f = this.opts.fetchImpl ?? fetch;
    const out: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      try {
        const res = await f('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(this.opts.accessToken ? { authorization: `Bearer ${this.opts.accessToken}` } : {}),
          },
          body: JSON.stringify(
            chunk.map((m) => ({
              to: m.token,
              title: m.title,
              body: m.body,
              data: m.data,
              sound: 'default',
              channelId: 'default',
            })),
          ),
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
        });
        if (!res.ok) {
          out.push(...chunk.map(() => 'failed' as const));
          continue;
        }
        const body = (await res.json()) as {
          data?: { status: string; details?: { error?: string } }[];
        };
        chunk.forEach((_, j) => {
          const t = body.data?.[j];
          out.push(
            t?.status === 'ok'
              ? 'sent'
              : t?.details?.error === 'DeviceNotRegistered'
                ? 'gone'
                : 'failed',
          );
        });
      } catch {
        out.push(...chunk.map(() => 'failed' as const));
      }
    }
    return out;
  }
}

export function createPushProvider(env: Env): PushProvider | null {
  if (env.PUSH_PROVIDER === 'none') return null;
  if (env.PUSH_PROVIDER === 'expo')
    return new ExpoPushProvider({ accessToken: env.EXPO_ACCESS_TOKEN });
  return new DevOutboxPushProvider(env.PUSH_DEV_OUTBOX);
}
