import { formatClock } from '../../utils/format';

export function CompetitionClock({ remainingMs, paused }: { remainingMs: number | null; paused?: boolean }) {
  return (
    <div className="stat" aria-label={`Competition time remaining ${formatClock(remainingMs)}${paused ? ', paused' : ''}`}>
      <span className="stat__label">Competition{paused ? ' (paused)' : ''}</span>
      <span className="stat__value">{formatClock(remainingMs)}</span>
    </div>
  );
}
