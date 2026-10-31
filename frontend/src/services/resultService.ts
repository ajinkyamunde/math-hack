import { apiClient, downloadFile } from './apiClient';
import { call } from './authService';
import type { DifficultySummary, LeaderboardEntry, Paginated, ParticipantSummaryResult, QuestionStats, ResultsSummary, StudentResult } from '../types';

export type CsvExportType = 'results' | 'students' | 'questions' | 'difficulty' | 'attempts';

export interface HistoryItem {
  competitionId: string;
  name: string;
  status: string;
  joinedAt: string;
  completedAt: string | null;
  finalScore: number | null;
  finalRank: number | null;
}

export const resultService = {
  leaderboard: (id: string) =>
    call(apiClient.get<{ entries: LeaderboardEntry[]; total: number; me?: { rank: number; totalPoints: number; correct: number; answered: number; accuracy: number | null } | null }>(`/competitions/${id}/leaderboard`)),
  hostResults: (id: string) => call(apiClient.get<{ summary: ResultsSummary; students: StudentResult[] }>(`/competitions/${id}/results`)),
  myResult: (id: string) => call(apiClient.get<{ summary: { name: string }; me: ParticipantSummaryResult }>(`/competitions/${id}/results`)),
  analytics: (id: string) => call(apiClient.get<{ summary: ResultsSummary; questions: QuestionStats[]; difficulty: DifficultySummary[] }>(`/competitions/${id}/analytics`)),
  history: (page = 1) => call(apiClient.get<Paginated<HistoryItem>>('/students/me/history', { params: { page, pageSize: 10 } })),
  exportXlsx: (id: string) => downloadFile(`/competitions/${id}/export.xlsx`, 'mathhack-results.xlsx'),
  exportCsv: (id: string, type: CsvExportType) => downloadFile(`/competitions/${id}/export.csv?type=${type}`, `mathhack-${type}.csv`),
  studentReport: (id: string, studentId: string) => downloadFile(`/competitions/${id}/students/${studentId}/report.csv`, 'mathhack-student-report.csv'),
  myReport: (id: string) => downloadFile(`/competitions/${id}/my-report.csv`, 'mathhack-my-report.csv'),
};
