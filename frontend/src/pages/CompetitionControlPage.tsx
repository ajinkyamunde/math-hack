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
import { BulkQuestionEditor } from '../features/competition/BulkQuestionEditor';
import { useHostCompetition } from '../features/competition/useHostCompetition';
import { useNow } from '../hooks/useNow';
import { resultService } from '../services/resultService';
import type { DirectQuestionInput, HostCompetitionState, OptionKey } from '../types';
import { formatClock, formatDuration } from '../utils/format';
import { remainingUntil } from '../utils/serverClock';

interface QuestionDetails {
  id: string;
  questionText: string;
  options: string[];
  correctOption: OptionKey;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  timeLimitSeconds: number;
  points: number;
}

const toDirectQuestions = (state: HostCompetitionState, bankFallback: Map<string, QuestionDetails>): DirectQuestionInput[] =>
  state.queue.map((item) => {
    const fallback = bankFallback.get(item.questionId);
    return {
      id: item.questionId,
      questionText: item.snapshot?.questionText ?? fallback?.questionText ?? 'Question',
      options: item.snapshot?.options ?? fallback?.options ?? ['', '', '', ''],
      correctOption: (item.snapshot?.correctOption ?? fallback?.correctOption ?? 'A') as OptionKey,
      difficulty: item.snapshot?.difficulty ?? fallback?.difficulty ?? 'EASY',
      points: item.snapshot?.points ?? fallback?.points ?? 10,
    };
  });

export function CompetitionControlPage() {
  const { id } = useParams();
  const live = useHostCompetition(id);
  const { state } = live;
  const now = useNow(250, state?.status === 'RUNNING');
  const [confirm, setConfirm] = useState<'end' | 'cancel' | null>(null);
  const [editingQuestions, setEditingQuestions] = useState(false);
  const [draftQuestions, setDraftQuestions] = useState<DirectQuestionInput[]>([]);
  const [questionDetails, setQuestionDetails] = useState(new Map<string, QuestionDetails>());

  // Before start, queue items have no snapshot; fetch their details once so questions are readable and editable.
  useEffect(() => {
    if (!state || state.queue.every((q) => q.snapshot) || questionDetails.size) return;
    import('../services/questionService').then(async ({ questionService }) => {
      const missing = state.queue.filter((q) => !q.snapshot).map((q) => q.questionId);
      const fetched = await Promise.all(missing.map((qid) => questionService.get(qid).catch(() => null)));
      setQuestionDetails(
        new Map(
          fetched.filter(Boolean).map((q) => [
            q!._id,
            {
              id: q!._id,
              questionText: q!.questionText,
              options: q!.options,
              correctOption: q!.correctOption,
              difficulty: q!.difficulty,
              timeLimitSeconds: q!.timeLimitSeconds,
              points: q!.points,
            },
          ]),
        ),
      );
    });
  }, [state, questionDetails.size]);

  // Initial standings for the leaderboard panel (live updates arrive over the socket).
  const { setLeaderboard } = live;
  useEffect(() => {
    if (!id) return;
    resultService.leaderboard(id).then((r) => setLeaderboard(r.entries)).catch(() => undefined);
  }, [id, setLeaderboard]);

  const directQuestions = useMemo(() => (state ? toDirectQuestions(state, questionDetails) : []), [state, questionDetails]);

  if (!state) return live.error ? <ErrorAlert error={live.error} /> : <Loading label="Linking to competition…" />;

  const paused = state.status === 'PAUSED';
  const running = state.status === 'RUNNING';
  const active = running || paused;
  const finished = state.status === 'COMPLETED' || state.status === 'CANCELLED';
  const competitionLeft = paused ? state.remainingMs : state.endsAt ? remainingUntil(state.endsAt, undefined, now) : state.durationSeconds * 1000;
  const canEditQuestions = !finished && (state.status === 'DRAFT' || state.status === 'WAITING');
  const busy = live.busy !== null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Live control"
        title={state.name}
        description={`${formatDuration(state.durationSeconds)} · Self-paced · socket ${live.connection}`}
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
          {running && <button type="button" className="btn" disabled={busy} onClick={() => void live.run('pause')}>Pause</button>}
          {paused && <button type="button" className="btn btn--gold" disabled={busy} onClick={() => void live.run('resume')}>Resume</button>}
          {active && <button type="button" className="btn btn--danger" disabled={busy} onClick={() => setConfirm('end')}>End competition</button>}
          {!finished && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setConfirm('cancel')}>Cancel competition</button>}
        </div>
        {state.status === 'WAITING' && !state.queue.length && <p className="field__error" style={{ marginTop: 8 }}>Add questions before starting.</p>}
        {state.status === 'DRAFT' && <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>Students can join once registration is open.</p>}
      </Panel>

      <div className="grid grid--stats">
        <StatCard label="Competition time" value={formatClock(competitionLeft)} hint={paused ? 'Paused' : state.endsAt ? 'Remaining' : 'Duration'} />
        <StatCard label="Participants" value={live.participants ?? '—'} hint={live.connected !== null ? `${live.connected} connected now` : 'Live count updates as students connect'} />
        <StatCard label="Total questions" value={directQuestions.length} hint="Available to participants" />
        <StatCard label="Status" value={state.status} />
      </div>

      {active && (
        <Panel title="Competition in progress">
          <p className="muted" style={{ margin: 0 }}>
            Participants are answering questions at their own pace within the competition's overall duration. Submissions are locked immediately upon answer.
          </p>
        </Panel>
      )}

      {paused && <Alert tone="warning" title="Paused">All clocks are frozen. Students cannot submit until you resume.</Alert>}

      <Panel
        title={`Questions (${directQuestions.length})`}
        actions={
          canEditQuestions &&
          (editingQuestions ? (
            <>
              <button
                type="button"
                className="btn btn--small btn--primary"
                disabled={busy}
                onClick={async () => {
                  await live.saveDirectQuestions(draftQuestions);
                  setEditingQuestions(false);
                }}
              >
                Save questions
              </button>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => setEditingQuestions(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                setDraftQuestions(directQuestions);
                setEditingQuestions(true);
              }}
            >
              Add / Edit questions
            </button>
          ))
        }
      >
        {editingQuestions ? (
          <BulkQuestionEditor questions={draftQuestions} onChange={setDraftQuestions} maxQuestions={50} />
        ) : !directQuestions.length ? (
          <p className="muted" style={{ margin: 0 }}>No questions in competition yet.</p>
        ) : (
          <ol className="queue-list">
            {directQuestions.map((q, index) => (
              <li key={q.id ?? index} className="queue-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row row--between" style={{ alignItems: 'flex-start' }}>
                  <div className="row" style={{ alignItems: 'center', gap: 8, flex: 1 }}>
                    <span className="queue-item__index">{index + 1}</span>
                    <DifficultyBadge difficulty={q.difficulty} />
                    <span className="queue-item__text" style={{ fontWeight: 600 }}>{q.questionText}</span>
                  </div>
                </div>
                <div className="grid grid--2" style={{ gap: 4, paddingLeft: 28, fontSize: '0.85rem' }}>
                  {q.options.map((opt, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '2px 6px',
                        color: 'ABCD'[i] === q.correctOption ? 'var(--color-gold, #ffd700)' : 'var(--color-muted, #aaa)',
                        fontWeight: 'ABCD'[i] === q.correctOption ? 600 : 'normal',
                      }}
                    >
                      <strong>{'ABCD'[i]}:</strong> {opt} {'ABCD'[i] === q.correctOption && '(Correct)'}
                    </div>
                  ))}
                </div>
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
