import type { Language } from '@wtrdrop/shared';

/** Delivers a sign-in code. Implementations must never log the code. */
export interface OtpProvider {
  readonly name: string;
  send(input: { phone: string; code: string; language: Language }): Promise<void>;
}

export class OtpDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OtpDeliveryError';
  }
}
