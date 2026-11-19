import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the mobile screens, run on the Expo web build at phone size.
 * They check behaviour and layout. Native-only behaviour (Android/iOS) is tested with Maestro from Phase 3.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:8081', trace: 'off' },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npx expo start --web --port 8081',
    env: { EXPO_OFFLINE: '1', CI: '1', BROWSER: 'none' },
    url: 'http://localhost:8081',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
