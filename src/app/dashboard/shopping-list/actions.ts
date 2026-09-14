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
import { recordListClearedTransition, recordOutOfStockTransition, recordRestockTransition } from "@/lib/notifications";
import { findInventoryMatches } from "@/lib/item-matching";

/**
 * Case-insensitive exact-name lookup only — never creates. Used wherever a
 * shopping-list item should be auto-linked when it obviously already
 * matches something in inventory, but left unlinked (rather than spawning a
 * near-duplicate item) when it doesn't; the user then resolves it via
 * linkShoppingListItemAction/createInventoryItemFromShoppingListItemAction
 * below (see EditShoppingItemDialog).
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
    await prisma.shoppingList.updateMany({
      where: { id: listId, householdId: household.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
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

export async function generateFromLowStockAction(listId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: listId, householdId: household.id, status: "ACTIVE" },
  });
  if (!list) return { error: "This list can't be edited right now" };

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
      (item) => item.quantity <= item.lowStockThreshold && !alreadyOnListIds.has(item.id),
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
        })),
      });
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  return {};
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
    inventoryItem = await prisma.inventoryItem.create({
      data: {
        householdId,
        name,
        category: newItemDetails.category || "Uncategorized",
        unit: newItemDetails.unit || "pcs",
        quantity: 0,
        lowStockThreshold: 0,
      },
    });
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
): Promise<ActionState & { autoLinkedName?: string }> {
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
    return { autoLinkedName: result.autoLinkedName ?? undefined };
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

/**
 * Links a shopping-list item that didn't resolve to an exact inventory-item
 * match (see findExactInventoryItem above) to an existing inventory item the
 * user picked themselves — the "choose an existing item" half of the
 * mapping dialog (EditShoppingItemDialog).
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
    const inventoryItem = await prisma.inventoryItem.create({
      data: {
        householdId: household.id,
        name: item.name,
        category: trimmedCategory || "Uncategorized",
        quantity: 0,
        lowStockThreshold: 0,
      },
    });

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
    await prisma.$transaction(async (tx) => {
      for (const resolution of resolutions) {
        const item = itemsById.get(resolution.itemId);
        if (!item || item.inventoryItemId !== null) continue;
        shoppingListId = item.shoppingListId;

        if (resolution.kind === "existing") {
          const inventoryItem = await tx.inventoryItem.findFirst({
            where: { id: resolution.inventoryItemId, householdId: household.id },
          });
          if (!inventoryItem) continue;
          await tx.shoppingListItem.update({
            where: { id: item.id },
            data: { inventoryItemId: inventoryItem.id },
          });
        } else {
          const trimmedCategory = resolution.category.trim().slice(0, 60);
          const inventoryItem = await tx.inventoryItem.create({
            data: {
              householdId: household.id,
              name: item.name,
              category: trimmedCategory || "Uncategorized",
              quantity: 0,
              lowStockThreshold: 0,
            },
          });
          await tx.shoppingListItem.update({
            where: { id: item.id },
            data: { inventoryItemId: inventoryItem.id },
          });
        }
        resolvedCount++;
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  if (shoppingListId) {
    revalidatePath(`/dashboard/shopping-list/${shoppingListId}`);
    revalidatePath("/dashboard/inventory");
  }
  return { resolvedCount };
}

export async function togglePurchasedAction(itemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingList: { householdId: household.id } },
    include: { inventoryItem: true },
  });
  if (!item) return { error: "Item not found" };

  const nextPurchased = !item.purchased;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.shoppingListItem.update({
        where: { id: item.id },
        data: { purchased: nextPurchased },
      });

      if (item.inventoryItem) {
        const delta = nextPurchased ? item.quantity : -item.quantity;
        const nextQuantity = Math.max(0, item.inventoryItem.quantity + delta);
        await tx.inventoryItem.update({
          where: { id: item.inventoryItem.id },
          data: { quantity: nextQuantity },
        });
        await recordOutOfStockTransition(tx, household.id, item.inventoryItem.id, item.inventoryItem.quantity, nextQuantity);
        await recordRestockTransition(
          tx,
          household.id,
          item.inventoryItem.id,
          item.inventoryItem.quantity,
          item.inventoryItem.lowStockThreshold,
          nextQuantity,
          item.inventoryItem.lowStockThreshold,
        );

        if (nextPurchased && item.estimatedPrice != null) {
          await tx.priceHistory.create({
            data: { inventoryItemId: item.inventoryItem.id, price: item.estimatedPrice },
          });
        }
      }

      if (nextPurchased) {
        const remainingPending = await tx.shoppingListItem.count({
          where: { shoppingListId: item.shoppingListId, purchased: false },
        });
        await recordListClearedTransition(tx, household.id, item.shoppingListId, remainingPending + 1, remainingPending);
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
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

  await prisma.$transaction(async (tx) => {
    for (const match of validMatches) {
      const item = itemsById.get(match.shoppingListItemId)!;
      const convertedPrice = Math.round(match.price * rate * 100) / 100;
      totalAmount += convertedPrice;

      await tx.shoppingListItem.update({
        where: { id: item.id },
        data: { estimatedPrice: convertedPrice, purchased: true },
      });

      if (item.inventoryItem) {
        await tx.inventoryItem.update({
          where: { id: item.inventoryItem.id },
          data: { quantity: item.inventoryItem.quantity + item.quantity },
        });
        await tx.priceHistory.create({
          data: { inventoryItemId: item.inventoryItem.id, price: convertedPrice },
        });
      }
    }
  });

  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/budget");

  return { itemsUpdated: validMatches.length, totalAmount };
}

export async function deleteShoppingListItemAction(itemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

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
        await recordListClearedTransition(tx, household.id, item.shoppingListId, remainingPending + 1, remainingPending);
      });
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  return {};
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
  // mapping" row UI (EditShoppingItemDialog / linkShoppingListItemAction /
  // createInventoryItemFromShoppingListItemAction above / batch resolution
  // via resolveShoppingListMappingsAction below), completed list or not.
  const unresolvedCount = list.items.filter((item) => item.inventoryItemId === null).length;

  await prisma.shoppingList.update({
    where: { id: list.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

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
