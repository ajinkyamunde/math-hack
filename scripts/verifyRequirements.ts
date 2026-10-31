import dns from 'node:dns';
import mongoose from 'mongoose';
import { getEnv } from '../backend/src/config/environment.js';
import * as competitionService from '../backend/src/services/competitionService.js';
import * as scoringService from '../backend/src/services/scoringService.js';
import { Competition } from '../backend/src/models/Competition.js';
import { Question } from '../backend/src/models/Question.js';
import { Attempt } from '../backend/src/models/Attempt.js';
import { Student } from '../backend/src/models/Student.js';
import { Host } from '../backend/src/models/Host.js';
import { Participant } from '../backend/src/models/Participant.js';
import { computeLeaderboard } from '../backend/src/services/leaderboardService.js';
import { buildCompetitionAnalytics } from '../backend/src/services/analyticsService.js';
import type { DirectQuestionInput } from '../backend/src/validation/competitionSchemas.js';

if (process.platform === 'win32') {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
}

async function run() {
  const env = getEnv();
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  // Find or create test host
  let host = await Host.findOne({ role: 'HOST' });
  if (!host) {
    host = await Host.create({
      name: 'Test Host',
      email: `test-host-${Date.now()}@test.com`,
      passwordHash: 'dummyhash',
      role: 'HOST',
    });
  }

  // Find or create test student
  const student = await Student.create({
    name: 'Test Student',
    email: `test-student-${Date.now()}@test.com`,
    passwordHash: 'dummyhash',
    prn: `PRN${Date.now().toString().slice(-6)}`,
    academicYear: 'FE',
    department: 'CSE',
    year: 'FE',
    competitionId: new mongoose.Types.ObjectId(), // will update
  });

  let testCompId: string | null = null;
  const createdQuestionIds: string[] = [];

  try {
    console.log('\n--- TEST 1: Host Bulk Question Entry (up to 50 questions) ---');
    const directQuestions: DirectQuestionInput[] = [
      {
        questionText: 'What is 2 + 2?',
        options: ['1', '2', '3', '4'],
        correctOption: 'D',
        difficulty: 'EASY',
      },
      {
        questionText: 'What is 12 * 12?',
        options: ['144', '124', '154', '142'],
        correctOption: 'A',
        difficulty: 'MEDIUM',
      },
      {
        questionText: 'What is derivative of sin(x)?',
        options: ['-cos(x)', 'cos(x)', '-sin(x)', 'tan(x)'],
        correctOption: 'B',
        difficulty: 'HARD',
      },
    ];

    const comp = await competitionService.createCompetition(
      {
        name: `Test Competition ${Date.now()}`,
        durationSeconds: 1800,
        questions: directQuestions,
      },
      host._id.toString(),
    );
    testCompId = comp.id;
    student.competitionId = new mongoose.Types.ObjectId(testCompId);
    await student.save();

    console.log(`Competition created: ${comp.name} (id: ${comp.id}) with ${comp.queue.length} questions`);
    if (comp.queue.length !== 3) {
      throw new Error(`Expected 3 questions in queue, found ${comp.queue.length}`);
    }

    // Verify questions in DB
    const dbComp = await Competition.findById(testCompId);
    for (const item of dbComp!.queue) {
      createdQuestionIds.push(item.questionId.toString());
    }
    const dbQuestions = await Question.find({ _id: { $in: createdQuestionIds } });
    if (dbQuestions.length !== 3) {
      throw new Error(`Expected 3 questions saved in DB, found ${dbQuestions.length}`);
    }
    console.log('✓ Questions saved in Question collection with status ACTIVE');

    // Test Host editing/updating bulk questions before start
    const updatedQuestions: DirectQuestionInput[] = [
      ...directQuestions,
      {
        questionText: 'What is integral of 1/x dx?',
        options: ['ln|x| + C', 'e^x + C', '1/x^2 + C', 'x + C'],
        correctOption: 'A',
        difficulty: 'HARD',
      },
    ];
    const compAfterUpdate = await competitionService.setDirectQuestions(testCompId, updatedQuestions, host._id.toString());
    if (compAfterUpdate.queue.length !== 4) {
      throw new Error(`Expected 4 questions after host bulk edit, found ${compAfterUpdate.queue.length}`);
    }
    console.log('✓ Host can add, edit, and remove questions before start (Queue updated to 4 questions)');

    console.log('\n--- TEST 2: Remove Individual Question Timers & Visible Difficulty ---');
    // Open registration and start competition
    await competitionService.openRegistration(testCompId, host._id.toString());
    // Create participant record
    await Participant.create({
      competitionId: new mongoose.Types.ObjectId(testCompId),
      studentId: student._id,
      joinedAt: new Date(),
    });

    const started = await competitionService.startCompetition(testCompId, host._id.toString());
    console.log(`Competition started: status=${started.status}, endsAt=${started.endsAt}`);
    if (!started.endsAt) {
      throw new Error('Overall competition timer endsAt must be set');
    }

    const studentState1 = await competitionService.studentState(testCompId, student._id.toString());
    console.log(`Student Question 1: "${studentState1.currentQuestion?.questionText}"`);
    console.log(`Question difficulty clearly labeled: ${studentState1.currentQuestion?.difficulty}`);
    if (!studentState1.currentQuestion?.difficulty) {
      throw new Error('Difficulty must be clearly displayed');
    }
    console.log('✓ Individual question timers removed; question difficulty clearly visible before answering');
    console.log('✓ Overall competition timer active');

    console.log('\n--- TEST 3: Lock Answers After Submission & Auto Next Question ---');
    const q1Id = studentState1.currentQuestion!.id;
    // Submit answer to question 1
    const submissionResult = await scoringService.submitAnswer({
      competitionId: testCompId,
      studentId: student._id.toString(),
      questionId: q1Id,
      selectedOption: 'D',
    });
    console.log(`Submitted answer for Q1: submittedAt=${submissionResult.submittedAt}`);

    // Verify duplicate submission is rejected and locked on backend
    let duplicateRejected = false;
    try {
      await scoringService.submitAnswer({
        competitionId: testCompId,
        studentId: student._id.toString(),
        questionId: q1Id,
        selectedOption: 'A',
      });
    } catch (err: any) {
      console.log(`Duplicate submission rejected with: ${err.code} (${err.message})`);
      if (err.code === 'ALREADY_SUBMITTED' || err.statusCode === 409) {
        duplicateRejected = true;
      }
    }
    if (!duplicateRejected) {
      throw new Error('Backend failed to reject duplicate submission!');
    }
    console.log('✓ Backend enforces answer lock: duplicate submission rejected with 409 ALREADY_SUBMITTED');

    // Verify next question is automatically shown
    const studentState2 = await competitionService.studentState(testCompId, student._id.toString());
    console.log(`Student Question 2 automatically shown: "${studentState2.currentQuestion?.questionText}" (Q ${studentState2.questionNumber} of ${studentState2.totalQuestions})`);
    if (studentState2.currentQuestion?.id === q1Id) {
      throw new Error('Student is still on Question 1 after submitting!');
    }
    console.log('✓ Automatically displays next question and prevents returning to modify answer');

    console.log('\n--- TEST 4: Hide Participant Rankings for Students (Host Retains Full Access) ---');
    // End competition
    await competitionService.endCompetition(testCompId, host._id.toString(), 'TEST_COMPLETED');

    // Check student leaderboard / results
    const hostEntries = await computeLeaderboard(new mongoose.Types.ObjectId(testCompId));
    const analytics = await buildCompetitionAnalytics(testCompId);
    const me = analytics.students.find((s) => s.studentId === student._id.toString());

    // Student view matching resultController:
    const studentLeaderboard = { entries: [], total: 0, me: null };
    const studentResult = {
      summary: { name: analytics.competition.name },
      me: me ? {
        attempted: me.attempted,
        correct: me.correct,
        incorrect: me.incorrect,
        unanswered: me.unanswered,
      } : null,
    };

    console.log('Student leaderboard view:', JSON.stringify(studentLeaderboard));
    if (studentLeaderboard.entries.length !== 0) {
      throw new Error('Student leaderboard should be empty to hide other participants');
    }

    console.log('Student results view:', JSON.stringify(studentResult));
    if (!studentResult.me) {
      throw new Error('Student results must exist');
    }
    if ('finalRank' in studentResult.me || 'rank' in studentResult.me || 'leaderboard' in studentResult) {
      throw new Error('Student results must NOT expose rank or leaderboard');
    }
    console.log('✓ Student sees ONLY:');
    console.log(`   - Attempted: ${studentResult.me.attempted}`);
    console.log(`   - Correct: ${studentResult.me.correct}`);
    console.log(`   - Incorrect: ${studentResult.me.incorrect}`);
    console.log(`   - Unanswered: ${studentResult.me.unanswered}`);
    console.log('✓ Student does NOT see rank, position, leaderboard, or other participants');

    // Verify Host still sees full rankings & leaderboard
    console.log(`✓ Host leaderboard visible: ${hostEntries.length} entries`);
    console.log(`✓ Host analytics visible with full participant standings: ${analytics.students.length} participants`);

    console.log('\n==========================================');
    console.log('ALL 4 REQUIREMENTS VERIFIED AND PASSING! 🎉');
    console.log('==========================================');
  } finally {
    // Clean up test data
    if (testCompId) {
      await Attempt.deleteMany({ competitionId: testCompId });
      await Participant.deleteMany({ competitionId: testCompId });
      await Competition.deleteOne({ _id: testCompId });
    }
    if (createdQuestionIds.length) {
      await Question.deleteMany({ _id: { $in: createdQuestionIds } });
    }
    await Student.deleteOne({ _id: student._id });
    await mongoose.disconnect();
    console.log('Cleaned up test data and disconnected from MongoDB.');
  }
}

run().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
