import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { DifficultyBadge, StatusBadge } from '../components/common/Badges';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { EmptyState } from '../components/common/EmptyState';
import { Loading } from '../components/common/Loading';
import { Pagination } from '../components/common/Pagination';
import { Panel } from '../components/common/Panel';
import { SelectField, TextField } from '../components/forms/Fields';
import { PageHeader } from '../components/layout/PageHeader';
import { QuestionPreview } from '../components/questions/QuestionPreview';
import { useQuestionFilters } from '../features/question-management/useQuestionFilters';
import { useAsync } from '../hooks/useAsync';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { questionService } from '../services/questionService';
import { toApiError, type ApiError } from '../services/apiClient';
import { DIFFICULTIES, type Question } from '../types';
import { titleCase } from '../utils/format';

const PAGE_SIZE = 15;

export function QuestionBankPage() {
  const { filters, setFilter } = useQuestionFilters();
  const [searchText, setSearchText] = useState(filters.search);
  const search = useDebouncedValue(searchText, 350);
  const [preview, setPreview] = useState<Question | null>(null);
  const [toDelete, setToDelete] = useState<Question | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const list = useAsync(
    () => questionService.list({ ...filters, search, pageSize: PAGE_SIZE }),
    [filters.page, filters.difficulty, filters.status, filters.topic, search],
  );
  const topics = useAsync(() => questionService.topics(), []);

  async function duplicate(question: Question) {
    setActionError(null);
    try {
      await questionService.duplicate(question._id);
      await list.reload();
    } catch (err) {
      setActionError(toApiError(err));
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    setActionError(null);
    try {
      await questionService.remove(toDelete._id);
      setToDelete(null);
      await list.reload();
    } catch (err) {
      setActionError(toApiError(err));
      setToDelete(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Arsenal"
        title="Question Bank"
        description={list.data ? `${list.data.total} question${list.data.total === 1 ? '' : 's'} match your filters` : undefined}
        actions={
          <>
            <Link className="btn" to="/host/questions/import">Bulk import</Link>
            <Link className="btn btn--primary" to="/host/questions/new">Add MCQ</Link>
          </>
        }
      />
      <div className="toolbar" role="search">
        <TextField label="Search" type="search" placeholder="Text, topic or tag" value={searchText} onChange={(e) => { setSearchText(e.target.value); setFilter('page', 1); }} />
        <SelectField label="Difficulty" value={filters.difficulty} onChange={(e) => setFilter('difficulty', e.target.value)} options={[{ value: '', label: 'All' }, ...DIFFICULTIES.map((d) => ({ value: d, label: titleCase(d) }))]} />
        <SelectField label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} options={[{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'DRAFT', label: 'Draft' }]} />
        <SelectField label="Topic" value={filters.topic} onChange={(e) => setFilter('topic', e.target.value)} options={[{ value: '', label: 'All topics' }, ...(topics.data ?? []).map((t) => ({ value: t, label: t }))]} />
      </div>
      <ErrorAlert error={actionError} />
      <Panel>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorAlert error={list.error} />
        ) : !list.data?.items.length ? (
          <EmptyState title="No questions found" action={<Link className="btn btn--primary" to="/host/questions/new">Create the first question</Link>}>
            Adjust the filters, add a question manually, or import a spreadsheet.
          </EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Question</th><th>Difficulty</th><th>Topic</th><th className="num">Time</th><th className="num">Pts</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {list.data.items.map((q) => (
                    <tr key={q._id}>
                      <td style={{ minWidth: 220, maxWidth: 420 }}>{q.questionText}</td>
                      <td><DifficultyBadge difficulty={q.difficulty} /></td>
                      <td>{q.topic || <span className="muted">—</span>}</td>
                      <td className="num">{q.timeLimitSeconds}s</td>
                      <td className="num">{q.points}</td>
                      <td><StatusBadge status={q.status} /></td>
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                          <button type="button" className="btn btn--small" onClick={() => setPreview(q)} aria-label={`Preview: ${q.questionText}`}>Preview</button>
                          <Link className="btn btn--small" to={`/host/questions/${q._id}/edit`} aria-label={`Edit: ${q.questionText}`}>Edit</Link>
                          <button type="button" className="btn btn--small" onClick={() => void duplicate(q)} aria-label={`Duplicate: ${q.questionText}`}>Duplicate</button>
                          <button type="button" className="btn btn--small btn--danger" onClick={() => setToDelete(q)} aria-label={`Delete: ${q.questionText}`}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.data.total} onChange={(p) => setFilter('page', p)} />
          </>
        )}
      </Panel>
      {preview && (
        <div className="dialog-backdrop" onClick={() => setPreview(null)}>
          <div className="panel panel--holo" style={{ maxWidth: 760, width: '100%' }} role="dialog" aria-modal="true" aria-label="Question preview" onClick={(e) => e.stopPropagation()}>
            <QuestionPreview {...preview} />
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn" onClick={() => setPreview(null)} autoFocus>Close</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete this question?"
        message="It will be removed from the question bank. Results of finished competitions keep their own copy."
        confirmLabel="Delete question"
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
