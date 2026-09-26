"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import { toFriendlyError } from "@/lib/actions/errors";
import { Prisma } from "@/generated/prisma/client";
import {
  buildTemplateItems,
  MAX_TEMPLATE_ITEMS,
  resolveTemplateRows,
  TEMPLATE_NAME_MAX_LENGTH,
  type TemplateItemInput,
} from "@/lib/shopping/list-templates";

// GAP-4: reusable named shopping-list templates. Kept in its own file
// rather than folded into actions.ts (already ~1,700 lines and edited by
// most shopping-list work), the same way share-actions.ts is. Every action
// here is household-member-scoped via requireHousehold() — same as
// deleteShoppingListAction and the rest of this feature — and re-checks
// that each list/template id it's handed belongs to that household before
// touching it. See REQUIREMENTS.md's shopping-list "List templates"
// subsection.

const templateNameSchema = z.string().trim().min(1).max(TEMPLATE_NAME_MAX_LENGTH);

const saveTemplateSchema = z.object({
  listId: z.string().min(1),
  name: templateNameSchema,
});

async function templateNameTaken(householdId: string, name: string) {
  // Case-insensitive so "BBQ" and "bbq" can't both exist — the DB's
  // @@unique([householdId, name]) is case-sensitive and only a backstop
  // for two concurrent saves.
  const existing = await prisma.shoppingListTemplate.findFirst({
    where: { householdId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  return existing !== null;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Form action for the list ⋯ menu's "Save as template" dialog: snapshots
 * the list's current items (see buildTemplateItems) under a new name.
 * Refuses a name already in use instead of overwriting — an overwrite
 * would silently throw away whatever the other template held.
 */
export async function saveAsTemplateAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).shoppingList.templates;

  const parsed = saveTemplateSchema.safeParse({
    listId: formData.get("listId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: dict.errors.invalidName };

  const list = await prisma.shoppingList.findFirst({
    where: { id: parsed.data.listId, householdId: household.id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!list) return { error: dict.errors.listNotFound };

  const items = buildTemplateItems(list.items);
  if (items.length === 0) return { error: dict.errors.emptyList };
  if (items.length > MAX_TEMPLATE_ITEMS) {
    return { error: format(dict.errors.tooManyItems, { max: MAX_TEMPLATE_ITEMS }) };
  }

  const name = parsed.data.name;
  if (await templateNameTaken(household.id, name)) {
    return { error: format(dict.errors.nameTaken, { name }) };
  }

  try {
    await prisma.shoppingListTemplate.create({
      data: {
        householdId: household.id,
        name,
        items: { create: items.map((item, position) => ({ ...item, position })) },
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: format(dict.errors.nameTaken, { name }) };
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  return {};
}

/**
 * Stamps a template out as a brand-new ACTIVE list named after it, then
 * opens that list. Rows are re-linked to inventory by resolveTemplateRows —
 * the same resolver importShoppingListItemsAction uses — so a template needs
 * no linking logic of its own. The list and its items are created in one
 * nested write so a failure can't leave an empty list behind. Never touches
 * AUTO-8's default list: this is always a separate list.
 */
export async function createListFromTemplateAction(templateId: string): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).shoppingList.templates;

  const template = await prisma.shoppingListTemplate.findFirst({
    where: { id: templateId, householdId: household.id },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!template) return { error: dict.errors.notFound };

  let list;
  try {
    const inventoryItems = await prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, unit: true, lastKnownPrice: true },
    });
    list = await prisma.shoppingList.create({
      data: {
        householdId: household.id,
        name: template.name,
        items: { create: resolveTemplateRows(template.items, inventoryItems) },
      },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  redirect(`/dashboard/shopping-list/${list.id}`);
}

export type TemplateSnapshot = { name: string; items: TemplateItemInput[] };

/**
 * Deletes a template straight away — "undo over confirm" — and hands back
 * what it held so the toast's Undo can put it back with
 * restoreShoppingListTemplateAction.
 */
export async function deleteShoppingListTemplateAction(
  templateId: string,
): Promise<ActionState & { snapshot?: TemplateSnapshot }> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).shoppingList.templates;

  const template = await prisma.shoppingListTemplate.findFirst({
    where: { id: templateId, householdId: household.id },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!template) return { error: dict.errors.notFound };

  try {
    await prisma.shoppingListTemplate.deleteMany({
      where: { id: template.id, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  return {
    snapshot: {
      name: template.name,
      items: template.items.map(({ name, quantity, unit, inventoryItemId }) => ({
        name,
        quantity,
        unit,
        inventoryItemId,
      })),
    },
  };
}

const snapshotSchema = z.object({
  name: templateNameSchema,
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        quantity: z.number().min(0.01).max(100000),
        unit: z.string().trim().max(20),
        inventoryItemId: z.string().min(1).nullable(),
      }),
    )
    .min(1)
    .max(MAX_TEMPLATE_ITEMS),
});

/**
 * The Undo for deleteShoppingListTemplateAction. The snapshot comes back
 * from the client, so it's validated like any other input and every
 * inventoryItemId in it is re-checked against the caller's household —
 * one that isn't theirs (or was deleted in the meantime) is dropped to
 * null rather than trusted, and gets re-resolved by name on next use.
 */
export async function restoreShoppingListTemplateAction(snapshot: TemplateSnapshot): Promise<ActionState> {
  const { household } = await requireHousehold();
  const dict = (await getDictionary()).shoppingList.templates;

  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) return { error: dict.errors.invalidName };

  const { name, items } = parsed.data;
  if (await templateNameTaken(household.id, name)) {
    return { error: format(dict.errors.nameTaken, { name }) };
  }

  try {
    const linkedIds = [...new Set(items.flatMap((item) => (item.inventoryItemId ? [item.inventoryItemId] : [])))];
    const owned = linkedIds.length
      ? await prisma.inventoryItem.findMany({
          where: { id: { in: linkedIds }, householdId: household.id },
          select: { id: true },
        })
      : [];
    const ownedIds = new Set(owned.map((item) => item.id));

    await prisma.shoppingListTemplate.create({
      data: {
        householdId: household.id,
        name,
        items: {
          create: items.map((item, position) => ({
            ...item,
            inventoryItemId: item.inventoryItemId && ownedIds.has(item.inventoryItemId) ? item.inventoryItemId : null,
            position,
          })),
        },
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { error: format(dict.errors.nameTaken, { name }) };
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/shopping-list");
  return {};
}
