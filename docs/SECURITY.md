# Security

## Authentication and sessions
* Passwords: Argon2id (19 MiB, t=2, p=1 — OWASP baseline). Login compares against a dummy hash when the account does not exist, so timing does not reveal valid PRNs or emails. Errors are a generic "Invalid credentials."
* Sessions: HS256 JWT in an **HTTP-only** cookie (`Secure` in production, `SameSite` configurable, 12 h default). The browser never sees the token. Each request re-checks that the account still exists and is `ACTIVE`.
* Hosts cannot self-register. `npm run create-host` reads credentials from env or a hidden prompt, enforces password strength, hashes, never prints the password, and is idempotent.
* PRN ownership: registration alone cannot prove a PRN belongs to the registrant. MathHack offers two stronger options: email verification (enabled when SMTP is configured; `REQUIRE_EMAIL_VERIFICATION=true` blocks joining until verified) and an official roster (`ROSTER_ENFORCED=true` requires PRN + email to match an uploaded roster). Without SMTP, accounts honestly remain "unverified" and the UI says so.

## Authorization
* Roles come only from the signed session. `authorizeHost` guards every host route and socket event; `requireStudent` guards student actions. Students can read only sanitized competition state, their own results, and a top-10 leaderboard without PRNs or emails.
* Socket rooms are joined only after the server verifies a participant record; `answer:received` goes only to the submitting student's own room.

## CSRF
* Origin/Referer must equal `FRONTEND_URL` for all state-changing requests.
* Requests with a session must send `X-CSRF-Token` = HMAC(secret, session id), delivered in login/me responses and held in memory by the SPA.
* Socket handshakes check Origin (prevents cross-site WebSocket hijacking).

## Input and output
* Zod validates every body, query and path parameter (unknown fields stripped, so `isCorrect`, `points`, `studentId`, `role` sent by a client are ignored). Mongoose validates again on write.
* Body limits: 100 KB JSON, 2 MB uploads, 16 KB socket messages.
* Regex search input is escaped (no ReDoS / operator injection); `strictQuery` is on.
* Spreadsheet/CSV exports prefix cells starting with `= + - @ TAB CR` (and full-width variants) with `'`.
* Error responses never contain stack traces or database messages.

## Competition integrity
* Correctness, points, response time and deadlines are computed on the server. The client countdown is display only.
* `correctOption` and `explanation` are `select: false` and appear only in host responses and post-close reveals.
* Unique indexes prevent duplicate scoring even under concurrent submissions; version-guarded transitions prevent duplicate publishes.
* Significant host actions (login, start, pause, resume, publish, skip, end, cancel, queue edits, imports, exports) are written to `auditlogs`.

## Transport and headers
* Helmet defaults (CSP for API responses, HSTS in production behind HTTPS, nosniff, frameguard), `x-powered-by` disabled, CORS restricted to `FRONTEND_URL` with credentials.
* Rate limits: 600 req/min/IP general (labs share NAT), 20 failed logins per 15 min per IP+identifier, 50 registrations/h/IP, 20 uploads/min; per-socket token bucket (10 burst, 5/s). Rate limiting cannot be disabled in production.
* Set `TRUST_PROXY` to the number of proxies so limits see real client IPs.

## Secrets and logging
* All secrets come from environment variables, validated at startup (`SESSION_SECRET` ≥ 32 chars). `.env` is git-ignored; `.env.example` has placeholders only.
* The logger redacts keys like password/secret/token/cookie/hash/uri and strips credentials from MongoDB URIs.

## Known limitations
* JWT sessions cannot be individually revoked before expiry; suspending an account blocks it immediately because every request re-checks account status. Rotate `SESSION_SECRET` to invalidate all sessions.
* Without SMTP or a roster, PRN ownership is not verified (displayed as such).
