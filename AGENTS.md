# AGENTS.md

Guidance for AI coding agents working in this repo. The product is
**Squirrel**, a household app covering inventory, shopping lists, meal
planning, tasks, and household and personal budgets. The full spec, data
model and conventions are in [REQUIREMENTS.md](./REQUIREMENTS.md). Read the
section for the feature you're touching before you change it. Anything
that touches the UI follows [DESIGN.md](./DESIGN.md): the seven UX
principles and Squirrel's own design principles, with the checklist every
UI change is reviewed against.

Open work is in [BACKLOG.md](./BACKLOG.md), grouped by phase with stable IDs
(`AUTO-3`, `SCALE-H`, …). When you finish an item, document it in
REQUIREMENTS.md and delete it from BACKLOG.md. `docs/archive/` holds the
finished planning docs that code comments cite. They're history, so don't
update them or add new work there.

## Stack

- **Next.js 16** (App Router, Turbopack) with React 19, in TypeScript
  throughout. APIs differ from older Next.js versions. When unsure, check the
  version-matched guides in `node_modules/next/dist/docs/`.
- **PostgreSQL + Prisma 7**: the schema is in `prisma/schema.prisma` and the
  CLI config is in `prisma7.config.ts`. The generated client goes to
  `src/generated/prisma`, which is gitignored and rebuilt by `postinstall`.
  The client needs the driver adapter in `src/lib/prisma.ts`, so never write
  a bare `new PrismaClient()`.
- **Auth.js v5** (Credentials provider, JWT sessions).
  `src/lib/auth.config.ts` holds only the Edge-safe parts and is used by
  `src/proxy.ts`. `src/lib/auth.ts` is Node-only. **Never import
  `src/lib/auth.ts` from `proxy.ts`.**
- **Tailwind 4 + shadcn/ui on Base UI (not Radix)**. Compose with the
  `render` prop (`<DialogTrigger render={<Button>…</Button>} />`) and never
  with `asChild`.
- Zod, Sonner (toasts), next-themes, Sentry, Upstash Redis (rate limiting),
  Resend (email), web-push.

## Commands

```bash
docker compose up -d        # local Postgres
npx prisma migrate dev      # apply schema locally (dev only, never prod)
npm run dev                 # dev server on :3000
npm run lint
npm run typecheck           # next typegen && tsc --noEmit (typegen emits .next/types)
npm test                    # vitest run (non-watch)
npm run check               # lint + typecheck + test in one go
npm run build
npm run test:e2e            # Playwright vs `next start` + real Postgres (build first), desktop + mobile
npm run test:e2e:mobile     # just the phone viewport (or :desktop) while iterating
npm run test:e2e:screenshots # every page × desktop/mobile × en/sv to test-results/screenshots/
npm run ci:local            # the full gate: check + build + e2e
```

**CI is local for now.** GitHub Actions is paused (the account can't start
runners), so `.github/workflows/ci.yml` only runs on manual dispatch and
GitHub check results are to be ignored. `npm run ci:local` (lint →
typecheck → unit tests → build → e2e) is the gate: **run it and see it pass
before every push**, and paste its summary into the PR body. See
`ci_gate` in AUTOPILOT.md. In Claude Code on the web,
`.claude/hooks/session-start.sh` runs `npm ci` and starts a migrated local
Postgres, so all of these work from the first turn.

## Layout

- `src/app/`: routes. The app itself is under `src/app/dashboard/<feature>/`.
  Public and auth pages (`login`, `signup`, `join`, `privacy`, …) sit at the
  top level.
- `src/app/dashboard/<feature>/actions.ts`: Server Actions for that feature,
  with a colocated `actions.test.ts`.
- `src/lib/actions/`: Server Actions shared across routes (auth, household,
  locale, notifications, …).
- `src/lib/`: domain logic and pure calculators (`safe-to-spend-calc.ts`,
  `recurring-template-calc.ts`, `stock-status.ts`, `units.ts`, …), plus
  `session.ts` and `prisma.ts`.
- `src/lib/i18n/`: locale cookie, dictionaries (`dictionaries/en.ts`,
  `sv.ts`) and `format`/`plural` helpers.
- `src/components/<feature>/`: feature components. `src/components/ui/`
  holds shadcn primitives.
- `prisma/migrations/`: committed migration history.

## Conventions

- **Tenancy**: every Server Action gets the household from the session via
  `requireHousehold()` (`src/lib/session.ts`). **Never accept a household id
  from the client.**
- **Action shapes**: a form action has the signature
  `(prevState, formData) => Promise<ActionState>` and is used with
  `useActionState`. A click action (toggle, delete, +/-) is called directly
  inside `useTransition`.
- **Auth redirects**: don't wrap redirecting `signIn`/`signOut` in a
  try/catch that swallows the redirect. Catch only `AuthError` and re-throw
  everything else.
- **i18n**: all user-facing text goes in both `en.ts` and `sv.ts`
  (`sv.ts satisfies Dictionary`). Pass the `dict` (or a sub-object) to
  Client Components as a prop and never hardcode strings in JSX. Dictionary
  values are plain strings or `{ one, other }` pairs, never functions. Locale
  is chosen by a cookie, **not** by `[lang]` routing. That was a deliberate
  choice, so don't "fix" it.
- **Base UI `SelectValue`** renders the raw `value`. If the values aren't
  human-readable, give it a `children` function that maps each value to its
  label.
- **Cookies and local storage**: anything new stored in the browser must be
  added to `src/lib/cookie-inventory.ts`. A drift-guard test enforces this,
  and the privacy page lists what's stored. Every entry must be necessary or
  a user preference. An analytics or third-party cookie needs a real consent
  flow first.
- Follow the surrounding code's style and comment density. Comments explain
  *why*, often at length. Keep that style.

## Development workflow

Every change goes through the same loop. Scale each step to the size of the
change, but don't skip one.

1. **Orient.** Find the BACKLOG.md item (if any) and the REQUIREMENTS.md
   section for the feature. Read the files you'll change and one existing
   neighbour to copy the pattern from (an `actions.ts` + `actions.test.ts`
   pair, a sibling component). If the change touches the UI, read
   DESIGN.md (it's short) and design to its principles and checklist. For anything touching more than ~3 files or
   the schema, write a short plan first and check it against the
   Conventions above.
2. **Branch.** Work on a feature branch, never `master`.
3. **Implement.** Smallest diff that does the job. Follow the Conventions
   section. No drive-by refactors, reformatting or renamed symbols outside
   the task, since they bloat review and conflict with parallel work.
4. **Test.** Add or update the colocated `*.test.ts` for any logic you
   touched: every new Server Action, calculator or branch in one. Test
   behaviour (tenancy check, validation errors, the happy path), not
   implementation details. Bug fixes get a test that fails without the fix.
   **Anything that changes the UI gets a UI test**: a new page, component,
   form, dialog or layout change adds or extends an `e2e/` spec that
   asserts it through the browser (see "UI tests" under Testing). It runs
   on desktop and mobile automatically, so make sure it passes on both.
5. **Verify.** Run the focused test while iterating
   (`npx vitest run <path>` or `npx playwright test <spec>`), then
   `npm run check && npm run build` (plus `npm run test:e2e` for anything
   user-visible) once at the end. Fix every failure. Never skip, `.skip` or loosen a test to get
   green.
6. **Self-review.** Run the `self-review` skill
   (`.claude/skills/self-review/SKILL.md`) against your diff before opening
   the PR. Fix what it finds.
7. **Document.** Update REQUIREMENTS.md for shipped behaviour, delete the
   finished BACKLOG.md item, add new env vars to `.env.example`.
8. **PR.** Conventional Commit title, template filled in (Release note in
   both languages). Keep PRs to one backlog item or one concern.
   After opening, drive it to green with the `steward` skill
   (`.claude/skills/steward/SKILL.md`).

## Working efficiently (token budget)

Context is the scarcest resource. Spend it on the code you're changing, not
on re-reading things or scrolling logs. None of these trade away quality:
the verification steps above stay mandatory.

- **Never read REQUIREMENTS.md (4 600+ lines) or BACKLOG.md whole.** List
  headings with `grep -n '^#' REQUIREMENTS.md`, then read just your section
  with an offset/limit. Same for any file over ~300 lines: grep for the
  symbol first, then read the range around it.
- **Search before you read.** Use Grep/Glob to locate code; open only the
  files that matter. Prefer `grep -l` / files-only output when you just need
  to know *where*.
- **Don't re-read** a file you've just read or edited. Edits fail loudly if
  they didn't apply.
- **Batch independent tool calls** into one turn (several reads, or lint and
  a grep) instead of one call per turn.
- **Keep command output small.** Run a single test file rather than the
  suite while iterating; pipe noisy output through `tail -n 40` or
  `grep -E 'error|fail|✗'`; use `npx vitest run --reporter=dot` for a
  quiet full run. Run the full `check`/`build` once at the end, not after
  every edit.
- **Skip what's generated or vendored**: `src/generated/`, `.next/`,
  `node_modules/` (except the Next.js docs in `node_modules/next/dist/docs/`
  when you need an API), `package-lock.json`, `docs/archive/` (only open an
  archive doc when a code comment cites it and you need the rationale).
- **Use subagents sparingly.** They start cold and re-read context. Reach
  for one only for a genuinely broad search across many directories, or to
  run independent tasks in parallel; tell it exactly what to return.
- **Answer, don't narrate.** Short status updates, no restating the plan or
  the diff back. The PR body and commit messages are the record.
- **Fix root causes in one pass.** A failing check means read the actual
  error, fix it, re-run that one check. Don't guess-and-push.

## Code review

Reviews (self-review, or reviewing someone's PR) check the diff against, in
priority order:

1. **Correctness and security**: `requireHousehold()` in every Server
   Action, no client-supplied household id, every Prisma query scoped by
   household, Zod-validated input, no secrets or PII in logs, auth redirects
   not swallowed.
2. **Tests**: new logic has tests, bug fixes have a regression test, mocks
   follow the existing pattern (no real DB).
3. **UX and design**: any UI change passes DESIGN.md's "UI review
   checklist" (UX principles plus Squirrel's design principles). Name the
   principle a finding breaks.
4. **Conventions**: i18n in both `en.ts` and `sv.ts`, no hardcoded JSX
   strings, `render` not `asChild`, browser storage in
   `cookie-inventory.ts`, migration committed with any schema change.
5. **Docs**: REQUIREMENTS.md updated, BACKLOG.md item removed, PR template
   filled in.
6. **Simplicity**: no dead code, no speculative abstractions, no unrelated
   changes.

Report findings most-severe first, each with file:line and a concrete fix.
Skip style nits the linter would catch.

## Autonomous loop

Scheduled sessions (scouts, builder, reviewer, retro) improve the app on their own,
steered by [AUTOPILOT.md](./AUTOPILOT.md). If you are one of them, read
AUTOPILOT.md first and obey it. Human-only areas listed there always get
flagged for careful review. See REQUIREMENTS.md, "Autonomous improvement
loop".

## Pull requests and releases

- All work lands on `master` through a squash-merged PR. Never push to
  `master` directly. Only the release workflow does that.
- **PR title** must be a Conventional Commit. It sets the version bump:
  `feat:` minor, `fix:`/`perf:` patch, `type!:` major. `refactor`, `docs`,
  `test`, `ci`, `chore`, `build` and `style` don't release.
- **Fill in the "Release note" section** of the PR template in English and
  Swedish. Write it for users, not developers. It's shown in the app under
  "What's new".
- Never edit `version` in `package.json` or
  `src/lib/release-notes/releases.json` by hand. `.github/workflows/release.yml`
  writes both after merge. See REQUIREMENTS.md, "Releases & What's new".
- **While CI is local** (`ci_gate: local` in AUTOPILOT.md) that workflow
  can't run, so a releasing PR (`feat`, `fix`, `perf`, `revert` or `!`)
  cuts its own release as the last step before merge. Merge the latest
  `master` first, then run
  `PR_NUMBER=<n> PR_TITLE="<title>" PR_BODY="$(cat <body.md>)" node scripts/release.ts apply`
  and commit the three files it changes. Then add the version to the
  INFRA-6 list in BACKLOG.md, so its tag and GitHub Release get backfilled.

## Testing

- Vitest runs in the node environment on `src/**/*.test.ts`. Tests sit next
  to the file they test.
- Tests never touch a real database. Mock `@/lib/prisma`, `@/lib/auth`,
  `@/lib/session`, `next/headers`, `next/navigation` and `next/cache` with
  `vi.mock`, and follow existing tests such as
  `src/lib/actions/household.test.ts`.
- There's no component-rendering setup (no jsdom or Testing Library).
  UI behaviour is covered end to end instead: Playwright specs in `e2e/`
  run against a production build and a real, seeded Postgres. See
  REQUIREMENTS.md, "Testing", for the seed users and conventions.

### UI tests

- **Every spec runs twice**: the `desktop` project (Desktop Chrome) and
  the `mobile` project (Pixel 7, 412 px wide, touch). The dashboard is a
  different layout on phones (bottom bar, only `main` scrolls), so a test
  that passes on one can fail on the other. Name a spec
  `*.desktop.spec.ts` or `*.mobile.spec.ts` only when the check is
  meaningless at the other size (e.g. which navigation shows).
- **Every page is listed in `e2e/routes.ts`.** `smoke.spec.ts`
  (dashboard) and `public.spec.ts` (logged out) render each one in `en`
  and `sv` on both viewports and fail on an HTTP error, the error
  boundary, a console error, or content wider than the screen.
  `src/app/page-coverage.test.ts` fails `npm test` when a `page.tsx` has
  no entry there, so a new page must be added in the same PR (with a
  seeded row in `e2e/seed.ts` if it has a dynamic segment).
- **Behaviour goes in a flow spec.** The smoke run only proves a page
  renders. Anything a user does (submit a form, open a dialog, toggle,
  delete, navigate) gets a test in `flows.spec.ts` or a new
  `e2e/<feature>.spec.ts`: act through the UI, then assert the visible
  result, and reload first when the point is that it saved.
- **Locators**: by role and accessible name (`getByRole("button", { name:
  "Add task" })`), not CSS classes or test ids. If you can't find an
  element that way, it probably needs a label for screen readers too.
  Name rows you create uniquely (`unique()` in `flows.spec.ts`), since
  specs share the seeded household.
- **Shared checks** live in `e2e/ui.ts` (`collectErrors`,
  `expectRendersCleanly`, `expectNoHorizontalOverflow`, `saveScreenshot`,
  `dismissCookieNotice` for specs where the cookie notice would get in
  the way).
  Reuse them in new specs rather than re-implementing.
- **Screenshots**: `npm run test:e2e:screenshots` (or
  `E2E_SCREENSHOT_DIR=<dir> npx playwright test smoke public`) saves
  `<desktop|mobile>-<en|sv>-<route>.png` for every page. The UX scout
  looks at these. Use them yourself to eyeball a layout change.

## Database changes

- Edit `prisma/schema.prisma`, then run `npx prisma migrate dev --name <name>`
  locally and commit the generated migration.
- Production only ever runs `npx prisma migrate deploy`. See
  [DEPLOYMENT.md](./DEPLOYMENT.md).

## Don'ts

- Don't commit `.env` or secrets. Only `.env.example` is tracked, so document
  new env vars there.
- Don't edit `src/generated/` by hand.
- Don't run `prisma migrate dev`/`reset` against anything but local dev.
