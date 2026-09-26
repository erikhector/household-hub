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
import {
  recordListClearedTransition,
  recordOutOfStockTransition,
  recordPriceSpikes,
  type RecordedPrice,
} from "@/lib/notifications";
import { findInventoryMatches } from "@/lib/item-matching";
import { getStockStatus } from "@/lib/stock-status";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";
import { matchSmartAddInventoryItem } from "@/lib/shopping/smart-add-suggestions";
import { AUTO_FUZZY_MATCH_MIN_SCORE, createInventoryLinker } from "@/lib/shopping/inventory-link";
import {
  addToDefaultListOnLowStock,
  getOrCreateDefaultShoppingList,
  revalidateAutoAdded,
  type AutoAddedItem,
} from "@/lib/shopping/default-list";
import { categoryKey } from "@/lib/shopping/shopping-mode-grouping";
import {
  applySubsetReorder,
  effectiveOrder,
  learnFromCheckOffs,
  parseLearnedOrder,
  type CheckOff,
} from "@/lib/shopping/store-order";
import { estimatedExpiryUpdate } from "@/lib/inventory/shelf-life";
import { openedResetOnArrival } from "@/lib/inventory/expiry";
import type { InventoryItem } from "@/generated/prisma/client";

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

// GAP-5: a note is a short hint for whoever's shopping ("get the ripe
// ones"), not a recipe — long enough for a sentence or two, short enough to
// stay a muted line or two under the item name on a phone. Mirrored by the
// edit dialog's maxLength (ShoppingItemFormDialog), since a "use server"
// file can't export a plain constant for it to import.
const SHOPPING_ITEM_NOTE_MAX_LENGTH = 200;

const updateItemSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
  quantity: z.coerce.number().min(0.01, "Quantity must be greater than 0"),
  unit: z.string().trim().max(20, "Unit must be 20 characters or fewer").optional(),
  note: z
    .string()
    .trim()
    .max(SHOPPING_ITEM_NOTE_MAX_LENGTH, `Note must be ${SHOPPING_ITEM_NOTE_MAX_LENGTH} characters or fewer`)
    .optional(),
});

/**
 * Edits a shopping-list item's own fields (name/quantity/unit, and GAP-5's
 * optional note). Previously
 * the only way to fix a typo or change a quantity was delete-and-re-add,
 * which lost addedAutomatically/estimatedPrice/the inventory link in the
 * process. Scoped the same way as deleteShoppingListItemAction: household
 * ownership only, no ACTIVE-list check (the UI already only renders the
 * edit control for active lists).
 */
export async function updateShoppingListItemAction(
  itemId: string,
  data: { name: string; quantity: number; unit: string; note?: string },
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
        // GAP-5: `note` left out (undefined) means "don't touch it", so a
        // caller that only edits name/quantity/unit can't wipe a note by
        // accident. A blank or whitespace-only note clears it to null
        // rather than storing "", so "has a note" is just `note != null`.
        ...(parsed.data.note !== undefined ? { note: parsed.data.note || null } : {}),
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

const setItemCategorySchema = z
  .string()
  .trim()
  .max(60, "Category must be 60 characters or fewer");

/**
 * Re-files a shopping-list row's linked InventoryItem under a different
 * category — the tappable category chip on each row (AUTO-2b), so a wrong
 * auto-category guess (AUTO-2's createCategoryResolver) can be fixed right
 * where it's noticed instead of a trip to the inventory page. It writes the
 * InventoryItem, not the list row (the row has no category of its own), and
 * that's also what makes the correction stick: the resolver's first tier is
 * household memory, so the next add of the same name follows this choice
 * rather than being re-guessed. An unlinked row has no category to change
 * yet — it goes through the mapping dialog first. Blank clears back to the
 * locale's "Uncategorized" bucket, same as bulkUpdateFieldAction.
 */
export async function setShoppingListItemCategoryAction(
  itemId: string,
  category: string,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    select: { shoppingListId: true, inventoryItemId: true },
  });
  if (!item) return { error: "Item not found" };
  if (!item.inventoryItemId) return { error: "Link this item to your pantry first" };

  const parsed = setItemCategorySchema.safeParse(category);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid category" };
  }

  try {
    await prisma.inventoryItem.updateMany({
      where: { id: item.inventoryItemId, householdId: household.id },
      data: {
        category: parsed.data || (await getDictionary()).inventory.uncategorized,
        updatedByUserId: userId,
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
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
    const linkInventoryItem = createInventoryLinker(inventoryItems);

    const rows = parsed.data.items.map((item) => {
      const inventoryItem = linkInventoryItem(item.name);
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
  // GAP-9: the PriceHistory row this toggle wrote, if any — checked for a
  // price spike once the transaction has committed (see recordPriceSpikes).
  const recordedPrices: RecordedPrice[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      await tx.shoppingListItem.update({
        where: { id: item.id },
        // AUTO-9: the tick's timestamp is the whole check-off sequence
        // record — folded into this same row write, so learning the store
        // order costs no extra write per tap. Un-ticking clears it, so an
        // accidental tick never leaves a false step in the sequence, and a
        // re-tick later records when it was actually picked up.
        data: { purchased: nextPurchased, checkedOffAt: nextPurchased ? new Date() : null },
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
        // AUTO-7: checking an item off is a stock-arrival event — only
        // considered while marking purchased (un-marking removes stock, not
        // adds it), and only actually writes when estimatedExpiryUpdate
        // decides it should (see that function's doc comment for the
        // 0→>0-or-no-expiry-yet rule and why a real date is never touched).
        const expiryUpdate = nextPurchased
          ? estimatedExpiryUpdate(item.inventoryItem, item.inventoryItem.quantity, nextQuantity)
          : null;
        // GAP-28: a restock from zero is a fresh, sealed pack — spread
        // before expiryUpdate so a new estimate wins over the cleared date
        // (see openedResetOnArrival's doc comment).
        const openedReset = nextPurchased
          ? openedResetOnArrival(item.inventoryItem, item.inventoryItem.quantity, nextQuantity)
          : null;
        await tx.inventoryItem.update({
          where: { id: item.inventoryItem.id },
          data: {
            quantity: nextQuantity,
            ...(priceToRecord != null ? { lastKnownPrice: priceToRecord } : {}),
            ...openedReset,
            ...expiryUpdate,
          },
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
          // GAP-9: the line's quantity/unit too, so the price can be
          // compared per unit later (see detectPriceSpike).
          const row = await tx.priceHistory.create({
            data: {
              inventoryItemId: item.inventoryItem.id,
              price: priceToRecord,
              quantity: item.quantity,
              unit: item.unit,
            },
          });
          recordedPrices.push({
            priceHistoryId: row.id,
            inventoryItemId: item.inventoryItem.id,
            price: priceToRecord,
            quantity: item.quantity,
            unit: item.unit,
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
  await recordPriceSpikes(household.id, recordedPrices, userId);

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
 *
 * `store` (GAP-6) is one optional name for the whole receipt — a receipt is
 * from a single store, so there's no per-line field for it — stamped onto
 * every PriceHistory row this writes. `PriceHistory.store` has existed in
 * the schema since AUTO-9's groundwork, but this is the first write path
 * that ever populates it; left blank, rows are written exactly as before
 * (store: null).
 */
export async function applyReceiptScanAction(
  listId: string,
  currency: string,
  matches: ReceiptScanMatch[],
  store?: string,
): Promise<ActionState & { itemsUpdated?: number; totalAmount?: number }> {
  const { household, userId } = await requireHousehold();
  const trimmedStore = store?.trim().slice(0, 120) || null;

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
  // GAP-9: every PriceHistory row written below, checked for price spikes
  // as one batch after the transaction commits — see recordPriceSpikes for
  // why that's after, and batched, rather than per row inside it.
  const recordedPrices: RecordedPrice[] = [];

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
          const nextQuantity = item.inventoryItem.quantity + item.quantity;
          // AUTO-7: a matched receipt line is stock arriving, same as
          // togglePurchasedAction — see estimatedExpiryUpdate's doc comment.
          const expiryUpdate = estimatedExpiryUpdate(item.inventoryItem, item.inventoryItem.quantity, nextQuantity);
          // GAP-28: same fresh-pack reset as togglePurchasedAction.
          const openedReset = openedResetOnArrival(item.inventoryItem, item.inventoryItem.quantity, nextQuantity);
          // AUTO-4: a scanned receipt price is as real as it gets, so it
          // becomes the item's new lastKnownPrice — folded into the same
          // quantity update rather than a second write.
          await tx.inventoryItem.update({
            where: { id: item.inventoryItem.id },
            data: { quantity: nextQuantity, lastKnownPrice: convertedPrice, ...openedReset, ...expiryUpdate },
          });
          const row = await tx.priceHistory.create({
            data: {
              inventoryItemId: item.inventoryItem.id,
              price: convertedPrice,
              quantity: item.quantity,
              unit: item.unit,
              store: trimmedStore,
            },
          });
          recordedPrices.push({
            priceHistoryId: row.id,
            inventoryItemId: item.inventoryItem.id,
            price: convertedPrice,
            quantity: item.quantity,
            unit: item.unit,
          });
        }
      }),
    );
  });
  await recordPriceSpikes(household.id, recordedPrices, userId);

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
  // GAP-6: optional, one store for the whole receipt — see
  // applyReceiptScanAction's doc comment for why this is per-receipt.
  store: z.string().trim().max(120).optional(),
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
  store?: string,
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

  const parsed = registerReceiptSchema.safeParse({ name: listName, currency, store, items });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const trimmedStore = parsed.data.store || null;

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
    // Widened to the full row (not just id/quantity/unit) so the AUTO-7
    // shelf-life estimate below has the category/shelfLifeDays/expiresAt it
    // needs, without a second fetch per item.
    inventoryItem: InventoryItem | null;
  }[] = [];
  let totalAmount = 0;
  let unresolvedCount = 0;
  const resolveCategory = createCategoryResolver(household.id);
  // AUTO-2b(a): every "add as new item" line whose guess misses is a
  // candidate for the AI fallback, scheduled (batched) once every line has
  // been processed below.
  const aiCandidates: string[] = [];

  for (const line of parsed.data.items) {
    let inventoryItem: InventoryItem | null = null;

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
  const inventoryDeltas = new Map<
    string,
    { currentQuantity: number; delta: number; lastKnownPrice: number; item: InventoryItem }
  >();
  for (const item of preparedItems) {
    if (!item.inventoryItem) continue;
    const existing = inventoryDeltas.get(item.inventoryItem.id) ?? {
      currentQuantity: item.inventoryItem.quantity,
      delta: 0,
      lastKnownPrice: item.convertedPrice,
      item: item.inventoryItem,
    };
    existing.delta += item.quantity;
    existing.lastKnownPrice = item.convertedPrice;
    inventoryDeltas.set(item.inventoryItem.id, existing);
  }

  // GAP-9: see applyReceiptScanAction's matching comment.
  const recordedPrices: RecordedPrice[] = [];
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
          const row = await tx.priceHistory.create({
            data: {
              inventoryItemId: item.inventoryItem.id,
              price: item.convertedPrice,
              quantity: item.quantity,
              unit: item.unit,
              store: trimmedStore,
            },
          });
          recordedPrices.push({
            priceHistoryId: row.id,
            inventoryItemId: item.inventoryItem.id,
            price: item.convertedPrice,
            quantity: item.quantity,
            unit: item.unit,
          });
        }
      }

      for (const [inventoryItemId, { currentQuantity, delta, lastKnownPrice, item }] of inventoryDeltas) {
        const nextQuantity = currentQuantity + delta;
        // AUTO-7: registering a receipt is a stock-arrival event too — same
        // rule as applyReceiptScanAction/togglePurchasedAction above.
        const expiryUpdate = estimatedExpiryUpdate(item, currentQuantity, nextQuantity);
        // GAP-28: same fresh-pack reset as togglePurchasedAction.
        const openedReset = openedResetOnArrival(item, currentQuantity, nextQuantity);
        await tx.inventoryItem.update({
          where: { id: inventoryItemId },
          data: { quantity: nextQuantity, lastKnownPrice, ...openedReset, ...expiryUpdate },
        });
      }

      return list.id;
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  await recordPriceSpikes(household.id, recordedPrices, userId);

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

/**
 * AUTO-9: folds one finished trip's check-off sequence into the household's
 * learned store order (see store-order.ts for the EMA itself). Only rows
 * ticked off by hand carry a checkedOffAt, so receipt-applied rows, rows
 * ticked before the column existed and anything un-ticked again simply
 * aren't part of the sequence. A trip that touched fewer than two
 * categories teaches nothing and writes nothing.
 *
 * Best-effort on purpose: the list is already completed by the time this
 * runs, so a failure here is logged and reported (toFriendlyError) but never
 * turns a successful "Done shopping" into an error toast. `learned` is the
 * value requireHousehold loaded at the start of the request; two members
 * completing lists in the same instant can lose one trip's nudge, which a
 * moving average shrugs off.
 */
async function learnStoreOrder(
  householdId: string,
  learned: unknown,
  items: { checkedOffAt: Date | null; inventoryItem: { category: string } | null }[],
) {
  const checkOffs: CheckOff[] = items.flatMap((item) =>
    item.checkedOffAt ? [{ key: categoryKey(item.inventoryItem?.category ?? null), at: item.checkedOffAt }] : [],
  );
  const next = learnFromCheckOffs(parseLearnedOrder(learned), checkOffs);
  if (!next) return;
  try {
    await prisma.household.update({ where: { id: householdId }, data: { categoryOrderLearned: next } });
  } catch (error) {
    toFriendlyError(error);
  }
}

// Category keys (see categoryKey in shopping-mode-grouping.ts) as the
// "Reorder sections" dialog lists them. Bounded so a crafted call can't
// store an unbounded array on the household row; a real list shows at most
// a few dozen sections.
const categoryOrderSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(200);

/**
 * AUTO-9's "Reorder sections": saves a hand-arranged order of the
 * categories one list shows. It's merged into the household's whole
 * current order (applySubsetReorder) rather than replacing it, so sections
 * this list doesn't have keep their place. Once saved, a manual order
 * always beats the learned one (storeOrderSortKey) until it's reset; the
 * learning itself keeps running underneath, so a reset lands on an
 * up-to-date learned order. Household-wide, like the learned order —
 * everyone shops the same store.
 */
export async function saveCategoryOrderAction(keys: string[]): Promise<ActionState> {
  const { household } = await requireHousehold();
  const parsed = categoryOrderSchema.safeParse(keys);
  if (!parsed.success) return { error: "Invalid section order" };

  const current = {
    learned: parseLearnedOrder(household.categoryOrderLearned),
    manual: household.categoryOrderManual,
  };
  const manual = applySubsetReorder(effectiveOrder(current, parsed.data), parsed.data);
  try {
    await prisma.household.update({ where: { id: household.id }, data: { categoryOrderManual: manual } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list/[id]", "page");
  return {};
}

/**
 * Drops the hand-arranged order so the learned one takes over again.
 * Returns the order it dropped so the toast's "Undo" can put it back via
 * saveCategoryOrderAction (Guardrails: undo over confirm).
 */
export async function resetCategoryOrderAction(): Promise<ActionState & { previous?: string[] }> {
  const { household } = await requireHousehold();
  const previous = household.categoryOrderManual;
  try {
    await prisma.household.update({ where: { id: household.id }, data: { categoryOrderManual: [] } });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list/[id]", "page");
  return { previous };
}

export async function completeShoppingListAction(
  listId: string,
): Promise<{
  expenseLoggedMessage?: string;
  unresolvedNotice?: string;
  /** The Groceries expense this completion logged, if any — handed back to
   * uncompleteShoppingListAction by the toast's "Undo" (AUTO-5) so it
   * removes exactly that row and nothing else. */
  transactionId?: string;
  error?: string;
}> {
  const { household, userId } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
    // The linked item's category rides along for AUTO-9's store-order
    // learning below — it's the category a row was grouped under.
    include: { items: { include: { inventoryItem: { select: { category: true } } } } },
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

  await learnStoreOrder(household.id, household.categoryOrderLearned, list.items);

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
  let transactionId: string | undefined;

  if (groceriesTotal > 0) {
    const category = await findOrCreateGroceriesCategory(household.id);
    const transaction = await prisma.transaction.create({
      data: {
        householdId: household.id,
        categoryId: category.id,
        amount: groceriesTotal,
        type: "EXPENSE",
        description: format(dict.shoppingList.expenseDescription, { name: list.name }),
        date: new Date(),
        createdByUserId: userId,
      },
      select: { id: true },
    });
    transactionId = transaction.id;

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

  return { expenseLoggedMessage, unresolvedNotice, transactionId };
}

/**
 * The "Undo" on the "Done shopping" toast (AUTO-5): puts a just-completed
 * list back to ACTIVE and removes the Groceries expense that completion
 * logged, identified by the id completeShoppingListAction returned — never
 * "the latest Groceries expense", which could be someone else's. Same
 * short-lived, fat-finger-only shape as undoMarkMealEntryCookedAction, not
 * a permanent "reopen list" control. Idempotent: a list that's no longer
 * COMPLETED (a double-tapped Undo, or it was archived meanwhile) is left
 * alone, and the expense delete is a household-scoped deleteMany, so a
 * stale or foreign id removes nothing. Inventory needs no reversal —
 * completing never touched it (purchases already moved stock as each item
 * was checked off, and they stay checked off).
 */
export async function uncompleteShoppingListAction(
  listId: string,
  transactionId?: string,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id },
    select: { id: true, status: true },
  });
  if (!list) return { error: "List not found" };
  if (list.status !== "COMPLETED") return {};

  try {
    await prisma.$transaction(async (tx) => {
      await tx.shoppingList.update({
        where: { id: list.id },
        data: { status: "ACTIVE", completedAt: null },
      });
      if (transactionId) {
        await tx.transaction.deleteMany({
          where: { id: transactionId, householdId: household.id },
        });
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/budget");
  return {};
}
