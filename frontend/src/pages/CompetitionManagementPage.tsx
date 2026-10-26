import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { StatusBadge } from '../components/common/Badges';
import { EmptyState } from '../components/common/EmptyState';
import { Loading } from '../components/common/Loading';
import { Pagination } from '../components/common/Pagination';
import { Panel } from '../components/common/Panel';
import { SelectField, TextAreaField, TextField } from '../components/forms/Fields';
import { PageHeader } from '../components/layout/PageHeader';
import { QueueEditor, type QueueQuestion } from '../features/competition/QueueEditor';
import { useAsync } from '../hooks/useAsync';
import { competitionService } from '../services/competitionService';
import { toApiError, type ApiError } from '../services/apiClient';
import type { ProgressionMode } from '../types';
import { formatDateTime, formatDuration } from '../utils/format';

const STATUS_FILTERS = ['', 'DRAFT', 'WAITING', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED'];

function CreateCompetitionForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [mode, setMode] = useState<ProgressionMode>('AUTOMATIC');
  const [revealAnswers, setRevealAnswers] = useState(true);
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [completeWhenEmpty, setCompleteWhenEmpty] = useState(false);
  const [queue, setQueue] = useState<QueueQuestion[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await competitionService.create({
        name,
        description,
        durationSeconds: Math.round(minutes * 60),
        questionProgressionMode: mode,
        settings: { revealAnswers, showLeaderboardToStudents: showLeaderboard, completeWhenQueueEmpty: completeWhenEmpty },
        questionIds: queue.map((q) => q.id),
      });
      navigate(`/host/competitions/${created.id}`);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const totalSeconds = queue.reduce((sum, q) => sum + q.timeLimitSeconds, 0);
  return (
    <form className="panel panel--holo stack" onSubmit={submit} aria-labelledby="create-title">
      <h2 id="create-title">Create competition</h2>
      <ErrorAlert error={error} title="Could not create the competition" />
      <div className="form-grid">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} error={error?.fieldErrors.name} />
        <TextField label="Duration (minutes)" type="number" min={1} max={360} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} hint="Default 30 minutes" error={error?.fieldErrors.durationSeconds} />
        <SelectField
          label="Question progression"
          value={mode}
          onChange={(e) => setMode(e.target.value as ProgressionMode)}
          options={[{ value: 'AUTOMATIC', label: 'Automatic (next question when time is up)' }, { value: 'MANUAL', label: 'Manual (host publishes each question)' }]}
        />
      </div>
      <TextAreaField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
      <div className="row">
        <label className="checkbox"><input type="checkbox" checked={revealAnswers} onChange={(e) => setRevealAnswers(e.target.checked)} /> Reveal the correct answer when each question closes</label>
        <label className="checkbox"><input type="checkbox" checked={showLeaderboard} onChange={(e) => setShowLeaderboard(e.target.checked)} /> Show the live leaderboard to students</label>
        <label className="checkbox"><input type="checkbox" checked={completeWhenEmpty} onChange={(e) => setCompleteWhenEmpty(e.target.checked)} /> End automatically when the queue runs out</label>
      </div>
      <QueueEditor value={queue} onChange={setQueue} />
      {queue.length > 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Queued question time: {formatDuration(totalSeconds)}. {totalSeconds > minutes * 60 && 'This exceeds the competition duration; later questions will be cut short or never published.'}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn--gold" disabled={saving || name.trim().length < 3}>{saving ? 'Creating…' : 'Create competition'}</button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function CompetitionManagementPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const [creating, setCreating] = useState(false);
  const list = useAsync(() => competitionService.list({ status: status || undefined, page, pageSize: 15 }), [status, page]);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Operations"
        title="Competitions"
        actions={!creating && <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>New competition</button>}
      />
      {creating && <CreateCompetitionForm onCancel={() => setCreating(false)} />}
      <Panel
        title="All competitions"
        actions={
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
            options={STATUS_FILTERS.map((s) => ({ value: s, label: s ? s.charAt(0) + s.slice(1).toLowerCase() : 'All' }))}
          />
        }
      >
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorAlert error={list.error} />
        ) : !list.data?.items.length ? (
          <EmptyState title="No competitions yet">Create one to get started.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Status</th><th className="num">Questions</th><th className="num">Participants</th><th>Duration</th><th>Created</th><th>Actions</th></tr></thead>
                <tbody>
                  {list.data.items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="num">{c.questionCount}</td>
                      <td className="num">{c.participantCount ?? 0}</td>
                      <td>{formatDuration(c.durationSeconds)}</td>
                      <td>{formatDateTime(c.createdAt)}</td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <Link className="btn btn--small" to={`/host/competitions/${c.id}`}>{['RUNNING', 'PAUSED'].includes(c.status) ? 'Live control' : 'Manage'}</Link>
                          {c.status === 'COMPLETED' && <Link className="btn btn--small" to={`/host/competitions/${c.id}/results`}>Results</Link>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParams({ ...(status ? { status } : {}), page: String(p) })} />
          </>
        )}
      </Panel>
    </div>
  );
}
