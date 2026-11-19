import { z } from 'zod';
import { languageSchema } from './schemas';

/** Version of the privacy notice shown at sign-up (DPDP Act). Bump when the text changes. */
export const PRIVACY_NOTICE_VERSION = '2026-11-v1';

const text = (max: number) => z.string().trim().min(1, 'Required').max(max);

export const personNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 letters')
  .max(80, 'Use at most 80 characters');

/** Indian PIN code: 6 digits, not starting with 0. */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code');

export const customerTypeSchema = z.enum(['household', 'office', 'shop']);
export type CustomerType = z.infer<typeof customerTypeSchema>;

export const customerProfileInputSchema = z.object({
  name: personNameSchema,
  preferredLanguage: languageSchema,
  /** Must be true the first time; the server stores when and which version. */
  acceptPrivacy: z.literal(true).optional(),
});
export type CustomerProfileInput = z.infer<typeof customerProfileInputSchema>;

export const addressInputSchema = z.object({
  label: text(40),
  line: text(200),
  landmark: text(120),
  pincode: pincodeSchema,
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  deliveryNote: z.string().trim().max(200).nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

export const serviceAreaInputSchema = z.object({
  name: text(60),
  nameMl: z.string().trim().max(60).nullable().optional(),
  pincodes: z.array(pincodeSchema).min(1, 'Add at least one PIN code').max(50),
  /** D-12. Null = use the business-wide setting. */
  deliveryChargePaise: z.number().int().min(0).max(100_000).nullable().optional(),
  /** D-12. No charge above this many cans; null = the setting, 0 = never free. */
  freeAboveCans: z.number().int().min(0).max(100).nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export type ServiceAreaInput = z.infer<typeof serviceAreaInputSchema>;

/** PINs anyone would guess first. Checked by the app before confirming and again by the server. */
const WEAK_PINS = new Set([
  '1234',
  '4321',
  '0000',
  '1111',
  '2222',
  '3333',
  '4444',
  '5555',
  '6666',
  '7777',
  '8888',
  '9999',
  '1212',
  '1122',
  '2580',
  '0852',
  '1004',
  '2000',
  '6969',
  '0123',
  '9876',
]);
export function isWeakPin(pin: string): boolean {
  return WEAK_PINS.has(pin);
}
