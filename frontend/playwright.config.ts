import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real backend and frontend against an isolated database
 * (MONGODB_URI_E2E, default mathhack_e2e_test). They never touch development or production data.
 */
const BACKEND_PORT = 4100;
const FRONTEND_PORT = 5174;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
export const E2E_MONGODB_URI = process.env.MONGODB_URI_E2E ?? 'mongodb://127.0.0.1:27017/mathhack_e2e_test?replicaSet=rs0';

const backendEnv = {
  NODE_ENV: 'development',
  MATHHACK_ENV_FILE: '/nonexistent',
  PORT: String(BACKEND_PORT),
  MONGODB_URI: E2E_MONGODB_URI,
  FRONTEND_URL,
  BACKEND_PUBLIC_URL: `http://localhost:${BACKEND_PORT}`,
  SESSION_SECRET: 'e2e-session-secret-that-is-definitely-long-enough-1234567890',
  RATE_LIMIT_DISABLED: 'true',
};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: FRONTEND_URL, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'npx tsx src/server.ts',
      cwd: '../backend',
      url: `http://localhost:${BACKEND_PORT}/api/health`,
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_URL,
      env: { MATHHACK_BACKEND_URL: `http://localhost:${BACKEND_PORT}`, VITE_API_URL: '' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
