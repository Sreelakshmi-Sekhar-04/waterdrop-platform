import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Admin portal browser tests against the real API and a fresh, throwaway database.
 * Run after `pnpm build`. Two servers start: the API (apps/api e2e-server, SMS codes written to
 * a local file the tests read) and `vite preview`, which forwards /api to it.
 */
export const API_PORT = 4101;
export const OUTBOX = path.resolve(import.meta.dirname, '.e2e/sms.jsonl');

export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:4173', trace: 'off' },
  webServer: [
    {
      command: 'pnpm --filter @wtrdrop/api e2e:server',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        E2E_DB_NAME: 'wtrdrop_e2e_admin',
        OTP_DEV_OUTBOX: OUTBOX,
        CORS_ORIGINS: 'http://localhost:4173',
        // Two browsers click far faster than people, all from one address; the limit itself is
        // tested in the API suite.
        RATE_LIMIT_PER_MINUTE: '3000',
      },
    },
    {
      command: 'pnpm preview',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
  projects: [
    // Each project signs in as a different seeded account, so they can run side by side.
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
