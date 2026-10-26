# `questions` collection

Model: `backend/src/models/Question.ts`

| Field | Type | Notes |
|---|---|---|
| `questionText` | string ≤2000 | required |
| `options` | string[4] | exactly four, all different (validated in Zod and Mongoose) |
| `correctOption` | `A`/`B`/`C`/`D` | `select: false`; only host endpoints request it |
| `difficulty` | `EASY`/`MEDIUM`/`HARD` | |
| `timeLimitSeconds` | int | EASY 20–30 (default 25), MEDIUM 300–360 (300), HARD 720–900 (900) |
| `points` | int 1–1000 | defaults 10 / 20 / 30 |
| `topic`, `tags[]` | strings | optional |
| `explanation` | string ≤2000 | `select: false`; revealed only after a question closes and only if the competition allows it |
| `status` | `DRAFT`/`ACTIVE` | only ACTIVE questions can be queued |
| `fingerprint` | sha256 | of the normalized question text; used for duplicate detection |
| `createdBy` | ObjectId → hosts | |
| `importBatchId`, `importedBy`, `importedAt` | | set for spreadsheet imports |

Indexes: `{ status, difficulty, createdAt: -1 }`, `{ topic }`, `{ fingerprint }`, text index on `questionText, topic, tags`.

Competitions never read live questions while running: they play an immutable **snapshot** taken at start (see competitions.schema.md), so editing the bank never changes historical results. Editing or deleting a question that is queued in a RUNNING/PAUSED competition is refused (409).
