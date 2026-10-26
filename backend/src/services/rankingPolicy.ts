/**
 * Deterministic ranking (documented in docs/ARCHITECTURE.md):
 *   1. Total points (higher first)
 *   2. Correct answers (more first)
 *   3. Accuracy = correct / answered (higher first; nobody-answered counts as lowest)
 *   4. Average response time on correct answers (faster first; no correct answers sorts last)
 * Participants equal on all four share a rank (standard competition ranking: 1, 2, 2, 4).
 * Display order inside a tie is by PRN so the output is stable, but the rank number is shared.
 * A sudden-death decider is run by the host publishing an extra question; it is not automatic.
 */
export interface RankableEntry {
  prn: string;
  totalPoints: number;
  correct: number;
  accuracy: number | null;
  avgCorrectResponseMs: number | null;
}

export function compareEntries(a: RankableEntry, b: RankableEntry): number {
  return tieKeyCompare(a, b) || a.prn.localeCompare(b.prn);
}

function tieKeyCompare(a: RankableEntry, b: RankableEntry): number {
  if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
  if (b.correct !== a.correct) return b.correct - a.correct;
  const accA = a.accuracy ?? -1;
  const accB = b.accuracy ?? -1;
  if (accB !== accA) return accB - accA;
  const timeA = a.avgCorrectResponseMs ?? Number.POSITIVE_INFINITY;
  const timeB = b.avgCorrectResponseMs ?? Number.POSITIVE_INFINITY;
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  return 0;
}

export function assignRanks<T extends RankableEntry>(entries: T[]): (T & { rank: number })[] {
  const sorted = entries.slice().sort(compareEntries);
  let rank = 0;
  return sorted.map((entry, index) => {
    if (index === 0 || tieKeyCompare(sorted[index - 1]!, entry) !== 0) rank = index + 1;
    return { ...entry, rank };
  });
}
