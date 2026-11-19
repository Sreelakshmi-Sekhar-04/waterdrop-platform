import { defineConfig, devices } from '@playwright/test';

/** Admin UI smoke tests. Run after `pnpm build`; they serve the built app with `vite preview`. */
export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'off' },
  webServer: { command: 'pnpm preview', url: 'http://localhost:4173', reuseExistingServer: false },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
