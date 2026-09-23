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

- [ ] `npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm test` and `npm run build` pass
- [ ] New user-facing text is in both `en.ts` and `sv.ts`
- [ ] Finished BACKLOG.md items are documented in REQUIREMENTS.md and removed from the backlog
