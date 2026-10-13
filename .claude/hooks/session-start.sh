#!/bin/bash
# Claude Code on the web starts from a fresh clone with no node_modules, so
# lint/typecheck/test can't run until dependencies exist. Install them once,
# up front, so the agent doesn't spend turns (and tokens) discovering that.
# Local sessions already have node_modules and manage them by hand.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# `npm ci` also runs `prisma generate` via postinstall (no DB needed).
# Quiet flags keep the install log out of the agent's context.
if [ ! -d node_modules/.bin ]; then
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
fi

# The vendored pstack skills read their model roles from
# ~/.agents/pstack-models.md, not from the repo. Without that file they
# fall back to their own defaults (other vendors' models), so install the
# repo's copy, where every role is `inherit-parent` (the session model).
mkdir -p "$HOME/.agents"
cp .agents/pstack-models.md "$HOME/.agents/pstack-models.md"

# End-to-end tests (npm run test:e2e) need a real Postgres. The web image
# ships PostgreSQL 16 but not running; start it and create the same
# database docker-compose.yml would, so agents can run the suite without
# Docker. Best-effort: a failure here must not block the session, since
# lint/typecheck/unit tests don't need a database.
if command -v pg_ctlcluster >/dev/null 2>&1; then
  (
    service postgresql start >/dev/null 2>&1
    su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='household'\"" | grep -q 1 ||
      su postgres -c "psql -qc \"CREATE USER household WITH PASSWORD 'household' CREATEDB\""
    su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='household_hub'\"" | grep -q 1 ||
      su postgres -c "psql -qc \"CREATE DATABASE household_hub OWNER household\""
    # Local-only values, copied from .env.example's dev defaults.
    [ -f .env ] || grep -E '^(DATABASE_URL|AUTH_SECRET)=' .env.example > .env
    npx prisma migrate deploy >/dev/null 2>&1
  ) || echo "session-start: Postgres setup skipped (e2e tests won't run)" >&2
fi
