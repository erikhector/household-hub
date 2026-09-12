"use server";

import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";

// Kept in its own file rather than folded into actions.ts (already large):
// these two are household-member-scoped mutations on ShoppingListShareLink,
// paired with the genuinely unauthenticated token-only actions in
// src/app/share/shopping-list/actions.ts that the public page calls instead.
// See REQUIREMENTS.md's shopping-list "Share link" subsection for the full
// permissions model (no login, manual revoke only, member-not-owner scoped —
// same convention as deleteShoppingListAction and the rest of this feature).

// Same header-derived-base-URL approach as household.ts's absoluteAppUrl —
// see its doc comment for why a client-supplied origin can never be trusted
// here: a forged Host/X-Forwarded-Host header would let anyone get this app
// to hand back a share URL pointing at an attacker-controlled domain, with a
// real, working token embedded in it.
async function absoluteAppUrl(path: string): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return `${configured}${path}`;

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}${path}`;
}

/**
 * Any household member (not owner-gated — matches deleteShoppingListAction's
 * convention that shopping-list actions are member-, not owner-, scoped)
 * creates or reuses this list's active share link. Reuses rather than
 * piling up duplicate active tokens for repeat clicks of the same "Share"
 * button.
 */
export async function createShareLinkAction(
  shoppingListId: string,
): Promise<ActionState & { url?: string; shareLinkId?: string }> {
  const { household } = await requireHousehold();

  const list = await prisma.shoppingList.findFirst({
    where: { id: shoppingListId, householdId: household.id },
  });
  if (!list) return { error: "Shopping list not found" };

  let shareLink;
  try {
    shareLink = await prisma.shoppingListShareLink.findFirst({
      where: { shoppingListId: list.id, revokedAt: null },
    });
    if (!shareLink) {
      shareLink = await prisma.shoppingListShareLink.create({
        data: { shoppingListId: list.id, token: randomUUID() },
      });
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  const url = await absoluteAppUrl(`/share/shopping-list/${shareLink.token}`);
  revalidatePath(`/dashboard/shopping-list/${list.id}`);
  return { url, shareLinkId: shareLink.id };
}

/**
 * Any household member can revoke — re-validates the link belongs to a list
 * in the caller's household before touching it, the same IDOR guard every
 * other id-targeted action in this feature uses.
 */
export async function revokeShareLinkAction(shareLinkId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  const shareLink = await prisma.shoppingListShareLink.findFirst({
    where: { id: shareLinkId, shoppingList: { householdId: household.id } },
  });
  if (!shareLink) return { error: "Share link not found" };

  try {
    await prisma.shoppingListShareLink.update({
      where: { id: shareLink.id },
      data: { revokedAt: new Date() },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath(`/dashboard/shopping-list/${shareLink.shoppingListId}`);
  return {};
}
