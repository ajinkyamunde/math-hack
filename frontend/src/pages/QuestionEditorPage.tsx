import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { Loading } from '../components/common/Loading';
import { PageHeader } from '../components/layout/PageHeader';
import { QuestionForm, emptyQuestion } from '../components/questions/QuestionForm';
import { useAsync } from '../hooks/useAsync';
import { questionService } from '../services/questionService';
import { toApiError, type ApiError } from '../services/apiClient';
import type { QuestionInput } from '../types';

export function QuestionEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = useAsync(() => (id ? questionService.get(id) : Promise.resolve(null)), [id]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save(input: QuestionInput) {
    setSaving(true);
    setError(null);
    try {
      if (id) await questionService.update(id, input);
      else await questionService.create(input);
      navigate('/host/questions');
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (id && existing.loading) return <Loading />;
  if (id && existing.error) return <ErrorAlert error={existing.error} />;
  const q = existing.data;
  const initial: QuestionInput = q
    ? { questionText: q.questionText, options: [...q.options], correctOption: q.correctOption, difficulty: q.difficulty, timeLimitSeconds: q.timeLimitSeconds, points: q.points, topic: q.topic, explanation: q.explanation, tags: q.tags, status: q.status }
    : emptyQuestion();

  return (
    <div className="stack">
      <PageHeader eyebrow="Question bank" title={id ? 'Edit MCQ' : 'New MCQ'} description="Exactly four options, one correct answer. Timer ranges follow the difficulty." />
      <QuestionForm key={q?._id ?? 'new'} initial={initial} submitting={saving} serverError={error} onSubmit={(input) => void save(input)} onCancel={() => navigate('/host/questions')} />
    </div>
  );
}
