# Index reference

Indexes are declared on the Mongoose schemas and built at startup with `syncIndexes()` (auto-indexing is off).

| Collection | Index | Purpose |
|---|---|---|
| students | `prn` unique | duplicate PRN prevention, login by PRN |
| students | `email` unique | duplicate email prevention, login by email |
| students | `department, academicYear` | host filtering |
| hosts | `email` unique | login, idempotent createHost |
| questions | `status, difficulty, createdAt` | paginated bank listing and filters |
| questions | `topic` | topic filter |
| questions | `fingerprint` | duplicate detection on import |
| questions | text(`questionText, topic, tags`) | text search support |
| competitions | `status, createdAt` | listings, dashboard "active competition" |
| competitions | `createdBy, createdAt` | per-host listings |
| competitions | `status, endsAt` | timer watchdog sweeps |
| participants | `competitionId, studentId` unique | one participant per student per competition |
| participants | `competitionId, connectionStatus` | presence counts |
| participants | `studentId, joinedAt` | student history pagination |
| participants | `competitionId, finalRank` | final ranking reads |
| attempts | `competitionId, questionId, studentId` unique | duplicate-scoring prevention |
| attempts | `competitionId, studentId` | leaderboard aggregation |
| attempts | `competitionId, questionId, timedOut` | live answer counts, question stats |
| attempts | `studentId, createdAt` | student analytics |
| importbatches | `expiresAt` TTL | previews expire after one hour |
| importbatches | `createdBy, createdAt` | |
| auditlogs | `competitionId, createdAt` | audit trail per competition |
| rosterentries | `prn` unique | optional official roster |

`backend/tests/database.test.ts` asserts that the unique indexes exist and reject duplicates.
