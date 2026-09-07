# Deployment

## Monitoring

The app exposes an unauthenticated health check at `GET /api/health`. It runs a trivial
database round-trip (`SELECT 1`) so a `200` response means both the app process and the
database are reachable — not just that the process is up.

- **200** — `{ "status": "ok", "timestamp": "<ISO-8601>" }`. Everything is healthy.
- **503** — `{ "status": "error" }`. The database round-trip failed. Check the server logs
  for the real error (logged server-side, not exposed in the response) — this usually means
  the database is unreachable, out of connections, or misconfigured (bad `DATABASE_URL`).

Point an external uptime monitor at this endpoint, for example:

- [UptimeRobot](https://uptimerobot.com/) or [Better Uptime](https://betteruptime.com/) —
  create an HTTP(S) monitor against `https://<your-domain>/api/health`, checking every 1–5
  minutes, alerting on any non-200 response.
- If hosting on Vercel, Fly.io, or Railway, wire the platform's own built-in health check to
  this same path so the platform can restart/reroute traffic away from an unhealthy instance
  automatically, in addition to (not instead of) an external monitor — a platform-only check
  won't tell you if the whole app is down.

The endpoint requires no authentication by design so monitoring infrastructure can call it
with a plain HTTP GET; it does not (and must not) expose any data beyond the status/timestamp
above.
