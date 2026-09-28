// GAP-4: pure helpers behind shopping-list templates (see
// src/app/dashboard/shopping-list/template-actions.ts). Kept dependency-free
// apart from the shared inventory linker so the row-building rules can be
// unit-tested without mocking Prisma.
import type { ItemAliasLike } from "@/lib/item-alias";
import { createInventoryLinker } from "@/lib/shopping/inventory-link";

// Same cap importShoppingListItemsAction puts on a pasted list — a template
// is just a saved paste, and anything bigger than this is far more likely
// a mistake (or abuse) than a real shop.
export const MAX_TEMPLATE_ITEMS = 300;
// Same limit a list name has (createListSchema), since a new list takes
// the template's name.
export const TEMPLATE_NAME_MAX_LENGTH = 120;

export type TemplateItemInput = {
  name: string;
  quantity: number;
  unit: string;
  inventoryItemId: string | null;
};

/**
 * A list's items → the rows a template stores. Every item is kept whether
 * or not it was checked off — saving a finished trip as "Costco run" is the
 * common case, and by then everything is purchased. Duplicate lines (same
 * name and unit, e.g. milk added twice by two people) collapse into one with
 * their quantities summed, so expanding the template later doesn't recreate
 * the accident.
 */
export function buildTemplateItems(
  listItems: { name: string; quantity: number; unit: string; inventoryItemId: string | null }[],
): TemplateItemInput[] {
  const byKey = new Map<string, TemplateItemInput>();
  for (const item of listItems) {
    const name = item.name.trim();
    if (!name) continue;
    const key = `${name.toLowerCase()}\u0000${item.unit}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.inventoryItemId ??= item.inventoryItemId;
    } else {
      byKey.set(key, {
        name,
        quantity: item.quantity,
        unit: item.unit,
        inventoryItemId: item.inventoryItemId,
      });
    }
  }
  return [...byKey.values()];
}

type LinkableInventoryItem = { id: string; name: string; unit: string; lastKnownPrice: number | null };

/**
 * A template's stored rows → ShoppingListItem create data for a fresh list.
 * The saved inventory link wins while that item still exists in the
 * household (it was an explicit choice at the time); otherwise — never
 * linked, or the item was deleted and the link SetNull'd — the row goes
 * through the same exact/alias/fuzzy resolver importShoppingListItemsAction
 * uses,
 * so a template behaves exactly like re-pasting the list would. Price comes
 * from the linked item's lastKnownPrice (AUTO-4), not from the template.
 */
export function resolveTemplateRows(
  templateItems: { name: string; quantity: number; unit: string; inventoryItemId: string | null }[],
  inventoryItems: LinkableInventoryItem[],
  aliases: readonly ItemAliasLike[] = [],
) {
  const byId = new Map(inventoryItems.map((item) => [item.id, item]));
  const linkInventoryItem = createInventoryLinker(inventoryItems, aliases);
  return templateItems.map((item) => {
    const inventoryItem =
      (item.inventoryItemId ? byId.get(item.inventoryItemId) : undefined) ?? linkInventoryItem(item.name);
    return {
      inventoryItemId: inventoryItem?.id ?? null,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit || inventoryItem?.unit || "pcs",
      estimatedPrice: inventoryItem?.lastKnownPrice ?? undefined,
    };
  });
}
