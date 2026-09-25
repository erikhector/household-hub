"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Check,
  CheckCheck,
  ClipboardPaste,
  Download,
  Ellipsis,
  Link2,
  PackagePlus,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createDialogHandle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShoppingItemFormDialog } from "@/components/shopping/shopping-item-form-dialog";
import { ReceiptScanDialog } from "@/components/shopping/receipt-scan-dialog";
import { ResolveMappingsDialog } from "@/components/shopping/resolve-mappings-dialog";
import { ImportListDialog } from "@/components/shopping/import-list-dialog";
import { ShareListButton } from "@/components/shopping/share-list-button";
import { SmartAddBar } from "@/components/shopping/smart-add-bar";
import { CategoryChip } from "@/components/shopping/category-chip";
import {
  archiveShoppingListAction,
  completeShoppingListAction,
  deleteShoppingListAction,
  deleteShoppingListItemAction,
  generateFromLowStockAction,
  togglePurchasedAction,
  unarchiveShoppingListAction,
  uncompleteShoppingListAction,
  updateShoppingListItemPriceAction,
} from "@/app/dashboard/shopping-list/actions";
import { format, plural } from "@/lib/i18n/format";
import { showAutoAddedToast } from "@/components/shopping/auto-added-toast";
import { cn } from "@/lib/utils";
import type { SmartAddCandidate } from "@/lib/shopping/smart-add-suggestions";
import { groupPendingItemsByCategory } from "@/lib/shopping/shopping-mode-grouping";
import { sumEstimatedPendingTotal } from "@/lib/shopping/estimated-total";
import { useScreenWakeLock } from "@/lib/shopping/use-screen-wake-lock";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

// Below this many unlinked items, resolving them one at a time via each
// row's edit dialog is fine; above it, the batch ResolveMappingsDialog is
// offered instead so the user isn't clicking into the same dialog N times.
const BATCH_RESOLVE_THRESHOLD = 3;

// How long a row the smart add line just added stays highlighted — long
// enough to spot where it landed, short enough to be gone by the next add.
const ADDED_HIGHLIGHT_MS = 2000;

type ShoppingListItemRow = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  purchased: boolean;
  addedAutomatically: boolean;
  inventoryItemId: string | null;
  // The linked InventoryItem's category (AUTO-3, [id]/page.tsx's query),
  // null when there's no link yet. Drives shopping mode's grouping below,
  // and each editable row's CategoryChip (AUTO-2b) for correcting it.
  category: string | null;
  // AUTO-4: defaulted from the linked InventoryItem's lastKnownPrice at
  // creation (per-unit, unmultiplied by quantity — see the create paths in
  // actions.ts), then only ever changed by an explicit correction via
  // PriceTag below or an actual receipt price. null means no price is known
  // yet — the row shows nothing rather than "≈ 0".
  estimatedPrice: number | null;
  // GAP-5: optional free-text hint, set from ShoppingItemFormDialog's edit
  // mode. null when there isn't one (never "").
  note: string | null;
};

type InventoryItemOption = { id: string; name: string; category: string; unit?: string };

type ShoppingListData = {
  id: string;
  name: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  items: ShoppingListItemRow[];
};

type ShoppingListDict = Dictionary["shoppingList"];

export function ShoppingListClient({
  list,
  inventoryItems,
  smartAddCandidates,
  categories,
  units,
  dict,
  autoAddDict,
  barcodeDict,
  exportLabel,
  locale,
}: {
  list: ShoppingListData;
  inventoryItems: InventoryItemOption[];
  smartAddCandidates: SmartAddCandidate[];
  categories: string[];
  units: string[];
  dict: ShoppingListDict;
  /** AUTO-8: un-checking a row can drop its item back into low stock and
   * onto "Next shop" — see showAutoAddedToast. */
  autoAddDict: Dictionary["inventory"]["autoAdd"];
  barcodeDict: Dictionary["barcodeScanner"];
  exportLabel: string;
  locale: Locale;
}) {
  const [isPending, startTransition] = useTransition();
  // Same convention as the budget page's amounts (SafeToSpend,
  // TransactionList, …): locale-aware decimals, no currency symbol — there's
  // no household-level currency setting, so a symbol would be a guess.
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const pendingItems = list.items.filter((item) => !item.purchased);
  const purchasedItems = list.items.filter((item) => item.purchased);
  const isActive = list.status === "ACTIVE";
  const statusLabel = list.status === "COMPLETED" ? dict.statusCompleted : dict.statusArchived;
  const unresolvedItems = list.items.filter((item) => item.inventoryItemId === null);
  const pendingGroups = groupPendingItemsByCategory(pendingItems, dict.otherCategory);
  // AUTO-4: "what's left to buy is roughly going to cost" — see
  // sumEstimatedPendingTotal's own doc comment for why this is pending-only
  // and per-unit/unmultiplied.
  const estimatedTotal = sumEstimatedPendingTotal(pendingItems);

  const showResolveMappings = isActive && unresolvedItems.length >= BATCH_RESOLVE_THRESHOLD;
  const resolveMappingsLabel = format(plural(unresolvedItems.length, dict.resolveMappings.triggerButton), {
    count: unresolvedItems.length,
  });

  // One handle per dialog the ⋯ menu opens (AUTO-5) — created once per
  // mount, see createDialogHandle for why the dialogs can't sit inside the
  // menu itself.
  const [dialogs] = useState(() => ({
    addItem: createDialogHandle(),
    importList: createDialogHandle(),
    share: createDialogHandle(),
    resolveMappings: createDialogHandle(),
    completeList: createDialogHandle(),
    deleteList: createDialogHandle(),
  }));

  const addLowStock = () =>
    startTransition(async () => {
      const result = await generateFromLowStockAction(list.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const added = result.added ?? 0;
      if (added > 0) {
        toast.success(format(plural(added, dict.addLowStockAddedToast), { count: added }));
      } else {
        toast.info(dict.addLowStockNoneToast);
      }
    });

  // Shared by "Done shopping" (no confirm — every item is already checked
  // off, so there's nothing to lose) and the menu's confirm-gated "Complete
  // list" (items still pending). Either way the toast carries an "Undo"
  // (BACKLOG.md's "undo over confirm") that reopens the list and removes
  // exactly the Groceries expense this completion logged, if any.
  const completeList = () =>
    startTransition(async () => {
      const result = await completeShoppingListAction(list.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const transactionId = result.transactionId;
      toast.success(dict.completedToast, {
        description: result.expenseLoggedMessage,
        action: {
          label: dict.undo,
          onClick: () =>
            startTransition(async () => {
              const undo = await uncompleteShoppingListAction(list.id, transactionId);
              if (undo.error) toast.error(undo.error);
            }),
        },
      });
      if (result.unresolvedNotice) toast.info(result.unresolvedNotice);
    });

  // AUTO-3: keep the screen on while there's an ACTIVE list open on a phone.
  useScreenWakeLock(isActive);

  // "Cleared" covers two cases: every item got checked off (purchasedItems
  // non-empty), or the list was emptied out entirely after having had items
  // this session (hadItems distinguishes that from a list that's simply
  // never had anything added to it, which gets the plain empty state).
  const [hadItems, setHadItems] = useState(list.items.length > 0);
  if (list.items.length > 0 && !hadItems) setHadItems(true);
  const isCleared =
    pendingItems.length === 0 && (purchasedItems.length > 0 || (list.items.length === 0 && hadItems));

  // Adjust-state-during-render pattern: re-arm the dismissal the moment the
  // list leaves the cleared state (e.g. a new item is added), so the next
  // time it clears it shows fresh instead of staying dismissed forever.
  const [wasCleared, setWasCleared] = useState(isCleared);
  const [clearedDismissed, setClearedDismissed] = useState(false);
  if (isCleared !== wasCleared) {
    setWasCleared(isCleared);
    if (!isCleared) setClearedDismissed(false);
  }
  const showCleared = isCleared && !clearedDismissed;

  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(new Set());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);
  const highlightAdded = (ids: string[]) => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedIds(new Set(ids));
    highlightTimer.current = setTimeout(() => setHighlightedIds(new Set()), ADDED_HIGHLIGHT_MS);
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard/shopping-list"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {dict.backToAll}
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{list.name}</h1>
            {!isActive && <Badge variant="secondary">{statusLabel}</Badge>}
          </div>
          {/* AUTO-4: hidden until at least one pending item has a price —
              nothing to estimate yet otherwise. */}
          {estimatedTotal > 0 && (
            <p className="text-sm text-muted-foreground">
              {format(dict.estimatedTotal, { amount: numberFormat.format(estimatedTotal) })}
            </p>
          )}
        </div>
        {/* AUTO-5: only what's used on every trip stays visible — "Scan
            receipt" here and the smart add line below. Everything else
            lives in the ⋯ menu; the dialogs those items open are rendered
            outside it (see the handles above) because the menu's popup
            unmounts as it closes. */}
        <div className="flex flex-wrap items-center gap-2">
          {isActive && (
            <ReceiptScanDialog
              listId={list.id}
              pendingItems={pendingItems.map((item) => ({ id: item.id, name: item.name }))}
              inventoryItems={inventoryItems}
              categories={categories}
              units={units}
              dict={dict.receiptScan}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="icon" disabled={isPending} aria-label={dict.moreActions}>
                  <Ellipsis className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-auto min-w-52">
              {isActive && (
                <>
                  <DropdownMenuItem onClick={() => dialogs.addItem.open(null)}>
                    <Plus />
                    {dict.addItem}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => dialogs.importList.open(null)}>
                    <ClipboardPaste />
                    {dict.importList.triggerLabel}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={addLowStock}>
                    <PackagePlus />
                    {dict.addLowStock}
                  </DropdownMenuItem>
                  {showResolveMappings && (
                    <DropdownMenuItem onClick={() => dialogs.resolveMappings.open(null)}>
                      <Link2 />
                      {resolveMappingsLabel}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => dialogs.share.open(null)}>
                    <Share2 />
                    {dict.shareLink.button}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem render={<Link href={`/dashboard/shopping-list/${list.id}/export`} prefetch={false} />}>
                <Download />
                {exportLabel}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isActive && list.items.length > 0 && (
                <DropdownMenuItem onClick={() => dialogs.completeList.open(null)}>
                  <CheckCheck />
                  {dict.completeList}
                </DropdownMenuItem>
              )}
              {list.status === "ARCHIVED" ? (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      const result = await unarchiveShoppingListAction(list.id);
                      if (result.error) toast.error(result.error);
                    })
                  }
                >
                  <ArchiveRestore />
                  {dict.unarchive}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      const result = await archiveShoppingListAction(list.id);
                      if (result.error) toast.error(result.error);
                    })
                  }
                >
                  <Archive />
                  {dict.archive}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={() => dialogs.deleteList.open(null)}>
                <Trash2 />
                {dict.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isActive && (
        <>
          <ShoppingItemFormDialog
            mode="create"
            listId={list.id}
            inventoryItems={inventoryItems}
            units={units}
            dict={dict}
            barcodeDict={barcodeDict}
            handle={dialogs.addItem}
          />
          <ImportListDialog listId={list.id} dict={dict.importList} handle={dialogs.importList} />
          <ShareListButton shoppingListId={list.id} dict={dict.shareLink} handle={dialogs.share} />
          {showResolveMappings && (
            <ResolveMappingsDialog
              items={unresolvedItems.map((item) => ({ id: item.id, name: item.name }))}
              inventoryItems={inventoryItems}
              categories={categories}
              dict={dict.resolveMappings}
              triggerLabel={resolveMappingsLabel}
              handle={dialogs.resolveMappings}
            />
          )}
          <ConfirmDialog
            handle={dialogs.completeList}
            title={dict.confirmCompleteList.title}
            description={dict.confirmCompleteList.description}
            cancelLabel={dict.confirmCompleteList.cancel}
            confirmLabel={dict.confirmCompleteList.confirm}
            pendingLabel={dict.confirmCompleteList.confirming}
            variant="default"
            onConfirm={completeList}
          />
        </>
      )}
      <ConfirmDialog
        handle={dialogs.deleteList}
        title={format(dict.confirmDeleteList.title, { name: list.name })}
        description={dict.confirmDeleteList.description}
        cancelLabel={dict.confirmDeleteList.cancel}
        confirmLabel={dict.confirmDeleteList.confirm}
        pendingLabel={dict.confirmDeleteList.confirming}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteShoppingListAction(list.id);
            if (result.error) toast.error(result.error);
          })
        }
      />

      {isActive && (
        <SmartAddBar
          listId={list.id}
          candidates={smartAddCandidates}
          pendingInventoryItemIds={pendingItems.flatMap((item) => (item.inventoryItemId ? [item.inventoryItemId] : []))}
          dict={dict.smartAdd}
          barcodeDict={barcodeDict}
          onAdded={highlightAdded}
        />
      )}

      <div className="flex flex-col gap-2">
        {showCleared ? (
          <ClearedState
            dict={dict}
            onDismiss={() => setClearedDismissed(true)}
            // Only once something was actually bought — a list that was
            // simply emptied out has no trip to finish.
            onDone={isActive && purchasedItems.length > 0 ? completeList : undefined}
            isPending={isPending}
          />
        ) : pendingItems.length === 0 && purchasedItems.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {isActive ? dict.emptyListActive : dict.emptyListOther}
          </p>
        ) : (
          <>
            {/* Shopping mode (AUTO-3): pending items grouped by the linked
                inventory item's category, in a fixed store-walk order —
                see groupPendingItemsByCategory. Purchased items below stay
                a single flat "Purchased" section, unchanged. */}
            {pendingGroups.map((group) => (
              <Fragment key={group.label}>
                <p className="text-xs font-medium uppercase text-muted-foreground">{group.label}</p>
                {group.items.map((item) => (
                  <ShoppingRow
                    key={item.id}
                    item={item}
                    highlighted={highlightedIds.has(item.id)}
                    editable={isActive}
                    isPending={isPending}
                    startTransition={startTransition}
                    inventoryItems={inventoryItems}
                    categories={categories}
                    units={units}
                    dict={dict}
                    numberFormat={numberFormat}
                    autoAddDict={autoAddDict}
                  />
                ))}
              </Fragment>
            ))}
            {purchasedItems.length > 0 && (
              <p className="mt-4 text-xs font-medium uppercase text-muted-foreground">
                {dict.purchased}
              </p>
            )}
            {purchasedItems.map((item) => (
              <ShoppingRow
                key={item.id}
                item={item}
                editable={isActive}
                isPending={isPending}
                startTransition={startTransition}
                inventoryItems={inventoryItems}
                categories={categories}
                units={units}
                dict={dict}
                numberFormat={numberFormat}
                autoAddDict={autoAddDict}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ClearedState({
  dict,
  onDismiss,
  onDone,
  isPending,
}: {
  dict: ShoppingListDict;
  onDismiss: () => void;
  /** AUTO-5: completes the list in one tap, with Undo on the toast. */
  onDone?: () => void;
  isPending: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center gap-1.5 rounded-md border border-dashed p-8 text-center">
      <CheckCheck className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium">{dict.clearedTitle}</p>
      <p className="text-sm text-muted-foreground">{dict.clearedDescription}</p>
      {onDone && (
        <Button className="mt-3" disabled={isPending} onClick={onDone}>
          {dict.doneShopping}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 size-7 text-muted-foreground"
        aria-label={dict.clearedDismissAriaLabel}
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function ShoppingRow({
  item,
  highlighted = false,
  editable,
  isPending,
  startTransition,
  inventoryItems,
  categories,
  units,
  dict,
  numberFormat,
  autoAddDict,
}: {
  item: ShoppingListItemRow;
  highlighted?: boolean;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  inventoryItems: InventoryItemOption[];
  categories: string[];
  units: string[];
  dict: ShoppingListDict;
  numberFormat: Intl.NumberFormat;
  autoAddDict: Dictionary["inventory"]["autoAdd"];
}) {
  const needsMapping = item.inventoryItemId === null;

  // A just-added row scrolls into view if the list is long enough to have
  // hidden it ("nearest" leaves it alone if it's already on screen). New
  // rows always land at the bottom of the pending section, so the sticky add
  // line above never covers them; the phone BottomNav below is cleared by
  // main's scroll-padding in the dashboard layout.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex flex-col gap-1 rounded-md border transition-colors duration-700",
        // AUTO-3: a bigger touch target while the list is ACTIVE (shopping
        // mode) — rows are tapped one-handed, phone in the other hand, so
        // this is when it matters most; a read-only list stays compact.
        editable ? "px-3 py-3" : "px-3 py-2",
        highlighted && "border-primary/50 bg-primary/10",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <label
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3",
            // Stretches the label to the row's full height so tapping
            // anywhere on the row (not just the checkbox glyph) toggles
            // purchased — the label/input pairing (Checkbox is a native
            // <input type="checkbox">) already gives this keyboard and
            // screen-reader semantics for free, no extra handler needed.
            editable && "cursor-pointer self-stretch",
          )}
        >
          <Checkbox
            checked={item.purchased}
            disabled={isPending || !editable}
            className={editable ? "size-5" : undefined}
            onChange={() =>
              startTransition(async () => {
                const result = await togglePurchasedAction(item.id);
                if (result.error) toast.error(result.error);
                else showAutoAddedToast(result.autoAdded, autoAddDict);
              })
            }
          />
          <span
            className={`min-w-0 flex-1 truncate ${item.purchased ? "text-muted-foreground line-through" : ""}`}
            title={`${item.name} × ${item.quantity} ${item.unit}`}
          >
            {item.name} × {item.quantity} {item.unit}
          </span>
          {item.addedAutomatically && (
            <Badge variant="secondary" className="shrink-0">
              {dict.lowStockBadge}
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
            affordance, since the estimate itself is still worth showing. */}
        <div className="flex shrink-0 items-center gap-1">
          {/* AUTO-2b: the in-place fix for a wrong auto-category guess.
              Only on an editable, linked row — an unlinked one has no
              category yet (the mapping flow picks one), and a read-only
              list already shows each row's category as its group header. */}
          {editable && item.category !== null && (
            <CategoryChip
              itemId={item.id}
              itemName={item.name}
              category={item.category}
              categories={categories}
              disabled={isPending}
              dict={dict.categoryChip}
            />
          )}
          <PriceTag item={item} editable={editable} isPending={isPending} startTransition={startTransition} numberFormat={numberFormat} dict={dict} />
          {editable && (
            <>
              <ShoppingItemFormDialog
                mode="edit"
                item={item}
                inventoryItems={inventoryItems}
                categories={categories}
                units={units}
                dict={dict}
                editAriaLabel={format(dict.editItemAriaLabel, { name: item.name })}
                matchItemLabel={dict.matchItemButton}
              />
              <ConfirmDialog
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    disabled={isPending}
                    aria-label={format(dict.deleteItemAriaLabel, { name: item.name })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                }
                title={format(dict.confirmDeleteItem.title, { name: item.name })}
                description={dict.confirmDeleteItem.description}
                cancelLabel={dict.confirmDeleteItem.cancel}
                confirmLabel={dict.confirmDeleteItem.confirm}
                pendingLabel={dict.confirmDeleteItem.confirming}
                onConfirm={() =>
                  startTransition(async () => {
                    const result = await deleteShoppingListItemAction(item.id);
                    if (result.error) toast.error(result.error);
                  })
                }
              />
            </>
          )}
        </div>
      </div>
      {/* GAP-5: the note as a muted second line, indented past the checkbox
          (size-5 + gap-3 on an editable row, size-4 + gap-3 otherwise) so it
          lines up under the item name. Outside the label so tapping it
          doesn't toggle the row, and wrapped rather than truncated — unlike
          the name, the note is the part someone needs to read in the aisle. */}
      {item.note && (
        <p
          className={cn(
            "text-xs break-words whitespace-pre-line text-muted-foreground",
            editable ? "pl-8" : "pl-7",
          )}
        >
          {item.note}
        </p>
      )}
      {/* Persistent, always-visible explanation for as long as the item
          stays unlinked — the "Match item" badge above (in
          ShoppingItemFormDialog) is easy to miss on its own, so this spells
          out the consequence (buying it won't update pantry stock) right
          under the item the moment it's added, rather than only at
          list-completion time (see unresolvedNotice). */}
      {editable && needsMapping && (
        <p className="pl-7 text-xs text-muted-foreground">{dict.needsMappingHint}</p>
      )}
    </div>
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
}: {
  item: ShoppingListItemRow;
  editable: boolean;
  isPending: boolean;
  startTransition: (fn: () => void) => void;
  numberFormat: Intl.NumberFormat;
  dict: ShoppingListDict;
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
        className="shrink-0 rounded px-1 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline tabular-nums"
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
      className="flex shrink-0 items-center gap-1"
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
        className="h-7 w-20 px-2 text-sm"
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
