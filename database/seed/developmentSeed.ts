/**
 * Development-only seed: loads the sample question set and, with --with-students, a handful of demo
 * student accounts. It refuses to run in production and never touches existing records.
 *
 *   npm run seed:dev                 # sample questions only
 *   npm run seed:dev -- --with-students
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../../backend/src/config/database.js';
import { getEnv } from '../../backend/src/config/environment.js';
import { Host } from '../../backend/src/models/Host.js';
import { Question } from '../../backend/src/models/Question.js';
import { Student } from '../../backend/src/models/Student.js';
import { hashPassword } from '../../backend/src/services/authService.js';
import { parseCsv, validateRows } from '../../backend/src/services/questionImportService.js';
import { questionFingerprint } from '../../backend/src/utils/text.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main(): Promise<void> {
  const env = getEnv();
  if (env.NODE_ENV === 'production') throw new Error('The development seed must never run in production.');
  await connectDatabase();
  try {
    const host = await Host.findOne().lean();
    if (!host) throw new Error('Create a host first: npm run create-host');

    const csv = await readFile(path.join(root, 'question-files', 'examples', 'sample-questions.csv'));
    const { valid, invalid } = validateRows(parseCsv(csv));
    if (invalid.length) throw new Error(`Sample file has ${invalid.length} invalid rows`);
    let added = 0;
    for (const { question } of valid) {
      const fingerprint = questionFingerprint(question.questionText);
      if (await Question.exists({ fingerprint })) continue;
      await Question.create({ ...question, status: 'ACTIVE', fingerprint, createdBy: host._id });
      added += 1;
    }
    console.log(`Sample questions: ${added} added, ${valid.length - added} already present.`);

    if (process.argv.includes('--with-students')) {
      const passwordHash = await hashPassword('DemoPassw0rd');
      let created = 0;
      for (let i = 1; i <= 5; i += 1) {
        const prn = `DEMO${String(i).padStart(6, '0')}`;
        if (await Student.exists({ prn })) continue;
        await Student.create({ name: `Demo Student ${i}`, prn, email: `demo${i}@example.test`, department: 'Mathematics', academicYear: 'SE', passwordHash });
        created += 1;
      }
      console.log(`Demo students: ${created} created (password: DemoPassw0rd, development only).`);
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
