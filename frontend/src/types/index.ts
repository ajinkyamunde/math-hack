export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type OptionKey = 'A' | 'B' | 'C' | 'D';
export type QuestionStatus = 'DRAFT' | 'ACTIVE';
export type CompetitionStatus = 'DRAFT' | 'WAITING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type ProgressionMode = 'AUTOMATIC' | 'MANUAL';
export type Role = 'student' | 'host';

export const OPTION_KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];
export const DIFFICULTIES: Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];
export const ACADEMIC_YEARS = ['FE', 'SE', 'TE', 'BE', 'PG1', 'PG2'] as const;

/** Mirrors the server's validation ranges so forms can guide the host; the server remains authoritative. */
export const DIFFICULTY_RULES: Record<Difficulty, { defaultSeconds: number; minSeconds: number; maxSeconds: number; defaultPoints: number }> = {
  EASY: { defaultSeconds: 25, minSeconds: 20, maxSeconds: 30, defaultPoints: 10 },
  MEDIUM: { defaultSeconds: 300, minSeconds: 300, maxSeconds: 360, defaultPoints: 20 },
  HARD: { defaultSeconds: 900, minSeconds: 720, maxSeconds: 900, defaultPoints: 30 },
};

export interface StudentUser {
  _id: string;
  role: 'student';
  name: string;
  prn: string;
  email: string;
  department: string;
  academicYear: string;
  emailVerified: boolean;
  rosterVerified?: boolean;
  createdAt: string;
}

export interface HostUser {
  _id: string;
  role: 'host';
  name: string;
  email: string;
}

export type User = StudentUser | HostUser;

export interface SessionResponse {
  user: User;
  csrfToken: string;
  emailVerificationAvailable?: boolean;
  emailVerificationRequired?: boolean;
}

export interface Question {
  _id: string;
  questionText: string;
  options: string[];
  correctOption: OptionKey;
  difficulty: Difficulty;
  timeLimitSeconds: number;
  points: number;
  topic: string;
  explanation: string;
  tags: string[];
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
  importedAt?: string;
}

export interface QuestionInput {
  questionText: string;
  options: string[];
  correctOption: OptionKey;
  difficulty: Difficulty;
  timeLimitSeconds: number;
  points: number;
  topic: string;
  explanation: string;
  tags: string[];
  status: QuestionStatus;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PublicQuestion {
  id: string;
  questionText: string;
  options: string[];
  difficulty: Difficulty;
  points: number;
  timeLimitSeconds: number;
  publishedAt?: string;
  deadline?: string;
  remainingMs: number;
  correctOption?: OptionKey;
  explanation?: string;
}

export interface CompetitionSettings {
  revealAnswers?: boolean;
  showLeaderboardToStudents?: boolean;
  completeWhenQueueEmpty?: boolean;
  pointsOverride?: Partial<Record<Difficulty, number | null>> | null;
}

interface CompetitionStateBase {
  id: string;
  name: string;
  description: string;
  status: CompetitionStatus;
  durationSeconds: number;
  questionProgressionMode: ProgressionMode;
  startedAt: string | null;
  endsAt: string | null;
  completedAt: string | null;
  remainingMs: number | null;
  serverNow: string;
  questionNumber: number | null;
  totalQuestions: number;
  currentQuestion: PublicQuestion | null;
}

export interface StudentCompetitionState extends CompetitionStateBase {
  joined: boolean;
  settings: { revealAnswers: boolean; showLeaderboardToStudents: boolean };
  mySubmission: { questionId: string; selectedOption: OptionKey | null; submittedAt: string | null } | null;
}

export interface QueueEntry {
  questionId: string;
  order: number;
  status: 'PENDING' | 'LIVE' | 'CLOSED' | 'SKIPPED';
  snapshot: { questionText: string; difficulty: Difficulty; points: number; timeLimitSeconds: number; correctOption: OptionKey } | null;
  publishedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

export interface HostCompetitionState extends CompetitionStateBase {
  settings: CompetitionSettings;
  createdAt?: string;
  pausedAt: string | null;
  completionReason: string | null;
  queue: QueueEntry[];
  /** Present on the initial host read (GET); live updates arrive as socket events. */
  participants?: number;
  connectedParticipants?: number;
}

export interface CompetitionSummary {
  id: string;
  name: string;
  description: string;
  status: CompetitionStatus;
  durationSeconds: number;
  questionCount: number;
  startedAt: string | null;
  endsAt: string | null;
  completedAt: string | null;
  createdAt: string;
  joined?: boolean;
  participantCount?: number;
  questionProgressionMode?: ProgressionMode;
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  name: string;
  department: string;
  totalPoints: number;
  correct: number;
  prn?: string;
  incorrect?: number;
  answered?: number;
  accuracy?: number | null;
  avgCorrectResponseMs?: number | null;
}

export interface DifficultyStats {
  attempted: number;
  correct: number;
  incorrect: number;
  timedOut: number;
  avgResponseMs: number | null;
  avgCorrectResponseMs: number | null;
}

export interface StudentResult extends Required<Pick<LeaderboardEntry, 'rank' | 'studentId' | 'name' | 'department' | 'totalPoints' | 'correct'>> {
  prn: string;
  incorrect: number;
  answered: number;
  attempted: number;
  unanswered: number;
  accuracy: number | null;
  avgResponseMs: number | null;
  avgCorrectResponseMs: number | null;
  byDifficulty: Record<Difficulty, DifficultyStats>;
}

export interface ResultsSummary {
  competitionId: string;
  name: string;
  status: CompetitionStatus;
  participants: number;
  questionsPublished: number;
  totalSubmissions: number;
  averageScore: number | null;
  highestScore: number | null;
}

export interface QuestionStats {
  questionId: string;
  position: number;
  questionText: string;
  difficulty: Difficulty;
  correctOption: OptionKey;
  submissions: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  accuracy: number | null;
  avgResponseMs: number | null;
  optionCounts: Record<OptionKey, number>;
}

export interface DifficultySummary extends DifficultyStats {
  difficulty: Difficulty;
  accuracy: number | null;
}

export interface ImportPreview {
  batchId: string;
  fileType: 'csv' | 'xlsx';
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  validRows: { rowNumber: number; question: QuestionInput }[];
  invalidRows: { rowNumber: number; questionText: string; errors: { field: string; message: string }[] }[];
  duplicateRows: { rowNumber: number; question: QuestionInput; reason: string }[];
  expiresAt: string;
}

export interface HostOverview {
  registeredStudents: number;
  activeQuestions: number;
  totalQuestions: number;
  activeCompetition: (HostCompetitionState & { participants: number; connectedParticipants: number; answersReceived: number }) | null;
}
