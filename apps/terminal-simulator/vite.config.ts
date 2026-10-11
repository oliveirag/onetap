import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const gateway = `http://127.0.0.1:${process.env.TERMINAL_GATEWAY_PORT ?? 5174}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/gateway': { target: gateway, ws: true } },
  },
  build: { outDir: 'dist/web' },
});
