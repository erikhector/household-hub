# AGENTS.md

Guidance for AI coding agents working in this repo. The product is
**Squirrel**, a household app covering inventory, shopping lists, meal
planning, tasks, and household and personal budgets. The full spec, data
model and conventions are in [REQUIREMENTS.md](./REQUIREMENTS.md). Read the
section for the feature you're touching before you change it.

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
npx next typegen && npx tsc --noEmit   # typecheck (typegen emits .next/types)
npm test                    # vitest run (non-watch)
npm run build
```

CI (`.github/workflows/ci.yml`) runs lint → typegen → tsc → test → build on
every push and PR. **Run all of these before calling a change done.**

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

## Testing

- Vitest runs in the node environment on `src/**/*.test.ts`. Tests sit next
  to the file they test.
- Tests never touch a real database. Mock `@/lib/prisma`, `@/lib/auth`,
  `@/lib/session`, `next/headers`, `next/navigation` and `next/cache` with
  `vi.mock`, and follow existing tests such as
  `src/lib/actions/household.test.ts`.
- There's no component-rendering setup (no jsdom or Testing Library) yet.

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
