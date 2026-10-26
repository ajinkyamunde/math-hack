# Database

MathHack uses MongoDB through Mongoose 8. Use **MongoDB Atlas** (any tier, including M0 for trials) or a self-hosted **replica set** (a single-node replica set is fine; `docker-compose.yml` sets one up). A standalone `mongod` also works: correctness never depends on multi-document transactions, because every critical write is protected by unique indexes and version-guarded single-document updates.

Per-collection schemas: [`database/schemas/`](../database/schemas). Index reference: [`database/indexes.md`](../database/indexes.md).

## Collections

`students`, `hosts`, `questions`, `competitions` (with embedded queue + snapshots), `participants`, `attempts`, `importbatches` (TTL 1 h), `auditlogs`, `rosterentries` (optional).

## Integrity guarantees

| Rule | Mechanism |
|---|---|
| One account per PRN and per email | unique indexes + friendly pre-check |
| One participant per student per competition | unique index; join is idempotent |
| One scored attempt per student per question | unique index; repeats return the original |
| No double-publish / double-close | `stateVersion` compare-and-set on every transition |
| Import confirmed once | atomic `PREVIEW → COMMITTING` claim |
| Historical results immutable | queue snapshots frozen at start |

## Setup

1. Atlas: create a cluster, a database user with `readWrite` on the `mathhack` database, and an IP access rule for your backend host. Copy the `mongodb+srv://` URI into `MONGODB_URI`.
2. Local: `docker run -d --name mathhack-mongo -p 27017:27017 mongo:7 --replSet rs0` then `docker exec mathhack-mongo mongosh --eval 'rs.initiate()'`, and use `mongodb://127.0.0.1:27017/mathhack?replicaSet=rs0`.
3. Start the backend; it builds all indexes (`syncIndexes`) at boot. `npm run validate-env -- --check-db` verifies connectivity.

If MongoDB is unreachable the backend refuses to start and `/api/health` reports 503. There is no fake-data fallback.

## Seed data

`npm run seed:dev` (development only; refuses `NODE_ENV=production`) adds the 15 sample questions; `-- --with-students` also creates five clearly-labelled demo students. Production never creates student accounts automatically.

## Backups

Atlas: enable continuous backup / snapshots. Self-hosted: schedule `mongodump --uri "$MONGODB_URI" --archive=mathhack-$(date +%F).gz --gzip` and store archives privately.
