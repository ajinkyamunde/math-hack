/**
 * Resets a host account's password directly in the database.
 * Usage:
 *   HOST_EMAIL=ajinkya.1251010574@vit.edu HOST_PASSWORD="NewPassword123" npm run reset-host-pass
 * Or interactively:
 *   npm run reset-host-pass
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../backend/src/config/database.js';
import { getEnv } from '../backend/src/config/environment.js';
import { Host } from '../backend/src/models/Host.js';
import { hashPassword } from '../backend/src/services/authService.js';
import { normalizeEmail } from '../backend/src/utils/text.js';
import { passwordSchema } from '../backend/src/validation/authSchemas.js';

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

async function main(): Promise<void> {
  getEnv();
  const interactive = process.stdin.isTTY;
  const email = process.env.HOST_EMAIL || (interactive ? await ask('Host email: ') : 'ajinkya.1251010574@vit.edu');
  const password = process.env.HOST_PASSWORD || (interactive ? await ask('New password (hidden): ', true) : '');

  const parsed = z
    .object({
      email: z.string().email('Enter a valid email address.'),
      password: passwordSchema,
    })
    .safeParse({ email, password });

  if (!parsed.success) {
    console.error(`Validation error: ${parsed.error.issues.map((i) => i.message).join(' ')}`);
    process.exitCode = 1;
    return;
  }

  await connectDatabase();
  try {
    const normalized = normalizeEmail(parsed.data.email);
    const host = await Host.findOne({ email: normalized });
    if (!host) {
      console.error(`Host with email "${normalized}" was not found.`);
      process.exitCode = 1;
      return;
    }

    host.passwordHash = await hashPassword(parsed.data.password);
    await host.save();
    console.log(`Password successfully updated for host: ${normalized}`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(`resetHostPassword failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
