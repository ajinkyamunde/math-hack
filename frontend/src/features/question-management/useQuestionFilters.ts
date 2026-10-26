import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { QuestionFilters } from '../../services/questionService';

/** Keeps question-bank filters in the URL so they survive refreshes and can be shared. */
export function useQuestionFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<Required<Pick<QuestionFilters, 'page' | 'search' | 'difficulty' | 'status' | 'topic'>>>(
    () => ({
      page: Math.max(1, Number(params.get('page') ?? 1) || 1),
      search: params.get('search') ?? '',
      difficulty: params.get('difficulty') ?? '',
      status: params.get('status') ?? '',
      topic: params.get('topic') ?? '',
    }),
    [params],
  );
  const setFilter = (key: keyof typeof filters, value: string | number) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === undefined) next.delete(key);
    else next.set(key, String(value));
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  return { filters, setFilter };
}
