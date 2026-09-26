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
