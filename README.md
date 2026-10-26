# MathHack — Avengers: Endgame Edition

A real-time mathematics MCQ competition platform for college events. A host builds a question bank, imports questions from Excel/CSV, runs a live competition from a control room, and exports full analytics. Students register with their PRN, join from a phone or laptop, and answer against server-authoritative timers.

## Features

- **Two roles.** Students self-register with PRN, name, email and password. Hosts are created only by the `create-host` script; there is no public host signup.
- **Question bank.** Create, edit, duplicate and delete questions, with draft and active status, search, filters and pagination. Questions used in a started competition are locked against edits.
- **Excel/CSV import.** Upload a file, preview every row with row-level errors and duplicate detection, then confirm. Templates for both formats can be downloaded, and invalid rows can be downloaded as an error report.
- **Difficulty rules.**

  | Difficulty | Default time | Allowed range | Points |
  |---|---|---|---|
  | EASY | 25 s | 20–30 s | 10 |
  | MEDIUM | 5 min | 5–6 min | 20 |
  | HARD | 15 min | 12–15 min | 30 |

  A competition lasts 30 minutes by default. The overall deadline always caps the current question's deadline.
- **Competition lifecycle.** DRAFT → WAITING → RUNNING ⇄ PAUSED → COMPLETED, with CANCELLED available from any non-final state. Questions advance automatically when their timer expires. The host can also publish the next question, skip a question or end the competition manually. Pause and resume shift every deadline, so students lose no time.
- **Fair, duplicate-proof scoring.** The server decides correctness, points and response time. Unique indexes allow one attempt per student per question. Students who do not answer get a timeout attempt. Correct answers are never sent to students before a question closes.
- **Leaderboard.** Ranked by points, then correct answers, then accuracy, then average correct response time. Full ties share a rank. It updates live over Socket.IO, and falls back to HTTP polling when the socket is down.
- **Analytics and exports.** Per-difficulty charts and per-question accuracy. A six-sheet Excel workbook (Leaderboard, Easy, Medium and Hard Analytics, Question Statistics, All Attempts), CSV exports, and a personal CSV report each student can download. All exports are protected against spreadsheet formula injection.
- **Security.** Argon2id password hashing, HTTP-only session cookie, CSRF tokens with an origin check, rate limiting, Helmet headers, strict CORS and Zod validation on every input and socket payload. Logs are redacted. Details are in [docs/SECURITY.md](docs/SECURITY.md).

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, React Router 7, Recharts, Socket.IO client |
| Backend | Node.js 20+, Express 5, TypeScript, Socket.IO 4, Mongoose 8, Zod, ExcelJS, csv-parse |
| Database | MongoDB 7 as a replica set (local single node or Atlas) |
| Tests | Vitest, Supertest, socket.io-client, React Testing Library, Playwright |

## Folder structure

```
mathhack/
├── backend/            Express + Socket.IO API (src/{config,controllers,middleware,models,routes,services,sockets,utils,validation})
│   └── tests/          Vitest + Supertest integration tests (real MongoDB, *_test databases only)
├── frontend/           React app (src/{app,components,features,hooks,pages,services,styles,types,utils})
│   └── tests/          unit/ (Vitest + RTL) and e2e/ (Playwright)
├── database/           schemas/*.schema.md, indexes.md, seed/developmentSeed.ts
├── docs/               ARCHITECTURE, API, DATABASE, QUESTION_IMPORT, DEPLOYMENT, SECURITY
├── question-files/     templates/ (CSV + XLSX) and examples/sample-questions.csv
├── result-files/       local export folder (exports are git-ignored)
├── scripts/            createHost.ts, validateEnvironment.ts, generateTemplates.ts
├── docker-compose.yml  MongoDB replica set + backend + nginx-served frontend
└── .env.example        every variable, placeholders only
```

## Prerequisites

- Node.js 20.11 or newer (22 recommended) and npm 10.
- MongoDB 7 running as a replica set. MongoDB Atlas works out of the box. Locally, the quickest option is Docker:

  ```bash
  docker run -d --name mathhack-mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all
  docker exec mathhack-mongo mongosh --quiet --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
  ```

## Installation

```bash
npm install                 # installs both workspaces
cp .env.example .env        # then edit .env
npm run validate-env -- --check-db
```

### Environment variables

All variables are documented in [.env.example](.env.example). The essentials are:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string. It must point at a replica set. |
| `SESSION_SECRET` | At least 32 random characters. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `FRONTEND_URL` | The exact browser origin of the app. It is used for CORS, CSRF and Socket.IO. |
| `BACKEND_PUBLIC_URL` | The public URL of the API. It is used in email verification links. |
| `VITE_API_URL` | The API URL baked into the frontend build. Leave it empty in development so Vite proxies `/api` and `/socket.io` to the backend. |
| `COOKIE_SAME_SITE`, `COOKIE_DOMAIN`, `TRUST_PROXY` | Settings for deploying behind proxies and across subdomains. |
| `HOST_INITIAL_*` | Read only by `npm run create-host`. Remove them afterwards. |
| `REDIS_URL` | Optional. Enables the Socket.IO Redis adapter for multiple backend instances. |
| `SMTP_*`, `REQUIRE_EMAIL_VERIFICATION` | Optional. Email verification for students. |
| `ROSTER_ENFORCED` | Optional. Only PRN and email pairs on an uploaded roster can register. |

Never commit `.env`. It is git-ignored.

## Create the host account

```bash
npm run create-host
```

The script prompts for name, email and password in an interactive terminal. It also reads `HOST_INITIAL_NAME`, `HOST_INITIAL_EMAIL` and `HOST_INITIAL_PASSWORD` for CI or containers. The script is idempotent and never prints the password.

Optional development data (refuses to run with `NODE_ENV=production`):

```bash
npm run seed:dev                     # sample question bank
npm run seed:dev -- --with-students  # plus a few demo students
```

## Run in development

```bash
npm run dev:backend    # http://localhost:4000
npm run dev:frontend   # http://localhost:5173
```

- Students: open `/register`, then `/login`.
- Host: open `/host/login`.

## Tests and checks

```bash
npm run typecheck
npm run lint
npm test               # backend integration + frontend unit tests
npm run test:e2e       # Playwright full competition flow (desktop host + phone student)
```

Backend tests need a MongoDB replica set. They use `TEST_MONGODB_URI`, which defaults to `mongodb://127.0.0.1:27017/mathhack_test?replicaSet=rs0`. They refuse to run against any database whose name does not contain `test`. The E2E suite starts its own backend on port 4100 and Vite on port 5174, against `mathhack_e2e_test`.

## Importing questions

1. Go to **Host → Import questions**.
2. Download the CSV or XLSX template. The same templates are in `question-files/templates/`.
3. Fill in one question per row. The columns are: `Question, Option A–D, Correct Answer, Difficulty, Time Limit Seconds, Points, Topic, Explanation`.
4. Upload the file and review the preview. Invalid rows show their line number and reason, and duplicates are flagged.
5. Confirm to import the valid rows. Download the error report to fix the rest.

Full rules are in [docs/QUESTION_IMPORT.md](docs/QUESTION_IMPORT.md). `question-files/examples/sample-questions.csv` has 15 ready-made questions.

## Running a competition

1. **Host → Competitions → New.** Set a title, duration, and automatic or manual progression, then add questions to the queue. You can reorder questions and override points.
2. **Open** the competition. It moves to WAITING, and students can now join it from their dashboard.
3. **Start.** The server freezes the question queue and publishes the first question. Each question closes at its own deadline or at the overall deadline, whichever comes first.
4. From the control room you can pause, resume, skip, publish next or end the competition, while watching live participants and the leaderboard.
5. When the last question closes or time runs out, the competition becomes COMPLETED and the final leaderboard is frozen.

## Exporting results

On **Host → Results** for a completed competition:

- **Excel workbook:** six sheets (Leaderboard, Easy/Medium/Hard Analytics, Question Statistics, All Attempts).
- **CSV:** results, students, questions, difficulty summary or all attempts.

Students can download their own CSV report from their competition page.

Only authenticated hosts can download exports. Cells that start with `=`, `+`, `-`, `@`, tab or carriage return are neutralized.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). It covers:

- Docker Compose on a single server
- MongoDB Atlas with Render, Railway or a VPS for the backend
- Vercel or Netlify for the frontend
- Redis for multiple instances
- A production checklist

Quick start with Docker:

```bash
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
docker compose up -d --build     # http://localhost:8080
```

Then create the host with `npm run create-host` against the same database.

## More documentation

- [Architecture](docs/ARCHITECTURE.md): timing model, concurrency and real-time design
- [API](docs/API.md): REST endpoints and Socket.IO events
- [Database](docs/DATABASE.md) and [database/schemas](database/schemas)
- [Security](docs/SECURITY.md)
