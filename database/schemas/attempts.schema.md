# `attempts` collection

Model: `backend/src/models/Attempt.ts`

| Field | Type | Notes |
|---|---|---|
| `competitionId`, `questionId`, `studentId` | ObjectId | |
| `difficulty` | enum | copied from the snapshot for fast analytics |
| `selectedOption` | `A–D` or null | null for timeouts |
| `isCorrect` | boolean | computed on the server |
| `responseTimeMs` | int or **null** | server-measured: `received − publishedAt − pausedMs`. Null for timeouts so unanswered questions never count as 0 s. |
| `pointsAwarded` | int | computed on the server |
| `submittedAt` | date or null | server receive time |
| `timedOut` | boolean | true for participants who did not answer before the question closed |
| `createdAt` | date | |

Indexes: `{ competitionId, questionId, studentId }` **unique** — the database itself guarantees one scored record per student per question per competition, so duplicate or concurrent submissions can never be scored twice. Also `{ competitionId, studentId }`, `{ competitionId, questionId, timedOut }`, `{ studentId, createdAt: -1 }`.

A real answer that was received before the deadline but committed just after a timeout row was written replaces that timeout row through a conditional update (`timedOut: true` → answer), which can succeed only once.
