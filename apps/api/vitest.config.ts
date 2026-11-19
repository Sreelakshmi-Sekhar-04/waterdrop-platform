import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests each create their own database, so files can run in parallel.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
