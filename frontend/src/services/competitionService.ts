import { apiClient } from './apiClient';
import { call } from './authService';
import type { CompetitionSettings, CompetitionSummary, HostCompetitionState, HostOverview, OptionKey, Paginated, ProgressionMode, StudentCompetitionState } from '../types';

export interface CompetitionInput {
  name: string;
  description: string;
  durationSeconds: number;
  questionProgressionMode: ProgressionMode;
  settings: CompetitionSettings;
  questionIds?: string[];
}

export type HostCommand = 'open' | 'start' | 'pause' | 'resume' | 'publish' | 'skip' | 'end' | 'cancel';

export const competitionService = {
  list: (params: { page?: number; pageSize?: number; status?: string } = {}) => call(apiClient.get<Paginated<CompetitionSummary>>('/competitions', { params })),
  create: (input: CompetitionInput) => call(apiClient.post<{ competition: HostCompetitionState }>('/competitions', input)).then((r) => r.competition),
  update: (id: string, input: Partial<CompetitionInput>) => call(apiClient.patch<{ competition: HostCompetitionState }>(`/competitions/${id}`, input)).then((r) => r.competition),
  hostState: (id: string) => call(apiClient.get<{ competition: HostCompetitionState }>(`/competitions/${id}`)).then((r) => r.competition),
  studentState: (id: string) => call(apiClient.get<{ competition: StudentCompetitionState }>(`/competitions/${id}/state`)).then((r) => r.competition),
  setQueue: (id: string, questionIds: string[]) => call(apiClient.put<{ competition: HostCompetitionState }>(`/competitions/${id}/queue`, { questionIds })).then((r) => r.competition),
  command: (id: string, command: HostCommand, questionId?: string) =>
    call(apiClient.post<{ competition: HostCompetitionState }>(`/competitions/${id}/${command}`, questionId ? { questionId } : {})).then((r) => r.competition),
  join: (id: string) => call(apiClient.post<{ competition: StudentCompetitionState }>(`/competitions/${id}/join`)).then((r) => r.competition),
  submitAnswer: (id: string, questionId: string, selectedOption: OptionKey) =>
    call(apiClient.post<{ submission: { questionId: string; selectedOption: OptionKey; submittedAt: string; alreadySubmitted: boolean } }>(`/competitions/${id}/answers`, { questionId, selectedOption })).then((r) => r.submission),
  overview: () => call(apiClient.get<HostOverview>('/host/overview')),
};
