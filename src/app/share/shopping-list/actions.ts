"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { toFriendlyError } from "@/lib/actions/errors";
import { recordListClearedTransition, recordOutOfStockTransition, recordRestockTransition } from "@/lib/notifications";

// Genuinely unauthenticated actions reached via the token-only public page at
// src/app/share/shopping-list/[token]/page.tsx — there is no session on this
// path at all (no requireHousehold call anywhere below), by product
// decision: the token itself IS the credential, same frictionless model as
// /join/[token]. See REQUIREMENTS.md's shopping-list "Share link" subsection
// for the full permissions model.
//
// The critical security boundary in this file is
// toggleItemViaShareTokenAction re-validating that the itemId the client
// sent actually belongs to the specific ShoppingList this token points at —
// never trust a client pairing a valid token with an arbitrary itemId from a
// *different* list (or household). Every lookup below re-derives the list
// from the token first, then scopes the item query to that list's id, the
// same "always re-derive the tenant boundary server-side" shape
// requireHousehold()-scoped actions use, just with the token standing in for
// the session.

async function findActiveShareLink(token: string) {
  return prisma.shoppingListShareLink.findUnique({
    where: { token },
  });
}

export type SharedShoppingListItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  purchased: boolean;
};

export type SharedShoppingList = {
  id: string;
  name: string;
  items: SharedShoppingListItem[];
};

/**
 * Public lookup for the share page itself. Returns null for an unknown
 * token OR a revoked one (indistinguishable to the visitor — there's no
 * reason to leak which) so the page can render a single "not found or
 * revoked" state.
 */
export async function getShoppingListByShareToken(token: string): Promise<SharedShoppingList | null> {
  const shareLink = await findActiveShareLink(token);
  if (!shareLink || shareLink.revokedAt) return null;

  const list = await prisma.shoppingList.findUnique({
    where: { id: shareLink.shoppingListId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!list) return null;

  return {
    id: list.id,
    name: list.name,
    items: list.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      purchased: item.purchased,
    })),
  };
}

/**
 * Unauthenticated equivalent of togglePurchasedAction
 * (src/app/dashboard/shopping-list/actions.ts) — replicates its exact side
 * effects (flip `purchased`, adjust the linked InventoryItem's quantity,
 * recordOutOfStockTransition, log PriceHistory), just reached via a share
 * token instead of requireHousehold(). See this file's top doc comment for
 * why the itemId/token pairing check below is the actual security boundary,
 * not optional defensive dressing.
 */
export async function toggleItemViaShareTokenAction(
  token: string,
  itemId: string,
): Promise<{ error?: string }> {
  const shareLink = await findActiveShareLink(token);
  if (!shareLink || shareLink.revokedAt) {
    return { error: "This share link is invalid or has been revoked" };
  }

  // Scoped to shareLink.shoppingListId, not just "any item with this id" —
  // this is what stops a visitor from taking a valid token for list A and
  // pairing it with an itemId from list B (their own, or guessed/enumerated)
  // to toggle an item they were never granted access to.
  const item = await prisma.shoppingListItem.findFirst({
    where: { id: itemId, shoppingListId: shareLink.shoppingListId },
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

      const list = await tx.shoppingList.findUnique({
        where: { id: item.shoppingListId },
        select: { householdId: true },
      });

      if (item.inventoryItem) {
        const delta = nextPurchased ? item.quantity : -item.quantity;
        const nextQuantity = Math.max(0, item.inventoryItem.quantity + delta);
        await tx.inventoryItem.update({
          where: { id: item.inventoryItem.id },
          data: { quantity: nextQuantity },
        });
        if (list) {
          await recordOutOfStockTransition(
            tx,
            list.householdId,
            item.inventoryItem.id,
            item.inventoryItem.quantity,
            nextQuantity,
          );
          await recordRestockTransition(
            tx,
            list.householdId,
            item.inventoryItem.id,
            item.inventoryItem.quantity,
            item.inventoryItem.lowStockThreshold,
            nextQuantity,
            item.inventoryItem.lowStockThreshold,
          );
        }

        if (nextPurchased && item.estimatedPrice != null) {
          await tx.priceHistory.create({
            data: { inventoryItemId: item.inventoryItem.id, price: item.estimatedPrice },
          });
        }
      }

      if (list && nextPurchased) {
        const remainingPending = await tx.shoppingListItem.count({
          where: { shoppingListId: item.shoppingListId, purchased: false },
        });
        await recordListClearedTransition(tx, list.householdId, item.shoppingListId, remainingPending + 1, remainingPending);
      }
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/share/shopping-list/${token}`);
  revalidatePath(`/dashboard/shopping-list/${item.shoppingListId}`);
  revalidatePath("/dashboard/shopping-list");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");

  return {};
}
