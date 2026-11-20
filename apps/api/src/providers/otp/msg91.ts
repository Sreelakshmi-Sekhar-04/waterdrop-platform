import { OtpDeliveryError, type OtpProvider } from './otp-provider';

/**
 * Sends the code with MSG91's Flow (template) API. The template must be
 * registered on DLT and contain a variable named "otp".
 * Not yet tested against the real MSG91 service: that needs the business's
 * MSG91 account and approved DLT template (see docs/PROGRESS.md).
 */
export class Msg91OtpProvider implements OtpProvider {
  readonly name = 'msg91';
  constructor(
    private readonly opts: {
      authKey: string;
      templateId: string;
      baseUrl: string;
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async send({ phone, code }: { phone: string; code: string; language?: string }) {
    const f = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.opts.baseUrl}/api/v5/flow`, {
        method: 'POST',
        headers: {
          authkey: this.opts.authKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          template_id: this.opts.templateId,
          short_url: '0',
          // MSG91 expects the number without "+", e.g. 919847012345.
          recipients: [{ mobiles: phone.replace(/^\+/, ''), otp: code }],
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000),
      });
    } catch {
      throw new OtpDeliveryError('SMS provider unreachable');
    }
    const body = (await res.json().catch(() => null)) as { type?: string } | null;
    if (!res.ok || body?.type === 'error') {
      // Status only: the response body can echo the number.
      throw new OtpDeliveryError(`SMS provider rejected the message (HTTP ${res.status})`);
    }
  }
}
