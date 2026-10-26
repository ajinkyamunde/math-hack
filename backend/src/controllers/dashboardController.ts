import type { Request, Response } from 'express';
import { Attempt } from '../models/Attempt.js';
import { Competition, type CompetitionLean } from '../models/Competition.js';
import { Participant } from '../models/Participant.js';
import { Question } from '../models/Question.js';
import { Student } from '../models/Student.js';
import { hostCompetitionState } from '../services/competitionView.js';
import { broadcaster } from '../sockets/broadcaster.js';

/** Real counts for the host overview cards. Every number comes from the database or live socket rooms. */
export async function overview(_req: Request, res: Response): Promise<void> {
  const [registeredStudents, activeQuestions, totalQuestions, active] = await Promise.all([
    Student.estimatedDocumentCount(),
    Question.countDocuments({ status: 'ACTIVE' }),
    Question.estimatedDocumentCount(),
    Competition.findOne({ status: { $in: ['RUNNING', 'PAUSED', 'WAITING'] } })
      .sort({ status: 1, updatedAt: -1 })
      .lean<CompetitionLean>(),
  ]);

  let activeCompetition = null;
  if (active) {
    const id = String(active._id);
    const [participants, connected, answers] = await Promise.all([
      Participant.countDocuments({ competitionId: active._id }),
      broadcaster().connectedStudentIds(id),
      active.currentQuestionId
        ? Attempt.countDocuments({ competitionId: active._id, questionId: active.currentQuestionId, timedOut: false })
        : Promise.resolve(0),
    ]);
    activeCompetition = { ...hostCompetitionState(active, Date.now()), participants, connectedParticipants: connected.length, answersReceived: answers };
  }

  res.json({ registeredStudents, activeQuestions, totalQuestions, activeCompetition });
}
