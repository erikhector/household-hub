# Task M: account deletion + GDPR data export — progress

## Checklist

- [x] Read PRODUCTION_READINESS.md, AGENTS.md for context
- [x] Read background files: profile actions.ts + forms, household.ts (deleteHouseholdAction/leaveHouseholdAction/transferOwnershipAction), delete-household-dialog.tsx, schema.prisma (cascade check), inventory export route.ts, export-csv-button.tsx, auth.ts, auth.test.ts, household.test.ts
- [x] Verify cascade-safety understanding against actual schema.prisma (search all onDelete: touching HouseholdMember/User) — confirmed safe, see notes below
- [x] Implement `deleteAccountAction` in `src/app/dashboard/profile/actions.ts` (used requireUserId, not requireHousehold — deletion logic needs ALL of the user's memberships, not just the active-cookie one)
  - [x] require current password via bcrypt.compare
  - [x] per-membership branch logic (contributor -> remove row; sole-owner -> delete household; multi-member owner -> block with error naming households)
  - [x] wrap in prisma.$transaction, then delete User row, then signOut, then redirect to /login?deleted=success
- [x] Confirmation dialog UI `src/components/profile/delete-account-dialog.tsx` (mirrors delete-household-dialog.tsx but confirms via password re-entry, not typed name), wired into profile page danger zone
- [x] New Route Handler `src/app/dashboard/profile/export-data/route.ts` producing bounded JSON export
  - [x] profile fields (email, displayName, createdAt, emailVerifiedAt; never passwordHash)
  - [x] household memberships (household name, role, joined date only)
  - [x] PersonalBudgetCategory / PersonalTransaction / PersonalRecurringTemplate(+ack) rows
  - [x] Content-Disposition attachment
  - [x] UI button on profile page — renamed ExportCsvButton -> ExportButton (src/components/export/export-button.tsx) since it's now used for both CSV and JSON; updated all 3 prior usages (inventory, budget, shopping-list) + new profile usage
- [x] i18n strings added to en.ts and sv.ts (profile.dataExport, profile.deleteAccount, profile.dangerZoneTitle/Description, auth.login.accountDeletedSuccess)
- [x] Tests: deleteAccountAction (3 membership branches + wrong password + empty password), export route JSON shape (personal data included, household-shared + passwordHash excluded)
- [ ] Run npm run lint
- [ ] Run npx next typegen (new export-data route added) + npx tsc --noEmit
- [ ] Run npm run test — fix any regressions (baseline 371/371 passing)
- [ ] Commit work (small logical commits), message ends with Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- [ ] Final report: files changed, cascade-safety findings, lint/typecheck/test results, follow-ups (JWT session invalidation gap — note only, not fixed)

## Notes / findings

Cascade-safety check on prisma/schema.prisma — every `onDelete:` touching
HouseholdMember or User:
- `HouseholdMember.household` -> Household: Cascade (expected — deleting a
  household deletes its membership rows)
- `HouseholdMember.user` -> User: Cascade (expected — deleting a user
  deletes their membership rows; this is why deleteAccountAction must
  explicitly delete a sole-owned Household *before* relying on this, since
  deleting User alone would never delete the orphaned Household row itself)
- `Transaction.paidByMemberId` -> HouseholdMember: SetNull (confirms the
  brief: an ex-member's transactions survive, just losing the "paid by"
  note)
- `TransactionSplit.householdMemberId` -> HouseholdMember: Cascade — this
  one DOES cascade on member removal, but it only removes that member's own
  cost-share row from a split (never the parent Transaction, never another
  member's split row). This is pre-existing, already-accepted behavior
  shared with leaveHouseholdAction/removeMemberAction (see the schema's own
  comment: "an ex-member's own split rows are simply removed with them — a
  known simplification for an edge case explicitly out of scope"). No new
  data-loss risk introduced by deleteAccountAction reusing the same
  "delete the HouseholdMember row" mechanics.
- RecipeIngredient/ShoppingListItem's inventoryItemId relations: SetNull,
  unrelated to HouseholdMember/User.
Conclusion: confirms the task brief's summary as written — no relation was
found that would cascade-delete shared household data other members care
about.
