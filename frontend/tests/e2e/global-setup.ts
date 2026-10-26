import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_MONGODB_URI } from '../../playwright.config';

export default function globalSetup(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  execSync(`npx tsx ${path.join(here, 'prepare-db.ts')}`, {
    cwd: path.resolve(here, '../../../backend'),
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: E2E_MONGODB_URI, SESSION_SECRET: 'x'.repeat(40), FRONTEND_URL: 'http://localhost:5174', BACKEND_PUBLIC_URL: 'http://localhost:4100' },
    stdio: 'inherit',
  });
}
