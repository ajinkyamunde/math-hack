import { apiClient, downloadFile } from './apiClient';
import { call } from './authService';
import type { AssignableCompetition, CreatedParticipant, ParticipantFilters, ParticipantView } from '../types';
import type { NewParticipantInput } from '../features/participants/participantValidation';

/** Only non-empty filters are sent, so the URL stays short and the server applies its defaults. */
export function participantQuery(filters: ParticipantFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.department) params.set('department', filters.department);
  if (filters.academicYear) params.set('academicYear', filters.academicYear);
  if (filters.includeRegistered) params.set('includeRegistered', 'true');
  return params;
}

const withQuery = (path: string, filters: ParticipantFilters) => {
  const query = participantQuery(filters).toString();
  return query ? `${path}?${query}` : path;
};

/** Host-only. The server checks the host session and that this host created the competition. */
export const participantService = {
  list: (competitionId: string, filters: ParticipantFilters) =>
    call(apiClient.get<ParticipantView>(withQuery(`/competitions/${competitionId}/participants`, filters))),
  exportXlsx: (competitionId: string, filters: ParticipantFilters) => {
    const params = participantQuery(filters);
    // Excel cells have no time zone, so the server writes times in the host's own zone.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) params.set('tz', timeZone);
    return downloadFile(`/competitions/${competitionId}/participants/export.xlsx?${params.toString()}`, 'mathhack-participants.xlsx');
  },
  assignableCompetitions: () => call(apiClient.get<{ items: AssignableCompetition[] }>('/host/assignable-competitions')).then((r) => r.items),
  create: (input: NewParticipantInput) =>
    call(
      apiClient.post<CreatedParticipant>('/host/participants', {
        ...input,
        prn: input.prn.trim() || undefined,
        competitionId: input.competitionId || undefined,
      }),
    ),
  /** The host sets a new password; nobody can read the old one. */
  resetPassword: (competitionId: string, studentId: string, password: string) =>
    call(apiClient.post<{ reset: boolean }>(`/competitions/${competitionId}/participants/${studentId}/password`, { password })),
};
