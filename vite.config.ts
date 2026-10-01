import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相對路徑：GitHub Pages 的子路徑 /empiresGame/ 與本機預覽都能用
  base: './',
  server: { port: 5190, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
});
