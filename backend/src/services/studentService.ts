import { parse } from 'csv-parse/sync';
import { Types } from 'mongoose';
import { Participant } from '../models/Participant.js';
import { RosterEntry } from '../models/RosterEntry.js';
import { Student } from '../models/Student.js';
import { badRequest } from '../utils/errors.js';
import { escapeRegex, normalizeEmail, normalizePrn } from '../utils/text.js';

export async function listStudents(query: { page: number; pageSize: number; search?: string }) {
  const filter: Record<string, unknown> = {};
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: pattern }, { prn: pattern }, { email: pattern }, { department: pattern }];
  }
  const [items, total] = await Promise.all([
    Student.find(filter).sort({ createdAt: -1, _id: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize),
    Student.countDocuments(filter),
  ]);
  return { items: items.map((s) => s.toJSON()), total, page: query.page, pageSize: query.pageSize };
}

/** Paginated competition history for one student, with their stored final score and rank. */
export async function studentHistory(studentId: string, query: { page: number; pageSize: number }) {
  const id = new Types.ObjectId(studentId);
  const [rows, total] = await Promise.all([
    Participant.find({ studentId: id })
      .populate<{ competitionId: { _id: Types.ObjectId; name: string; status: string; completedAt?: Date; startedAt?: Date } | null }>(
        'competitionId',
        'name status completedAt startedAt',
      )
      .sort({ joinedAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean(),
    Participant.countDocuments({ studentId: id }),
  ]);
  return {
    items: rows
      .filter((row) => row.competitionId)
      .map((row) => ({
        competitionId: String(row.competitionId!._id),
        name: row.competitionId!.name,
        status: row.competitionId!.status,
        joinedAt: row.joinedAt,
        completedAt: row.completedAt ?? row.competitionId!.completedAt ?? null,
        finalScore: row.finalScore ?? null,
        finalRank: null,
      })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

const MAX_ROSTER_ROWS = 20000;

/** Replaces the official roster from a CSV with PRN and Email columns (Name optional). */
export async function importRoster(buffer: Buffer, hostId: string) {
  let records: Record<string, string>[];
  try {
    records = parse(buffer, { bom: true, columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, to_line: MAX_ROSTER_ROWS + 1 });
  } catch (error) {
    throw badRequest(`The roster CSV could not be read: ${(error as Error).message}`);
  }
  const errors: { row: number; message: string }[] = [];
  const entries = new Map<string, { prn: string; email: string; name: string }>();
  records.forEach((record, index) => {
    const prn = normalizePrn(record.prn ?? '');
    const email = normalizeEmail(record.email ?? '');
    if (!/^[A-Z0-9]{6,20}$/.test(prn) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.push({ row: index + 2, message: 'PRN (6–20 letters/digits) and a valid email are required.' });
      return;
    }
    entries.set(prn, { prn, email, name: (record.name ?? '').trim().slice(0, 100) });
  });
  if (!entries.size) throw badRequest('No valid roster rows found. The CSV needs PRN and Email columns.', errors.slice(0, 50));
  await RosterEntry.deleteMany({});
  const docs = [...entries.values()].map((entry) => ({ ...entry, uploadedBy: hostId }));
  for (let i = 0; i < docs.length; i += 1000) await RosterEntry.insertMany(docs.slice(i, i + 1000), { ordered: false });
  await Student.updateMany({}, { $set: { rosterVerified: false } });
  const verified = await Student.updateMany(
    { $or: docs.map((d) => ({ prn: d.prn, email: d.email })).slice(0, 20000) },
    { $set: { rosterVerified: true } },
  );
  return { imported: docs.length, invalid: errors.length, errors: errors.slice(0, 50), matchedStudents: verified.modifiedCount };
}

export async function rosterSize(): Promise<number> {
  return RosterEntry.estimatedDocumentCount();
}
