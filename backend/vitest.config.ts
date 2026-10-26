import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/env.ts'],
    // Tests share one isolated MongoDB test database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
