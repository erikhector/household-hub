# Task J: Sentry error tracking — progress

Note: PRODUCTION_READINESS.md does not exist in this worktree snapshot (checked,
not found — repo has AGENT_TASKS.md / AGENT_TASKS_PHASE2.md instead, neither of
which mention Sentry). Worked from the task description given directly by the
orchestrator, which was self-contained.

Also note: task F's `src/lib/logger.ts` does not exist yet in this worktree —
`src/lib/actions/errors.ts`, `src/lib/email.ts`, `src/app/error.tsx`, and
`src/app/global-error.tsx` all still used plain `console.error`. Adapted to
that: added `Sentry.captureException` alongside the existing `console.error`
calls, rather than switching to a logger that doesn't exist here. Did not
touch `src/lib/email.ts` — out of the explicit scope (errors.ts + unhandled
error boundaries only).

## Checklist

- [x] Investigate current state (errors.ts, email.ts, error boundaries, env example)
- [x] `npm install` (node_modules was missing in this fresh worktree)
- [x] Add `@sentry/nextjs` dependency (10.73.0)
- [x] Sentry client init: `src/instrumentation-client.ts` (current Next 16 convention,
      not the older `sentry.client.config.ts` — confirmed via @sentry/nextjs's own
      deprecation warning for that file)
- [x] Sentry server + edge init: `src/instrumentation.ts` `register()`, gated on
      `SENTRY_DSN`, distinguishing runtime is unnecessary since Sentry.init is
      the same call for both — Next calls register() once per runtime
- [x] `onRequestError` exported from `src/instrumentation.ts` (Next's
      unhandled-server-error hook — Server Components/Route Handlers/Server
      Actions/proxy) wired to `Sentry.captureRequestError`
- [x] `onRouterTransitionStart` exported from `src/instrumentation-client.ts`
      (Sentry flagged this as required for nav instrumentation during build)
- [x] All gated on `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` — confirmed true no-op
      otherwise (Sentry.captureException/captureRequestError/
      captureRouterTransitionStart are documented no-ops without a prior
      Sentry.init() call — verified by reading @sentry/core's scope.js)
- [x] `next.config.ts`: `withSentryConfig` (imported from the non-deprecated
      `@sentry/nextjs/config` entrypoint) applied only when `SENTRY_DSN` is
      set; source-map upload additionally gated on `SENTRY_AUTH_TOKEN` via
      `sourcemaps: { disable: !SENTRY_AUTH_TOKEN }` — verified build succeeds
      with DSN set but no auth token (no network/auth failure)
- [x] `src/lib/actions/errors.ts`: added `Sentry.captureException(error)` in
      `toFriendlyError`, same return shape, same `console.error` kept
- [x] `src/app/global-error.tsx`: `Sentry.captureException(error)` in the
      existing effect
- [x] `src/app/error.tsx`: same, for the segment-level boundary
- [x] `.env.example`: additive block — `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`,
      `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, all optional
- [x] Confirmed zero-config build works (no Sentry env vars at all — no
      `runAfterProductionCompile` step even appears, i.e. the plugin isn't
      loaded)
- [x] Confirmed build also works with `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`
      set but no `SENTRY_AUTH_TOKEN` (source maps skipped, no crash)
- [x] Fixed two @sentry/nextjs deprecation warnings surfaced during that test
      build: import `withSentryConfig` from `@sentry/nextjs/config` (not the
      root export), and removed the deprecated `disableLogger` option
      (unsupported under Turbopack, which this repo uses, anyway)
- [x] `npm run lint` — passes; the one pre-existing failure
      (`src/components/theme/use-theme-cycle.ts:15`, a react-hooks
      set-state-in-effect rule) is unrelated to this change, confirmed via
      `git stash` that it fails identically on the base commit
- [x] `npx tsc --noEmit` — clean (0 errors)
- [x] `npm run test` — 334/334 passing
- [x] `npm run build` with `SENTRY_DSN` unset — clean, no Sentry involvement
- [x] Commit
- [x] Final report noting human must create Sentry account + set real DSN
