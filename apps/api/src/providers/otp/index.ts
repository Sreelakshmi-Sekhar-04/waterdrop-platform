import type { Env } from '../../config/env';
import { DevOutboxOtpProvider } from './dev-outbox';
import { Msg91OtpProvider } from './msg91';
import type { OtpProvider } from './otp-provider';

export type { OtpProvider } from './otp-provider';
export { OtpDeliveryError } from './otp-provider';

export function createOtpProvider(env: Env): OtpProvider {
  if (env.OTP_PROVIDER === 'msg91') {
    return new Msg91OtpProvider({
      authKey: env.MSG91_AUTH_KEY!,
      templateId: env.MSG91_TEMPLATE_ID!,
      baseUrl: env.MSG91_BASE_URL,
    });
  }
  return new DevOutboxOtpProvider(env.OTP_DEV_OUTBOX);
}
