import { apiClient, downloadFile } from './apiClient';
import { call } from './authService';
import type { ImportPreview, Paginated, Question, QuestionInput, QuestionStatus } from '../types';

export interface QuestionFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  difficulty?: string;
  status?: string;
  topic?: string;
  sort?: 'newest' | 'oldest' | 'difficulty';
}

const clean = (filters: QuestionFilters) => Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined));

export const questionService = {
  list: (filters: QuestionFilters) => call(apiClient.get<Paginated<Question>>('/questions', { params: clean(filters) })),
  topics: () => call(apiClient.get<{ topics: string[] }>('/questions/topics')).then((r) => r.topics),
  get: (id: string) => call(apiClient.get<{ question: Question }>(`/questions/${id}`)).then((r) => r.question),
  create: (input: QuestionInput) => call(apiClient.post<{ question: Question }>('/questions', input)).then((r) => r.question),
  update: (id: string, input: QuestionInput) => call(apiClient.put<{ question: Question }>(`/questions/${id}`, input)).then((r) => r.question),
  remove: (id: string) => call(apiClient.delete(`/questions/${id}`)),
  duplicate: (id: string) => call(apiClient.post<{ question: Question }>(`/questions/${id}/duplicate`)).then((r) => r.question),
  previewImport: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return call(apiClient.post<ImportPreview>('/questions/import/preview', form));
  },
  confirmImport: (batchId: string, includeDuplicates: boolean, status: QuestionStatus) =>
    call(apiClient.post<{ insertedCount: number; skippedInvalid: number; skippedDuplicates: number }>('/questions/import/confirm', { batchId, includeDuplicates, status })),
  downloadErrorReport: (batchId: string) => downloadFile(`/questions/import/${batchId}/errors.csv`, 'mathhack-import-errors.csv'),
  downloadTemplate: (format: 'csv' | 'xlsx') => downloadFile(`/questions/template.${format}`, `mathhack-question-template.${format}`),
};
