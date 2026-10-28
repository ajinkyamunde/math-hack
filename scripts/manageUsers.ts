/**
 * View or delete registered users from the terminal:
 *   npm run users
 *   npm run users -- --delete-student <email-or-prn>
 */
import { connectDatabase, disconnectDatabase } from '../backend/src/config/database.js';
import { getEnv } from '../backend/src/config/environment.js';
import { Student } from '../backend/src/models/Student.js';
import { Host } from '../backend/src/models/Host.js';
import { Participant } from '../backend/src/models/Participant.js';
import { normalizeEmail, normalizePrn } from '../backend/src/utils/text.js';

async function main(): Promise<void> {
  getEnv();
  await connectDatabase();
  try {
    const deleteIndex = process.argv.indexOf('--delete-student');
    const deleteTarget = deleteIndex !== -1 ? process.argv[deleteIndex + 1] : undefined;

    if (deleteTarget) {
      const email = normalizeEmail(deleteTarget);
      const prn = normalizePrn(deleteTarget);
      const student = await Student.findOne({ $or: [{ email }, { prn }] });
      if (!student) {
        console.log(`Student "${deleteTarget}" not found.`);
        return;
      }
      await Student.deleteOne({ _id: student._id });
      await Participant.deleteMany({ studentId: student._id });
      console.log(`Successfully deleted student: ${student.name} (${student.email}, PRN: ${student.prn}) and their competition entries.`);
      return;
    }

    console.log('\n=== REGISTERED STUDENTS ===');
    const students = await Student.find().sort({ createdAt: -1 }).lean();
    if (students.length === 0) {
      console.log('No registered students found.');
    } else {
      console.table(
        students.map((s) => ({
          Name: s.name,
          Email: s.email,
          PRN: s.prn,
          Department: s.department,
          Year: s.academicYear,
          Status: s.accountStatus,
          RegisteredAt: s.createdAt ? new Date(s.createdAt).toLocaleString() : 'N/A',
        })),
      );
    }

    console.log('\n=== HOST ACCOUNTS ===');
    const hosts = await Host.find().lean();
    console.table(
      hosts.map((h) => ({
        Name: h.name,
        Email: h.email,
        Role: h.role,
        Status: h.accountStatus,
      })),
    );
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
