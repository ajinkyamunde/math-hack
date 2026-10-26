# `participants` collection

Model: `backend/src/models/Participant.ts`

| Field | Type | Notes |
|---|---|---|
| `competitionId` | ObjectId | |
| `studentId` | ObjectId | |
| `joinedAt` | date | timeouts are recorded only for questions that closed after this |
| `connectionStatus` | `ONLINE`/`OFFLINE` | best-effort presence; live counts come from Socket.IO rooms |
| `activeConnections`, `lastSeenAt` | | |
| `finalScore`, `finalRank`, `completedAt` | | written once when the competition completes |

Indexes: `{ competitionId, studentId }` **unique** (one participant record per student per competition), `{ competitionId, connectionStatus }`, `{ studentId, joinedAt: -1 }` (history), `{ competitionId, finalRank }`.
