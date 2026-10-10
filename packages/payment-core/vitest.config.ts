import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'payment-core',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
