import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['scripts/**/*.arena.ts'], testTimeout: 3_600_000 },
});
