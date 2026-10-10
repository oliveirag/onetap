import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'hardware-bridge',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
