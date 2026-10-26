# Architecture

```
 Phones / laptops (React + Vite)                Host browser (React)
        │  HTTPS (REST, cookie session)                │
        │  WebSocket (Socket.IO, same cookie)          │
        ▼                                              ▼
 ┌─────────────────────────── Express + Socket.IO (Node 22, TypeScript) ───────────────────────────┐
 │ routes → middleware (helmet, CORS, rate limit, CSRF, auth, Zod) → controllers → services        │
 │ services: auth · questions · import · competition engine · timers · scoring · leaderboard ·     │
 │           analytics · export                       sockets: auth · rooms · events · broadcaster │
 └───────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                 ▼
                                   MongoDB (Atlas / replica set)
```

## Responsibility boundaries

* **Frontend** (`frontend/src`): presentation, forms with usability validation, API calls, live UI. It never decides correctness, points, or deadlines, and stores nothing authoritative (no tokens or roles in localStorage; the CSRF token lives in memory).
* **Backend** (`backend/src`): authentication, authorization, validation, competition lifecycle, timer enforcement, scoring, imports, analytics, exports.
* **Database**: students, hosts, questions, competitions (with queue snapshots), participants, attempts, import previews, audit log, optional roster.

Controllers are thin; business rules live in services. Services publish real-time events through `sockets/broadcaster.ts`, so they can run (and be tested) without a socket server.

## Competition engine (`services/competitionService.ts`)

Every host command and every timer expiry goes through one function, `mutate(id, planner)`:

1. Read the competition.
2. A pure *planner* decides the change (close live question, publish next, complete, …) or throws a validation error.
3. The change is written with `findOneAndUpdate({ _id, stateVersion })` and `$inc: { stateVersion: 1 }`.
4. If another actor changed the competition first, the write matches nothing and the planner runs again on fresh state.
5. After a successful write, side effects run: timeout rows, broadcasts, leaderboard, final results, alarm rescheduling.

This makes host double-clicks, host-vs-timer races, and multiple backend instances safe: exactly one transition wins.

## Timers (`services/timerService.ts`)

Deadlines are absolute timestamps in MongoDB (`endsAt`, `currentQuestionDeadline`). The timer service only sets *alarms*: one `setTimeout` per running competition for its next deadline, plus a 2-second watchdog that sweeps for any running competition whose deadline has passed. On startup it processes overdue deadlines and re-arms alarms, so a restart never loses or extends time. No `setInterval` counter is ever the clock.

Rules: the overall deadline caps every question (`deadline = min(now + limit, endsAt)`); when `endsAt` passes, the live question closes with reason `COMPETITION_ENDED`, scores are finalized, and status becomes `COMPLETED`.

## Progression

* **Automatic**: when a question expires (or is skipped) the next `PENDING` item by `order` is published immediately, unless less than one second of competition time remains.
* **Manual**: the host publishes each question. "Publish now" on any pending item closes the live question first.
* With `completeWhenQueueEmpty`, an exhausted queue completes the competition; otherwise it waits for the host.
* **Skip** closes the live question early (answers already received still count) or removes a pending item from play.

## Scoring and ranking

Points come from the frozen snapshot (question points, or the competition's per-difficulty override). No speed bonus. Response time = server receive time − publish time − pause time during the question.

Ranking (`services/rankingPolicy.ts`):
1. total points, 2. correct answers, 3. accuracy (`correct / answered`; nobody-answered ranks lowest), 4. average response time on correct answers (faster first).
Entries tied on all four share a rank (1, 2, 2, 4) and are listed by PRN. A sudden-death decider is run by the host publishing an extra question; it is not automatic.

## Real-time events

Rooms: `competition:<id>` (students verified as participants), `competition:<id>:hosts`, `student:<id>` (that student's devices only).

| Direction | Event | Notes |
|---|---|---|
| C→S | `competition:join` | ack returns the authoritative state (current question, remaining time, own submission) |
| C→S | `question:submit` | student only; same service as the HTTP fallback |
| C→S | `host:publish-question`, `host:pause`, `host:resume`, `host:skip`, `host:end` | host role checked server-side |
| S→C | `competition:state`, `competition:started/paused/resumed/completed` | |
| S→C | `question:published` | never contains the answer or explanation |
| S→C | `question:closed` | answer + explanation only if `revealAnswers` |
| S→C | `answer:received` | only to the submitting student's room |
| S→C | `leaderboard:updated` | students get top 10 without PRNs; hosts get the full table (debounced to 1/s) |
| S→C | `question:answer-count`, `participant:connection`, `participant:joined` | hosts only |

Clients sync a clock offset from `serverNow` in each payload and render countdowns from deadlines. If the socket drops, the student page polls `GET /api/competitions/:id/state` every 5 s until it reconnects.

## Scaling out

A single instance comfortably serves a college event. For several instances set `REDIS_URL`: Socket.IO uses the Redis adapter so rooms and broadcasts span instances, and live connection counts use `fetchSockets()` across the cluster. Timer processing is already multi-instance safe (version-guarded transitions; every instance's watchdog may try, one wins). Put instances behind a load balancer with sticky sessions if you allow the HTTP long-polling transport.
