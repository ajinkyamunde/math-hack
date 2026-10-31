import { useCallback, useEffect, useState } from 'react';
import { competitionService } from '../../services/competitionService';
import { emitWithAck, getSocket } from '../../services/socketService';
import { toApiError, type ApiError } from '../../services/apiClient';
import type { LeaderboardEntry, OptionKey, PublicQuestion, StudentCompetitionState } from '../../types';
import { syncServerClock } from '../../utils/serverClock';
import { useCompetitionSocket } from './useCompetitionSocket';

export interface ClosedQuestion {
  questionId: string;
  correctOption?: OptionKey;
  explanation?: string | null;
  reason?: string;
}

type Submission = StudentCompetitionState['mySubmission'];

const POLL_INTERVAL_MS = 5000;

export function useStudentCompetition(competitionId: string | undefined) {
  const [state, setState] = useState<StudentCompetitionState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [lastClosed, setLastClosed] = useState<ClosedQuestion | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** Applies a state payload, keeping our own submission when a room-wide broadcast does not carry it. */
  const applyState = useCallback((next: StudentCompetitionState) => {
    syncServerClock(next.serverNow);
    setState((previous) => {
      const keepSubmission: Submission =
        next.mySubmission ?? (previous?.mySubmission && previous.mySubmission.questionId === next.currentQuestion?.id ? previous.mySubmission : null);
      return { ...next, joined: previous?.joined || next.joined, mySubmission: keepSubmission };
    });
  }, []);

  const fetchState = useCallback(async () => {
    if (!competitionId) return;
    try {
      const fresh = await competitionService.studentState(competitionId);
      setState(fresh);
      syncServerClock(fresh.serverNow);
      setError(null);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
    }
  }, [competitionId]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const connection = useCompetitionSocket<StudentCompetitionState>(
    competitionId,
    Boolean(state?.joined),
    {
      'competition:state': (payload: StudentCompetitionState) => applyState(payload),
      'question:published': (payload: { serverNow: string; question: PublicQuestion }) => {
        syncServerClock(payload.serverNow);
        setLastClosed(null);
        setSubmitError(null);
        setState((previous) => (previous ? { ...previous, currentQuestion: payload.question, mySubmission: null } : previous));
      },
      'question:closed': (payload: ClosedQuestion) => {
        setLastClosed(payload);
        setState((previous) =>
          previous && previous.currentQuestion?.id === payload.questionId ? { ...previous, currentQuestion: null } : previous,
        );
      },
      'answer:received': (payload: { questionId: string; selectedOption: OptionKey; submittedAt: string }) => {
        setState((previous) => (previous ? { ...previous, mySubmission: { ...payload } } : previous));
      },
      'leaderboard:updated': (payload: { entries: LeaderboardEntry[] }) => setLeaderboard(payload.entries),
    },
    applyState,
    (err) => setError(toApiError(err)),
  );

  // HTTP fallback: while the socket is down, keep the essential state fresh by polling.
  useEffect(() => {
    if (!state?.joined || connection === 'online') return undefined;
    if (state.status === 'COMPLETED' || state.status === 'CANCELLED') return undefined;
    const id = window.setInterval(() => void fetchState(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [state?.joined, state?.status, connection, fetchState]);

  const join = useCallback(async () => {
    if (!competitionId) return;
    try {
      const joined = await competitionService.join(competitionId);
      setState(joined);
      syncServerClock(joined.serverNow);
      setError(null);
    } catch (err) {
      setError(toApiError(err));
    }
  }, [competitionId]);

  const submit = useCallback(
    async (questionId: string, option: OptionKey) => {
      if (!competitionId) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const result = getSocket().connected
          ? await emitWithAck<{ questionId: string; selectedOption: OptionKey; submittedAt: string }>('question:submit', { competitionId, questionId, selectedOption: option })
          : await competitionService.submitAnswer(competitionId, questionId, option);
        void result;
        await fetchState();
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'Your answer could not be submitted.');
        void fetchState();
      } finally {
        setSubmitting(false);
      }
    },
    [competitionId, fetchState],
  );

  return { state, error, loading, connection, leaderboard, lastClosed, submitting, submitError, join, submit, refresh: fetchState };
}
