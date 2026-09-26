---
name: self-review
description: Review your own diff in household-hub (Squirrel) against the repo's conventions before opening or updating a PR. Use after implementing a change and before `git push` / creating a PR, or when asked to review a branch in this repo.
---

# Self-review

A cheap, focused pass over **only the diff**. Don't re-read whole files you
already know; read extra context only where a hunk is ambiguous.

## 1. Get the diff (one call)

```bash
git fetch -q origin master && git diff --stat origin/master...HEAD && git diff origin/master...HEAD -- . ':!package-lock.json'
```

Include uncommitted work with `git diff origin/master` instead if you
haven't committed yet.

## 2. Check each hunk against this list

Stop at the first real problem in a hunk, note it, move on.

**Blocking**
- [ ] Server Actions call `requireHousehold()` and never take a household id
      from `formData`/args. Every Prisma `where` on tenant data includes the
      household (or goes through a record already scoped to it).
- [ ] Input is Zod-validated. Form actions return `ActionState`, not throw.
- [ ] `signIn`/`signOut` redirects aren't swallowed (catch `AuthError` only).
- [ ] No secrets, tokens, emails or other PII logged or sent to Sentry.
- [ ] `proxy.ts` doesn't import `src/lib/auth.ts`. No bare `new PrismaClient()`.
- [ ] Schema change ⇒ a committed migration under `prisma/migrations/`.
- [ ] New logic has a colocated test; a bug fix has a test that would fail
      without it. No `.skip`/`.only`, no weakened assertions.

**Must fix before merge**
- [ ] Every user-facing string is in `en.ts` **and** `sv.ts`, none hardcoded
      in JSX. Plurals use `{ one, other }`.
- [ ] Base UI composition uses `render`, never `asChild`. `SelectValue` with
      non-readable values has a `children` mapper.
- [ ] New cookie/localStorage key is in `src/lib/cookie-inventory.ts`.
- [ ] New env var is in `.env.example`.
- [ ] REQUIREMENTS.md documents the shipped behaviour; finished BACKLOG.md
      item deleted. `version`/`releases.json` untouched.

**Simplify**
- [ ] No unrelated edits, dead code, leftover `console.log`, or
      commented-out code. No new abstraction with a single caller.

## 3. Verify

```bash
npm run check 2>&1 | tail -n 40 && npm run build 2>&1 | tail -n 20
```

## 4. Report

Fix what you found, then give a short list: what you fixed, and anything you
deliberately left (with why). No summary of the whole diff.
