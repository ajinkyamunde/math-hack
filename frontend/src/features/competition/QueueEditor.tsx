import { useMemo, useState } from 'react';
import { DifficultyBadge } from '../../components/common/Badges';
import { EmptyState } from '../../components/common/EmptyState';
import { Loading } from '../../components/common/Loading';
import { TextField } from '../../components/forms/Fields';
import { useAsync } from '../../hooks/useAsync';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { questionService } from '../../services/questionService';
import type { Difficulty } from '../../types';

export interface QueueQuestion {
  id: string;
  questionText: string;
  difficulty: Difficulty;
  timeLimitSeconds: number;
  points: number;
  locked?: boolean;
  status?: string;
}

interface QueueEditorProps {
  value: QueueQuestion[];
  onChange: (next: QueueQuestion[]) => void;
}

/**
 * Picks ACTIVE questions from the bank and orders them explicitly. Locked items (already published)
 * stay in place; move buttons work with keyboard and touch, unlike drag-and-drop.
 */
export function QueueEditor({ value, onChange }: QueueEditorProps) {
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  const bank = useAsync(() => questionService.list({ status: 'ACTIVE', search: debounced, pageSize: 50, sort: 'difficulty' }), [debounced]);
  const selected = useMemo(() => new Set(value.map((q) => q.id)), [value]);
  const firstMovable = value.findIndex((q) => !q.locked);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < firstMovable || target >= value.length || value[target]?.locked) return;
    const next = value.slice();
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="grid grid--2">
      <div className="stack">
        <h3 style={{ margin: 0 }}>Queue ({value.length})</h3>
        {value.length === 0 ? (
          <EmptyState title="Queue is empty">Add active questions from the bank.</EmptyState>
        ) : (
          <ol className="queue-list">
            {value.map((q, index) => (
              <li key={q.id} className={`queue-item ${q.status === 'LIVE' ? 'is-live' : ''} ${q.locked && q.status !== 'LIVE' ? 'is-done' : ''}`}>
                <span className="queue-item__index">{index + 1}</span>
                <span className="queue-item__text">{q.questionText}</span>
                <DifficultyBadge difficulty={q.difficulty} />
                {q.locked ? (
                  <span className="badge badge--neutral">{q.status?.toLowerCase()}</span>
                ) : (
                  <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <button type="button" className="btn btn--small icon-btn" onClick={() => move(index, -1)} disabled={index <= firstMovable} aria-label={`Move question ${index + 1} up`}>↑</button>
                    <button type="button" className="btn btn--small icon-btn" onClick={() => move(index, 1)} disabled={index === value.length - 1} aria-label={`Move question ${index + 1} down`}>↓</button>
                    <button type="button" className="btn btn--small btn--danger icon-btn" onClick={() => onChange(value.filter((x) => x.id !== q.id))} aria-label={`Remove question ${index + 1}`}>✕</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Active questions</h3>
        <TextField label="Search the bank" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        {bank.loading && !bank.data ? (
          <Loading />
        ) : !bank.data?.items.length ? (
          <EmptyState title="No active questions">Create or import questions and save them as active.</EmptyState>
        ) : (
          <ul className="queue-list" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {bank.data.items.map((q) => (
              <li key={q._id} className="queue-item">
                <span className="queue-item__text">{q.questionText}</span>
                <DifficultyBadge difficulty={q.difficulty} />
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={selected.has(q._id)}
                  onClick={() => onChange([...value, { id: q._id, questionText: q.questionText, difficulty: q.difficulty, timeLimitSeconds: q.timeLimitSeconds, points: q.points }])}
                  aria-label={`Add to queue: ${q.questionText}`}
                >
                  {selected.has(q._id) ? 'Added' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
