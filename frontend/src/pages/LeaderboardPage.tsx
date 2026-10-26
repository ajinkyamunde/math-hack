import { Link, useParams } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { Loading } from '../components/common/Loading';
import { Panel } from '../components/common/Panel';
import { StatCard } from '../components/common/StatCard';
import { LeaderboardTable } from '../components/leaderboard/LeaderboardTable';
import { PageHeader } from '../components/layout/PageHeader';
import { useAuth } from '../features/authentication/useAuth';
import { useLeaderboard } from '../features/leaderboard/useLeaderboard';
import { useAsync } from '../hooks/useAsync';
import { competitionService } from '../services/competitionService';
import { resultService } from '../services/resultService';
import { DIFFICULTIES } from '../types';
import { formatPercent, formatSeconds, titleCase } from '../utils/format';
import { useState } from 'react';

export function LeaderboardPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const competition = useAsync(() => competitionService.studentState(id!), [id]);
  const board = useLeaderboard(id);
  const completed = competition.data?.status === 'COMPLETED';
  const result = useAsync(() => (completed ? resultService.myResult(id!) : Promise.resolve(null)), [id, completed]);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (competition.loading && !competition.data) return <Loading />;
  if (competition.error) return <ErrorAlert error={competition.error} />;
  const me = result.data?.me;

  return (
    <div className="stack">
      <PageHeader
        eyebrow={completed ? 'Final results' : 'Standings'}
        title={competition.data?.name ?? 'Leaderboard'}
        actions={
          <>
            {!completed && <Link className="btn" to={`/student/competitions/${id}`}>Back to arena</Link>}
            {completed && me && (
              <button type="button" className="btn" onClick={() => resultService.myReport(id!).catch((e: Error) => setDownloadError(e.message))}>
                Download my report
              </button>
            )}
          </>
        }
      />
      {downloadError && <ErrorAlert error={{ message: downloadError }} />}
      {me && (
        <>
          <div className="grid grid--stats">
            <StatCard label="Final rank" value={`#${me.rank}`} hint={`of ${result.data?.summary.participants}`} />
            <StatCard label="Score" value={me.totalPoints} />
            <StatCard label="Correct" value={`${me.correct}/${me.attempted}`} hint={`${me.unanswered} unanswered`} />
            <StatCard label="Accuracy" value={formatPercent(me.accuracy)} />
            <StatCard label="Avg correct time" value={formatSeconds(me.avgCorrectResponseMs)} />
          </div>
          <Panel title="By difficulty">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Difficulty</th><th className="num">Attempted</th><th className="num">Correct</th><th className="num">Avg time</th><th className="num">Avg correct time</th></tr></thead>
                <tbody>
                  {DIFFICULTIES.map((d) => (
                    <tr key={d}>
                      <td>{titleCase(d)}</td>
                      <td className="num">{me.byDifficulty[d].attempted}</td>
                      <td className="num">{me.byDifficulty[d].correct}</td>
                      <td className="num">{formatSeconds(me.byDifficulty[d].avgResponseMs)}</td>
                      <td className="num">{formatSeconds(me.byDifficulty[d].avgCorrectResponseMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      <Panel title="Top performers">
        {board.loading && !board.data ? <Loading /> : board.error ? <ErrorAlert error={board.error} /> : <LeaderboardTable entries={board.data?.entries ?? []} highlightId={user?._id} />}
        {board.data?.me && !board.data.entries.some((e) => e.studentId === user?._id) && (
          <p className="muted small" style={{ marginTop: 12 }}>Your position: #{board.data.me.rank} with {board.data.me.totalPoints} points.</p>
        )}
      </Panel>
    </div>
  );
}
