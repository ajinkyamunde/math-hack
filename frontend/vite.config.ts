/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', 'VITE_');
  const backend = process.env.MATHHACK_BACKEND_URL ?? 'http://localhost:4000';
  return {
    plugins: [react()],
    envDir: '..',
    server: {
      port: 5173,
      strictPort: true,
      // In development the browser talks to the Vite origin and requests are proxied, so cookies stay first-party.
      proxy: env.VITE_API_URL
        ? undefined
        : {
            '/api': { target: backend, changeOrigin: false },
            '/socket.io': { target: backend, ws: true, changeOrigin: false },
          },
    },
    build: { sourcemap: true, chunkSizeWarningLimit: 900 },
    test: {
      environment: 'jsdom',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/unit/setup.ts'],
    },
  };
});
