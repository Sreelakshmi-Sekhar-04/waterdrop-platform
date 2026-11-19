/// <reference types="node" />
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the mobile screens, run on the Expo web build at phone size, against the real
 * API and a fresh, throwaway database (apps/api e2e-server; SMS codes go to a local file the tests
 * read). Native-only behaviour (Android/iOS) is tested with Maestro on a device.
 */
export const API_PORT = 4102;
export const WEB_PORT = 8082;
export const OUTBOX = path.resolve(__dirname, '.e2e/sms.jsonl');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'off' },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: 'pnpm --filter @wtrdrop/api e2e:server',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        E2E_DB_NAME: 'wtrdrop_e2e_mobile',
        OTP_DEV_OUTBOX: OUTBOX,
        CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      // --clear: EXPO_PUBLIC_* values are baked into the bundle, so never reuse a dev cache.
      command: `npx expo start --web --port ${WEB_PORT} --clear`,
      env: {
        EXPO_OFFLINE: '1',
        CI: '1',
        BROWSER: 'none',
        EXPO_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
        // Lets the demo-data screens of later phases open without an account (dev builds only).
        EXPO_PUBLIC_PREVIEW: '1',
      },
      url: `http://localhost:${WEB_PORT}`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
