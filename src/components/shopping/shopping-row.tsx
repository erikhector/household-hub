"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createDialogHandle } from "@/components/ui/dialog";
import { LazyDialog } from "@/components/ui/lazy-dialog";
import { ShoppingItemEditTriggers } from "@/components/shopping/shopping-item-edit-triggers";
import { loadShoppingItemFormDialog } from "@/components/shopping/lazy-dialogs";
import { CategoryChip } from "@/components/shopping/category-chip";
import { updateShoppingListItemPriceAction } from "@/app/dashboard/shopping-list/item-actions";
import { format } from "@/lib/i18n/format";
import { useTickFeedback } from "@/lib/tick-feedback";
import { SwipeRow } from "@/components/shared/swipe-row";
import { RowActionsMenu } from "@/components/shared/row-actions-menu";
import { cn } from "@/lib/utils";
import { useUnitLabel } from "@/components/units-provider";
import { formatShoppingItemLabel } from "@/lib/shopping-list-text";
import type {
  InventoryItemOption,
  ShoppingListDict,
  ShoppingListItemRow,
} from "@/components/shopping/shopping-list-types";

export function ShoppingRow({
  item,
  onToggle,
  onDelete,
  leaving = false,
  highlighted = false,
  editable,
  isPending,
  startTransition,
  inventoryItems,
  categories,
  units,
  dict,
  numberFormat,
  awaitingPutAway = false,
  groupedByCategory = false,
}: {
  /** `purchased` is already the optimistic value (see ShoppingListClient). */
  item: ShoppingListItemRow;
  /** The optimistic tick, owned by ShoppingListClient. */
  onToggle: () => void;
  /** UX-49: removes the item with an Undo toast, owned by ShoppingListClient. */
  onDelete: (item: ShoppingListItemRow) => void;
  /** UX-37: just ticked, animating out of its aisle towards "In the cart". */
  leaving?: boolean;
  /** Ticked but not in inventory yet — gets a small "Not put away" tag. */
  awaitingPutAway?: boolean;
  highlighted?: boolean;
  /** The row sits under its category's group header (the pending section),
   * so its own category chip would only repeat that header (UX-22). */
  groupedByCategory?: boolean;
  /** UX-84: told when a swipe-delete hides (or Undo restores) this row, so
   * its aisle can hide its header too instead of leaving it alone. */
  onHiddenChange?: (itemId: string, hidden: boolean) => void;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  inventoryItems: InventoryItemOption[];
  categories: string[];
  units: string[];
  dict: ShoppingListDict;
  numberFormat: Intl.NumberFormat;
}) {
  const unitLabel = useUnitLabel();
  const needsMapping = item.inventoryItemId === null;
  const purchased = item.purchased;
  // UX-54: the box fills (with a haptic) before the row moves.
  const { ticking, tick } = useTickFeedback();
  // UX-37: an unticked row on an ACTIVE list is shopping mode proper — the
  // row you're reading at arm's length in the aisle — so it gets large
  // type. Ticked rows (In the cart) and read-only lists stay compact.
  const large = editable && !purchased;
  // UX-79: on a phone a large row whose controls are only price and ⋯ keeps
  // them on the name's line, so it is one 56 px line instead of two (118 px)
  // and a 15-item list shows more than 2-3 rows above the dock. A row that
  // also carries a chip or the "Match item" badge keeps the stacked second
  // line: those are too wide to share a 412 px line with a readable name.
  const inline = large && !needsMapping && !(item.category !== null && !groupedByCategory);
  // PERF-25: the edit form is a lazily loaded chunk, so its openers (the pencil,
  // "Match item", the ⋯ menu's Edit and the swipe) reach it through this
  // row's own handle instead of sharing a Dialog root with it.
  const [editHandle] = useState(() => createDialogHandle());

  // A just-added row scrolls into view if the list is long enough to have
  // hidden it ("nearest" leaves it alone if it's already on screen). New
  // rows always land at the bottom of the pending section, so the sticky add
  // line above never covers them; the phone BottomNav below is cleared by
  // main's scroll-padding in the dashboard layout, and the shopping-mode
  // dock above it by the row's scroll-margin (--shopping-dock, set by
  // NextUpDock while it's shown). Both sit on SwipeRow's root and that's
  // what scrolls: its `overflow-hidden` makes it a scroll container, and
  // Chrome clips a target's scroll-margin to the inner scroller it's in, so
  // a margin on the row inside it never reached `main`.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlighted) return;
    const row = rowRef.current;
    (row?.closest<HTMLElement>("[data-swipe-row]") ?? row)?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <SwipeRow
      className={cn(
        "list-bleed rounded-md max-sm:scroll-mb-[var(--shopping-dock,0px)]",
        // MAINT-39: a leaving row takes no room in the aisle from the tap
        // on (zero height, the list's 0.5rem gap cancelled by the negative
        // margin, drawn back at its own place by `top-2`), so the rows below
        // move up at tap time, inside the 500 ms the layout-shift metric
        // forgives. Removing it from the DOM after LEAVE_MS then moves
        // nothing. Holding its full height until that timer fired meant a
        // busy main thread could run the timer late and the rows below
        // jumped, as a real layout shift. No z-index: the rows rising into
        // its place come later in the DOM, so they paint over it as it
        // fades. Kept on top, SwipeRow's opaque content background (which
        // doesn't fade) hid the next row for most of its glide.
        leaving && "top-2 -mt-2 h-0 overflow-visible",
      )}
      // UX-33: the row glides when the list moves; not while it's leaving
      // its aisle, which has its own animation (it then arrives in "In the
      // cart" as a new row and rises in there).
      flipKey={leaving ? undefined : item.id}
      // MAINT-19: the optimistic overlay already lists this item in "In the
      // cart", so the fading aisle copy must not be a second checkbox for
      // a screen reader (or a test) to find.
      inert={leaving}
      // A read-only (completed or archived) list has nothing to swipe to.
      primaryLabel={editable ? (purchased ? dict.swipe.untick : dict.swipe.tick) : undefined}
      primaryIcon={<Check className="size-4" />}
      editLabel={editable ? dict.swipe.edit : undefined}
      deleteLabel={dict.swipe.delete}
      onDelete={editable ? () => onDelete(item) : undefined}
      disabled={isPending}
    >
      <div
        ref={rowRef}
        className={cn(
          "relative flex flex-col gap-1 rounded-md border transition-colors duration-700",
          // AUTO-3: a bigger touch target while the list is ACTIVE (shopping
          // mode) — rows are tapped one-handed, phone in the other hand, so
          // this is when it matters most; a read-only list stays compact.
          editable ? "px-3 py-3" : "px-3 py-2",
          large && "min-h-14",
          inline && "max-sm:py-1",
          highlighted && "border-primary/50 bg-primary/10",
          // UX-37: the just-ticked row drops and fades towards "In the cart"
          // below for LEAVE_MS, then moves there. motion-safe only; under
          // reduced motion it isn't held back at all (see toggleItem).
          leaving &&
            "pointer-events-none motion-safe:animate-out motion-safe:fade-out motion-safe:slide-out-to-bottom-4 motion-safe:fill-mode-forwards motion-safe:duration-250",
        )}
      >
        {/* Below sm the row stacks: the name gets the full width on its own
            line and the controls drop to a second line, indented under it.
            On one line, the shrink-0 controls (category chip, price — wider
            since GAP-13 added a currency symbol — edit, delete) left a phone
            only a few pixels of truncated name, the one part of the row you
            actually need to read in the aisle. */}
        <div
          className={cn(
            "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2",
            inline && "max-sm:flex-row max-sm:items-center max-sm:gap-1",
          )}
        >
          <label
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3",
              // Stretches the label to the row's full height so tapping
              // anywhere on the row (not just the checkbox glyph) toggles
              // purchased — the label/input pairing (Checkbox is a native
              // <input type="checkbox">) already gives this keyboard and
              // screen-reader semantics for free, no extra handler needed.
              editable && "cursor-pointer self-stretch max-sm:min-h-11 pointer-coarse:min-h-11",
              // UX-37: and past the label to the whole row — its padding, the
              // note and the hint lines too — via a pseudo-element spread over
              // the row (the row is `relative`, the label isn't). Hit-testing
              // a label's ::after is the label, so it's the same native
              // toggle; the controls column sits above it (`relative z-10`).
              editable && "after:absolute after:inset-0 after:rounded-md after:content-['']",
            )}
          >
            <Checkbox
              checked={purchased || ticking}
              data-ticking={ticking || undefined}
              disabled={isPending || !editable}
              // z-[1]: above the label's row-wide ::after (painted after it),
              // so a tap on the box itself lands on the box.
              className={cn(editable && "z-[1] size-5", large && "max-sm:size-6 pointer-coarse:size-6")}
              data-swipe-primary
              onChange={() => (purchased ? onToggle() : tick(onToggle))}
            />
            <span
              className={cn(
                "min-w-0 flex-1 break-words sm:truncate",
                large && "text-base max-sm:text-lg pointer-coarse:text-lg",
                purchased && "text-muted-foreground line-through",
              )}
              title={formatShoppingItemLabel(item, unitLabel)}
            >
              {formatShoppingItemLabel(item, unitLabel)}
            </span>
            {item.addedAutomatically && (
              <Badge variant="secondary" className="shrink-0">
                {dict.lowStockBadge}
              </Badge>
            )}
            {awaitingPutAway && (
              <Badge variant="outline" className="shrink-0">
                {dict.putAway.awaitingBadge}
              </Badge>
            )}
            {!editable && needsMapping && (
              <Badge variant="outline" className="shrink-0 border-dashed">
                {dict.needsMappingBadge}
              </Badge>
            )}
          </label>
          {/* Outside the label on purpose (AUTO-4) — anything inside it would
              also toggle the checkbox on tap, since Checkbox is a native
              <input> the label is already wired to. Rendered even on a
              non-editable (view-only) row, just without the tap-to-correct
              affordance, since the estimate itself is still worth showing.
              `relative z-10` lifts it above the label's row-wide hit area
              (UX-37), so these controls still get their own taps. */}
          <div
            className={cn(
              "relative z-10 flex shrink-0 flex-wrap items-center gap-1 max-sm:gap-2 pointer-coarse:gap-2 empty:hidden sm:pl-0",
              editable ? "pl-8" : "pl-7",
              large && "max-sm:pl-9",
              inline && "max-sm:flex-nowrap max-sm:pl-0",
            )}
          >
            {/* AUTO-2b: the in-place fix for a wrong auto-category guess.
                Only on an editable, linked row — an unlinked one has no
                category yet (the mapping flow picks one), and a read-only
                list already shows each row's category as its group header.
                Rows under a group header skip it for the same reason
                (UX-22), so it shows on the flat Purchased section. */}
            {editable && item.category !== null && !groupedByCategory && (
              <CategoryChip
                itemId={item.id}
                itemName={item.name}
                category={item.category}
                categories={categories}
                disabled={isPending}
                dict={dict.categoryChip}
              />
            )}
            <PriceTag item={item} editable={editable} isPending={isPending} startTransition={startTransition} numberFormat={numberFormat} dict={dict} hideAddOnPhone={inline} />
            {editable && (
              <>
                <ShoppingItemEditTriggers
                  handle={editHandle}
                  unlinked={item.inventoryItemId === null}
                  editAriaLabel={format(dict.editItemAriaLabel, { name: item.name })}
                  matchItemLabel={dict.matchItemButton}
                />
                <LazyDialog loader={loadShoppingItemFormDialog} handle={editHandle}>
                  {(ShoppingItemFormDialog) => (
                    <ShoppingItemFormDialog
                      mode="edit"
                      item={item}
                      inventoryItems={inventoryItems}
                      categories={categories}
                      units={units}
                      dict={dict}
                      handle={editHandle}
                    />
                  )}
                </LazyDialog>
                {/* UX-49: removes at once with the swipe's Undo toast, not a
                    "can't be undone" confirm for an item that is one tap to
                    add back. */}
                <Button
                  variant="ghost"
                  size="icon"
                  data-row-delete
                  className="size-7 text-muted-foreground hover:text-destructive max-sm:hidden"
                  disabled={isPending}
                  aria-label={format(dict.deleteItemAriaLabel, { name: item.name })}
                  onClick={() => onDelete(item)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                {/* On a phone the Edit and Delete icons above are hidden
                    (the row's left swipe shows both) and this ⋯ is their
                    tap path, clicking those same buttons. */}
                <RowActionsMenu
                  label={format(dict.rowActionsAriaLabel, { name: item.name })}
                  editLabel={dict.swipe.edit}
                  deleteLabel={dict.swipe.delete}
                  // UX-79: an inline row has no room for "Add price" beside
                  // the name, so the ⋯ carries it (the ≈ price button, once
                  // there is one, stays on the row to correct it).
                  priceLabel={inline && item.estimatedPrice == null ? dict.addPriceLabel : undefined}
                  disabled={isPending}
                />
              </>
            )}
          </div>
        </div>
        {/* GAP-5: the note as a muted second line, indented past the checkbox
            (size-5 + gap-3 on an editable row, size-6 on a large one on a
            phone, size-4 + gap-3 otherwise) so it lines up under the item name.
            Outside the label, but on an editable row the label's row-wide hit
            area (UX-37) covers it, so tapping it ticks the row like any other
            part of it. Wrapped rather than truncated — unlike the name, the
            note is the part someone needs to read in the aisle. */}
        {item.note && (
          <p
            className={cn(
              "text-xs break-words whitespace-pre-line text-muted-foreground",
              editable ? "pl-8" : "pl-7",
              large && "max-sm:pl-9",
            )}
          >
            {item.note}
          </p>
        )}
        {/* GAP-65: who put the line on a shared list. Only the server-resolved
            name is passed in, so it is absent on your own lines and in a
            one-person household. Same indent as the note above. */}
        {item.addedByName && (
          <p
            className={cn(
              "text-xs break-words text-muted-foreground",
              editable ? "pl-8" : "pl-7",
              large && "max-sm:pl-9",
            )}
          >
            {format(dict.addedBy, { name: item.addedByName })}
          </p>
        )}
        {/* UX-168: an unlinked row keeps only its "Match item" chip. The
            consequence (buying it won't update stock) is said once per list
            by the note in ShoppingListClient, not as a paragraph per row. */}
      </div>
    </SwipeRow>
  );
}

/**
 * The row's "≈ 24 kr" (AUTO-4) — muted, tappable text that swaps for a
 * small inline input on tap, following the same "tap a value to correct it
 * in place" idea as, say, an inventory quantity stepper, just with no prior
 * example of an inline-edited text field in this codebase to match exactly.
 * A save round-trips through updateShoppingListItemPriceAction; until it
 * resolves the input just sits there disabled rather than optimistically
 * updating, since a bad round trip here would otherwise show a corrected
 * price that didn't actually save.
 *
 * Read-only (not editable) rows still render the plain "≈ price" text when
 * one is set — the estimate is informational even once a list is completed
 * or archived — just without the tap affordance, matching every other
 * per-row edit control's editable-only gating.
 */
function PriceTag({
  item,
  editable,
  isPending,
  startTransition,
  numberFormat,
  dict,
  hideAddOnPhone = false,
}: {
  item: ShoppingListItemRow;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  numberFormat: Intl.NumberFormat;
  dict: ShoppingListDict;
  hideAddOnPhone?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => (item.estimatedPrice != null ? String(item.estimatedPrice) : ""));

  if (!editable) {
    return item.estimatedPrice != null ? (
      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
        ≈ {numberFormat.format(item.estimatedPrice)}
      </span>
    ) : null;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(
          "touch-target shrink-0 justify-center rounded px-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline tabular-nums",
          // UX-79: on an inline row it's reached from the row's ⋯ instead
          // (RowActionsMenu clicks this same button, so the inline editor
          // is the one a tap opens).
          hideAddOnPhone && item.estimatedPrice == null && "max-sm:hidden",
        )}
        data-price-edit
        disabled={isPending}
        onClick={() => {
          setDraft(item.estimatedPrice != null ? String(item.estimatedPrice) : "");
          setEditing(true);
        }}
        aria-label={
          item.estimatedPrice != null
            ? format(dict.editPriceAriaLabel, { name: item.name })
            : format(dict.addPriceAriaLabel, { name: item.name })
        }
      >
        {item.estimatedPrice != null ? `≈ ${numberFormat.format(item.estimatedPrice)}` : dict.addPriceLabel}
      </button>
    );
  }

  function save() {
    const price = Number(draft.replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(price) || price < 0) {
      toast.error(dict.priceInvalid);
      return;
    }
    startTransition(async () => {
      const result = await updateShoppingListItemPriceAction(item.id, price);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
    });
  }

  return (
    <form
      className="flex shrink-0 items-center gap-1 max-sm:gap-2 pointer-coarse:gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        autoFocus
        value={draft}
        disabled={isPending}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-24 px-2"
        aria-label={format(dict.priceInputAriaLabel, { name: item.name })}
      />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        className="size-7"
        disabled={isPending}
        aria-label={dict.savePriceAriaLabel}
      >
        <Check className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-7 text-muted-foreground"
        disabled={isPending}
        onClick={() => setEditing(false)}
        aria-label={dict.cancelPriceAriaLabel}
      >
        <X className="size-3.5" />
      </Button>
    </form>
  );
}
