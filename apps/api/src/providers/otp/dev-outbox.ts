import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { OtpProvider } from './otp-provider';

/**
 * DEVELOPMENT ONLY. Instead of sending an SMS, appends the message to a local
 * file so a developer or an automated test can read it. Start-up refuses this
 * provider when NODE_ENV=production (see config/env.ts). Everything else about
 * sign-in (random code, hashing, expiry, attempt limits) is the real code path.
 */
export class DevOutboxOtpProvider implements OtpProvider {
  readonly name = 'dev-outbox';
  constructor(private readonly file: string) {}

  async send({ phone, code, language }: { phone: string; code: string; language: string }) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), phone, code, language });
    await appendFile(this.file, `${line}\n`, { mode: 0o600 });
  }
}
