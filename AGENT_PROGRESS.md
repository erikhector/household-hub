# Task A: CSP header — progress

Note: PRODUCTION_READINESS.md does not exist in this worktree (checked repo
root, AGENT_TASKS.md, AGENT_TASKS_PHASE2.md — none define a "Task A" list
matching this assignment). Proceeded directly from the detailed task
instructions given in the orchestrator prompt, since they were self-contained.

## Checklist — all done

- [x] Locate PRODUCTION_READINESS.md (not found — proceeded from prompt instructions)
- [x] Read AGENTS.md and check node_modules/next/dist/docs/ for CSP/headers guidance
      (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md)
- [x] Read next.config.ts's existing securityHeaders array and commenting convention
- [x] Inspect receipt-scan-dialog.tsx / tesseract.js usage — confirmed via source
      inspection of node_modules/tesseract.js: worker/core/lang-data all default to
      jsdelivr CDN (no local corePath/workerPath/langPath configured), worker is
      spawned from a same-origin Blob that does `importScripts(cdnWorkerUrl)`.
- [x] Inspect barcode-scanner.tsx / barcode-detector ponyfill usage — confirmed its
      zxing-wasm dependency's `locateFile` defaults to fastly.jsdelivr.net, runs on
      the main thread (no worker), fetches + WebAssembly.instantiateStreaming's it.
- [x] Check Next.js's own needs — no next/font external requests (self-hosted at
      build time); Next emits inline bootstrap `<script>` tags (RSC payload) with no
      nonce, and shadcn/Radix/Base-UI set inline `style` attributes at runtime —
      both confirmed necessary by testing (see below), so 'unsafe-inline' is used
      for both script-src and style-src.
- [x] Write CSP directive(s) into securityHeaders, matching comment convention,
      dev vs prod conditional for 'unsafe-eval' (React dev/Turbopack HMR only)
- [x] Create .claude/launch.json for dev server (already existed, correct as-is)
- [x] Start dev server, open Browser pane — see "Environment quirks" below for why
      this needed a workaround
- [x] Exercise /login — clean, no CSP violations
- [x] Exercise dashboard (signed up a fresh test household) — clean
- [x] Exercise inventory "scan barcode" add flow — dialog opens, no CSP violations;
      getUserMedia() itself is blocked by the *pre-existing* Permissions-Policy
      `camera=()` header (unrelated bug, not part of this task — flagged as a
      separate background task, see "Findings" below). Verified the CSP itself is
      correct by reproducing barcode-detector's exact zxing-wasm CDN fetch +
      WebAssembly.instantiate in the page's own console: no CSP violations.
- [x] Exercise shopping list "Scan receipt" dialog (OCR) — dialog opens cleanly;
      the file input needs a native OS file picker which browser automation can't
      drive, so verified the CSP itself by reproducing tesseract.js's exact
      Blob-Worker + importScripts(cdn) + fetch(cdn core/lang-data) +
      WebAssembly.instantiate sequence in the page's own console: all succeeded,
      zero CSP violations logged.
- [x] Also swept /dashboard/budget, /meal-planning, /household, /profile — clean
- [x] Adjust directives until clean — iterated twice: added 'unsafe-inline' to
      script-src (Next's inline RSC bootstrap script) and to style-src (Base
      UI/Radix inline style attributes), both confirmed necessary by live console
      errors before the fix and confirmed silent after
- [x] npm run lint — 1 pre-existing failure in src/components/theme/use-theme-cycle.ts,
      unrelated to this change (not touched by this task; already tracked as its
      own spawned background task)
- [x] npx tsc --noEmit — clean, no errors
- [x] npm run test (vitest run) — 334/334 tests passed, 24 files
- [x] Commit work
- [x] Final report

## Environment quirks hit along the way (for a cold-start agent, or future reference)

- This worktree ships with no `node_modules` — ran `npm ci` first (took a few
  minutes; already done, don't redo unless the lockfile changes).
- No `.env` in the worktree either — copied the main repo's `.env` (local
  Postgres via docker-compose, dev-only AUTH_SECRET placeholder — no real
  secrets) so `next dev` and Prisma can actually run.
- **The Browser tool's `preview_start` with a launch.json `name` spawns `npm run
  dev` with the MAIN repo directory as cwd, not this worktree** — confirmed by
  checking which directory got a `.next` build folder. That means it silently
  tests the *unmodified* main-repo next.config.ts, not this worktree's change,
  and it also collides with Next 16's system-wide "only one `next dev` lockfile
  per resolved project root" guard against whatever dev server is already
  running there (in my run, that produced "Another next dev server is already
  running" / EADDRINUSE noise). The fix: start `next dev -p <port>` directly via
  the Bash tool (which *does* use this worktree as cwd — verified a `.next`
  folder appeared here, isolated from the main repo's), then open it in the
  Browser pane with `preview_start`'s `url` parameter (not `name`) pointing at
  that manually-started server.

## Findings out of scope for this task (flagged as separate background tasks)

- `Permissions-Policy: camera=(), microphone=(), geolocation=()` (pre-existing,
  added in an earlier commit, not touched by this task) actually blocks the
  barcode scanner's own `getUserMedia()` call — confirmed live via a console
  "Permissions policy violation: camera is not allowed in this document." The
  scanner always falls into its "camera access denied" state regardless of what
  the user allows. Flagged as its own background task (change to `camera=(self)`).
- `npm run lint` has one pre-existing failure in
  `src/components/theme/use-theme-cycle.ts` (react-hooks/set-state-in-effect) —
  unrelated to next.config.ts / CSP. Already tracked as a separate pending
  background task from earlier in this session; not fixed here.
