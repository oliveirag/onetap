import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['server/gateway.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist/server',
  noExternal: [/^@reclaimed\//],
});
