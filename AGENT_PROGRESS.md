# Agent progress — item G: shopping-list "+"-button create dialog

## Status: done

## What was done

Converted the shopping list's item-creation UI from a permanently-visible inline
form to a `<Plus>`-button-triggered `Dialog`, matching the shape item F just
established for Tasks (and already used by Inventory/Recipes).

- `src/components/shopping/shopping-list-client.tsx`
  - `AddItemForm` gained an optional `onSuccess` callback, invoked after a
    successful `addAdHocItemAction` call (alongside the existing field
    resets). Its fields, validation, and server action are unchanged.
  - Added a new `AddItemDialog` component (structured after
    `EditShoppingItemDialog`'s `Dialog`/`DialogContent`/`DialogHeader`/
    `DialogTitle` shell, and after Tasks' new `AddTaskDialog`): a `<Plus>`-icon
    `Button` as the `DialogTrigger`, with `AddItemForm` rendered inside
    `DialogContent` and `onSuccess={() => setOpen(false)}` closing the dialog
    on a successful add.
  - The list detail header's outer wrapper now uses
    `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`
    (same responsive layout Tasks uses), and `AddItemDialog` is rendered as
    the first (leftmost/primary) action in the header's button row, gated on
    `isActive` same as the old inline form was.
  - Removed the old unconditional `<AddItemForm ... />` render below the
    header.
- `src/lib/i18n/dictionaries/en.ts` / `sv.ts`
  - Added `shoppingList.addItem` ("Add item" / "Lägg till vara") for the
    trigger button's label and `shoppingList.addItemDialogTitle`
    ("Add an item" / "Lägg till en vara") for the dialog title.
  - Updated `shoppingList.emptyListActive` to mention the "+" button
    (mirroring Tasks' item F empty-state copy change), in both locales.
    `emptyListOther` (shown for completed/archived lists, which have no add
    affordance) was left unchanged, since only the active-list empty state
    needed the new copy.

## Verification

- `npm run lint` — clean.
- `npx tsc --noEmit` — clean. (Note: this required generating `.next/types`
  first via `npm run build`, since a fresh `noEmit` check on a worktree with
  no prior `.next` build fails with unrelated `PageProps`/`LayoutProps`/
  `icon.png` errors that are a pre-existing artifact of Next.js's generated
  route types, not caused by this change.)
- `npm run test` — 47 files / 649 tests passed.
- Manual check via a local dev server (`next dev` on port 3100, pointed at
  the already-running local Postgres container): created a new shopping
  list, opened it, confirmed the empty state now reads "...use the + button
  above to add items...", clicked the "+ Add item" button, filled in a name
  ("Milk"), submitted, and confirmed the item appeared in the list and the
  dialog closed/reset automatically. Cleaned up the test list afterward.

## Notes for anyone resuming

- This worktree's branch was originally forked before item F (Tasks' dialog
  conversion) had landed on `master`; it was fast-forwarded to `master`
  (`f09feec`) before starting this task so `AddTaskDialog` could be used as
  the structural reference. No conflicts; fast-forward was clean since the
  worktree branch was a direct ancestor.
- A local `.env` was added (gitignored, not committed) pointing at the
  Postgres container already running on `localhost:5432` under
  `docker-compose.yml`'s default credentials, purely to run the dev server
  for manual verification. `AUTH_SECRET`/`APP_URL` are dev-only placeholder
  values from `.env.example`.
- `next dev`/`next build` auto-wrote content into the root `AGENTS.md` during
  testing, as flagged as a known possibility; this was reverted with
  `git checkout -- AGENTS.md` before committing and is not part of this
  change.
- `UX_CONSISTENCY_BACKLOG.md`'s own status line for item G (currently `[~]`)
  was intentionally left as-is — the pattern in this repo's history is for
  that checklist to be updated in a separate commit once the PR/branch is
  actually reviewed and merged to `master` (see how item F's `[~]` -> `[x]`
  update landed as its own commit after the merge), which is outside this
  worktree's task.
