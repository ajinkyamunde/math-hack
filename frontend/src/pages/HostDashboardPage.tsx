import { Link } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { StatusBadge } from '../components/common/Badges';
import { EmptyState } from '../components/common/EmptyState';
import { Loading } from '../components/common/Loading';
import { Panel } from '../components/common/Panel';
import { StatCard } from '../components/common/StatCard';
import { PageHeader } from '../components/layout/PageHeader';
import { useAsync } from '../hooks/useAsync';
import { useNow } from '../hooks/useNow';
import { competitionService } from '../services/competitionService';
import { formatClock } from '../utils/format';
import { remainingUntil, syncServerClock } from '../utils/serverClock';
import { useEffect, useState } from 'react';
import { AddParticipantForm } from '../features/participants/AddParticipantForm';

export function HostDashboardPage() {
  const overview = useAsync(() => competitionService.overview(), []);
  const active = overview.data?.activeCompetition ?? null;
  const now = useNow(1000, active?.status === 'RUNNING');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (active) syncServerClock(active.serverNow);
  }, [active]);

  // Light polling keeps the overview cards current without a socket on this page.
  const { reload } = overview;
  useEffect(() => {
    const id = window.setInterval(() => void reload(), 10000);
    return () => window.clearInterval(id);
  }, [reload]);

  if (overview.loading && !overview.data) return <Loading label="Booting command center…" />;
  if (overview.error) return <ErrorAlert error={overview.error} title="Could not load the overview" />;
  const data = overview.data!;
  const remaining = active ? (active.status === 'PAUSED' ? active.remainingMs : remainingUntil(active.endsAt, undefined, now)) : null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Mission control"
        title="Command Center"
        actions={
          <>
            <Link className="btn btn--primary" to="/host/questions/new">Add MCQ</Link>
            <button type="button" className="btn" aria-expanded={adding} onClick={() => setAdding((open) => !open)}>Add participant</button>
            <Link className="btn" to="/host/competitions">Competitions</Link>
          </>
        }
      />
      {adding && <AddParticipantForm defaultCompetitionId={active?.id ?? ''} onCreated={() => void reload()} onClose={() => setAdding(false)} />}
      <div className="grid grid--stats">
        <StatCard label="Registered students" value={data.registeredStudents} />
        <StatCard label="Active questions" value={data.activeQuestions} hint={`${data.totalQuestions} in bank`} />
        <StatCard label="Active competition" value={active ? <StatusBadge status={active.status} /> : 'None'} hint={active?.name} />
        <StatCard label="Connected participants" value={active ? active.connectedParticipants : '—'} hint={active ? `${active.participants} joined` : undefined} />
        <StatCard label="Current question" value={active?.questionNumber ? `Q${active.questionNumber}` : '—'} hint={active?.currentQuestion ? `${active.answersReceived} answers received` : undefined} />
        <StatCard label="Time remaining" value={active?.startedAt ? formatClock(remaining) : '—'} />
      </div>
      <Panel title="Active competition">
        {active ? (
          <div className="row row--between">
            <div>
              <h3 style={{ margin: 0 }}>{active.name}</h3>
              <p className="muted small" style={{ margin: 0 }}>{active.queue.length} questions queued · {active.questionProgressionMode.toLowerCase()} progression</p>
            </div>
            <Link className="btn btn--gold" to={`/host/competitions/${active.id}`}>Open live control</Link>
          </div>
        ) : (
          <EmptyState title="No competition is live" action={<Link className="btn btn--primary" to="/host/competitions">Create a competition</Link>}>
            Create a competition, add questions to its queue, and open registration.
          </EmptyState>
        )}
      </Panel>
      <div className="grid grid--3">
        <Panel title="Question bank" compact>
          <p className="muted small">Write, edit and preview MCQs.</p>
          <Link className="btn btn--small" to="/host/questions">Manage questions</Link>
        </Panel>
        <Panel title="Bulk import" compact>
          <p className="muted small">Upload the Excel or CSV template with validation preview.</p>
          <Link className="btn btn--small" to="/host/questions/import">Import questions</Link>
        </Panel>
        <Panel title="Results" compact>
          <p className="muted small">Rankings, analytics and Excel exports for finished competitions.</p>
          <Link className="btn btn--small" to="/host/competitions?status=COMPLETED">View results</Link>
        </Panel>
      </div>
    </div>
  );
}
