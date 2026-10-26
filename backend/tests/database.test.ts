import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { supportsTransactions } from '../src/config/database.js';
import { Attempt, Participant, Student } from '../src/models/index.js';
import { useTestDatabase } from './helpers.js';

useTestDatabase();

async function indexKeys(collection: string): Promise<{ key: Record<string, number>; unique?: boolean }[]> {
  return (await mongoose.connection.db!.collection(collection).indexes()) as { key: Record<string, number>; unique?: boolean }[];
}

describe('database connection and indexes', () => {
  it('is connected to the isolated test database', () => {
    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toMatch(/test/);
  });

  it('creates the unique indexes that enforce business rules', async () => {
    const students = await indexKeys('students');
    expect(students.find((i) => i.key.prn === 1)?.unique).toBe(true);
    expect(students.find((i) => i.key.email === 1)?.unique).toBe(true);
    const participants = await indexKeys('participants');
    expect(participants.find((i) => i.key.competitionId === 1 && i.key.studentId === 1)?.unique).toBe(true);
    const attempts = await indexKeys('attempts');
    expect(attempts.find((i) => i.key.competitionId === 1 && i.key.questionId === 1 && i.key.studentId === 1)?.unique).toBe(true);
    const batches = await indexKeys('importbatches');
    expect(batches.some((i) => i.key.expiresAt === 1)).toBe(true);
  });

  it('rejects duplicate attempts at the database level', async () => {
    const ids = { competitionId: new mongoose.Types.ObjectId(), questionId: new mongoose.Types.ObjectId(), studentId: new mongoose.Types.ObjectId() };
    await Attempt.create({ ...ids, difficulty: 'EASY', selectedOption: 'A', isCorrect: true, pointsAwarded: 10, responseTimeMs: 100 });
    await expect(Attempt.create({ ...ids, difficulty: 'EASY', selectedOption: 'B', isCorrect: false, pointsAwarded: 0, responseTimeMs: 90 })).rejects.toMatchObject({ code: 11000 });
  });

  it('rejects duplicate participants and students', async () => {
    const ids = { competitionId: new mongoose.Types.ObjectId(), studentId: new mongoose.Types.ObjectId() };
    await Participant.create(ids);
    await expect(Participant.create(ids)).rejects.toMatchObject({ code: 11000 });
    const base = { name: 'A', department: 'D', academicYear: 'FE', passwordHash: 'x' };
    await Student.create({ ...base, prn: 'P1234567', email: 'a@b.test' });
    await expect(Student.create({ ...base, prn: 'P1234567', email: 'c@b.test' })).rejects.toMatchObject({ code: 11000 });
  });

  it('detects transaction support on the replica set', async () => {
    expect(typeof (await supportsTransactions())).toBe('boolean');
  });
});
