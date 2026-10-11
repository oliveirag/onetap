import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle workspace packages (they ship TypeScript source); keep npm deps external.
  noExternal: [/^@reclaimed\//],
  // npm deps of those workspace packages must stay external too: CommonJS modules
  // such as pg cannot be inlined into an ESM bundle (dynamic require of "events").
  external: ['pg'],
});
