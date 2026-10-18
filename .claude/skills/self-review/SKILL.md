---
name: self-review
description: Review your own diff in household-hub (Squirrel) against the repo's conventions before opening or updating a PR. Use after implementing a change and before `git push` / creating a PR, or when asked to review a branch in this repo.
---

# Self-review

A cheap, focused pass over **only the diff**. Don't re-read whole files you
already know; read extra context only where a hunk is ambiguous.

## 1. Get the diff (one call)

```bash
git fetch -q origin next && git diff --stat origin/next...HEAD && git diff origin/next...HEAD -- . ':!package-lock.json'
```

Include uncommitted work with `git diff origin/next` instead if you
haven't committed yet. (`next` is where feature PRs land; for a hotfix
into `master`, diff against `origin/master`.)

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
- [ ] User-visible change ⇒ an `e2e/` spec asserts it, passing on both the
      `desktop` and `mobile` projects. New page ⇒ listed in `e2e/routes.ts`
      (seeded row in `e2e/seed.ts` if it has a dynamic segment).
- [ ] Layout/CSS change ⇒ ran the full `npm run test:e2e` (or at least the
      specs near the area, e.g. `form-control-sizes`) once, not only
      `test:e2e:quick`: the landscape and tablet reruns have broken the
      release PR (#269, #336) after fast CI was green, and e2e runs only there.
- [ ] e2e text locators are scoped (`page.getByRole("main").getByText(...)`,
      or the `dialog`) because a phone/desktop layout can render the same
      text twice and a bare `getByText` then fails strict mode (blocked
      #134 and #138 at merge).

**Must fix before merge**
- [ ] UI change (pages, `src/components/`, `globals.css`, user-facing
      strings) ⇒ passes every item of DESIGN.md's "UI review checklist"
      (the seven UX principles and Squirrel's design principles). Look at
      the mobile screenshot of the changed page, not just the code.
- [ ] UI change ⇒ DESIGN.md's **Mobile UX rules M1–M10** hold, for the new
      UI *and* for the existing component or page the diff touches (targets
      ≥ 44 × 44 px with 8 px gaps, primary action in the thumb zone, right
      `type`/`inputMode`/`autoComplete` on fields, feedback on every tap,
      no gesture-only action, loading/offline states). Two misses recur in
      review: a `p-*` in a className silently drops a base `safe-area-inset`
      padding via tailwind-merge (re-add `pt-/pb-[max(…,env(safe-area-inset-…))]`
      after it, and keep the only exit reachable without scrolling), and
      resizing a target to 44 px inside a fixed-width row or breakpoint band
      (check the 600-640 px band and sv long labels). Fix what you find in
      the touched component in this PR; an exception needs a reason in the
      PR Summary.
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
npm run ci:local 2>&1 | grep -E "Test Files|Tests |passed|failed|error" | tail -n 20
```

## 4. Report

Fix what you found, then give a short list: what you fixed, and anything you
deliberately left (with why). No summary of the whole diff.
