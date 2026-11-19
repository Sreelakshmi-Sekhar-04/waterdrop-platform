import { z } from 'zod';

/**
 * Business settings with their validation rules. Defaults are DEMO values from
 * docs/REQUIREMENTS-CHANGELOG.md Part 4 and must be replaced with the owner's
 * real values before launch.
 */
export const settingsSchema = z.object({
  deliveryChargePaise: z.number().int().min(0),
  freeDeliveryAboveCans: z.number().int().min(0),
  depositPerCanPaise: z.number().int().min(0),
  /** Orders after this local time (Asia/Kolkata) are delivered the next open day. */
  sameDayCutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM'),
  maxCansPerOrder: z.number().int().min(1).max(100),
  staffUndoWindowMinutes: z.number().int().min(0).max(60),
  autoAcceptOrders: z.boolean(),
  supportPhone: z
    .string()
    .regex(/^\+91[6-9]\d{9}$/)
    .nullable(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const DEMO_SETTINGS: Settings = {
  deliveryChargePaise: 0,
  freeDeliveryAboveCans: 0,
  depositPerCanPaise: 15000,
  sameDayCutoff: '14:00',
  maxCansPerOrder: 10,
  staffUndoWindowMinutes: 10,
  autoAcceptOrders: true,
  supportPhone: null,
};

/** A partial update: at least one known key, each validated. Unknown keys are rejected. */
export const settingsPatchSchema = settingsSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one setting to change');
