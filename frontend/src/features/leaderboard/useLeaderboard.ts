import { resultService } from '../../services/resultService';
import { useAsync } from '../../hooks/useAsync';

export function useLeaderboard(competitionId: string | undefined) {
  return useAsync(() => (competitionId ? resultService.leaderboard(competitionId) : Promise.resolve(null)), [competitionId]);
}
