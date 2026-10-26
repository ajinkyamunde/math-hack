/**
 * Creates the initial host (admin) account. There is deliberately no HTTP endpoint for this.
 *
 *   HOST_INITIAL_NAME="Exam Cell" HOST_INITIAL_EMAIL=host@college.edu HOST_INITIAL_PASSWORD=... npm run create-host
 *
 * Missing values are asked for interactively (the password is not echoed). Secrets are never printed.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../backend/src/config/database.js';
import { getEnv } from '../backend/src/config/environment.js';
import { createHostAccount } from '../backend/src/services/authService.js';
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
  getEnv(); // validates configuration before touching the database
  const interactive = process.stdin.isTTY;
  const name = process.env.HOST_INITIAL_NAME || (interactive ? await ask('Host display name: ') : '') || 'MathHack Host';
  const email = process.env.HOST_INITIAL_EMAIL || (interactive ? await ask('Host email: ') : '');
  const password = process.env.HOST_INITIAL_PASSWORD || (interactive ? await ask('Host password (hidden): ', true) : '');

  const parsed = z.object({ email: z.string().email('Enter a valid email address.'), password: passwordSchema }).safeParse({ email, password });
  if (!parsed.success) {
    console.error(`Cannot create host: ${parsed.error.issues.map((i) => i.message).join(' ')}`);
    process.exitCode = 1;
    return;
  }

  await connectDatabase();
  try {
    const result = await createHostAccount({ name, email, password });
    console.log(result.created ? `Host account created for ${result.email}.` : `A host account for ${result.email} already exists. Nothing changed.`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(`createHost failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
