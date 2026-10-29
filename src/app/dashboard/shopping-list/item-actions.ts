"use server";

// MAINT-3: adding, editing, linking and deleting shopping-list rows, split out
// of the old actions.ts. Ticking is in purchase-actions.ts, the free-text
// smart-add bar in smart-add-actions.ts.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { recordListClearedTransition } from "@/lib/notifications";
import { learnItemAlias } from "@/lib/item-alias";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";
import { createInventoryLinker } from "@/lib/shopping/inventory-link";
import { defaultLineEstimate } from "@/lib/shopping/unit-price";
import { findExactInventoryItem, findFuzzyInventoryItem } from "./inventory-lookup";
import { updateItemPriceSchema } from "./price-schema";

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
 * confident fuzzy match, see findFuzzyInventoryItem in inventory-lookup.ts), they just differ
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
  userId: string,
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
      // GAP-65: the session user, never a client value.
      addedByUserId: userId,
      inventoryItemId: inventoryItem?.id ?? null,
      name,
      quantity,
      unit: unit || inventoryItem?.unit || "pcs",
      // AUTO-4: default the estimate from the linked item's last recorded
      // price, so the running total (and the eventual Groceries expense)
      // isn't 0 just because nothing's been priced yet this trip.
      // BUG-3: lastKnownPrice is per unit of quantity, a row's estimate is
      // the whole line (completeShoppingListAction sums it as is, so a
      // 2-pack priced at "24" books as 24, not 48), hence the multiply.
      // This only ever runs at creation; once the user corrects a row's
      // price, nothing here touches it again (Guardrails: corrections stick).
      estimatedPrice: defaultLineEstimate(inventoryItem?.lastKnownPrice, quantity),
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
  const { household, userId } = await requireHousehold();

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
      userId,
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
  const { household, userId } = await requireHousehold();

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
      userId,
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

/**
 * Corrects a shopping-list item's estimatedPrice (AUTO-4) — what the row's
 * tap-to-edit "≈ price" saves. A plain field update, same shape as
 * updateShoppingListItemAction just for one field, so the two other places
 * that ever set estimatedPrice (the create-path defaults above, and a
 * receipt scan/registration's actual price) never need to touch this. Once
 * the user corrects a row here, nothing else in the shopping-list actions overwrites it
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
 * match (see findExactInventoryItem in inventory-lookup.ts) to an existing inventory item the
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
 * links it — the explicit "create new item" half of the mapping dialog.
 * Nothing creates inventory items implicitly from a shopping-list name.
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

  try {
    await prisma.shoppingListItem.update({
      where: { id: item.id },
      data: { inventoryItemId: null },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

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
  const { household, userId } = await requireHousehold();

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
        addedByUserId: userId,
        inventoryItemId: inventoryItem?.id ?? null,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit || inventoryItem?.unit || "pcs",
        // AUTO-4: same last-known-price default as the ad-hoc add path.
        estimatedPrice: defaultLineEstimate(inventoryItem?.lastKnownPrice, item.quantity),
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
