import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate.ts', 'src/db/seed.ts', 'src/ops/check-integrity.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Bundle workspace packages (they ship TypeScript source); keep npm deps external.
  noExternal: [/^@wtrdrop\//],
});
