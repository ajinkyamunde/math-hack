import type { CompetitionStatus, Difficulty, QuestionStatus } from '../../types';
import { titleCase } from '../../utils/format';

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`badge badge--${difficulty.toLowerCase()}`}>{titleCase(difficulty)}</span>;
}

export function StatusBadge({ status }: { status: CompetitionStatus | QuestionStatus }) {
  return (
    <span className={`badge badge--status-${status.toLowerCase()}`}>
      {status === 'RUNNING' && <span className="dot" aria-hidden="true" />}
      {titleCase(status)}
    </span>
  );
}
