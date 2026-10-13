"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { datedName, format, plural } from "@/lib/i18n/format";
import { resolveShoppingExpenseCategory } from "@/lib/budget-groceries-category";
import { createMoneyFormat, HOUSEHOLD_BASE_CURRENCY } from "@/lib/currency";
import { fetchExchangeRate } from "@/lib/exchange-rate";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { recordListClearedTransition, recordPriceSpikes, type RecordedPrice } from "@/lib/notifications";
import { learnItemAlias } from "@/lib/item-alias";
import { findInventoryMatches } from "@/lib/item-matching";
import { getStockStatus } from "@/lib/stock-status";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";
import { matchSmartAddInventoryItem } from "@/lib/shopping/smart-add-suggestions";
import { AUTO_FUZZY_MATCH_MIN_SCORE, createInventoryLinker } from "@/lib/shopping/inventory-link";
import { getOrCreateDefaultShoppingList, revalidateAutoAdded, type AutoAddedItem } from "@/lib/shopping/default-list";
import { categoryKey } from "@/lib/shopping/shopping-mode-grouping";
import {
  applySubsetReorder,
  effectiveOrder,
  learnFromCheckOffs,
  parseLearnedOrder,
  type CheckOff,
} from "@/lib/shopping/store-order";
import { estimatedExpiryUpdate } from "@/lib/inventory/shelf-life";
import { frozenResetOnArrival, openedResetOnArrival } from "@/lib/inventory/expiry";
import { applyStockArrival, reverseStockArrival } from "@/lib/shopping/put-away";
import { awaitsReceiptPrice, defersToPutAway } from "@/lib/shopping/put-away-calc";
import { loadIncomingByItem, coveredQuantity } from "@/lib/incoming-stock";
import type { InventoryItem, Prisma } from "@/generated/prisma/client";

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
 *
 * A batch caller (registerReceiptAction) passes the household's items as
 * `preloaded` so N unmatched lines cost one table read, not N.
 */
async function findFuzzyInventoryItem(householdId: string, name: string, preloaded?: InventoryItem[]) {
  const candidates = preloaded ?? (await prisma.inventoryItem.findMany({ where: { householdId } }));
  const matches = findInventoryMatches(name, candidates, { minScore: AUTO_FUZZY_MATCH_MIN_SCORE, limit: 2 });
  return matches.length === 1 ? matches[0] : null;
}

const createListSchema = z.object({
  name: z.string().trim().max(120, v("listNameTooLong")).optional(),
});

export async function createShoppingListAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const parsed = createListSchema.safeParse({ name: formData.get("name") || undefined });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const dict = await getDictionary();
  let list;
  try {
    list = await prisma.shoppingList.create({
      data: {
        householdId: household.id,
        name:
          parsed.data.name ||
          datedName(dict.shoppingList.defaultNamePrefix, await getLocale()),
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
  if (!list) return await fail("listNotEditable");

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
    // Stock ticked off but not yet put away counts as covered — see
    // src/lib/incoming-stock.ts. Without it, pressing this while the last
    // trip's bags are still on the counter would re-list everything in them.
    const incoming = await loadIncomingByItem(prisma, household.id, new Date());

    const toAdd = lowStockItems.filter(
      (item) =>
        getStockStatus(coveredQuantity(item.quantity, incoming.get(item.id) ?? 0), item.lowStockThreshold) !== "in" &&
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
  name: z.string().trim().min(1, v("nameRequired")).max(120, v("nameTooLong")),
  quantity: z.coerce.number().min(0.01, v("quantityPositive")),
  unit: z.string().trim().max(20, v("unitTooLong")).optional(),
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
  if (!list) return await fail("listNotEditable");

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
    return await zodFail(parsed.error);
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
  category: z.string().trim().max(60, v("categoryTooLong")).optional(),
  unit: z.string().trim().max(20, v("unitTooLong")).optional(),
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
    return await zodFail(parsed.error);
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
  name: z.string().trim().min(1, v("nameRequired")).max(120, v("nameTooLong")),
  quantity: z.coerce.number().min(0.01, v("quantityPositive")),
  unit: z.string().trim().max(20, v("unitTooLong")).optional(),
  note: z
    .string()
    .trim()
    .max(SHOPPING_ITEM_NOTE_MAX_LENGTH, v("noteTooLong"))
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
  if (!item) return await fail("itemNotFound");

  const parsed = updateItemSchema.safeParse(data);
  if (!parsed.success) {
    return await zodFail(parsed.error);
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
  price: z.coerce.number().min(0, v("priceNegative")).max(1_000_000, v("priceTooLarge")),
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
  if (!item) return await fail("itemNotFound");

  const parsed = updateItemPriceSchema.safeParse({ price });
  if (!parsed.success) {
    return await zodFail(parsed.error);
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
 *
 * Linking a row that had no link also teaches the household an alias
 * (MATCH-5) when the row's name differs from the item's, so the next
 * pasted list, template or receipt with that name links on its own — the
 * same learning the recipe review does. Re-pointing an already linked row
 * doesn't: only a "needs mapping" row is the matcher's miss.
 */
export async function linkShoppingListItemAction(
  itemId: string,
  inventoryItemId: string,
): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
  });
  if (!item) return await fail("itemNotFound");

  const inventoryItem = await prisma.inventoryItem.findFirst({
    where: { id: inventoryItemId, householdId: household.id },
  });
  if (!inventoryItem) return await fail("inventoryItemNotFound");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.shoppingListItem.update({
        where: { id: item.id },
        data: { inventoryItemId: inventoryItem.id },
      });
      if (item.inventoryItemId === null) await learnItemAlias(tx, household.id, item.name, inventoryItem);
    });
  } catch (error) {
    return toFriendlyError(error);
  }

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
  if (!item) return await fail("itemNotFound");

  const trimmedCategory = category.trim();
  if (trimmedCategory.length > 60) {
    return await fail("categoryTooLong");
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
  if (!item) return await fail("itemNotFound");

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
  .max(60, v("categoryTooLong"));

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
  if (!item) return await fail("itemNotFound");
  if (!item.inventoryItemId) return await fail("linkItemToPantryFirst");

  const parsed = setItemCategorySchema.safeParse(category);
  if (!parsed.success) {
    return await zodFail(parsed.error, "invalidCategory");
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
    return await zodFail(parsed.error);
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return await fail("listNotEditable");

  let added = 0;
  try {
    // MATCH-5: with the household's learned aliases, so a name fixed once
    // in a recipe review ("eggs" → Egg) links here too.
    const [inventoryItems, aliases] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { householdId: household.id } }),
      prisma.itemAlias.findMany({
        where: { householdId: household.id },
        select: { normalizedName: true, inventoryItemId: true },
      }),
    ]);
    const linkInventoryItem = createInventoryLinker(inventoryItems, aliases);

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
 *      name, the household's learned alias for it (MATCH-5), the one item
 *      containing every typed word ("mjölk" →
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
    return await zodFail(parsed.error);
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return await fail("listNotEditable");

  const addedIds: string[] = [];
  const alreadyOnList: string[] = [];
  let createdInventory = false;
  try {
    const [inventoryItems, aliases, pending] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { householdId: household.id } }),
      prisma.itemAlias.findMany({
        where: { householdId: household.id },
        select: { normalizedName: true, inventoryItemId: true },
      }),
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
      existing ??= matchSmartAddInventoryItem(row.name, inventoryItems, aliases) ?? undefined;

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
 * row — and reports back how many actually resolved. An "existing" link
 * teaches an alias the same way linkShoppingListItemAction does (MATCH-5).
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
            await learnItemAlias(tx, household.id, item.name, inventoryItem);
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

/**
 * Ticks a row off (or back on). What a tick *means* for inventory depends on
 * the household's `inventorySyncMode`:
 *
 * - ON_PUT_AWAY (new households' default): the tick is "it's in the cart".
 *   Only `purchased`/`checkedOffAt`/`checkedOffByUserId` change; the pantry
 *   is updated later, when the row is put away (putAwayItemsAction). Until
 *   then the row is *incoming* stock (src/lib/incoming-stock.ts).
 * - ON_CHECK (every household that predates the put-away step): the tick is
 *   the arrival, exactly as before — applyStockArrival runs straight away
 *   and the row is stamped `putAwayAt` in the same write, so the data reads
 *   the same way whichever mode put it there.
 *
 * Un-ticking is decided by the *row*, not the mode: a row that was already
 * put away gives its stock back (the old un-tick), one that never was has
 * nothing to reverse. That keeps a household that switches modes mid-trip
 * from double-counting or losing anything.
 */
export async function togglePurchasedAction(
  itemId: string,
): Promise<ActionState & { autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    include: { inventoryItem: true },
  });
  if (!item) return await fail("itemNotFound");

  const nextPurchased = !item.purchased;
  const arrivesNow = nextPurchased && !defersToPutAway(household);
  const reversesArrival = !nextPurchased && item.putAwayAt !== null;

  let autoAdded: AutoAddedItem | null = null;
  // GAP-9: the PriceHistory row this toggle wrote, if any — checked for a
  // price spike once the transaction has committed (see recordPriceSpikes).
  const recordedPrices: RecordedPrice[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.shoppingListItem.update({
        where: { id: item.id },
        // AUTO-9: the tick's timestamp is the whole check-off sequence
        // record — folded into this same row write, so learning the store
        // order costs no extra write per tap. Un-ticking clears it, so an
        // accidental tick never leaves a false step in the sequence, and a
        // re-tick later records when it was actually picked up. Who ticked
        // it rides along so the put-away reminder reaches them.
        data: nextPurchased
          ? {
              purchased: true,
              checkedOffAt: now,
              checkedOffByUserId: userId,
              // ON_CHECK: arrived and counted now; `priceRecordedAt` only
              // when applyStockArrival below really writes a PriceHistory
              // row (linked and priced). Put-away mode: an explicit null
              // putAwayAt, so a row can never enter the cart already
              // looking "put away" whatever state it was left in.
              ...(arrivesNow
                ? {
                    putAwayAt: now,
                    ...(item.inventoryItem && item.estimatedPrice != null ? { priceRecordedAt: now } : {}),
                  }
                : { putAwayAt: null }),
            }
          : // The purchase is undone, and with it the record that its price
            // was taken: a re-tick is a new purchase.
            { purchased: false, checkedOffAt: null, checkedOffByUserId: null, putAwayAt: null, priceRecordedAt: null },
      });

      if (item.inventoryItem && arrivesNow) {
        // AUTO-4: this purchase's price becomes the item's new
        // lastKnownPrice and a PriceHistory row — only when a price was
        // actually set on the row.
        const arrival = await applyStockArrival(tx, {
          householdId: household.id,
          actingUserId: userId,
          inventoryItem: item.inventoryItem,
          quantity: item.quantity,
          unit: item.unit,
          price: item.estimatedPrice,
        });
        autoAdded = arrival.autoAdded;
        if (arrival.recordedPrice) recordedPrices.push(arrival.recordedPrice);
      } else if (item.inventoryItem && reversesArrival) {
        // Only un-checking can decrease stock here. Un-checking a row on the
        // default list itself is a no-op for AUTO-8: that same row is
        // pending again, which is exactly what the dedupe looks for.
        const reversal = await reverseStockArrival(tx, {
          householdId: household.id,
          actingUserId: userId,
          inventoryItem: item.inventoryItem,
          quantity: item.quantity,
        });
        autoAdded = reversal.autoAdded;
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
  recordPriceSpikes(household.id, recordedPrices, userId);

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded([autoAdded]);
  return autoAdded ? { autoAdded: [autoAdded] } : {};
}

export type PutAwayEntry = {
  itemId: string;
  /** "Didn't get it after all": the row is un-ticked instead. */
  notBought?: boolean;
  /** What actually came home; the row's own quantity when left out. */
  quantity?: number;
  /** A native date input's `YYYY-MM-DD`; blank leaves AUTO-7 to estimate. */
  expiresAt?: string;
  /** Where it was put; blank leaves the item's location as it is. */
  location?: string;
};

const putAwaySchema = z.object({
  listId: z.string().min(1),
  entries: z
    .array(
      z.object({
        itemId: z.string().min(1),
        notBought: z.boolean().optional(),
        quantity: z.number().min(0.01, v("quantityPositive")).max(100000).optional(),
        expiresAt: z
          .string()
          .trim()
          .optional()
          .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), v("invalidDate"))
          .transform((value) => (value ? new Date(value) : null)),
        location: z.string().trim().max(120, v("locationTooLong")).optional(),
      }),
    )
    .min(1, v("nothingToPutAway"))
    .max(300),
});

/**
 * The second half of the two-phase flow: moves ticked rows' stock into
 * inventory now that it's actually home (see togglePurchasedAction for the
 * first half, and Household.inventorySyncMode). Everything the old tick did
 * at arrival happens here instead, via applyStockArrival — the increment
 * (by what the person says came home, which also becomes the row's
 * quantity so a later un-tick gives back the right amount), PriceHistory
 * and lastKnownPrice unless a receipt already recorded them
 * (`priceRecordedAt`), AUTO-7's estimate or the person's own date, GAP-28's
 * opened-reset, the location, and the stock-change hooks — then stamps
 * `putAwayAt`. The price is recorded against the row's listed quantity (what
 * it was paid for), not the corrected one, so the unit price GAP-9 compares
 * stays right. A "not bought" entry un-ticks the row instead (clearing
 * `priceRecordedAt` too), so it goes back to pending rather than counting as
 * bought.
 *
 * Partial on purpose: any subset of the ticked rows can be put away, the
 * rest stay incoming, and the list isn't completed by this. Works on ACTIVE
 * and COMPLETED lists (a finished trip is exactly when there's something to
 * unpack), never ARCHIVED ones.
 *
 * Tenancy: the list must be this household's, and every entry must be a row
 * on that list — a single foreign id fails the whole call rather than being
 * silently dropped, so a forged request can't learn which of its ids were
 * real.
 *
 * Concurrency — what's actually guaranteed: each row is claimed with a
 * conditional write (`purchased AND putAwayAt IS NULL`) inside the
 * transaction, so a row's stock is counted at most once however many
 * members tap "Put away" at the same moment, and a row un-ticked meanwhile
 * is skipped rather than counted. The claim also holds the row's lock until
 * commit, and receipt apply claims its rows the same way, so a receipt and a
 * put-away can't both record the same line's price. Rows are processed one
 * at a time, re-reading the row and its inventory item after the claim, so
 * two rows for the same item add up. What isn't guaranteed: the inventory
 * item itself is re-read and then written with an absolute quantity, like
 * every other stock change in the app, so an unrelated edit of the same
 * item committing in between (someone tapping − at that exact moment) can
 * still be overwritten.
 */
export async function putAwayItemsAction(
  listId: string,
  entries: PutAwayEntry[],
): Promise<ActionState & { putAway?: number; notBought?: number; autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const parsed = putAwaySchema.safeParse({ listId, entries });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id, status: { in: ["ACTIVE", "COMPLETED"] } },
    select: { id: true },
  });
  if (!list) return await fail("listNotEditable");

  const ids = [...new Set(parsed.data.entries.map((entry) => entry.itemId))];
  // Tenancy only — the transaction below re-reads each row after claiming it.
  const rows = await prisma.shoppingListItem.findMany({
    where: { id: { in: ids }, shoppingListId: list.id },
    select: { id: true },
  });
  if (rows.length !== ids.length) return await fail("itemNotFound");

  // Last entry per row wins, in the order the dialog sent them.
  const entryById = new Map(parsed.data.entries.map((entry) => [entry.itemId, entry]));

  let putAway = 0;
  let notBought = 0;
  const autoAdded: AutoAddedItem[] = [];
  const recordedPrices: RecordedPrice[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();

      for (const [itemId, entry] of entryById) {
        // Claim the row: only a write that still finds it ticked and not
        // put away wins, so of two concurrent put-aways (or a put-away racing
        // an un-tick) exactly one moves its stock. The pre-transaction read
        // above is only for tenancy; everything below re-reads.
        const claimed = await tx.shoppingListItem.updateMany({
          where: { id: itemId, shoppingListId: list.id, purchased: true, putAwayAt: null },
          data: entry.notBought
            ? { purchased: false, checkedOffAt: null, checkedOffByUserId: null, priceRecordedAt: null }
            : { putAwayAt: now },
        });
        if (claimed.count === 0) continue;
        if (entry.notBought) {
          notBought++;
          continue;
        }
        putAway++;

        // Fresh inside the transaction, after the claim: the row's own price
        // state, and the inventory item as it stands after any earlier row
        // in this batch (or anyone else's committed change) touched it.
        const row = await tx.shoppingListItem.findUnique({
          where: { id: itemId },
          include: { inventoryItem: true },
        });
        if (!row) continue;

        const quantity = entry.quantity ?? row.quantity;
        const recordPrice = row.inventoryItem !== null && row.estimatedPrice != null && row.priceRecordedAt === null;
        if (quantity !== row.quantity || recordPrice) {
          await tx.shoppingListItem.update({
            where: { id: row.id },
            data: {
              ...(quantity !== row.quantity ? { quantity } : {}),
              ...(recordPrice ? { priceRecordedAt: now } : {}),
            },
          });
        }

        if (!row.inventoryItem) continue;
        const arrival = await applyStockArrival(tx, {
          householdId: household.id,
          actingUserId: userId,
          inventoryItem: row.inventoryItem,
          quantity,
          unit: row.unit,
          price: recordPrice ? row.estimatedPrice : null,
          // The price was paid for the listed quantity, so that's what its
          // unit price is worked out against — a corrected quantity mustn't
          // look like a price jump (GAP-9).
          priceQuantity: row.quantity,
          expiresAt: entry.expiresAt,
          location: entry.location || null,
        });
        if (arrival.recordedPrice) recordedPrices.push(arrival.recordedPrice);
        if (arrival.autoAdded) autoAdded.push(arrival.autoAdded);
      }

      // Nothing left to unpack on this list: an outstanding reminder about
      // it is now just noise in the bell.
      const stillWaiting = await tx.shoppingListItem.count({
        where: { shoppingListId: list.id, purchased: true, putAwayAt: null },
      });
      if (stillWaiting === 0) {
        await tx.notification.updateMany({
          where: { householdId: household.id, shoppingListId: list.id, kind: "PUT_AWAY_REMINDER", dismissedAt: null },
          data: { dismissedAt: now },
        });
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  recordPriceSpikes(household.id, recordedPrices, userId);

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded(autoAdded);
  return { putAway, notBought, ...(autoAdded.length > 0 ? { autoAdded } : {}) };
}

export type ReceiptScanMatch = { shoppingListItemId: string; price: number };

/**
 * Applies a reviewed receipt scan (see ReceiptScanDialog) to a shopping
 * list: for every matched line, converts its price to
 * HOUSEHOLD_BASE_CURRENCY if the receipt was in a different currency, sets
 * that as the item's estimatedPrice, and marks it purchased — mirroring
 * togglePurchasedAction's side effects for the household's
 * `inventorySyncMode`, just batched across every scanned line in one
 * transaction instead of one checkbox at a time. In ON_CHECK mode that's
 * the full arrival (stock, expiry, PriceHistory) and the row is put away;
 * in ON_PUT_AWAY mode only the price is recorded and the stock waits for
 * the put-away step.
 *
 * A line can match a row that hasn't been ticked yet, or — the usual way
 * round in put-away mode, where people tick in the store and scan at home —
 * one that's ticked but not yet put away and has no price recorded (see
 * awaitsReceiptPrice). A row already counted into inventory never matches
 * again, so a receipt can't add the same carton twice.
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
  if (!list) return await fail("listNotEditable");

  const itemsById = new Map(list.items.map((item) => [item.id, item]));
  // Belt-and-braces de-dupe: if the client ever sent the same shopping-list
  // item twice (e.g. two OCR'd lines both matched to it), only the first is
  // applied — otherwise it would be double-counted into inventory and
  // PriceHistory below.
  const seen = new Set<string>();
  const validMatches = matches.filter((m) => {
    if (seen.has(m.shoppingListItemId)) return false;
    const item = itemsById.get(m.shoppingListItemId);
    if (!item || !Number.isFinite(m.price) || m.price <= 0) return false;
    if (!awaitsReceiptPrice(item)) return false;
    seen.add(m.shoppingListItemId);
    return true;
  });
  if (validMatches.length === 0) return await fail("nothingToApply");

  let rate = 1;
  if (currency.toUpperCase() !== HOUSEHOLD_BASE_CURRENCY) {
    const fetched = await fetchExchangeRate(currency, HOUSEHOLD_BASE_CURRENCY);
    if (fetched === null) {
      return await fail("exchangeRateUnavailable", { currency: currency, base: HOUSEHOLD_BASE_CURRENCY });
    }
    rate = fetched;
  }

  // Put-away mode: the receipt says what was paid, not that anything is in
  // the cupboard yet, so the rows are marked bought with their real price
  // and left for the put-away step to move the stock. The price itself is a
  // fact right now, so PriceHistory (with the store) and lastKnownPrice are
  // written here and `priceRecordedAt` tells the put-away not to write them
  // again. `priceRecordedAt` means exactly "a PriceHistory row was written
  // for this line", so an unlinked row (no PriceHistory possible) never gets
  // it — instead it's put away on the spot, since there's no stock to wait
  // for either, which is also what stops it staying matchable forever.
  const deferStock = defersToPutAway(household);

  let totalAmount = 0;
  let itemsUpdated = 0;
  // GAP-9: every PriceHistory row written below, checked for price spikes
  // as one batch after the transaction commits — see recordPriceSpikes for
  // why that's after, and batched, rather than per row inside it.
  const recordedPrices: RecordedPrice[] = [];

  // Sequential, not Promise.all (SCALE-C used to run these in parallel):
  // two lines can land on the same inventory item (the same product on the
  // list twice), and parallel writes from one stale snapshot would lose one
  // line's stock. Each line re-reads its row and item inside the
  // transaction after claiming the row, so the second line builds on the
  // first. A receipt is a few dozen lines, so the extra hold time is small.
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const match of validMatches) {
      const item = itemsById.get(match.shoppingListItemId)!;
      const convertedPrice = Math.round(match.price * rate * 100) / 100;

      // Claimed only while it's still waiting for a price (the
      // transactional twin of awaitsReceiptPrice), so a put-away or a
      // second receipt that got there first wins and this line is skipped
      // instead of counting the stock or the price again.
      const claimed = await tx.shoppingListItem.updateMany({
        where: {
          id: item.id,
          shoppingListId: list.id,
          OR: [{ purchased: false }, { putAwayAt: null, priceRecordedAt: null }],
        },
        data: {
          estimatedPrice: convertedPrice,
          purchased: true,
          // Whoever applied the receipt gets the put-away reminder for rows
          // nobody ticked by hand.
          ...(deferStock && !item.purchased ? { checkedOffByUserId: userId } : {}),
        },
      });
      if (claimed.count === 0) continue;
      itemsUpdated++;
      totalAmount += convertedPrice;

      const row = await tx.shoppingListItem.findUnique({
        where: { id: item.id },
        include: { inventoryItem: true },
      });
      if (!row) continue;
      const linked = row.inventoryItem !== null;
      await tx.shoppingListItem.update({
        where: { id: row.id },
        data: {
          ...(linked ? { priceRecordedAt: now } : {}),
          ...(!deferStock || !linked ? { putAwayAt: now } : {}),
        },
      });
      if (!row.inventoryItem) continue;

      if (deferStock) {
        // AUTO-4: a scanned receipt price is as real as it gets, so it
        // becomes the item's new lastKnownPrice even before the stock
        // itself is put away.
        await tx.inventoryItem.update({
          where: { id: row.inventoryItem.id },
          data: { lastKnownPrice: convertedPrice },
        });
        const history = await tx.priceHistory.create({
          data: {
            inventoryItemId: row.inventoryItem.id,
            price: convertedPrice,
            quantity: row.quantity,
            unit: row.unit,
            store: trimmedStore,
          },
        });
        recordedPrices.push({
          priceHistoryId: history.id,
          inventoryItemId: row.inventoryItem.id,
          price: convertedPrice,
          quantity: row.quantity,
          unit: row.unit,
        });
        continue;
      }

      // A matched receipt line is stock arriving, same as a tick in
      // ON_CHECK mode: AUTO-7's estimate, GAP-28's fresh-pack reset,
      // AUTO-4's lastKnownPrice and GAP-9's PriceHistory all come from
      // applyStockArrival.
      const arrival = await applyStockArrival(tx, {
        householdId: household.id,
        actingUserId: userId,
        inventoryItem: row.inventoryItem,
        quantity: row.quantity,
        unit: row.unit,
        price: convertedPrice,
        store: trimmedStore,
      });
      if (arrival.recordedPrice) recordedPrices.push(arrival.recordedPrice);
    }
  });
  recordPriceSpikes(household.id, recordedPrices, userId);

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/budget");

  return { itemsUpdated, totalAmount };
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
  // Mirrors importItemsSchema/updateItemPriceSchema's caps — a hand-typed
  // receipt line has no legitimate reason to be this large.
  quantity: z.coerce.number().min(0.01).max(100_000),
  unit: z.string().trim().max(20).optional(),
  price: z.coerce.number().min(0.01).max(1_000_000, v("priceTooLarge")),
  inventoryItemId: z.string().trim().min(1).optional(),
  newItemCategory: z.string().trim().max(60).optional(),
});

const registerReceiptSchema = z.object({
  name: z.string().trim().max(120).optional(),
  currency: z.string().trim().min(1).max(10),
  // GAP-6: optional, one store for the whole receipt — see
  // applyReceiptScanAction's doc comment for why this is per-receipt.
  store: z.string().trim().max(120).optional(),
  // 300 mirrors importItemsSchema/bulkCreateSchema's cap on bulk item rows.
  items: z.array(registerReceiptItemSchema).min(1, v("addAtLeastOneItem")).max(300, v("tooManyItems")),
});

type LoggedExpense = { transactionId: string; amount: number; categoryName: string };

/**
 * MAINT-5: the one place a shopping trip's total becomes a budget expense,
 * shared by registerReceiptAction and completeShoppingListAction. Runs on
 * the caller's transaction client, inside the same `$transaction` as the
 * stock/status writes it accounts for: logging it afterwards (as both used
 * to) meant a failed insert surfaced as a crash after stock had already
 * moved, and retrying re-applied the stock. Never estimates — a zero total
 * logs nothing and returns null. Module-private, so not a client-callable
 * endpoint despite living in a `"use server"` file.
 */
async function logGroceriesExpense(
  tx: Prisma.TransactionClient,
  { householdId, userId, amount, description }: { householdId: string; userId: string; amount: number; description: string },
): Promise<LoggedExpense | null> {
  if (amount <= 0) return null;
  const category = await resolveShoppingExpenseCategory(tx, householdId);
  const transaction = await tx.transaction.create({
    data: {
      householdId,
      categoryId: category.id,
      amount,
      type: "EXPENSE",
      description,
      date: new Date(),
      createdByUserId: userId,
    },
    select: { id: true },
  });
  return { transactionId: transaction.id, amount, categoryName: category.name };
}

// The "Logged 123 kr to Groceries" toast. Names the category the expense
// actually went to, since that's now the household's choice (and may have
// been renamed) rather than always "Groceries".
async function formatExpenseLogged(template: string, currencyCode: string | null, expense: LoggedExpense) {
  const locale = await getLocale();
  // GAP-13: the household's display currency, like the list itself.
  const amountLabel = createMoneyFormat(locale, currencyCode).format(expense.amount);
  return format(template, { amount: amountLabel, category: expense.categoryName });
}

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
    return await zodFail(parsed.error);
  }
  const trimmedStore = parsed.data.store || null;

  const upperCurrency = parsed.data.currency.toUpperCase();
  let rate = 1;
  if (upperCurrency !== HOUSEHOLD_BASE_CURRENCY) {
    const fetched = await fetchExchangeRate(upperCurrency, HOUSEHOLD_BASE_CURRENCY);
    if (fetched === null) {
      return await fail("exchangeRateUnavailable", { currency: upperCurrency, base: HOUSEHOLD_BASE_CURRENCY });
    }
    rate = fetched;
  }

  const finalListName =
    parsed.data.name ||
    datedName(dict.shoppingList.registerReceipt.namePlaceholderPrefix, await getLocale());

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
  // PERF-16: the household's inventory, loaded on the first line that needs
  // a fuzzy match (a receipt whose lines are all linked or explicitly new
  // costs no read) and matched in memory after that. Items this receipt
  // creates are added so a later line can still fuzzy-match them, as it did
  // when each line re-read the table. Keyed by id: a line that created an
  // item *before* the lazy load is already in the read's result, and a
  // duplicate candidate would make a single confident match look ambiguous
  // (findFuzzyInventoryItem leaves a two-way tie unlinked).
  let fuzzyCandidates: Map<string, InventoryItem> | null = null;
  const createdThisReceipt: InventoryItem[] = [];
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
      createdThisReceipt.push(inventoryItem);
      fuzzyCandidates?.set(inventoryItem.id, inventoryItem);
    } else {
      inventoryItem = await findExactInventoryItem(household.id, line.name);
      if (!inventoryItem) {
        if (!fuzzyCandidates) {
          const loaded = await prisma.inventoryItem.findMany({ where: { householdId: household.id } });
          fuzzyCandidates = new Map([...loaded, ...createdThisReceipt].map((item) => [item.id, item]));
        }
        inventoryItem = await findFuzzyInventoryItem(household.id, line.name, [...fuzzyCandidates.values()]);
      }
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
  let registered: { listId: string; expense: LoggedExpense | null };
  try {
    registered = await prisma.$transaction(async (tx) => {
      const registeredAt = new Date();
      const list = await tx.shoppingList.create({
        data: {
          householdId: household.id,
          name: finalListName,
          status: "COMPLETED",
          completedAt: registeredAt,
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
            // The receipt is registered after the shop, so the stock is home
            // and counted below in this same transaction — whatever the
            // household's inventorySyncMode, there's nothing left to put
            // away (and nothing for the put-away step to count twice).
            putAwayAt: registeredAt,
            ...(item.inventoryItem ? { priceRecordedAt: registeredAt } : {}),
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
        // GAP-44: and a restocked frozen item is no longer frozen.
        const frozenReset = frozenResetOnArrival(item, currentQuantity, nextQuantity);
        await tx.inventoryItem.update({
          where: { id: inventoryItemId },
          data: { quantity: nextQuantity, lastKnownPrice, ...openedReset, ...frozenReset, ...expiryUpdate },
        });
      }

      const expense = await logGroceriesExpense(tx, {
        householdId: household.id,
        userId,
        amount: totalAmount,
        description: format(dict.shoppingList.expenseDescription, { name: finalListName }),
      });

      return { listId: list.id, expense };
    });
  } catch (error) {
    return toFriendlyError(error);
  }
  const { listId } = registered;
  recordPriceSpikes(household.id, recordedPrices, userId);

  const expenseLoggedMessage = registered.expense
    ? await formatExpenseLogged(dict.shoppingList.expenseLogged, household.currencyCode, registered.expense)
    : undefined;

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
  if (!item) return await fail("itemNotFound");

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
  if (!parsed.success) return await fail("invalidInput");

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
    await toFriendlyError(error);
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
  if (!parsed.success) return await fail("invalidSectionOrder");

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

/**
 * Finishes a trip: status COMPLETED, AUTO-9's store-order learning, and the
 * Groceries expense. Deliberately leaves inventory alone, including rows
 * that are ticked but not yet put away (put-away mode): putting those away
 * here, at the list's quantities, would book stock nobody confirmed —
 * exactly what the put-away step exists to avoid. Instead the list page
 * routes "Done shopping" through PutAwayDialog whenever such rows exist
 * (put away and finish, or finish and put away later), and a row left
 * waiting isn't lost: it stays incoming on the completed list, where the
 * "Put away" button and the reminder still find it.
 */
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
  // Log an expense for whatever purchased items actually have an estimated
  // price set — never invent/estimate a price for items that don't.
  let groceriesTotal = 0;
  for (const item of list.items) {
    if (item.purchased && item.estimatedPrice != null) {
      groceriesTotal += item.estimatedPrice;
    }
  }

  // Status change and expense commit together (MAINT-5), so a list is never
  // COMPLETED without the expense its prices add up to, or the other way round.
  let expense: LoggedExpense | null;
  try {
    expense = await prisma.$transaction(async (tx) => {
      await tx.shoppingList.update({
        where: { id: list.id },
        data: { status: "COMPLETED", completedAt: new Date(), ...(list.isDefault ? { isDefault: false } : {}) },
      });
      if (list.isDefault) await getOrCreateDefaultShoppingList(tx, household.id);

      return logGroceriesExpense(tx, {
        householdId: household.id,
        userId,
        amount: groceriesTotal,
        description: format(dict.shoppingList.expenseDescription, { name: list.name }),
      });
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  await learnStoreOrder(household.id, household.categoryOrderLearned, list.items);

  const transactionId = expense?.transactionId;
  const expenseLoggedMessage = expense
    ? await formatExpenseLogged(dict.shoppingList.expenseLogged, household.currencyCode, expense)
    : undefined;

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
 * completing never touched it (stock moves when each item is checked off,
 * or put away in put-away mode, and neither is undone here; a row still
 * waiting to be put away simply keeps waiting on the reopened list).
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
  if (!list) return await fail("listNotFound");
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
