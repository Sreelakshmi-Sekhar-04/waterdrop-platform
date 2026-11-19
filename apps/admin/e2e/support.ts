import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { OUTBOX } from '../playwright.config';

/** Seeded by apps/api e2e-server: desktop tests sign in as the owner, phone tests as the office account. */
export const ACCOUNTS = {
  desktop: { phone: '9847000001', role: 'Owner', owner: true },
  phone: { phone: '9847000003', role: 'Office', owner: false },
} as const;
export type ProjectName = keyof typeof ACCOUNTS;

/** The newest SMS code the dev outbox "sent" to this number (polls briefly). */
export async function latestCode(phone: string, notBefore = 0): Promise<string> {
  let code = '';
  await expect
    .poll(() => {
      const lines = (() => {
        try {
          return readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean);
        } catch {
          return [];
        }
      })();
      const hit = lines
        .map((l) => JSON.parse(l) as { at: string; phone: string; code: string })
        .filter((m) => m.phone === `+91${phone}` && Date.parse(m.at) >= notBefore)
        .pop();
      code = hit?.code ?? '';
      return code;
    })
    .not.toBe('');
  return code;
}

export async function requestCode(page: Page, phone: string): Promise<string> {
  const asked = Date.now() - 1000;
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(
    page.getByRole('heading', { name: 'Enter the code and your password' }),
  ).toBeVisible();
  return latestCode(phone, asked);
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
