import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, ErrorAlert } from '../components/common/Alert';
import { DifficultyBadge, StatusBadge } from '../components/common/Badges';
import { Loading } from '../components/common/Loading';
import { Panel } from '../components/common/Panel';
import { LeaderboardTable } from '../components/leaderboard/LeaderboardTable';
import { AnswerOptions } from '../components/questions/AnswerOptions';
import { CompetitionClock } from '../components/timers/CompetitionClock';
import { CountdownRing } from '../components/timers/CountdownRing';
import { useAuth } from '../features/authentication/useAuth';
import { useStudentCompetition } from '../features/competition/useStudentCompetition';
import { useNow } from '../hooks/useNow';
import type { OptionKey } from '../types';
import { remainingUntil } from '../utils/serverClock';

function ConnectionIndicator({ state }: { state: 'connecting' | 'online' | 'offline' }) {
  const label = state === 'online' ? 'Live' : state === 'connecting' ? 'Connecting…' : 'Reconnecting… (updating every few seconds)';
  return (
    <span className={`connection connection--${state === 'online' ? 'online' : 'offline'}`} role="status">
      <span className="dot" aria-hidden="true" /> {label}
    </span>
  );
}

export function CompetitionPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const live = useStudentCompetition(id);
  const { state } = live;
  const [selected, setSelected] = useState<OptionKey | null>(null);
  const paused = state?.status === 'PAUSED';
  const now = useNow(250, state?.status === 'RUNNING');
  const question = state?.currentQuestion ?? null;
  const submission = question && state?.mySubmission?.questionId === question.id ? state.mySubmission : null;

  // A new question clears the previous selection.
  useEffect(() => setSelected(null), [question?.id]);

  if (live.loading) return <Loading label="Entering the arena…" />;
  if (!state) return <ErrorAlert error={live.error} title="Competition unavailable" />;

  const competitionLeft = paused ? state.remainingMs : remainingUntil(state.endsAt, undefined, now);
  const questionLeft = question ? (paused ? question.remainingMs : remainingUntil(question.deadline, undefined, now)) : null;
  const timeUp = questionLeft !== null && questionLeft <= 0;
  const locked = Boolean(submission) || paused || timeUp || live.submitting;

  if (!state.joined) {
    return (
      <Panel holo title={state.name}>
        <p className="muted">You have not joined this competition yet.</p>
        <ErrorAlert error={live.error} />
        {['WAITING', 'RUNNING', 'PAUSED'].includes(state.status) ? (
          <button type="button" className="btn btn--gold" onClick={() => void live.join()}>Join competition</button>
        ) : (
          <Link className="btn" to="/student">Back to dashboard</Link>
        )}
      </Panel>
    );
  }

  return (
    <div className="stack">
      <div className="live-header">
        <div>
          <div className="eyebrow">Live arena</div>
          <h1 style={{ margin: 0 }}>{state.name}</h1>
        </div>
        <div className="row">
          <StatusBadge status={state.status} />
          <ConnectionIndicator state={live.connection} />
        </div>
      </div>

      {state.status !== 'WAITING' && (
        <div className="panel panel--compact row row--between">
          <CompetitionClock remainingMs={competitionLeft} paused={paused} />
          {question && <CountdownRing label="Question" remainingMs={questionLeft} totalMs={question.timeLimitSeconds * 1000} paused={paused} />}
        </div>
      )}

      {state.status === 'WAITING' && (
        <Panel holo>
          <h2>Assemble and stand by</h2>
          <p className="muted" style={{ margin: 0 }}>You are in. The first question will appear here automatically when the host starts the competition. Keep this screen open.</p>
        </Panel>
      )}

      {paused && <Alert tone="warning" title="Competition paused">The clock is frozen. Answers open again when the host resumes.</Alert>}

      {question ? (
        <form
          className="panel panel--holo question-card mh-animate-in"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected && !locked) void live.submit(question.id, selected);
          }}
          aria-labelledby="question-heading"
        >
          <div className="row row--between">
            <h2 id="question-heading" style={{ margin: 0 }}>Question {state.questionNumber ?? ''}{state.totalQuestions ? ` of ${state.totalQuestions}` : ''}</h2>
            <div className="row">
              <DifficultyBadge difficulty={question.difficulty} />
              <span className="badge badge--neutral">{question.points} pts</span>
            </div>
          </div>
          <p className="question-text">{question.questionText}</p>
          <AnswerOptions name={`q-${question.id}`} options={question.options} selected={submission?.selectedOption ?? selected} onSelect={setSelected} locked={locked} />
          {live.submitError && <Alert tone="error">{live.submitError}</Alert>}
          <div className="submit-bar">
            {submission ? (
              <Alert tone="success" title="Answer received">Your answer ({submission.selectedOption}) is locked in. Results are revealed when the question closes.</Alert>
            ) : timeUp ? (
              <Alert tone="warning" title="Time is up">Waiting for the next question…</Alert>
            ) : (
              <button type="submit" className="btn btn--gold btn--block" disabled={!selected || locked}>
                {live.submitting ? 'Submitting…' : selected ? `Submit answer ${selected}` : 'Select an answer'}
              </button>
            )}
          </div>
        </form>
      ) : (
        ['RUNNING', 'PAUSED'].includes(state.status) && (
          <Panel>
            {live.lastClosed ? (
              <div className="stack">
                <h2 style={{ margin: 0 }}>Question closed</h2>
                {live.lastClosed.correctOption ? (
                  <p style={{ margin: 0 }}>Correct answer: <strong style={{ color: 'var(--color-success)' }}>{live.lastClosed.correctOption}</strong></p>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>Answers are not revealed during this competition.</p>
                )}
                {live.lastClosed.explanation && <p className="muted" style={{ margin: 0 }}>{live.lastClosed.explanation}</p>}
                <p className="muted small" style={{ margin: 0 }}>Stand by for the next question.</p>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Waiting for the host to publish the next question…</p>
            )}
          </Panel>
        )
      )}

      {(state.status === 'COMPLETED' || state.status === 'CANCELLED') && (
        <Panel holo title={state.status === 'COMPLETED' ? 'Competition complete' : 'Competition cancelled'}>
          {state.status === 'COMPLETED' ? (
            <Link className="btn btn--gold" to={`/student/competitions/${state.id}/leaderboard`}>See final results</Link>
          ) : (
            <Link className="btn" to="/student">Back to dashboard</Link>
          )}
        </Panel>
      )}

      {state.settings.showLeaderboardToStudents && live.leaderboard.length > 0 && (
        <Panel title="Leaderboard">
          <LeaderboardTable entries={live.leaderboard} highlightId={user?._id} caption="Live top 10" />
        </Panel>
      )}
    </div>
  );
}
