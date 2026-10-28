import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, ErrorAlert } from '../components/common/Alert';
import { DifficultyBadge, StatusBadge } from '../components/common/Badges';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { Loading } from '../components/common/Loading';
import { Panel } from '../components/common/Panel';
import { StatCard } from '../components/common/StatCard';
import { LeaderboardTable } from '../components/leaderboard/LeaderboardTable';
import { PageHeader } from '../components/layout/PageHeader';
import { CountdownRing } from '../components/timers/CountdownRing';
import { QueueEditor, type QueueQuestion } from '../features/competition/QueueEditor';
import { useHostCompetition } from '../features/competition/useHostCompetition';
import { useNow } from '../hooks/useNow';
import { resultService } from '../services/resultService';
import type { HostCompetitionState } from '../types';
import { formatClock, formatDuration } from '../utils/format';
import { remainingUntil } from '../utils/serverClock';

const toQueueQuestions = (state: HostCompetitionState, bankFallback: Map<string, QueueQuestion>): QueueQuestion[] =>
  state.queue.map((item) => {
    const fallback = bankFallback.get(item.questionId);
    return {
      id: item.questionId,
      questionText: item.snapshot?.questionText ?? fallback?.questionText ?? 'Question',
      difficulty: item.snapshot?.difficulty ?? fallback?.difficulty ?? 'EASY',
      timeLimitSeconds: item.snapshot?.timeLimitSeconds ?? fallback?.timeLimitSeconds ?? 0,
      points: item.snapshot?.points ?? fallback?.points ?? 0,
      locked: item.status !== 'PENDING',
      status: item.status,
    };
  });

export function CompetitionControlPage() {
  const { id } = useParams();
  const live = useHostCompetition(id);
  const { state } = live;
  const now = useNow(250, state?.status === 'RUNNING');
  const [confirm, setConfirm] = useState<'end' | 'cancel' | null>(null);
  const [editingQueue, setEditingQueue] = useState(false);
  const [draftQueue, setDraftQueue] = useState<QueueQuestion[]>([]);
  const [queueTexts, setQueueTexts] = useState(new Map<string, QueueQuestion>());

  // Before start, queue items have no snapshot; fetch their text once so the queue is readable.
  useEffect(() => {
    if (!state || state.queue.every((q) => q.snapshot) || queueTexts.size) return;
    import('../services/questionService').then(async ({ questionService }) => {
      const missing = state.queue.filter((q) => !q.snapshot).map((q) => q.questionId);
      const fetched = await Promise.all(missing.map((qid) => questionService.get(qid).catch(() => null)));
      setQueueTexts(new Map(fetched.filter(Boolean).map((q) => [q!._id, { id: q!._id, questionText: q!.questionText, difficulty: q!.difficulty, timeLimitSeconds: q!.timeLimitSeconds, points: q!.points }])));
    });
  }, [state, queueTexts.size]);

  // Initial standings for the leaderboard panel (live updates arrive over the socket).
  const { setLeaderboard } = live;
  useEffect(() => {
    if (!id) return;
    resultService.leaderboard(id).then((r) => setLeaderboard(r.entries)).catch(() => undefined);
  }, [id, setLeaderboard]);

  const queueQuestions = useMemo(() => (state ? toQueueQuestions(state, queueTexts) : []), [state, queueTexts]);

  if (!state) return live.error ? <ErrorAlert error={live.error} /> : <Loading label="Linking to competition…" />;

  const paused = state.status === 'PAUSED';
  const running = state.status === 'RUNNING';
  const active = running || paused;
  const finished = state.status === 'COMPLETED' || state.status === 'CANCELLED';
  const question = state.currentQuestion;
  const competitionLeft = paused ? state.remainingMs : state.endsAt ? remainingUntil(state.endsAt, undefined, now) : state.durationSeconds * 1000;
  const questionLeft = question ? (paused ? question.remainingMs : remainingUntil(question.deadline, undefined, now)) : null;
  const pending = state.queue.filter((q) => q.status === 'PENDING');
  const answered = live.answerCount && question && live.answerCount.questionId === question.id ? live.answerCount.answered : null;
  const canEditQueue = !finished;
  const busy = live.busy !== null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Live control"
        title={state.name}
        description={`${formatDuration(state.durationSeconds)} · ${state.questionProgressionMode === 'AUTOMATIC' ? 'Automatic' : 'Manual'} progression · socket ${live.connection}`}
        actions={
          <>
            <StatusBadge status={state.status} />
            {state.status !== 'DRAFT' && <Link className="btn" to={`/host/competitions/${state.id}/participants`}>Participants</Link>}
            {finished && <Link className="btn btn--gold" to={`/host/competitions/${state.id}/results`}>View results</Link>}
          </>
        }
      />
      <ErrorAlert error={live.actionError} title="Action rejected" />

      <Panel holo title="Controls">
        <div className="control-deck">
          {state.status === 'DRAFT' && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void live.run('open')}>Open registration</button>}
          {state.status === 'WAITING' && <button type="button" className="btn btn--gold" disabled={busy || !state.queue.length} onClick={() => void live.run('start')}>Start competition</button>}
          {running && <button type="button" className="btn btn--primary" disabled={busy || !pending.length} onClick={() => void live.run('publish')}>{question ? 'Close & publish next' : 'Publish next question'}</button>}
          {running && <button type="button" className="btn" disabled={busy} onClick={() => void live.run('pause')}>Pause</button>}
          {paused && <button type="button" className="btn btn--gold" disabled={busy} onClick={() => void live.run('resume')}>Resume</button>}
          {running && question && <button type="button" className="btn" disabled={busy} onClick={() => void live.run('skip')}>Skip question</button>}
          {active && <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setConfirm('end')}>End competition</button>}
          {!finished && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirm('cancel')}>Cancel competition</button>}
        </div>
        {state.status === 'WAITING' && !state.queue.length && <p className="field__error" style={{ marginTop: 8 }}>Add questions to the queue before starting.</p>}
        {state.status === 'DRAFT' && <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>Students can join once registration is open.</p>}
      </Panel>

      <div className="grid grid--stats">
        <StatCard label="Competition time" value={formatClock(competitionLeft)} hint={paused ? 'Paused' : state.endsAt ? 'Remaining' : 'Duration'} />
        <StatCard label="Participants" value={live.participants ?? '—'} hint={live.connected !== null ? `${live.connected} connected now` : 'Live count updates as students connect'} />
        <StatCard label="Answers this question" value={question ? (answered ?? '—') : '—'} />
        <StatCard label="Questions left" value={pending.length} hint={`${state.queue.length} in queue`} />
      </div>

      {active && (
        <Panel title={question ? `Live question ${state.questionNumber ?? ''}` : 'No live question'}>
          {question ? (
            <div className="stack">
              <div className="row row--between">
                <div className="row"><DifficultyBadge difficulty={question.difficulty} /><span className="badge badge--neutral">{question.points} pts</span></div>
                <CountdownRing label="Question" remainingMs={questionLeft} totalMs={question.timeLimitSeconds * 1000} paused={paused} />
              </div>
              <p className="question-text" style={{ margin: 0 }}>{question.questionText}</p>
              <ol type="A" style={{ margin: 0 }}>
                {question.options.map((o, i) => (
                  <li key={i} style={{ color: 'ABCD'[i] === question.correctOption ? 'var(--color-success)' : undefined }}>
                    {o} {'ABCD'[i] === question.correctOption && <strong>(correct)</strong>}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{pending.length ? 'Publish the next question when ready.' : 'The queue is empty. Add questions or end the competition.'}</p>
          )}
        </Panel>
      )}

      {paused && <Alert tone="warning" title="Paused">All clocks are frozen. Students cannot submit until you resume.</Alert>}

      <Panel
        title="Question queue"
        actions={
          canEditQueue &&
          (editingQueue ? (
            <>
              <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={async () => { await live.saveQueue(draftQueue.map((q) => q.id)); setEditingQueue(false); }}>Save queue</button>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => setEditingQueue(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn btn--small" onClick={() => { setDraftQueue(queueQuestions); setEditingQueue(true); }}>Edit queue</button>
          ))
        }
      >
        {editingQueue ? (
          <QueueEditor value={draftQueue} onChange={setDraftQueue} />
        ) : !queueQuestions.length ? (
          <p className="muted" style={{ margin: 0 }}>No questions queued yet.</p>
        ) : (
          <ol className="queue-list">
            {queueQuestions.map((q, index) => (
              <li key={q.id} className={`queue-item ${q.status === 'LIVE' ? 'is-live' : ''} ${q.locked && q.status !== 'LIVE' ? 'is-done' : ''}`}>
                <span className="queue-item__index">{index + 1}</span>
                <span className="queue-item__text">{q.questionText}</span>
                <DifficultyBadge difficulty={q.difficulty} />
                <span className="badge badge--neutral">{q.status?.toLowerCase()}</span>
                {running && q.status === 'PENDING' && (
                  <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    <button type="button" className="btn btn--small" disabled={busy} onClick={() => void live.run('publish', q.id)} aria-label={`Publish question ${index + 1} now`}>Publish now</button>
                    <button type="button" className="btn btn--small btn--ghost" disabled={busy} onClick={() => void live.run('skip', q.id)} aria-label={`Skip question ${index + 1}`}>Skip</button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Leaderboard">
        <LeaderboardTable entries={live.leaderboard} detailed caption="Live leaderboard" />
      </Panel>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'end' ? 'End the competition now?' : 'Cancel this competition?'}
        message={confirm === 'end' ? 'Submissions stop immediately, the live question closes and final scores are calculated. This cannot be undone.' : 'The competition will be marked cancelled. This cannot be undone.'}
        confirmLabel={confirm === 'end' ? 'End competition' : 'Cancel competition'}
        busy={busy}
        onConfirm={async () => {
          await live.run(confirm!);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
