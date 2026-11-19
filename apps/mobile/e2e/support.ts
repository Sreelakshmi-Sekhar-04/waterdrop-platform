/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { OUTBOX } from '../playwright.config';

/** The newest SMS code the dev outbox "sent" to this number since `notBefore` (polls briefly). */
export async function latestCode(phone: string, notBefore = 0): Promise<string> {
  let code = '';
  await expect
    .poll(() => {
      let lines: string[] = [];
      try {
        lines = readFileSync(OUTBOX, 'utf8').trim().split('\n').filter(Boolean);
      } catch {
        // not written yet
      }
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

/** Fills the number, asks for a code and types the code the server "sent". */
export async function signInWithCode(page: Page, phone: string) {
  const asked = Date.now() - 1000;
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  const box = page.getByLabel('6-digit code');
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.fill(await latestCode(phone, asked));
}

export async function tapPin(page: Page, digits: string) {
  for (const d of digits) await page.getByRole('button', { name: d, exact: true }).click();
}

export async function fitsPhoneWidth(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
