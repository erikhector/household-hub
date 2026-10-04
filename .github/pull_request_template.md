<!--
PR title must be a Conventional Commit. It decides the version bump when merged:
  feat: …       → minor release (0.3.0 → 0.4.0)
  fix: / perf:  → patch release (0.3.0 → 0.3.1)
  feat!: …      → major release (any type + "!" = breaking)
  refactor, docs, test, ci, chore, build, style → merged without a release
The "Release preview" check comments on this PR with the exact version and note.
-->

## Summary

<!-- What changed and why. For reviewers, not users. -->

## Verification

<!-- CI is local for now (see AUTOPILOT.md `ci_gate`): paste the summary
lines of `npm run ci:local` for the pushed commit. -->

## Release note

<!--
Shown to users under "What's new" in the app once merged. Write for
someone using Squirrel, not a developer: one or two plain sentences.
Leave English empty to use the PR title. Leave Svenska empty to show the
English note to Swedish users too. Ignored for non-releasing PR types.
-->

### English



### Svenska



## Checklist

- [ ] `npm run check` (lint, typecheck, test) and `npm run build` pass
- [ ] New or changed logic has colocated tests; bug fixes have a regression test
- [ ] UI changes are covered in `e2e/` (new pages in `e2e/routes.ts`) and `npm run test:e2e` passes on desktop and mobile
- [ ] Self-reviewed the diff (`.claude/skills/self-review/SKILL.md`)
- [ ] UI changes meet DESIGN.md's Mobile UX rules (M1–M10) for new and touched UI, checked on the mobile screenshots (exceptions explained in the Summary)
- [ ] New user-facing text is in both `en.ts` and `sv.ts`
- [ ] Finished BACKLOG.md items are documented in REQUIREMENTS.md and removed from the backlog
