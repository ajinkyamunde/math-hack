# Deployment

MathHack deploys as two pieces: a **Node backend** (API + Socket.IO, stateful WebSockets) and a **static frontend** (Vite build). Plus MongoDB Atlas.

## 0. Before you start
* MongoDB Atlas cluster and `MONGODB_URI` (see [DATABASE.md](DATABASE.md)).
* A long random `SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
* Decide the domains. **Recommended:** serve both under one site, e.g. `https://mathhack.college.edu` (frontend) proxying `/api` and `/socket.io` to the backend, or `app.college.edu` + `api.college.edu` (same site, `COOKIE_SAME_SITE=lax`). Completely different sites (e.g. `*.vercel.app` + `*.onrender.com`) need `COOKIE_SAME_SITE=none` over HTTPS, and some mobile browsers block third-party cookies, so prefer a shared parent domain.

## Option A — Docker Compose (single server)

```bash
export SESSION_SECRET=...            # 32+ chars
docker compose up -d --build         # http://localhost:8080
```

The compose file runs MongoDB (single-node replica set), the backend and nginx serving the frontend with same-origin `/api` and `/socket.io` proxying. For the first host, run `npm run create-host` from a checkout pointed at the same `MONGODB_URI` (simplest), e.g. `MONGODB_URI=mongodb://localhost:27017/mathhack?replicaSet=rs0` after publishing the mongo port, or against Atlas. Put a TLS-terminating proxy (Caddy, Nginx, a cloud load balancer) in front of port 8080 for real events and update `FRONTEND_URL`/`BACKEND_PUBLIC_URL` to the HTTPS address.

## Option B — Managed platforms

### Backend (Render, Railway, Fly.io, a VM…)
* Root: repository. Build: `npm ci && npm run build -w backend`. Start: `node backend/dist/server.js` (or use `backend/Dockerfile`).
* Needs WebSocket support and a long-running process (not serverless functions).
* Environment:

| Variable | Example |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | provided by platform |
| `MONGODB_URI` | `mongodb+srv://…/mathhack` |
| `FRONTEND_URL` | `https://mathhack.college.edu` |
| `BACKEND_PUBLIC_URL` | `https://api.mathhack.college.edu` |
| `SESSION_SECRET` | 48 random bytes |
| `COOKIE_SAME_SITE` | `lax` (same site) or `none` (cross-site, HTTPS only) |
| `COOKIE_DOMAIN` | usually empty |
| `TRUST_PROXY` | `1` behind the platform's proxy |
| `REDIS_URL` | only when running 2+ instances |
| `SMTP_*`, `REQUIRE_EMAIL_VERIFICATION` | optional email verification |
| `ROSTER_ENFORCED` | optional |

* Health check path: `/api/health`.
* Create the host once: `npm run create-host` with `MONGODB_URI` + `HOST_INITIAL_*` set (from your machine or a one-off job), then remove `HOST_INITIAL_PASSWORD` from the environment.

### Frontend (Netlify, Vercel, Cloudflare Pages, S3 + CDN, nginx)
* Build: `npm ci && npm run build -w frontend` → `frontend/dist`.
* `VITE_API_URL`: empty if the host proxies `/api` and `/socket.io` to the backend (recommended), otherwise the backend origin, e.g. `https://api.mathhack.college.edu`.
* Configure SPA fallback (all paths → `index.html`). `frontend/nginx.conf` is a ready example.

## Scaling
One backend instance handles a typical college event (hundreds of phones). For more, run several instances with `REDIS_URL` set (Socket.IO Redis adapter) and sticky sessions at the load balancer. Timer processing is safe across instances (see ARCHITECTURE.md).

## Pre-event checklist
1. `npm run validate-env -- --check-db` passes with production values (it also warns about http URLs and `TRUST_PROXY=0`).
2. `/api/health` returns `{"status":"ok"}`.
3. Host can log in; import the question set; create the competition and **open registration** well before the start.
4. Ask a couple of students to join from phones on the venue Wi-Fi and confirm the "Live" indicator.
5. Ensure the venue network allows WebSockets (if not, Socket.IO falls back to long-polling and the student page also polls state every 5 s).
6. After the event, export the Excel workbook; results remain reproducible from the database at any time.

## Security checklist
* HTTPS everywhere; `NODE_ENV=production` (secure cookies, HSTS, rate limits enforced).
* Atlas network access restricted to the backend's egress IPs; DB user limited to the `mathhack` database.
* `.env` never committed; rotate `SESSION_SECRET` if leaked (signs everyone out).
* Backups enabled on Atlas.
