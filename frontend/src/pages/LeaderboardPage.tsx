import { Link, Navigate, useParams } from 'react-router-dom';
import { ErrorAlert } from '../components/common/Alert';
import { Loading } from '../components/common/Loading';
import { StatCard } from '../components/common/StatCard';
import { PageHeader } from '../components/layout/PageHeader';
import { useAsync } from '../hooks/useAsync';
import { competitionService } from '../services/competitionService';
import { resultService } from '../services/resultService';

export function LeaderboardPage() {
  const { id } = useParams();
  const competition = useAsync(() => competitionService.studentState(id!), [id]);
  const completed = competition.data?.status === 'COMPLETED';
  const result = useAsync(() => (completed ? resultService.myResult(id!) : Promise.resolve(null)), [id, completed]);

  if (competition.loading && !competition.data) return <Loading />;
  if (competition.error) return <ErrorAlert error={competition.error} />;

  // If competition is not finished, return to the live arena
  if (!completed) {
    return <Navigate to={`/student/competitions/${id}`} replace />;
  }

  const me = result.data?.me;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Final results"
        title={competition.data?.name ?? 'Results'}
        actions={<Link className="btn btn--gold" to="/student">Back to dashboard</Link>}
      />
      {result.loading && !result.data ? (
        <Loading label="Loading results…" />
      ) : result.error ? (
        <ErrorAlert error={result.error} />
      ) : me ? (
        <div className="grid grid--stats">
          <StatCard label="Total questions attempted" value={me.attempted} />
          <StatCard label="Number of correct answers" value={me.correct} />
          <StatCard label="Number of incorrect answers" value={me.incorrect} />
          <StatCard label="Number of unanswered questions" value={me.unanswered} />
        </div>
      ) : null}
    </div>
  );
}
