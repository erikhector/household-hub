"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { findOrCreateGroceriesCategory } from "@/app/dashboard/budget/actions";
import { HOUSEHOLD_BASE_CURRENCY } from "@/lib/currency";
import { fetchExchangeRate } from "@/lib/exchange-rate";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { recordListClearedTransition, recordOutOfStockTransition } from "@/lib/notifications";
import { findInventoryMatches } from "@/lib/item-matching";
import { getStockStatus } from "@/lib/stock-status";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";
import { matchSmartAddInventoryItem } from "@/lib/shopping/smart-add-suggestions";
import {
  addToDefaultListOnLowStock,
  getOrCreateDefaultShoppingList,
  revalidateAutoAdded,
  type AutoAddedItem,
} from "@/lib/shopping/default-list";

/**
 * Case-insensitive exact-name lookup only — never creates. Used wherever a
 * shopping-list item should be auto-linked when it obviously already
 * matches something in inventory, but left unlinked (rather than spawning a
 * near-duplicate item) when it doesn't; the user then resolves it via
 * linkShoppingListItemAction/createInventoryItemFromShoppingListItemAction
 * below (see ShoppingItemFormDialog's edit mode).
 */
async function findExactInventoryItem(householdId: string, name: string) {
  return prisma.inventoryItem.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" } },
  });
}

// Only auto-link on a fuzzy match this confident — a typo or a trailing
// size/brand ("Milk 1L" vs "Milk") should still resolve automatically, but
// anything softer is safer left for the user to confirm via the edit dialog.
const AUTO_FUZZY_MATCH_MIN_SCORE = 0.6;

/**
 * Fuzzy fallback for findExactInventoryItem, used only when there's no exact
 * match: auto-links a new shopping-list item to an existing inventory item
 * when exactly one candidate scores above AUTO_FUZZY_MATCH_MIN_SCORE. With
 * two candidates both scoring above it, guessing wrong is worse than leaving
 * the item unlinked, so that case is left alone too.
 */
async function findFuzzyInventoryItem(householdId: string, name: string) {
  const candidates = await prisma.inventoryItem.findMany({ where: { householdId } });
  const matches = findInventoryMatches(name, candidates, { minScore: AUTO_FUZZY_MATCH_MIN_SCORE, limit: 2 });
  return matches.length === 1 ? matches[0] : null;
}

const createListSchema = z.object({
  name: z.string().trim().max(120, "List name must be 120 characters or fewer").optional(),
});

export async function createShoppingListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = createListSchema.safeParse({ name: formData.get("name") || undefined });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const dict = await getDictionary();
  let list;
  try {
    list = await prisma.shoppingList.create({
      data: {
        householdId: household.id,
        name:
          parsed.data.name ||
          `${dict.shoppingList.defaultNamePrefix} — ${new Date().toLocaleDateString()}`,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  redirect(`/dashboard/shopping-list/${list.id}`);
}

export async function archiveShoppingListAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    // Archiving the default list un-defaults it (AUTO-8): unarchive always
    // returns a list to ACTIVE, and an old default coming back alongside the
    // current one would break "at most one ACTIVE default" (and trip the
    // partial unique index). The next auto-add lazily starts a fresh one.
    await prisma.shoppingList.updateMany({
      where: { id: listId, householdId: household.id },
      data: { status: "ARCHIVED", archivedAt: new Date(), isDefault: false },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
  return {};
}

export async function unarchiveShoppingListAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.shoppingList.updateMany({
      where: { id: listId, householdId: household.id, status: "ARCHIVED" },
      data: { status: "ACTIVE", archivedAt: null },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
  return {};
}

export async function deleteShoppingListAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.shoppingList.deleteMany({
      where: { id: listId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  redirect("/dashboard/shopping-list");
}

export async function generateFromLowStockAction(
  listId: string,
): Promise<ActionState & { added?: number }> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return { error: "This list can't be edited right now" };

  let added = 0;
  try {
    const lowStockItems = await prisma.inventoryItem.findMany({
      where: { householdId: household.id },
    });

    const alreadyOnList = await prisma.shoppingListItem.findMany({
      where: { shoppingListId: list.id, purchased: false, inventoryItemId: { not: null } },
      select: { inventoryItemId: true },
    });
    const alreadyOnListIds = new Set(alreadyOnList.map((i) => i.inventoryItemId));

    const toAdd = lowStockItems.filter(
      (item) =>
        getStockStatus(item.quantity, item.lowStockThreshold) !== "in" &&
        !alreadyOnListIds.has(item.id),
    );

    if (toAdd.length > 0) {
      await prisma.shoppingListItem.createMany({
        data: toAdd.map((item) => ({
          shoppingListId: list.id,
          inventoryItemId: item.id,
          name: item.name,
          quantity: Math.max(1, item.lowStockThreshold - item.quantity),
          unit: item.unit,
          addedAutomatically: true,
          // AUTO-4: same last-known-price default as the ad-hoc add path.
          estimatedPrice: item.lastKnownPrice ?? undefined,
        })),
      });
      added = toAdd.length;
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  return { added };
}

const addItemSchema = z.object({
  listId: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
  quantity: z.coerce.number().min(0.01, "Quantity must be greater than 0"),
  unit: z.string().trim().max(20, "Unit must be 20 characters or fewer").optional(),
});

/**
 * Shared by addAdHocItemAction and quickAddShoppingListItemAction below —
 * both just create a shopping-list item ad hoc (auto-linking to inventory
 * when the name matches exactly, or — absent an exact match — via a single
 * confident fuzzy match, see findFuzzyInventoryItem above), they just differ
 * in where the input comes from and what they hand back to the caller.
 *
 * `newItemDetails`, when given, lets the caller (ReceiptScanDialog's "add as
 * new item" shortcut) specify the category/unit a brand-new InventoryItem
 * should get when no exact-name match exists — OCR'd names are unreliable
 * enough that auto-mapping shouldn't silently guess those, so the fuzzy
 * fallback is skipped in that case too. addAdHocItemAction doesn't pass
 * this, so it keeps its old behavior of leaving inventoryItemId null when
 * neither match resolves.
 */
async function createAdHocShoppingListItem(
  householdId: string,
  listId: string,
  name: string,
  quantity: number,
  unit: string,
  newItemDetails?: { category: string; unit: string },
) {
  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId, status: "ACTIVE" },
  });
  if (!list) return { error: "This list can't be edited right now" } as const;

  let inventoryItem = await findExactInventoryItem(householdId, name);
  if (!inventoryItem && newItemDetails) {
    // Blank → guessed from the name (AUTO-2) rather than dumped in
    // "Uncategorized"; same for every create path below. A guess that also
    // misses schedules AUTO-2b(a)'s AI fallback, a no-op unless a provider
    // key is configured.
    const guessed = newItemDetails.category || (await createCategoryResolver(householdId)(name));
    inventoryItem = await prisma.inventoryItem.create({
      data: {
        householdId,
        name,
        category: guessed || "Uncategorized",
        unit: newItemDetails.unit || "pcs",
        quantity: 0,
        lowStockThreshold: 0,
      },
    });
    if (!guessed) scheduleAiCategoryFallback(householdId, [name]);
  } else if (!inventoryItem) {
    inventoryItem = await findFuzzyInventoryItem(householdId, name);
  }

  const item = await prisma.shoppingListItem.create({
    data: {
      shoppingListId: list.id,
      inventoryItemId: inventoryItem?.id ?? null,
      name,
      quantity,
      unit: unit || inventoryItem?.unit || "pcs",
      // AUTO-4: default the estimate from the linked item's last recorded
      // price, so the running total (and the eventual Groceries expense)
      // isn't 0 just because nothing's been priced yet this trip.
      // Per-unit, unmultiplied by quantity — matches how
      // completeShoppingListAction sums estimatedPrice below, so a 2-pack
      // priced at "24" books as 24, not 48. This only ever runs at creation;
      // once the user corrects a row's price, nothing here touches it again
      // (Guardrails: corrections stick).
      estimatedPrice: inventoryItem?.lastKnownPrice ?? undefined,
    },
  });
  // Only surfaced to the caller when the link just happened automatically
  // (not for a brand-new item the caller explicitly asked to create) — lets
  // the UI show a quick "linked to X" confirmation instead of leaving a
  // successful auto-link silent.
  const autoLinkedName = newItemDetails ? null : (inventoryItem?.name ?? null);
  return { list, item, autoLinkedName } as const;
}

export async function addAdHocItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState & { autoLinkedName?: string; needsMapping?: boolean }> {
  const { household } = await requireHousehold();

  const parsed = addItemSchema.safeParse({
    listId: formData.get("listId"),
    name: formData.get("name"),
    quantity: formData.get("quantity") || 1,
    unit: formData.get("unit") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const result = await createAdHocShoppingListItem(
      household.id,
      parsed.data.listId,
      parsed.data.name,
      parsed.data.quantity,
      parsed.data.unit ?? "",
    );
    if ("error" in result) return { error: result.error };
    revalidatePath(`/dashboard/shopping-list/${result.list.id}`);
    // Lets the add form surface the "needs mapping" explanation the moment
    // the item lands, instead of only via the persistent row badge — this
    // just reads back the link createAdHocShoppingListItem already decided,
    // it doesn't change what that decision is.
    return {
      autoLinkedName: result.autoLinkedName ?? undefined,
      needsMapping: result.item.inventoryItemId === null,
    };
  } catch (error) {
    return toFriendlyError(error);
  }
}

const quickAddSchema = addItemSchema.extend({
  category: z.string().trim().max(60, "Category must be 60 characters or fewer").optional(),
  unit: z.string().trim().max(20, "Unit must be 20 characters or fewer").optional(),
});

/**
 * Adds a new shopping-list item on the fly and hands back its id/name —
 * used by ReceiptScanDialog when a scanned line doesn't match anything
 * already on the list, so the user can create a match target for it without
 * leaving the scan review flow. `newItemDetails` is only used when that
 * creates a brand-new InventoryItem (see createAdHocShoppingListItem above).
 */
export async function quickAddShoppingListItemAction(
  listId: string,
  name: string,
  quantity: number,
  newItemDetails?: { category: string; unit: string },
): Promise<ActionState & { item?: { id: string; name: string } }> {
  const { household } = await requireHousehold();

  const parsed = quickAddSchema.safeParse({
    listId,
    name,
    quantity: quantity || 1,
    category: newItemDetails?.category,
    unit: newItemDetails?.unit,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    const result = await createAdHocShoppingListItem(
      household.id,
      parsed.data.listId,
      parsed.data.name,
      parsed.data.quantity,
      parsed.data.unit ?? "",
      newItemDetails ? { category: parsed.data.category ?? "", unit: parsed.data.unit ?? "" } : undefined,
    );
    if ("error" in result) return { error: result.error };
    revalidatePath(`/dashboard/shopping-list/${result.list.id}`);
    return { item: { id: result.item.id, name: result.item.name } };
  } catch (error) {
    return toFriendlyError(error);
  }
}

const updateItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
  quantity: z.coerce.number().min(0.01, "Quantity must be greater than 0"),
  unit: z.string().trim().max(20, "Unit must be 20 characters or fewer").optional(),
});

/**
 * Edits a shopping-list item's own fields (name/quantity/unit). Previously
 * the only way to fix a typo or change a quantity was delete-and-re-add,
 * which lost addedAutomatically/estimatedPrice/the inventory link in the
 * process. Scoped the same way as deleteShoppingListItemAction: household
 * ownership only, no ACTIVE-list check (the UI already only renders the
 * edit control for active lists).
 */
export async function updateShoppingListItemAction(
  itemId: string,
  data: { name: string; quantity: number; unit: string },
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    select: { id: true, shoppingListId: true },
  });
  if (!item) return { error: "Item not found" };

  const parsed = updateItemSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    await prisma.shoppingListItem.update({
      where: { id: item.id },
      data: {
        name: parsed.data.name,
        quantity: parsed.data.quantity,
        unit: parsed.data.unit || "pcs",
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  return {};
}

const updateItemPriceSchema = z.object({
  price: z.coerce.number().min(0, "Price can't be negative").max(1_000_000, "Price is too large"),
});

/**
 * Corrects a shopping-list item's estimatedPrice (AUTO-4) — what the row's
 * tap-to-edit "≈ price" saves. A plain field update, same shape as
 * updateShoppingListItemAction just for one field, so the two other places
 * that ever set estimatedPrice (the create-path defaults above, and a
 * receipt scan/registration's actual price) never need to touch this. Once
 * the user corrects a row here, nothing else in this file overwrites it
 * again — the create-path defaults only ever run once, at creation.
 */
export async function updateShoppingListItemPriceAction(
  itemId: string,
  price: number,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    select: { id: true, shoppingListId: true },
  });
  if (!item) return { error: "Item not found" };

  const parsed = updateItemPriceSchema.safeParse({ price });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    await prisma.shoppingListItem.update({
      where: { id: item.id },
      data: { estimatedPrice: parsed.data.price },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  return {};
}

/**
 * Links a shopping-list item that didn't resolve to an exact inventory-item
 * match (see findExactInventoryItem above) to an existing inventory item the
 * user picked themselves — the "choose an existing item" half of the
 * mapping dialog (ShoppingItemFormDialog's edit mode).
 */
export async function linkShoppingListItemAction(
  itemId: string,
  inventoryItemId: string,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
  });
  if (!item) return { error: "Item not found" };

  const inventoryItem = await prisma.inventoryItem.findFirst({
    where: { id: inventoryItemId, householdId: household.id },
  });
  if (!inventoryItem) return { error: "Inventory item not found" };

  await prisma.shoppingListItem.update({
    where: { id: item.id },
    data: { inventoryItemId: inventoryItem.id },
  });

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  return {};
}

/**
 * Creates a brand-new inventory item from a shopping-list item's name and
 * links it — the explicit "create new item" half of the mapping dialog,
 * replacing the old implicit auto-create in findOrCreateInventoryItem.
 */
export async function createInventoryItemFromShoppingListItemAction(
  itemId: string,
  category: string,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
  });
  if (!item) return { error: "Item not found" };

  const trimmedCategory = category.trim();
  if (trimmedCategory.length > 60) {
    return { error: "Category must be 60 characters or fewer" };
  }

  try {
    const guessed = trimmedCategory || (await createCategoryResolver(household.id)(item.name));
    const inventoryItem = await prisma.inventoryItem.create({
      data: {
        householdId: household.id,
        name: item.name,
        category: guessed || "Uncategorized",
        quantity: 0,
        lowStockThreshold: 0,
      },
    });
    if (!guessed) scheduleAiCategoryFallback(household.id, [item.name]);

    await prisma.shoppingListItem.update({
      where: { id: item.id },
      data: { inventoryItemId: inventoryItem.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  return {};
}

/**
 * Removes a shopping-list item's inventory link — the inverse of
 * linkShoppingListItemAction/createInventoryItemFromShoppingListItemAction,
 * for when an item was mapped to the wrong inventory item and needs to go
 * back to "needs mapping" rather than being deleted and re-added.
 */
export async function unlinkShoppingListItemAction(itemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    select: { id: true, shoppingListId: true },
  });
  if (!item) return { error: "Item not found" };

  await prisma.shoppingListItem.update({
    where: { id: item.id },
    data: { inventoryItemId: null },
  });

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  return {};
}

const importItemsSchema = z.object({
  listId: z.string().min(1),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        quantity: z.coerce.number().min(0.01).max(100000),
        unit: z.string().trim().max(20).optional(),
      }),
    )
    .min(1)
    .max(300),
});

/**
 * Bulk counterpart to createAdHocShoppingListItem, for ImportListDialog
 * (paste text or upload a CSV — see parsePastedList/parseImportCsv, shared
 * with the inventory bulk-paste flow) — e.g. a list pasted in from another
 * app's own share/export text, such as ICA's. Every row gets the same
 * exact/fuzzy inventory auto-link createAdHocShoppingListItem gives a single
 * ad-hoc item, just resolved against one household-wide inventory fetch
 * instead of a query per row, since a pasted list can run to dozens of
 * lines. Never auto-creates a new InventoryItem — an unlinked row is left
 * "needs mapping", resolvable afterward the same way any other unlinked item
 * is (ShoppingItemFormDialog's edit mode, or ResolveMappingsDialog once
 * there are enough of them).
 */
export async function importShoppingListItemsAction(
  listId: string,
  items: { name: string; quantity: number; unit?: string }[],
): Promise<ActionState & { added?: number }> {
  const { household } = await requireHousehold();

  const parsed = importItemsSchema.safeParse({ listId, items });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return { error: "This list can't be edited right now" };

  let added = 0;
  try {
    const inventoryItems = await prisma.inventoryItem.findMany({ where: { householdId: household.id } });
    const byExactName = new Map(inventoryItems.map((item) => [item.name.trim().toLowerCase(), item]));

    const rows = parsed.data.items.map((item) => {
      let inventoryItem = byExactName.get(item.name.trim().toLowerCase()) ?? null;
      if (!inventoryItem) {
        const matches = findInventoryMatches(item.name, inventoryItems, {
          minScore: AUTO_FUZZY_MATCH_MIN_SCORE,
          limit: 2,
        });
        inventoryItem = matches.length === 1 ? matches[0] : null;
      }
      return {
        shoppingListId: list.id,
        inventoryItemId: inventoryItem?.id ?? null,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit || inventoryItem?.unit || "pcs",
        // AUTO-4: same last-known-price default as the ad-hoc add path.
        estimatedPrice: inventoryItem?.lastKnownPrice ?? undefined,
      };
    });

    await prisma.shoppingListItem.createMany({ data: rows });
    added = rows.length;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  return { added };
}

const smartAddSchema = z.object({
  listId: z.string().min(1),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        quantity: z.coerce.number().min(0.01).max(100000),
        unit: z.string().trim().max(20).optional(),
        inventoryItemId: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .max(50),
});

/**
 * The commit path behind the shopping list's smart add line (AUTO-1,
 * SmartAddBar): one or more rows, already split by parseSmartAddInput
 * (src/lib/shopping/smart-add-suggestions.ts — the same path a future voice
 * input is meant to feed), added in one round trip. Unlike
 * importShoppingListItemsAction, every row ends up linked, since this is the
 * everyday "add milk" path and an unlinked row is a chore left for later:
 *
 *   1. a picked suggestion's `inventoryItemId` (only if it's this
 *      household's — anything else is ignored, not trusted);
 *   2. otherwise matchSmartAddInventoryItem's pick — an exact (normalized)
 *      name, the one item containing every typed word ("mjölk" →
 *      "Mjölk 3%"), or a single confident findInventoryMatches hit;
 *   3. otherwise a new InventoryItem (quantity 0, category guessed by AUTO-2's
 *      createCategoryResolver), shared by any later row in the same batch
 *      with the same case-insensitive name.
 *
 * Rows whose item is already pending on this list — or earlier in the same
 * batch — are skipped and reported back in `alreadyOnList` rather than
 * added as a duplicate or bumping the existing row's quantity, the same
 * dedupe generateFromLowStockAction does. `addedIds` lets the list briefly
 * highlight the new rows.
 */
export async function smartAddShoppingListItemsAction(
  listId: string,
  items: { name: string; quantity: number; unit?: string; inventoryItemId?: string }[],
): Promise<ActionState & { addedIds?: string[]; alreadyOnList?: string[] }> {
  const { household } = await requireHousehold();

  const parsed = smartAddSchema.safeParse({ listId, items });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return { error: "This list can't be edited right now" };

  const addedIds: string[] = [];
  const alreadyOnList: string[] = [];
  let createdInventory = false;
  try {
    const [inventoryItems, pending] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { householdId: household.id } }),
      prisma.shoppingListItem.findMany({
        where: { shoppingListId: list.id, purchased: false, inventoryItemId: { not: null } },
        select: { inventoryItemId: true },
      }),
    ]);
    const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
    const onList = new Set(pending.map((item) => item.inventoryItemId));

    // Planned up front, outside the transaction, so category guesses (which
    // may query) don't hold it open — same split as
    // resolveShoppingListMappingsAction. A new item is keyed by its
    // lowercased name until the transaction gives it an id.
    const resolveCategory = createCategoryResolver(household.id, inventoryItems);
    const newItems = new Map<string, { name: string; unit: string; category: string }>();
    const rows: {
      name: string;
      quantity: number;
      unit: string;
      inventoryItemId?: string;
      newKey?: string;
      estimatedPrice?: number;
    }[] = [];
    // AUTO-2b(a): every new item whose guess misses here is a candidate for
    // the AI fallback, scheduled once (batched) after the transaction below
    // actually creates the rows.
    const aiCandidates: string[] = [];

    for (const row of parsed.data.items) {
      let existing = row.inventoryItemId ? inventoryById.get(row.inventoryItemId) : undefined;
      existing ??= matchSmartAddInventoryItem(row.name, inventoryItems) ?? undefined;

      if (existing) {
        if (onList.has(existing.id)) {
          alreadyOnList.push(existing.name);
          continue;
        }
        onList.add(existing.id);
        rows.push({
          name: row.name,
          quantity: row.quantity,
          unit: row.unit || existing.unit || "pcs",
          inventoryItemId: existing.id,
          // AUTO-4: same last-known-price default as the other create
          // paths — a brand-new item created just below has no price yet,
          // so this only ever fires for the "existing" branch.
          estimatedPrice: existing.lastKnownPrice ?? undefined,
        });
        continue;
      }

      const newKey = row.name.toLowerCase();
      if (newItems.has(newKey)) {
        alreadyOnList.push(newItems.get(newKey)!.name);
        continue;
      }
      const unit = row.unit || "pcs";
      const guessed = await resolveCategory(row.name);
      if (!guessed) aiCandidates.push(row.name);
      newItems.set(newKey, { name: row.name, unit, category: guessed || "Uncategorized" });
      rows.push({ name: row.name, quantity: row.quantity, unit, newKey });
    }

    if (rows.length > 0) {
      await prisma.$transaction(async (tx) => {
        const createdIds = new Map<string, string>();
        for (const [key, item] of newItems) {
          const created = await tx.inventoryItem.create({
            data: {
              householdId: household.id,
              name: item.name,
              category: item.category,
              unit: item.unit,
              quantity: 0,
              lowStockThreshold: 0,
            },
          });
          createdIds.set(key, created.id);
        }
        for (const row of rows) {
          const created = await tx.shoppingListItem.create({
            data: {
              shoppingListId: list.id,
              inventoryItemId: row.inventoryItemId ?? createdIds.get(row.newKey!) ?? null,
              name: row.name,
              quantity: row.quantity,
              unit: row.unit,
              estimatedPrice: row.estimatedPrice,
            },
          });
          addedIds.push(created.id);
        }
      });
      createdInventory = newItems.size > 0;
      if (aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, aiCandidates);
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  if (addedIds.length > 0) revalidatePath(`/dashboard/shopping-list/${list.id}`);
  if (createdInventory) revalidatePath("/dashboard/inventory");
  return { addedIds, alreadyOnList };
}

export type MappingResolution =
  | { itemId: string; kind: "existing"; inventoryItemId: string }
  | { itemId: string; kind: "new"; category: string };

/**
 * Resolves several unlinked shopping-list items' inventory mappings in one
 * round trip — the batch counterpart to linkShoppingListItemAction /
 * createInventoryItemFromShoppingListItemAction above, for the "resolve N
 * items" review dialog (ResolveMappingsDialog) that appears once a list has
 * enough unmapped items that going through them one at a time would be
 * tedious. Silently skips any resolution whose item doesn't belong to the
 * caller's household, is already linked, or names an inventory item outside
 * the household — rather than failing the whole batch over one stale/bad
 * row — and reports back how many actually resolved.
 */
export async function resolveShoppingListMappingsAction(
  resolutions: MappingResolution[],
): Promise<ActionState & { resolvedCount?: number }> {
  const { household } = await requireHousehold();
  if (resolutions.length === 0) return { resolvedCount: 0 };

  const items = await prisma.shoppingListItem.findMany({
    where: { id: { in: resolutions.map((r) => r.itemId) }, shoppingList: { householdId: household.id } },
  });
  const itemsById = new Map(items.map((item) => [item.id, item]));

  let shoppingListId: string | null = null;
  let resolvedCount = 0;

  try {
    // Categories for "new" rows left blank are guessed up front (AUTO-2) so
    // the transaction below stays writes-only.
    const resolveCategory = createCategoryResolver(household.id);
    const guessedCategories = new Map<string, string>();
    for (const resolution of resolutions) {
      const item = itemsById.get(resolution.itemId);
      if (resolution.kind !== "new" || !item || item.inventoryItemId !== null || resolution.category.trim()) continue;
      const guess = await resolveCategory(item.name);
      if (guess) guessedCategories.set(item.id, guess);
    }
    // AUTO-2b(a): "new" rows whose category is still blank after the guess
    // above are AI fallback candidates, scheduled (batched) once the
    // transaction below actually creates them.
    const aiCandidates = resolutions
      .map((resolution) => {
        const item = itemsById.get(resolution.itemId);
        if (resolution.kind !== "new" || !item || item.inventoryItemId !== null) return null;
        return resolution.category.trim() || guessedCategories.has(item.id) ? null : item.name;
      })
      .filter((name): name is string => name !== null);

    // Per-row writes are parallelized with Promise.all rather than a
    // sequential for-await loop (SCALE-C) — the rows being written already
    // don't overlap (each resolution targets its own shoppingListItem/
    // inventoryItem), so this only cuts wall-clock transaction hold time,
    // it doesn't change which rows end up written. Results are collected
    // and folded into shoppingListId/resolvedCount afterward, in the same
    // input order the old loop used, so both end up identical to before —
    // including shoppingListId being set for an attempted-but-not-found
    // "existing" resolution even though it didn't increment resolvedCount.
    await prisma.$transaction(async (tx) => {
      const results = await Promise.all(
        resolutions.map(async (resolution) => {
          const item = itemsById.get(resolution.itemId);
          if (!item || item.inventoryItemId !== null) return null;

          if (resolution.kind === "existing") {
            const inventoryItem = await tx.inventoryItem.findFirst({
              where: { id: resolution.inventoryItemId, householdId: household.id },
            });
            if (!inventoryItem) return { shoppingListId: item.shoppingListId, resolved: false };
            await tx.shoppingListItem.update({
              where: { id: item.id },
              data: { inventoryItemId: inventoryItem.id },
            });
            return { shoppingListId: item.shoppingListId, resolved: true };
          }

          const trimmedCategory = resolution.category.trim().slice(0, 60);
          const inventoryItem = await tx.inventoryItem.create({
            data: {
              householdId: household.id,
              name: item.name,
              category: trimmedCategory || guessedCategories.get(item.id) || "Uncategorized",
              quantity: 0,
              lowStockThreshold: 0,
            },
          });
          await tx.shoppingListItem.update({
            where: { id: item.id },
            data: { inventoryItemId: inventoryItem.id },
          });
          return { shoppingListId: item.shoppingListId, resolved: true };
        }),
      );

      for (const result of results) {
        if (!result) continue;
        shoppingListId = result.shoppingListId;
        if (result.resolved) resolvedCount++;
      }
    });
    if (aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, aiCandidates);
  } catch (error) {
    return toFriendlyError(error);
  }

  if (shoppingListId) {
    revalidatePath(`/dashboard/shopping-list/${shoppingListId}`);
    revalidatePath("/dashboard/inventory");
  }
  return { resolvedCount };
}

export async function togglePurchasedAction(
  itemId: string,
): Promise<ActionState & { autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    include: { inventoryItem: true },
  });
  if (!item) return { error: "Item not found" };

  const nextPurchased = !item.purchased;

  let autoAdded: AutoAddedItem | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.shoppingListItem.update({
        where: { id: item.id },
        data: { purchased: nextPurchased },
      });

      if (item.inventoryItem) {
        const delta = nextPurchased ? item.quantity : -item.quantity;
        const nextQuantity = Math.max(0, item.inventoryItem.quantity + delta);
        // AUTO-4: this purchase's price becomes the item's new
        // lastKnownPrice — folded into the same quantity update rather than
        // a second write, and only set when a price was actually recorded
        // (marking something purchased with no price, or un-marking it,
        // leaves the last known price untouched).
        const priceToRecord = nextPurchased ? item.estimatedPrice : null;
        await tx.inventoryItem.update({
          where: { id: item.inventoryItem.id },
          data:
            priceToRecord != null
              ? { quantity: nextQuantity, lastKnownPrice: priceToRecord }
              : { quantity: nextQuantity },
        });
        await recordOutOfStockTransition(
          tx,
          household.id,
          item.inventoryItem.id,
          item.inventoryItem.quantity,
          nextQuantity,
          userId,
        );
        // Only un-checking can decrease stock here. Un-checking a row on the
        // default list itself is a no-op: that same row is pending again,
        // which is exactly what the dedupe looks for.
        autoAdded = await addToDefaultListOnLowStock(
          tx,
          household.id,
          item.inventoryItem.id,
          item.inventoryItem.quantity,
          nextQuantity,
        );

        if (priceToRecord != null) {
          await tx.priceHistory.create({
            data: { inventoryItemId: item.inventoryItem.id, price: priceToRecord },
          });
        }
      }

      if (nextPurchased) {
        const remainingPending = await tx.shoppingListItem.count({
          where: { shoppingListId: item.shoppingListId, purchased: false },
        });
        await recordListClearedTransition(tx, household.id, item.shoppingListId, remainingPending + 1, remainingPending, userId);
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded([autoAdded]);
  return autoAdded ? { autoAdded: [autoAdded] } : {};
}

export type ReceiptScanMatch = { shoppingListItemId: string; price: number };

/**
 * Applies a reviewed receipt scan (see ReceiptScanDialog) to a shopping
 * list: for every matched line, converts its price to
 * HOUSEHOLD_BASE_CURRENCY if the receipt was in a different currency, sets
 * that as the item's estimatedPrice, and marks it purchased — mirroring
 * togglePurchasedAction's inventory-quantity/PriceHistory side effects, just
 * batched across every scanned line in one transaction instead of one
 * checkbox at a time.
 *
 * Only ever receives the OCR'd text/numbers the client already extracted
 * (see receipt-parsing.ts) — the receipt photo itself never reaches the
 * server, same privacy stance as the barcode scanner
 * (src/components/shared/barcode-scanner.tsx).
 */
export async function applyReceiptScanAction(
  listId: string,
  currency: string,
  matches: ReceiptScanMatch[],
): Promise<ActionState & { itemsUpdated?: number; totalAmount?: number }> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
    include: { items: { include: { inventoryItem: true } } },
  });
  if (!list) return { error: "This list can't be edited right now" };

  const itemsById = new Map(list.items.map((item) => [item.id, item]));
  // Belt-and-braces de-dupe: if the client ever sent the same shopping-list
  // item twice (e.g. two OCR'd lines both matched to it), only the first is
  // applied — otherwise it would be double-counted into inventory and
  // PriceHistory below.
  const seen = new Set<string>();
  const validMatches = matches.filter((m) => {
    if (seen.has(m.shoppingListItemId)) return false;
    const item = itemsById.get(m.shoppingListItemId);
    if (!item || item.purchased || !Number.isFinite(m.price) || m.price <= 0) return false;
    seen.add(m.shoppingListItemId);
    return true;
  });
  if (validMatches.length === 0) return { error: "Nothing to apply" };

  let rate = 1;
  if (currency.toUpperCase() !== HOUSEHOLD_BASE_CURRENCY) {
    const fetched = await fetchExchangeRate(currency, HOUSEHOLD_BASE_CURRENCY);
    if (fetched === null) {
      return {
        error: `Couldn't fetch a ${currency} → ${HOUSEHOLD_BASE_CURRENCY} exchange rate right now. Try again shortly.`,
      };
    }
    rate = fetched;
  }

  let totalAmount = 0;

  // Per-row writes are parallelized with Promise.all rather than a
  // sequential for-await loop (SCALE-C) — each match targets its own
  // shoppingListItem/inventoryItem, so this only cuts wall-clock
  // transaction hold time. totalAmount's accumulation stays deterministic:
  // every map callback runs its synchronous prefix (computing
  // convertedPrice and adding it to totalAmount) before its first await,
  // so the additions happen in validMatches order exactly as the old loop
  // did, before any of the awaited writes resolve.
  await prisma.$transaction(async (tx) => {
    await Promise.all(
      validMatches.map(async (match) => {
        const item = itemsById.get(match.shoppingListItemId)!;
        const convertedPrice = Math.round(match.price * rate * 100) / 100;
        totalAmount += convertedPrice;

        await tx.shoppingListItem.update({
          where: { id: item.id },
          data: { estimatedPrice: convertedPrice, purchased: true },
        });

        if (item.inventoryItem) {
          // AUTO-4: a scanned receipt price is as real as it gets, so it
          // becomes the item's new lastKnownPrice — folded into the same
          // quantity update rather than a second write.
          await tx.inventoryItem.update({
            where: { id: item.inventoryItem.id },
            data: { quantity: item.inventoryItem.quantity + item.quantity, lastKnownPrice: convertedPrice },
          });
          await tx.priceHistory.create({
            data: { inventoryItemId: item.inventoryItem.id, price: convertedPrice },
          });
        }
      }),
    );
  });

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/budget");

  return { itemsUpdated: validMatches.length, totalAmount };
}

export type ReceiptRegistrationItem = {
  name: string;
  quantity: number;
  unit?: string;
  price: number;
  /** Inventory item the user explicitly matched this line to in the review
   * step (RegisterReceiptDialog's "Use existing" mode) — takes priority
   * over the exact/fuzzy auto-match fallback below. */
  inventoryItemId?: string;
  /** Set (possibly to "") when the user explicitly chose "Create new" for
   * this line, so a fresh InventoryItem is created with this category
   * instead of falling back to a fuzzy auto-match. */
  newItemCategory?: string;
};

const registerReceiptItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().min(0.01),
  unit: z.string().trim().max(20).optional(),
  price: z.coerce.number().min(0.01),
  inventoryItemId: z.string().trim().min(1).optional(),
  newItemCategory: z.string().trim().max(60).optional(),
});

const registerReceiptSchema = z.object({
  name: z.string().trim().max(120).optional(),
  currency: z.string().trim().min(1).max(10),
  items: z.array(registerReceiptItemSchema).min(1, "Add at least one item"),
});

/**
 * "Register receipt" — the alternative entry point to ReceiptScanDialog /
 * applyReceiptScanAction above for when there's no shopping list yet to
 * match scanned lines against: building that list by hand first, just to
 * immediately scan a receipt against it, is the tedious round trip this
 * skips. Instead this creates the list from the receipt itself, one already-
 * purchased item per reviewed line, and completes it in the same call — the
 * same end state completeShoppingListAction reaches (a logged Groceries
 * expense, an unresolved-items count) but reached in one step instead of
 * create → add → check off → complete.
 *
 * Each line's inventory link follows what the user chose in
 * RegisterReceiptDialog's review step (mirroring ResolveMappingsDialog's
 * existing/new toggle): `inventoryItemId` when they picked a suggested or
 * manually-chosen existing item, `newItemCategory` when they chose to
 * create a new one (created here, same shape as createAdHocShoppingListItem's
 * newItemDetails path). Neither set falls back to the old silent exact/fuzzy
 * auto-match, kept only for callers that predate the review step.
 *
 * Inventory matches/creates are resolved up front (before the transaction
 * below, which only performs writes). Quantity deltas are accumulated per
 * inventory item first so two receipt lines naming the same item don't
 * clobber each other by both computing their new quantity from the same
 * stale snapshot.
 */
export async function registerReceiptAction(
  listName: string | undefined,
  currency: string,
  items: ReceiptRegistrationItem[],
): Promise<
  ActionState & {
    listId?: string;
    itemsAdded?: number;
    totalAmount?: number;
    expenseLoggedMessage?: string;
    unresolvedNotice?: string;
  }
> {
  const { household, userId } = await requireHousehold();
  const dict = await getDictionary();

  const parsed = registerReceiptSchema.safeParse({ name: listName, currency, items });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const upperCurrency = parsed.data.currency.toUpperCase();
  let rate = 1;
  if (upperCurrency !== HOUSEHOLD_BASE_CURRENCY) {
    const fetched = await fetchExchangeRate(upperCurrency, HOUSEHOLD_BASE_CURRENCY);
    if (fetched === null) {
      return {
        error: `Couldn't fetch a ${upperCurrency} → ${HOUSEHOLD_BASE_CURRENCY} exchange rate right now. Try again shortly.`,
      };
    }
    rate = fetched;
  }

  const finalListName =
    parsed.data.name ||
    `${dict.shoppingList.registerReceipt.namePlaceholderPrefix} — ${new Date().toLocaleDateString()}`;

  const preparedItems: {
    name: string;
    quantity: number;
    unit: string;
    convertedPrice: number;
    inventoryItem: { id: string; quantity: number; unit: string } | null;
  }[] = [];
  let totalAmount = 0;
  let unresolvedCount = 0;
  const resolveCategory = createCategoryResolver(household.id);
  // AUTO-2b(a): every "add as new item" line whose guess misses is a
  // candidate for the AI fallback, scheduled (batched) once every line has
  // been processed below.
  const aiCandidates: string[] = [];

  for (const line of parsed.data.items) {
    let inventoryItem: { id: string; quantity: number; unit: string } | null = null;

    if (line.inventoryItemId) {
      inventoryItem = await prisma.inventoryItem.findFirst({
        where: { id: line.inventoryItemId, householdId: household.id },
      });
    } else if (line.newItemCategory !== undefined) {
      const guessed = line.newItemCategory || (await resolveCategory(line.name));
      if (!guessed) aiCandidates.push(line.name);
      inventoryItem = await prisma.inventoryItem.create({
        data: {
          householdId: household.id,
          name: line.name,
          category: guessed || "Uncategorized",
          unit: line.unit || "pcs",
          quantity: 0,
          lowStockThreshold: 0,
        },
      });
    } else {
      inventoryItem = await findExactInventoryItem(household.id, line.name);
      if (!inventoryItem) inventoryItem = await findFuzzyInventoryItem(household.id, line.name);
    }
    if (!inventoryItem) unresolvedCount++;

    const convertedPrice = Math.round(line.price * rate * 100) / 100;
    totalAmount += convertedPrice;

    preparedItems.push({
      name: line.name,
      quantity: line.quantity,
      unit: line.unit || inventoryItem?.unit || "pcs",
      convertedPrice,
      inventoryItem,
    });
  }
  // Every inventory item above is already committed independently of the
  // transaction below, so scheduling the fallback here doesn't need to wait
  // on (or be undone by) anything that happens afterward.
  if (aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, aiCandidates);

  // AUTO-4: also tracks each inventory item's most recently seen receipt
  // price so it can become lastKnownPrice below — a receipt line's price is
  // as real as it gets. When two lines on the same receipt name the same
  // item at different prices (a discount line, a typo'd re-entry), the last
  // one in the list wins, same as it would if they'd been two separate
  // purchases.
  const inventoryDeltas = new Map<string, { currentQuantity: number; delta: number; lastKnownPrice: number }>();
  for (const item of preparedItems) {
    if (!item.inventoryItem) continue;
    const existing = inventoryDeltas.get(item.inventoryItem.id) ?? {
      currentQuantity: item.inventoryItem.quantity,
      delta: 0,
      lastKnownPrice: item.convertedPrice,
    };
    existing.delta += item.quantity;
    existing.lastKnownPrice = item.convertedPrice;
    inventoryDeltas.set(item.inventoryItem.id, existing);
  }

  let listId: string;
  try {
    listId = await prisma.$transaction(async (tx) => {
      const list = await tx.shoppingList.create({
        data: {
          householdId: household.id,
          name: finalListName,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });

      for (const item of preparedItems) {
        await tx.shoppingListItem.create({
          data: {
            shoppingListId: list.id,
            inventoryItemId: item.inventoryItem?.id ?? null,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            purchased: true,
            estimatedPrice: item.convertedPrice,
          },
        });

        if (item.inventoryItem) {
          await tx.priceHistory.create({
            data: { inventoryItemId: item.inventoryItem.id, price: item.convertedPrice },
          });
        }
      }

      for (const [inventoryItemId, { currentQuantity, delta, lastKnownPrice }] of inventoryDeltas) {
        await tx.inventoryItem.update({
          where: { id: inventoryItemId },
          data: { quantity: currentQuantity + delta, lastKnownPrice },
        });
      }

      return list.id;
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  let expenseLoggedMessage: string | undefined;
  if (totalAmount > 0) {
    const category = await findOrCreateGroceriesCategory(household.id);
    await prisma.transaction.create({
      data: {
        householdId: household.id,
        categoryId: category.id,
        amount: totalAmount,
        type: "EXPENSE",
        description: format(dict.shoppingList.expenseDescription, { name: finalListName }),
        date: new Date(),
        createdByUserId: userId,
      },
    });

    const locale = await getLocale();
    const amountLabel = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(totalAmount);
    expenseLoggedMessage = format(dict.shoppingList.expenseLogged, { amount: amountLabel });
  }

  const unresolvedNotice =
    unresolvedCount > 0
      ? format(plural(unresolvedCount, dict.shoppingList.unresolvedNotice), { count: unresolvedCount })
      : undefined;

  revalidatePath("/dashboard/shopping-list");
  revalidatePath(`/dashboard/shopping-list/${listId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/budget");
  revalidatePath("/dashboard");

  return {
    listId,
    itemsAdded: preparedItems.length,
    totalAmount,
    expenseLoggedMessage,
    unresolvedNotice,
  };
}

export async function deleteShoppingListItemAction(itemId: string): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    select: { id: true, shoppingListId: true, purchased: true },
  });
  if (!item) return { error: "Item not found" };

  try {
    if (item.purchased) {
      // Deleting an already-purchased item can't change the pending count
      // — nothing to check for a LIST_CLEARED transition.
      await prisma.shoppingListItem.delete({ where: { id: item.id } });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.shoppingListItem.delete({ where: { id: item.id } });
        const remainingPending = await tx.shoppingListItem.count({
          where: { shoppingListId: item.shoppingListId, purchased: false },
        });
        await recordListClearedTransition(tx, household.id, item.shoppingListId, remainingPending + 1, remainingPending, userId);
      });
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  return {};
}

const undoAutoAddSchema = z.array(z.string().trim().min(1)).min(1).max(300);

// The Undo on the "Added X to Next shop" toast (AUTO-8). Removes exactly the
// rows an auto-add just created — the ids come back from the action that
// added them (see AutoAddedItem in src/lib/shopping/default-list.ts) — and
// nothing else. Scoped three ways so a stale or forged id can't reach
// anything it shouldn't: the row must be in one of this household's lists,
// still flagged `addedAutomatically` (never a row a person added by hand),
// and still unpurchased (once it's been checked off it's shopping history,
// not a mistaken add). `deleteMany` makes it idempotent — a double-clicked
// Undo, or one fired after the row was already removed, is a quiet no-op.
//
// Deliberately doesn't run recordListClearedTransition: undoing the only
// pending row on a list returns it to how it was a moment ago, not "the
// shopping is done".
export async function undoAutoAddedItemsAction(
  shoppingListItemIds: string[],
): Promise<ActionState & { removed?: number }> {
  const { household } = await requireHousehold();

  const parsed = undoAutoAddSchema.safeParse(shoppingListItemIds);
  if (!parsed.success) return { error: "Invalid input" };

  const where = {
    id: { in: parsed.data },
    addedAutomatically: true,
    purchased: false,
    shoppingList: { householdId: household.id },
  };

  let removed = 0;
  let listIds: string[] = [];
  try {
    const rows = await prisma.shoppingListItem.findMany({ where, select: { shoppingListId: true } });
    listIds = [...new Set(rows.map((row) => row.shoppingListId))];
    const result = await prisma.shoppingListItem.deleteMany({ where });
    removed = result.count;
  } catch (error) {
    return toFriendlyError(error);
  }

  for (const listId of listIds) revalidatePath(`/dashboard/shopping-list/${listId}`);
  if (listIds.length > 0) revalidatePath("/dashboard/shopping-list");
  return { removed };
}

export async function completeShoppingListAction(
  listId: string,
): Promise<{ expenseLoggedMessage?: string; unresolvedNotice?: string; error?: string }> {
  const { household, userId } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
    include: { items: true },
  });
  if (!list) return {};

  const dict = await getDictionary();

  // Completing no longer requires every item to be mapped to an inventory
  // item first — that used to block finishing the list at exactly the
  // moment (in the store, or just home) the user wants to be done. An
  // unlinked item was never going to update inventory anyway (see
  // togglePurchasedAction/applyReceiptScanAction, both no-ops without
  // item.inventoryItem), so nothing about the actual data changes here —
  // this only relaxes the completion gate, surfacing a heads-up afterward
  // instead of a hard stop. Items stay resolvable anytime via the "needs
  // mapping" row UI (ShoppingItemFormDialog's edit mode / linkShoppingListItemAction /
  // createInventoryItemFromShoppingListItemAction above / batch resolution
  // via resolveShoppingListMappingsAction below), completed list or not.
  const unresolvedCount = list.items.filter((item) => item.inventoryItemId === null).length;

  // Completing the default list (AUTO-8) hands the role straight to a
  // fresh, empty one, so there's always a "Next shop" to fill — the next
  // low-stock crossing after a shop shouldn't have to wait for a list to be
  // made. `isDefault` is cleared on the completed list first (same
  // transaction) so the partial unique index never sees two ACTIVE defaults
  // and a later un-archive can't resurrect a second one.
  if (list.isDefault) {
    await prisma.$transaction(async (tx) => {
      await tx.shoppingList.update({
        where: { id: list.id },
        data: { status: "COMPLETED", completedAt: new Date(), isDefault: false },
      });
      await getOrCreateDefaultShoppingList(tx, household.id);
    });
  } else {
    await prisma.shoppingList.update({
      where: { id: list.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }

  // Log a "Groceries" expense for whatever purchased items actually have an
  // estimated price set — never invent/estimate a price for items that
  // don't. Reuses Task 2's find-or-create category helper rather than
  // duplicating that lookup here.
  let groceriesTotal = 0;
  for (const item of list.items) {
    if (item.purchased && item.estimatedPrice != null) {
      groceriesTotal += item.estimatedPrice;
    }
  }

  let expenseLoggedMessage: string | undefined;

  if (groceriesTotal > 0) {
    const category = await findOrCreateGroceriesCategory(household.id);
    await prisma.transaction.create({
      data: {
        householdId: household.id,
        categoryId: category.id,
        amount: groceriesTotal,
        type: "EXPENSE",
        description: format(dict.shoppingList.expenseDescription, { name: list.name }),
        date: new Date(),
        createdByUserId: userId,
      },
    });

    const locale = await getLocale();
    const amountLabel = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(groceriesTotal);
    expenseLoggedMessage = format(dict.shoppingList.expenseLogged, { amount: amountLabel });
  }

  const unresolvedNotice =
    unresolvedCount > 0
      ? format(plural(unresolvedCount, dict.shoppingList.unresolvedNotice), { count: unresolvedCount })
      : undefined;

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/budget");

  return { expenseLoggedMessage, unresolvedNotice };
}
