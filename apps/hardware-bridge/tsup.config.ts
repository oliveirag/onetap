import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/diagnose.ts', 'src/cli/physical-test.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  noExternal: [/^@reclaimed\//],
  external: ['pcsc-mini'],
});
