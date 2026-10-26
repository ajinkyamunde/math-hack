import { useCallback, useEffect, useState } from 'react';
import { competitionService, type HostCommand } from '../../services/competitionService';
import { toApiError, type ApiError } from '../../services/apiClient';
import type { HostCompetitionState, LeaderboardEntry } from '../../types';
import { syncServerClock } from '../../utils/serverClock';
import { useCompetitionSocket } from './useCompetitionSocket';

export function useHostCompetition(competitionId: string | undefined) {
  const [state, setState] = useState<HostCompetitionState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [answerCount, setAnswerCount] = useState<{ questionId: string; answered: number } | null>(null);
  const [connected, setConnected] = useState<number | null>(null);
  const [participants, setParticipants] = useState<number | null>(null);

  const apply = useCallback((next: HostCompetitionState) => {
    syncServerClock(next.serverNow);
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!competitionId) return;
    try {
      const fresh = await competitionService.hostState(competitionId);
      apply(fresh);
      if (fresh.participants !== undefined) setParticipants(fresh.participants);
      if (fresh.connectedParticipants !== undefined) setConnected(fresh.connectedParticipants);
      setError(null);
    } catch (err) {
      setError(toApiError(err));
    }
  }, [competitionId, apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connection = useCompetitionSocket<HostCompetitionState>(
    competitionId,
    true,
    {
      'competition:state': (payload: HostCompetitionState) => apply(payload),
      'leaderboard:updated': (payload: { entries: LeaderboardEntry[] }) => setLeaderboard(payload.entries),
      'question:answer-count': (payload: { questionId: string; answered: number }) => setAnswerCount(payload),
      'question:published': () => setAnswerCount(null),
      'participant:connection': (payload: { connected: number }) => setConnected(payload.connected),
      'participant:joined': (payload: { participantCount: number }) => setParticipants(payload.participantCount),
    },
    apply,
  );

  const run = useCallback(
    async (command: HostCommand, questionId?: string) => {
      if (!competitionId) return;
      setBusy(command);
      setActionError(null);
      try {
        apply(await competitionService.command(competitionId, command, questionId));
      } catch (err) {
        setActionError(toApiError(err));
      } finally {
        setBusy(null);
      }
    },
    [competitionId, apply],
  );

  const saveQueue = useCallback(
    async (questionIds: string[]) => {
      if (!competitionId) return;
      setBusy('queue');
      setActionError(null);
      try {
        apply(await competitionService.setQueue(competitionId, questionIds));
      } catch (err) {
        setActionError(toApiError(err));
      } finally {
        setBusy(null);
      }
    },
    [competitionId, apply],
  );

  return { state, error, actionError, busy, connection, leaderboard, setLeaderboard, answerCount, connected, participants, run, saveQueue, refresh };
}
