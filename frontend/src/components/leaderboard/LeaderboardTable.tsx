import type { LeaderboardEntry } from '../../types';
import { formatPercent, formatSeconds } from '../../utils/format';
import { EmptyState } from '../common/EmptyState';

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  highlightId?: string;
  detailed?: boolean;
  caption?: string;
}

export function LeaderboardTable({ entries, highlightId, detailed, caption = 'Leaderboard' }: LeaderboardTableProps) {
  if (!entries.length) return <EmptyState title="No standings yet">Scores appear after participants answer questions.</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">Rank</th>
            <th scope="col">Name</th>
            {detailed && <th scope="col">PRN</th>}
            <th scope="col">Department</th>
            <th scope="col" className="num">Points</th>
            <th scope="col" className="num">Correct</th>
            {detailed && <th scope="col" className="num">Accuracy</th>}
            {detailed && <th scope="col" className="num">Avg correct time</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.studentId} className={entry.studentId === highlightId ? 'is-me' : undefined}>
              <td className="num">{entry.rank <= 3 ? <strong style={{ color: 'var(--color-gold)' }}>#{entry.rank}</strong> : `#${entry.rank}`}</td>
              <td>{entry.name}{entry.studentId === highlightId && <span className="muted small"> (you)</span>}</td>
              {detailed && <td className="mono">{entry.prn}</td>}
              <td>{entry.department}</td>
              <td className="num">{entry.totalPoints}</td>
              <td className="num">{entry.correct}</td>
              {detailed && <td className="num">{formatPercent(entry.accuracy)}</td>}
              {detailed && <td className="num">{formatSeconds(entry.avgCorrectResponseMs)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
