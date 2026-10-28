import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { StatusBadge } from '../components/common/Badges';
import { EmptyState } from '../components/common/EmptyState';
import { Loading } from '../components/common/Loading';
import { Pagination } from '../components/common/Pagination';
import { Panel } from '../components/common/Panel';
import { PageHeader } from '../components/layout/PageHeader';
import { useAuth } from '../features/authentication/useAuth';
import { useAsync } from '../hooks/useAsync';
import { competitionService } from '../services/competitionService';
import { resultService } from '../services/resultService';
import { toApiError } from '../services/apiClient';
import type { CompetitionSummary, StudentUser } from '../types';
import { formatDateTime, formatDuration } from '../utils/format';

function CompetitionRow({ competition, onJoined }: { competition: CompetitionSummary; onJoined: () => void }) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = ['WAITING', 'RUNNING', 'PAUSED'].includes(competition.status);
  return (
    <article className="panel panel--compact stack" style={{ gap: 8 }}>
      <div className="row row--between">
        <h3 style={{ margin: 0 }}>{competition.name}</h3>
        <StatusBadge status={competition.status} />
      </div>
      {competition.description && <p className="muted small" style={{ margin: 0 }}>{competition.description}</p>}
      <p className="muted small" style={{ margin: 0 }}>{competition.questionCount} questions · {formatDuration(competition.durationSeconds)}</p>
      {error && <p className="field__error">{error}</p>}
      <div className="row">
        {competition.joined && live && <Link className="btn btn--gold" to={`/student/competitions/${competition.id}`}>Enter arena</Link>}
        {!competition.joined && live && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={joining}
            onClick={async () => {
              setJoining(true);
              setError(null);
              try {
                await competitionService.join(competition.id);
                onJoined();
              } catch (err) {
                setError(toApiError(err).message);
              } finally {
                setJoining(false);
              }
            }}
          >
            {joining ? 'Joining…' : 'Join competition'}
          </button>
        )}
        {competition.status === 'COMPLETED' && competition.joined && <Link className="btn" to={`/student/competitions/${competition.id}/leaderboard`}>View results</Link>}
      </div>
    </article>
  );
}

export function StudentDashboardPage() {
  const { user } = useAuth();
  const student = user as StudentUser;
  const [historyPage, setHistoryPage] = useState(1);
  const competitions = useAsync(() => competitionService.list({ pageSize: 30 }), []);
  const history = useAsync(() => resultService.history(historyPage), [historyPage]);
  const available = competitions.data?.items.filter((c) => c.status !== 'CANCELLED' && (c.status !== 'COMPLETED' || c.joined)) ?? [];

  return (
    <div className="stack">
      <PageHeader eyebrow="Student dashboard" title={`Welcome, ${student.name.split(' ')[0]}`} description="Join a competition, then keep this page open on your phone while the host runs it." />
      <div className="grid grid--2">
        <Panel title="Competitions" actions={<button type="button" className="btn btn--small" onClick={() => void competitions.reload()}>Refresh</button>}>
          {competitions.loading && !competitions.data ? (
            <Loading />
          ) : competitions.error ? (
            <ErrorAlert error={competitions.error} />
          ) : available.length === 0 ? (
            <EmptyState title="No competitions open yet">When the host opens registration, it will appear here.</EmptyState>
          ) : (
            <div className="stack">
              {available.map((c) => (
                <CompetitionRow key={c.id} competition={c} onJoined={() => void competitions.reload()} />
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Profile">
          <dl className="stack" style={{ margin: 0, gap: 8 }}>
            {[
              ['Name', student.name],
              ['PRN', student.prn],
              ['Email', student.email],
              ['Department', student.department],
              ['Academic year', student.academicYear],
            ].map(([label, value]) => (
              <div key={label} className="row row--between">
                <dt className="muted small">{label}</dt>
                <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
      <Panel title="My previous results">
        {history.loading && !history.data ? (
          <Loading />
        ) : history.error ? (
          <ErrorAlert error={history.error} />
        ) : !history.data?.items.length ? (
          <EmptyState title="No results yet">Your competition history will appear here.</EmptyState>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Competition</th><th>Status</th><th>Joined</th><th className="num">Score</th><th className="num">Rank</th><th /></tr>
                </thead>
                <tbody>
                  {history.data.items.map((item) => (
                    <tr key={item.competitionId}>
                      <td>{item.name}</td>
                      <td><StatusBadge status={item.status as CompetitionSummary['status']} /></td>
                      <td>{formatDateTime(item.joinedAt)}</td>
                      <td className="num">{item.finalScore ?? '—'}</td>
                      <td className="num">{item.finalRank ? `#${item.finalRank}` : '—'}</td>
                      <td>{item.status === 'COMPLETED' && <Link to={`/student/competitions/${item.competitionId}/leaderboard`}>Details</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={historyPage} pageSize={history.data.pageSize} total={history.data.total} onChange={setHistoryPage} />
          </>
        )}
      </Panel>
    </div>
  );
}
