import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type ShoppingListItemRow = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  purchased: boolean;
  addedAutomatically: boolean;
  // GAP-65: the display name of whoever added the line, only when it is worth
  // showing: the household has 2+ members and the adder is somebody else than
  // the viewer. Resolved on the server so the client never sees user ids; null
  // otherwise (own line, solo household, share-link/automatic/older rows, or
  // an adder who has since left).
  addedByName: string | null;
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
  // The linked InventoryItem's barcode (AUTO-6), null without a link or a
  // stored code. Only ReceiptScanDialog reads it, to match a receipt line
  // that prints an EAN exactly (AUTO-11).
  barcode: string | null;
  // The put-away flow's state (see ShoppingListItem.putAwayAt): a ticked
  // row with no putAwayAt is still on its way home and waits in the
  // PutAwayDialog; priceRecordedAt says a receipt already priced it.
  putAwayAt: Date | null;
  priceRecordedAt: Date | null;
  // When the row was ticked, for the trip summary's duration (UX-81). null
  // for a receipt-applied row or one ticked before the column existed.
  checkedOffAt: Date | null;
  // The linked InventoryItem's current location, the put-away dialog's
  // "stays where it is" placeholder.
  location: string | null;
};

export type InventoryItemOption = { id: string; name: string; category: string; unit?: string };

export type ShoppingListData = {
  id: string;
  name: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  items: ShoppingListItemRow[];
};

export type ShoppingListDict = Dictionary["shoppingList"];
