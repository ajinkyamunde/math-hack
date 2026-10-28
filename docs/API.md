# REST API

Base path `/api`. JSON in and out. Errors always look like:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Please correct the highlighted fields.", "details": [{ "field": "prn", "message": "…" }] } }
```

Codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN`/`CSRF_FAILED` 403, `NOT_FOUND` 404, `CONFLICT`/`INVALID_STATE`/`DEADLINE_PASSED` 409, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429, `SERVICE_UNAVAILABLE` 503, `INTERNAL_ERROR` 500 (no internals leaked).

## Authentication model

* Session: HTTP-only cookie `mh_session` (HS256 JWT, default 12 h, `SameSite` configurable, `Secure` in production).
* CSRF: every POST/PUT/PATCH/DELETE must come from `FRONTEND_URL` (Origin/Referer check) and, when a session cookie is present, carry `X-CSRF-Token` equal to the `csrfToken` returned by login, register and `/auth/me`.
* Roles: `student` or `host`, taken only from the signed session. Each request also re-checks that the account exists and is active.

Legend: 🌐 public · 🎓 student · 🛡 host · 🔑 any signed-in user.

## Auth

| Method | Path | Who | Body / notes |
|---|---|---|---|
| POST | `/auth/register` | 🌐 | `{ name, prn, email, department, academicYear (FE/SE/TE/BE/PG1/PG2), password, confirmPassword }` → 201 `{ user, csrfToken }` and session cookie. 409 with `details.field` on duplicate PRN/email. Password ≥10 chars with upper, lower, digit. |
| POST | `/auth/login` | 🌐 | `{ role: "student", identifier (PRN or email), password }` or `{ role: "host", email, password }` → `{ user, csrfToken }`. Wrong credentials: 401 "Invalid credentials." Rate limited per IP + identifier. |
| POST | `/auth/logout` | 🔑 | 204, clears the cookie |
| GET | `/auth/me` | 🔑 | `{ user, csrfToken, … }` |

There is **no** host registration endpoint; use `npm run create-host`.

## Questions (🛡 only)

| Method | Path | Notes |
|---|---|---|
| GET | `/questions?page&pageSize(≤100)&search&difficulty&status&topic&sort=newest|oldest|difficulty` | `{ items, total, page, pageSize }`, includes `correctOption` (host only) |
| GET | `/questions/topics` | distinct topics |
| POST | `/questions` | `{ questionText, options[4], correctOption, difficulty, timeLimitSeconds?, points?, topic?, explanation?, tags?, status? }` |
| GET | `/questions/:id` | |
| PUT | `/questions/:id` | full replacement, same body; 409 if queued in a live competition |
| DELETE | `/questions/:id` | 204; 409 if queued in a live or upcoming competition |
| POST | `/questions/:id/duplicate` | copy saved as DRAFT |
| GET | `/questions/template.xlsx`, `/questions/template.csv` | downloadable templates |
| POST | `/questions/import/preview` | multipart field `file` (.xlsx/.csv, ≤2 MB, ≤1000 rows) → `{ batchId, totalRows, validCount, invalidCount, duplicateCount, validRows, invalidRows[{rowNumber, errors[{field,message}]}], duplicateRows[{rowNumber, reason}] }`. Nothing is saved. |
| POST | `/questions/import/confirm` | `{ batchId, includeDuplicates?, status? }` → 201 `{ insertedCount, skippedInvalid, skippedDuplicates }`. A batch can be confirmed once (409 after). Previews expire after 1 h. |
| GET | `/questions/import/:batchId/errors.csv` | row-level error report |

## Competitions

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/competitions?page&pageSize&status` | 🔑 | students never see DRAFTs and get `joined`; hosts get `participantCount` |
| POST | `/competitions` | 🛡 | `{ name, description?, durationSeconds? (60–21600, default 1800), questionProgressionMode? AUTOMATIC/MANUAL, settings?, questionIds? }` (ACTIVE questions only) |
| GET | `/competitions/:id` | 🔑 | host: full control state incl. queue snapshots and answers; student: sanitized live state |
| GET | `/competitions/:id/state` | 🔑 | same as above; the HTTP fallback for sockets |
| PATCH | `/competitions/:id` | 🛡 | settings, before start only |
| PUT | `/competitions/:id/queue` | 🛡 | `{ questionIds[] }` explicit order. While running/paused only pending items are reordered/added/removed. |
| POST | `/competitions/:id/open` | 🛡 | DRAFT → WAITING |
| POST | `/competitions/:id/start` | 🛡 | WAITING → RUNNING; snapshots the queue; automatic mode publishes the first question |
| POST | `/competitions/:id/pause` / `resume` | 🛡 | RUNNING ⇄ PAUSED; remaining time preserved exactly |
| POST | `/competitions/:id/publish` | 🛡 | `{ questionId? }` publish chosen or next pending question (closes the live one first) |
| POST | `/competitions/:id/skip` | 🛡 | `{ questionId? }` close live question early, or remove a pending one |
| POST | `/competitions/:id/end` | 🛡 | → COMPLETED, finalizes scores |
| POST | `/competitions/:id/cancel` | 🛡 | → CANCELLED |
| POST | `/competitions/:id/join` | 🎓 | idempotent; WAITING/RUNNING/PAUSED only |
| POST | `/competitions/:id/answers` | 🎓 | `{ questionId, selectedOption }` → 201 `{ submission: { questionId, selectedOption, submittedAt, alreadySubmitted:false } }`, or 200 with the original and `alreadySubmitted:true` on repeats. 409 `DEADLINE_PASSED` / `INVALID_STATE`. Correctness is not returned. |

Invalid lifecycle transitions return 409 `INVALID_STATE` with a readable reason (e.g. "Cannot resume: the competition has already ended.").

## Results

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/competitions/:id/leaderboard` | 🔑 | host: full table with PRNs; student participant: top 10 (name, department, points, correct) + own `me` row |
| GET | `/competitions/:id/results` | 🔑 | host: `{ summary, students[] }` with every metric; student: own row only, after completion |
| GET | `/competitions/:id/analytics` | 🛡 | `{ summary, questions[], difficulty[] }` |
| GET | `/competitions/:id/export.xlsx` | 🛡 | six-sheet workbook, streamed |
| GET | `/competitions/:id/export.csv?type=results|students|questions|difficulty|attempts` | 🛡 | |
| GET | `/competitions/:id/students/:studentId/report.csv` | 🛡 | individual report |
| GET | `/competitions/:id/my-report.csv` | 🎓 | own report after completion |

Missing averages are `null` in JSON and `N/A` in exports, never 0.

## Participant management (host who created the competition only)

Every route below requires a host session; per-competition routes also require that this host created the competition (403 otherwise). Responses never include passwords or hashes.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/competitions/:id/participants?search&status&department&academicYear&includeRegistered` | 🛡 owner | `{ competition, rows[], counts, departments, generatedAt }`; statuses REGISTERED, JOINED, PLAYING, DISCONNECTED, COMPLETED, CANCELLED |
| GET | `/competitions/:id/participants/export.xlsx?…same filters…&tz` | 🛡 owner | editable two-sheet workbook; `tz` (IANA zone) sets the time zone of the times written |
| GET | `/host/assignable-competitions` | 🛡 | this host's competitions that can still take participants (DRAFT, WAITING, RUNNING, PAUSED) |
| POST | `/host/participants` | 🛡 | `{ name, email, department, academicYear, password, prn?, competitionId? }` → 201 `{ participant, competition, generatedPrn }`. `password` must match `^[A-Za-z0-9]{4}$`. Blank PRN → a unique `MH…` placeholder. Uses the same duplicate rules as registration (409 with `details.field`). `ALLOWED_EMAIL_DOMAINS` is enforced when set. `competitionId` must be the host's own, not finished. 60/min/IP. |
| POST | `/competitions/:id/participants/:studentId/password` | 🛡 owner | `{ password }` (4 letters/digits) → `{ reset: true }`. The student must be a participant of `:id`. The old password stops working, existing sessions are revoked and any sign-in lock is cleared. 60/min/IP. |

## Students and dashboard

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/students/me/history?page&pageSize` | 🎓 | paginated past competitions with final score/rank |
| GET | `/students?page&pageSize&search` | 🛡 | registered students |
| GET | `/students/roster` | 🛡 | roster size and whether it is enforced |
| POST | `/students/roster` | 🛡 | multipart `file`: CSV with `PRN, Email[, Name]` columns; replaces the roster |
| GET | `/host/overview` | 🛡 | counts for the dashboard cards |
| GET | `/health` | 🌐 | `{ status, database }`, 503 if MongoDB is disconnected |

Socket.IO events are documented in [ARCHITECTURE.md](ARCHITECTURE.md#real-time-events).
