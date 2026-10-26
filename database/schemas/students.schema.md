# `students` collection

Model: `backend/src/models/Student.ts`

| Field | Type | Notes |
|---|---|---|
| `name` | string ≤100 | required |
| `prn` | string ≤20 | **normalized**: whitespace removed, upper-cased. Unique. |
| `email` | string ≤254 | **normalized**: trimmed, lower-cased. Unique. |
| `department` | string ≤100 | required |
| `academicYear` | enum `FE SE TE BE PG1 PG2` | required |
| `passwordHash` | string | Argon2id. `select: false`, stripped by `toJSON`; never sent to clients. |
| `emailVerified` | boolean | `false` until the emailed link is used. Stays `false` when SMTP is not configured (the UI says so). |
| `rosterVerified` | boolean | `true` when PRN + email match the uploaded official roster. |
| `emailVerificationTokenHash` / `emailVerificationExpiresAt` | string / date | SHA-256 of the one-time token; hidden. |
| `accountStatus` | enum `ACTIVE SUSPENDED` | suspended accounts cannot sign in or use existing sessions. |
| `createdAt` / `updatedAt` | date | Mongoose timestamps |

Indexes: `{ prn: 1 }` unique, `{ email: 1 }` unique, `{ department: 1, academicYear: 1 }`.
