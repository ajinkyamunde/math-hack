# `competitions` collection

Model: `backend/src/models/Competition.ts`

| Field | Type | Notes |
|---|---|---|
| `name`, `description` | string | |
| `createdBy` | ObjectId → hosts | |
| `durationSeconds` | int 60–21600 | default 1800 (30 min) |
| `status` | `DRAFT WAITING RUNNING PAUSED COMPLETED CANCELLED` | transitions validated in `competitionLifecycle.ts` |
| `questionProgressionMode` | `AUTOMATIC`/`MANUAL` | automatic publishes the next queued question when one expires |
| `settings` | object | `revealAnswers`, `showLeaderboardToStudents`, `completeWhenQueueEmpty`, `pointsOverride.{EASY,MEDIUM,HARD}` |
| `queue[]` | embedded | see below; order is the explicit `order` field, never natural order |
| `startedAt`, `endsAt` | date | `endsAt` is the authoritative overall deadline |
| `pausedAt`, `totalPausedMilliseconds` | | |
| `completedAt`, `completionReason` | | `TIMER HOST QUEUE_EMPTY CANCELLED` |
| `currentQuestionId`, `currentQuestionStartedAt`, `currentQuestionDeadline` | | the live question; deadline is already capped at `endsAt` |
| `currentQuestionPausedMs` | int | pause time during the live question, subtracted from response times |
| `pausedQuestionRemainingMs` | int | frozen question time shown while paused |
| `stateVersion` | int | optimistic-concurrency counter; every transition matches and increments it |

### Queue item

`questionId`, `order`, `status` (`PENDING LIVE CLOSED SKIPPED`), `snapshot` (questionText, options, correctOption, difficulty, timeLimitSeconds, points, topic, explanation), `publishedAt`, `deadline`, `closedAt`, `closeReason` (`TIMER SKIPPED HOST_NEXT COMPETITION_ENDED`).

### Timing model

All timing is stored as absolute timestamps. Remaining time is always `deadline − now`, so page refreshes, reconnects and backend restarts never reset a clock.

* Start: `endsAt = startedAt + durationSeconds`.
* Publish: `deadline = min(now + timeLimitSeconds, endsAt)`.
* Pause: record `pausedAt` (and the question's remaining time). Answers are rejected while paused.
* Resume: `pausedMs = now − pausedAt`; `endsAt`, the live question deadline and its queue-item deadline all move forward by `pausedMs`.
* An answer counts only if the server **receives** it strictly before the effective deadline.

Indexes: `{ status, createdAt: -1 }`, `{ createdBy, createdAt: -1 }`, `{ status, endsAt }` (timer sweeps).
