import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'terminal-simulator',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
