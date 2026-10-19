"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import type { ActionState } from "@/lib/actions/auth";
import { fail, toFriendlyError, v, zodFail } from "@/lib/actions/errors";
import { bulkEditableFields, type BulkEditableField } from "@/lib/inventory/bulk-editable-fields";
import { recordOutOfStockTransition, recordOutOfStockTransitions } from "@/lib/notifications";
import {
  addItemToDefaultList,
  addToDefaultListOnLowStock,
  addToDefaultListOnLowStockBatch,
  revalidateAutoAdded,
  type AutoAddedItem,
} from "@/lib/shopping/default-list";
import { createCategoryResolver, scheduleAiCategoryFallback } from "@/lib/inventory/category-resolver";
import { nextQuantityAfterDelta } from "@/lib/inventory/stock-change";
import { normalizeBarcode } from "@/lib/barcode";
import { releaseBarcode } from "@/lib/inventory/barcode-link";
import { estimatedExpiryUpdate, sameCalendarDay } from "@/lib/inventory/shelf-life";
import { frozenExpiryUpdate, openedExpiryUpdate } from "@/lib/inventory/expiry";
import { canonicalUnit } from "@/lib/units";

const itemSchema = z.object({
  name: z.string().trim().min(1, v("nameRequired")).max(120, v("nameTooLong")),
  // Left blank on the create form or the quick-add bar, a new item gets a
  // category guessed from its name (AUTO-2, see createCategoryResolver),
  // falling back to the locale's "Uncategorized" label — never blocking the
  // add on picking a category up front. On the edit form, blank means the
  // user cleared it on purpose, so it's never re-guessed there.
  category: z.string().trim().max(60, v("categoryTooLong")).optional(),
  // Rounded to at most 2 decimal places at the boundary — the display and
  // meal-cooking decrement (cooking-actions.ts) assume the same precision,
  // and rounding here keeps stray float drift (e.g. entering 0.1 + 0.2) out
  // of storage rather than just hiding it later.
  quantity: z.coerce
    .number()
    .min(0, v("quantityNegative"))
    .transform((n) => Math.round(n * 100) / 100),
  unit: z.string().trim().min(1).max(20, v("unitTooLong")).default("pcs"),
  lowStockThreshold: z.coerce.number().min(0, v("thresholdNegative")),
  location: z.string().trim().max(120, v("locationTooLong")).optional(),
  // Native <input type="date"> value ("" when left blank). A date typed
  // here is always real (never AUTO-7's estimate) — see
  // expiresAtEstimated: false below, unconditional on both create and
  // update.
  expiresAt: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : null)),
  // AUTO-7: the item form's "doesn't expire" checkbox — native checkboxes
  // only appear in FormData when checked ("on"), so a missing/blank value
  // means unchecked. Checking it sets shelfLifeDays to -1 (Grocy's "never"
  // convention) and clears any date, permanently opting the item out of
  // both manual and estimated expiry tracking until unchecked again.
  neverExpires: z
    .string()
    .optional()
    .transform((value) => value === "on"),
  // GAP-28: "use within N days once opened" — blank means "not tracked"
  // (null), which also hides the row's "Mark opened" button. Capped at ten
  // years only to keep a typo from overflowing the date maths; anything
  // real is days or weeks.
  useWithinDaysOpened: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== "" ? Number(value) : null))
    .refine(
      (days) => days === null || (Number.isInteger(days) && days > 0 && days <= 3650),
      v("useWithinDaysInvalid"),
    ),
});

const starterKitSchema = z.object({
  category: z.string().trim().min(1).max(60),
  names: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
});

export async function createInventoryItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit") || "pcs",
    lowStockThreshold: formData.get("lowStockThreshold"),
    location: formData.get("location") || undefined,
    expiresAt: formData.get("expiresAt") || undefined,
    neverExpires: formData.get("neverExpires") || undefined,
    useWithinDaysOpened: formData.get("useWithinDaysOpened") || undefined,
  });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }
  // Split out of the spread below — neither is an InventoryItem column by
  // that name (see AUTO-7's expiresAt/shelfLifeDays handling just after).
  const { neverExpires, expiresAt, useWithinDaysOpened, ...rest } = parsed.data;

  try {
    // Blank on both sides of `||` means household memory and the
    // dictionary both missed — AUTO-2b(a)'s AI fallback only ever gets a
    // chance at names that reach this point.
    const guessed = parsed.data.category || (await createCategoryResolver(household.id)(parsed.data.name));
    const category = guessed || (await getDictionary()).inventory.uncategorized;
    const data = {
      householdId: household.id,
      ...rest,
      category,
      updatedByUserId: userId,
      // AUTO-7: a date typed on this form is always real, never the
      // estimator's; "doesn't expire" clears any date and permanently
      // opts the item out (shelfLifeDays -1) instead of leaving it to the
      // category default (null).
      expiresAt: neverExpires ? null : expiresAt,
      expiresAtEstimated: false,
      shelfLifeDays: neverExpires ? -1 : null,
      // GAP-28: an item that never expires has no opened clock either —
      // "Mark opened" would otherwise hand it a date it opted out of.
      useWithinDaysOpened: neverExpires ? null : useWithinDaysOpened,
    };
    // A code scanned with the form's "Scan barcode" button is remembered on
    // the new item (AUTO-6), so the next scan of it resolves straight here.
    // Only then is a transaction needed — the code may have to move off
    // another item first (see releaseBarcode).
    const barcode = normalizeBarcode(String(formData.get("barcode") ?? ""));
    if (barcode) {
      await prisma.$transaction(async (tx) => {
        await releaseBarcode(tx, household.id, barcode);
        await tx.inventoryItem.create({ data: { ...data, barcode } });
      });
    } else {
      await prisma.inventoryItem.create({ data });
    }
    if (!guessed) scheduleAiCategoryFallback(household.id, [parsed.data.name]);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}

export async function updateInventoryItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState & { autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const itemId = String(formData.get("itemId") ?? "");
  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    quantity: formData.get("quantity"),
    unit: formData.get("unit") || "pcs",
    lowStockThreshold: formData.get("lowStockThreshold"),
    location: formData.get("location") || undefined,
    expiresAt: formData.get("expiresAt") || undefined,
    neverExpires: formData.get("neverExpires") || undefined,
    useWithinDaysOpened: formData.get("useWithinDaysOpened") || undefined,
  });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }
  // Split out of the spread below — see createInventoryItemAction's matching
  // comment.
  const { neverExpires, expiresAt, useWithinDaysOpened, ...rest } = parsed.data;

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return await fail("itemNotFound");

  // MATCH-6 (design §4, §6.1): the form's unit field is a plain edit only
  // while nothing is measured in the old unit. With stock, or with saved
  // conversions (whose factors are per old unit), a bare rename would
  // silently rescale them ("1 pcs" of flour becoming "1 g"), so the change
  // goes through the item page's "Change unit…", which converts them.
  if (canonicalUnit(parsed.data.unit) !== canonicalUnit(item.unit)) {
    const measuredInOldUnit =
      item.quantity > 0 || (await prisma.itemUnitConversion.count({ where: { inventoryItemId: item.id } })) > 0;
    if (measuredInOldUnit) return { error: (await getDictionary()).inventory.unitChangeNeedsItemPage };
  }

  const category = parsed.data.category || (await getDictionary()).inventory.uncategorized;

  // AUTO-7: "editing the date in the item form makes it real" means the
  // *date*, not the form — saving an unrelated field (name, quantity, a
  // category typo fix) must not silently discard an existing estimate.
  // Compared at day granularity (see sameCalendarDay's doc comment): only a
  // date that actually changed — including being cleared — flips
  // expiresAtEstimated back to false. Left untouched, it stays whatever it
  // already was.
  const nextExpiresAt = neverExpires ? null : expiresAt;
  const dateChanged = !sameCalendarDay(nextExpiresAt, item.expiresAt ?? null);


  let autoAdded: AutoAddedItem | null = null;
  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      // `location` is spread explicitly (not via `...rest`) so clearing
      // the field to empty actually nulls it out — Prisma drops `undefined`
      // keys from an update instead of writing them, which would otherwise
      // leave a stale location in place.
      data: {
        ...rest,
        category,
        location: parsed.data.location ?? null,
        updatedByUserId: userId,
        // "Doesn't expire" clears any date and permanently opts the item
        // out (shelfLifeDays -1); unchecking it resets shelfLifeDays back
        // to null (the category default) rather than leaving -1 in place.
        expiresAt: nextExpiresAt,
        ...(dateChanged ? { expiresAtEstimated: false } : {}),
        shelfLifeDays: neverExpires ? -1 : null,
        // GAP-28: see createInventoryItemAction. Clearing the setting leaves
        // an existing `openedAt` in place — the pack *was* opened, and the
        // "Opened" tag stays true until the next restock from zero resets it.
        useWithinDaysOpened: neverExpires ? null : useWithinDaysOpened,
      },
    });
    await recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, parsed.data.quantity, userId);
    autoAdded = await addToDefaultListOnLowStock(prisma, household.id, item.id, item.quantity, parsed.data.quantity);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/items/[id]", "page");
  revalidatePath("/dashboard");
  revalidateAutoAdded([autoAdded]);
  return autoAdded ? { autoAdded: [autoAdded] } : {};
}

// Rapid-entry path for the quick-add bar/grid: no dialog round trip, so a
// household starting from zero items (or blitzing through a shelf) can fire
// off several adds in a row by typing and pressing Enter. `quantity`/`unit`/
// `category` are optional — left out entirely, this defaults exactly the
// way a blank create-form submission would (qty 1, "pcs", a category guessed
// from the name or else "Uncategorized").
export async function quickAddInventoryItemAction(input: {
  name: string;
  quantity?: number;
  unit?: string;
  category?: string;
}): Promise<{ error?: string; name?: string }> {
  const { household, userId } = await requireHousehold();

  const parsed = itemSchema.safeParse({
    name: input.name,
    category: input.category,
    quantity: input.quantity ?? 1,
    unit: input.unit || "pcs",
    lowStockThreshold: 1,
  });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  // `neverExpires` is a form-only flag (itemSchema's transform always sets
  // it, false when absent), not an InventoryItem column — spreading it into
  // create() makes Prisma reject the whole insert with "Unknown argument".
  // Quick-add never offers it, so it's simply dropped here.
  const { neverExpires, ...itemData } = parsed.data;
  void neverExpires;

  try {
    const guessed = itemData.category || (await createCategoryResolver(household.id)(itemData.name));
    const category = guessed || (await getDictionary()).inventory.uncategorized;
    await prisma.inventoryItem.create({
      data: { householdId: household.id, ...itemData, category, updatedByUserId: userId },
    });
    if (!guessed) scheduleAiCategoryFallback(household.id, [parsed.data.name]);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { name: parsed.data.name };
}

const bulkCreateItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.coerce
    .number()
    .min(0)
    .default(1)
    .transform((n) => Math.round(n * 100) / 100),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  // Per-item suggestion (a barcode scan's Open Food Facts category) — used
  // only when the batch's shared category is blank.
  category: z.string().trim().max(60).optional(),
  // The scan queue's code for this row, remembered on the created item
  // (AUTO-6). Anything not barcode-shaped is dropped, not rejected.
  barcode: z.string().trim().max(20).optional(),
});

const bulkCreateSchema = z.object({
  items: z.array(bulkCreateItemSchema).min(1).max(300),
  category: z.string().trim().max(60).optional(),
  location: z.string().trim().max(120).optional(),
});

// Shared batch-insert path for the scan queue and the pasted-list review
// screen — both land here with a flat list of {name, quantity, unit} plus
// one category/location applied to the whole batch (a scanning or unpacking
// session is almost always one shelf/drawer at a time). With no shared
// category, each item gets its own: the per-item suggestion if there is one,
// else a guess from its name (AUTO-2), else "Uncategorized". Mirrors
// addStarterKitItemsAction's case-insensitive dedupe against what the
// household already has, so re-running a scan session over the same shelf
// doesn't create duplicate rows — it just skips the repeats.
export async function bulkCreateInventoryItemsAction(
  items: { name: string; quantity?: number; unit?: string; category?: string; barcode?: string }[],
  shared?: { category?: string; location?: string },
): Promise<{ error?: string; added?: number; skipped?: number }> {
  const { household, userId } = await requireHousehold();

  const parsed = bulkCreateSchema.safeParse({ items, category: shared?.category, location: shared?.location });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  const dict = await getDictionary();
  const location = parsed.data.location || null;

  let added = 0;
  let skipped = 0;
  try {
    const existing = await prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { name: true, category: true },
    });
    const existingNames = new Set(existing.map((item) => item.name.trim().toLowerCase()));
    const resolveCategory = createCategoryResolver(household.id, existing);

    // Later duplicates within the same batch (two rows scanned/pasted for
    // the same item) merge into one row by summing quantity, rather than
    // creating two rows or silently dropping the second.
    const merged = new Map<
      string,
      { name: string; quantity: number; unit: string; category?: string; barcode?: string }
    >();
    for (const item of parsed.data.items) {
      const key = item.name.toLowerCase();
      if (existingNames.has(key)) {
        skipped += 1;
        continue;
      }
      const prev = merged.get(key);
      merged.set(
        key,
        prev ? { ...prev, quantity: Math.round((prev.quantity + item.quantity) * 100) / 100 } : item,
      );
    }

    const toAdd = [];
    const aiCandidates: string[] = [];
    // A code can only land on one new row (the unique index would reject
    // the whole createMany otherwise) — the first row that carries it wins.
    const seenBarcodes = new Set<string>();
    for (const item of merged.values()) {
      const guessed = parsed.data.category || item.category || (await resolveCategory(item.name));
      const category = guessed || dict.inventory.uncategorized;
      if (!guessed) aiCandidates.push(item.name);
      let barcode = item.barcode ? normalizeBarcode(item.barcode) : null;
      if (barcode && seenBarcodes.has(barcode)) barcode = null;
      if (barcode) seenBarcodes.add(barcode);
      toAdd.push({ ...item, category, barcode });
    }
    if (toAdd.length > 0) {
      const data = toAdd.map((item) => ({
        householdId: household.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        location,
        lowStockThreshold: 1,
        updatedByUserId: userId,
        barcode: item.barcode,
        // AUTO-7: a bulk-created item is a brand-new row (no prior
        // expiresAt to protect), so this only ever fills in an estimate
        // when the item's category has a known shelf life — see
        // estimatedExpiryUpdate's doc comment. This is the one deliberate
        // exception to "never set by any bulk-add flow" in
        // REQUIREMENTS.md, and only for an *estimated* date.
        ...estimatedExpiryUpdate(
          { expiresAt: null, expiresAtEstimated: false, shelfLifeDays: null, category: item.category },
          0,
          item.quantity,
        ),
      }));
      if (seenBarcodes.size > 0) {
        // Same move-don't-share rule as every other link (releaseBarcode):
        // a scanned code already on an older item follows the new one.
        await prisma.$transaction(async (tx) => {
          for (const barcode of seenBarcodes) await releaseBarcode(tx, household.id, barcode);
          await tx.inventoryItem.createMany({ data });
        });
      } else {
        await prisma.inventoryItem.createMany({ data });
      }
      if (aiCandidates.length > 0) scheduleAiCategoryFallback(household.id, aiCandidates);
    }
    added = toAdd.length;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { added, skipped };
}

const bulkSetQuantitySchema = z.object({
  updates: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        quantity: z.coerce
          .number()
          .min(0)
          .transform((n) => Math.round(n * 100) / 100),
      }),
    )
    .min(1)
    .max(300),
});

// "Take stock" path for the AI shelf scan's restock mode
// (src/components/inventory/ai-shelf-scan-dialog.tsx, src/lib/actions/inventory-scan.ts):
// unlike bulkCreateInventoryItemsAction's additive dedupe, every update here
// *sets* an already-existing item's quantity to what was just counted —
// the household looked straight at the shelf, so the scanned count is the
// new truth, not a delta to add on top of what was already on record.
// Silently skips any itemId that isn't (or is no longer) one of this
// household's items rather than erroring the whole batch over it.
export async function bulkSetInventoryQuantitiesAction(
  updates: { itemId: string; quantity: number }[],
): Promise<{ error?: string; updated?: number; autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const parsed = bulkSetQuantitySchema.safeParse({ updates });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  let updated = 0;
  const autoAdded: AutoAddedItem[] = [];
  try {
    // A repeated itemId keeps its last count (what the old per-row loop
    // ended up with), and is judged once against the row as it was before.
    const newQuantityById = new Map(parsed.data.updates.map((u) => [u.itemId, u.quantity]));
    const items = await prisma.inventoryItem.findMany({
      where: { householdId: household.id, id: { in: [...newQuantityById.keys()] } },
    });
    // Everything below runs in a fixed number of queries however big the
    // batch is (PERF-15): a scan of 300 shelves used to cost 6-9 sequential
    // round trips per item. `quantity` differs per row, so it's one
    // UPDATE ... FROM (unnest) rather than updateMany; the household filter
    // stays in the statement so an id from another household can't match.
    if (items.length > 0) {
      await prisma.$executeRaw`
        UPDATE "InventoryItem" AS i
        SET "quantity" = v."quantity", "updatedByUserId" = ${userId}, "updatedAt" = NOW()
        FROM unnest(${items.map((item) => item.id)}::text[], ${items.map((item) => newQuantityById.get(item.id)!)}::double precision[])
          AS v("id", "quantity")
        WHERE i."id" = v."id" AND i."householdId" = ${household.id}`;
    }
    updated = items.length;

    const changes = items.map((item) => ({
      item,
      previousQuantity: item.quantity,
      nextQuantity: newQuantityById.get(item.id)!,
    }));
    // The alert rows and the auto-add touch different tables, so they can
    // overlap.
    const [, added] = await Promise.all([
      recordOutOfStockTransitions(
        prisma,
        household.id,
        changes.map(({ item, previousQuantity, nextQuantity }) => ({
          itemId: item.id,
          name: item.name,
          previousQuantity,
          nextQuantity,
        })),
        userId,
      ),
      addToDefaultListOnLowStockBatch(prisma, household.id, changes),
    ]);
    autoAdded.push(...added);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded(autoAdded);
  return { updated, autoAdded };
}

// Bulk-inserts a starter kit's selected items in one round trip. `category`
// and `names` arrive already translated by the client — it rendered them
// from the same locale dictionary this server action would otherwise have
// to re-resolve — so this only re-validates shape/length, not locale.
// Case-insensitively skips names the household already has so re-adding a
// kit (or overlapping two kits) doesn't create duplicate rows.
export async function addStarterKitItemsAction(
  category: string,
  names: string[],
): Promise<{ error?: string; added?: number }> {
  const { household, userId } = await requireHousehold();

  const parsed = starterKitSchema.safeParse({ category, names });
  if (!parsed.success) {
    return await zodFail(parsed.error);
  }

  let added = 0;
  try {
    const existing = await prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((item) => item.name.trim().toLowerCase()));
    const toAdd = [...new Set(parsed.data.names)].filter((name) => !existingNames.has(name.toLowerCase()));

    if (toAdd.length > 0) {
      await prisma.inventoryItem.createMany({
        data: toAdd.map((name) => ({
          householdId: household.id,
          name,
          category: parsed.data.category,
          quantity: 1,
          unit: "pcs",
          lowStockThreshold: 1,
          updatedByUserId: userId,
        })),
      });
    }
    added = toAdd.length;
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return { added };
}

export async function adjustQuantityAction(
  itemId: string,
  delta: number,
): Promise<ActionState & { autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return await fail("itemNotFound");

  const nextQuantity = nextQuantityAfterDelta(item.quantity, delta);
  let autoAdded: AutoAddedItem | null = null;
  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: nextQuantity, updatedByUserId: userId },
    });
    await recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, nextQuantity, userId);
    autoAdded = await addToDefaultListOnLowStock(prisma, household.id, item.id, item.quantity, nextQuantity);
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/items/[id]", "page");
  revalidatePath("/dashboard");
  revalidateAutoAdded([autoAdded]);
  return autoAdded ? { autoAdded: [autoAdded] } : {};
}

// Zeroes an item's quantity in one click and, optionally, drops it onto the
// household's default "Next shop" list (AUTO-8) — which replaced the old
// guess of "the most recently created ACTIVE list", so a mark-empty always
// lands on the same list the low-stock auto-add fills. Dedupes against an
// already-pending entry for the same inventory item like
// generateFromLowStockAction does, so repeated "mark empty" clicks don't
// pile up duplicate rows.
//
// The two menu entries differ only when auto-add wouldn't cover it:
// "Mark as empty & add to shopping list" is an explicit request, so it adds
// regardless of the household's auto-add setting or whether the item was
// already low, and the row isn't flagged `addedAutomatically` (a person
// asked for it). Plain "Mark as empty" behaves like any other decrease — an
// in-stock item crossing to 0 is auto-added (with Undo) when the setting is
// on, and nothing is added otherwise.
export async function markItemEmptyAction(
  itemId: string,
  addToShoppingList: boolean,
): Promise<{ listName?: string; autoAdded?: AutoAddedItem[]; error?: string }> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return await fail("itemNotFound");

  let autoAdded: AutoAddedItem | null = null;
  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { quantity: 0, updatedByUserId: userId },
    });
    await recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, 0, userId);
    if (!addToShoppingList) {
      autoAdded = await addToDefaultListOnLowStock(prisma, household.id, item.id, item.quantity, 0);
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/items/[id]", "page");
  revalidatePath("/dashboard");

  if (!addToShoppingList) {
    revalidateAutoAdded([autoAdded]);
    return autoAdded ? { autoAdded: [autoAdded] } : {};
  }

  try {
    const { list } = await addItemToDefaultList(prisma, household.id, { ...item, quantity: 0 }, false);

    revalidatePath(`/dashboard/shopping-list/${list.id}`);
    revalidatePath("/dashboard/shopping-list");

    return { listName: list.name };
  } catch (error) {
    return toFriendlyError(error);
  }
}

const addToListSchema = z.array(z.string().min(1)).min(1).max(200);

// UX-122: "Add to shopping list" from a row's menu or the bulk bar. Unlike
// markItemEmptyAction's "& add to shopping list" this never touches the
// stock: buying more spaghetti while one packet is left shouldn't mean
// wiping the count first. Same explicit-request rules as that path: onto the
// default list, regardless of the household's auto-add setting, as a
// person's own row (not `addedAutomatically`), and deduped against a row
// already pending there. Returns how many rows were actually created so the
// toast can say "already on the list" instead of claiming an add.
export async function addInventoryItemsToShoppingListAction(
  itemIds: string[],
): Promise<{ listName?: string; added?: number; alreadyOnList?: number; error?: string }> {
  const { household } = await requireHousehold();

  const parsed = addToListSchema.safeParse(itemIds);
  if (!parsed.success) return await fail("itemNotFound");
  const ids = [...new Set(parsed.data)];

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: ids }, householdId: household.id },
  });
  if (items.length === 0) return await fail("itemNotFound");

  try {
    let listId = "";
    let listName = "";
    let added = 0;
    for (const item of items) {
      const { list, created } = await addItemToDefaultList(prisma, household.id, item, false);
      listId = list.id;
      listName = list.name;
      if (created) added += 1;
    }

    revalidatePath(`/dashboard/shopping-list/${listId}`);
    revalidatePath("/dashboard/shopping-list");
    revalidatePath("/dashboard/inventory");

    return { listName, added, alreadyOnList: items.length - added };
  } catch (error) {
    return toFriendlyError(error);
  }
}

// GAP-28: the expiry fields "Mark opened" overwrites, captured before the
// write so the toast's Undo can put them back exactly — Guardrails' "undo
// over confirm", same shape as MarkCookedDialog's Undo.
export type OpenedUndoSnapshot = {
  openedAt: Date | null;
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
};

// One click on the row's "Mark opened" button: starts the item's shorter
// "use within N days once opened" clock and pulls `expiresAt` in to match
// (see openedExpiryUpdate for the min() rule and the estimate flag). Applied
// immediately with an Undo toast rather than a confirm step. Only offered
// when `useWithinDaysOpened` is set and the item isn't already opened, and
// re-checked here since the row can be stale — a second click (another
// device, a double tap) must not restart the clock and push the deadline
// back out.
export async function markItemOpenedAction(itemId: string): Promise<{
  error?: string;
  openedAt?: Date;
  expiresAt?: Date;
  previous?: OpenedUndoSnapshot;
}> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return await fail("itemNotFound");
  if (item.openedAt) return await fail("itemAlreadyOpened");

  const patch = openedExpiryUpdate(item, item.useWithinDaysOpened);
  if (!patch) return await fail("noUseWithinDays");

  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { ...patch, updatedByUserId: userId },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/items/[id]", "page");
  revalidatePath("/dashboard");
  return {
    openedAt: patch.openedAt,
    expiresAt: patch.expiresAt,
    previous: { openedAt: item.openedAt, expiresAt: item.expiresAt, expiresAtEstimated: item.expiresAtEstimated },
  };
}

const openedUndoSchema = z.object({
  openedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  expiresAtEstimated: z.boolean(),
});

// The Undo on "Mark opened"'s toast. `markedOpenedAt` is the timestamp that
// click wrote — only restored while the item still carries exactly that
// value, so a stale Undo (the toast lingered while the item was restocked
// from zero, or someone else re-marked it) is a quiet no-op instead of
// rolling back changes it didn't make. The snapshot only ever touches the
// three expiry fields of an item in the caller's own household, all of
// which the item form can already set directly, so taking it from the
// client grants nothing new.
export async function undoMarkItemOpenedAction(
  itemId: string,
  markedOpenedAt: Date,
  previous: OpenedUndoSnapshot,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = openedUndoSchema.safeParse(previous);
  if (!parsed.success || !(markedOpenedAt instanceof Date)) return await fail("invalidInput");

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return await fail("itemNotFound");
  if (!item.openedAt || item.openedAt.getTime() !== markedOpenedAt.getTime()) return {};

  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { ...parsed.data, updatedByUserId: userId },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/items/[id]", "page");
  revalidatePath("/dashboard");
  return {};
}

// GAP-44: the expiry fields "Freeze" overwrites, captured before the write
// so the toast's Undo can put them back exactly (same shape as
// OpenedUndoSnapshot).
export type FrozenUndoSnapshot = {
  frozenAt: Date | null;
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
};

// One click on the row's "Freeze" button: moves `expiresAt` out to now +
// the item's freezer window (see frozenExpiryUpdate) and stamps `frozenAt`,
// which drops the item out of EXPIRING_SOON and shows the "Frozen" tag.
// Applied immediately with an Undo toast. Only offered for an item that has
// an expiry date and isn't frozen yet, and re-checked here since the row
// can be stale: a second click must not restart the freezer clock.
export async function freezeItemAction(itemId: string): Promise<{
  error?: string;
  frozenAt?: Date;
  expiresAt?: Date;
  previous?: FrozenUndoSnapshot;
}> {
  const { household, userId } = await requireHousehold();

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return await fail("itemNotFound");
  if (item.frozenAt) return await fail("itemAlreadyFrozen");
  if (!item.expiresAt) return await fail("noExpiryToExtend");

  const patch = frozenExpiryUpdate(item.useWithinDaysFrozen);

  // The `frozenAt: null` filter makes the "not already frozen" check atomic:
  // two concurrent clicks both pass the read above, but only one update
  // matches, so the loser gets the same error instead of overwriting the
  // winner's frozenAt/expiresAt (which would also break the winner's Undo).
  try {
    const { count } = await prisma.inventoryItem.updateMany({
      where: { id: item.id, householdId: household.id, frozenAt: null },
      data: { ...patch, updatedByUserId: userId },
    });
    if (count === 0) return await fail("itemAlreadyFrozen");
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/items/[id]", "page");
  revalidatePath("/dashboard");
  return {
    frozenAt: patch.frozenAt,
    expiresAt: patch.expiresAt,
    previous: { frozenAt: item.frozenAt, expiresAt: item.expiresAt, expiresAtEstimated: item.expiresAtEstimated },
  };
}

const frozenUndoSchema = z.object({
  frozenAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  expiresAtEstimated: z.boolean(),
});

// The Undo on "Freeze"'s toast. Like undoMarkItemOpenedAction it restores
// only while the item still carries exactly the `frozenAt` that click wrote,
// so a stale Undo (restocked or re-frozen since) is a quiet no-op.
export async function undoFreezeItemAction(
  itemId: string,
  markedFrozenAt: Date,
  previous: FrozenUndoSnapshot,
): Promise<ActionState> {
  const { household, userId } = await requireHousehold();

  const parsed = frozenUndoSchema.safeParse(previous);
  if (!parsed.success || !(markedFrozenAt instanceof Date)) return await fail("invalidInput");

  const item = await prisma.inventoryItem.findFirst({
    where: { id: itemId, householdId: household.id },
  });
  if (!item) return await fail("itemNotFound");
  if (!item.frozenAt || item.frozenAt.getTime() !== markedFrozenAt.getTime()) return {};

  try {
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { ...parsed.data, updatedByUserId: userId },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/inventory/items/[id]", "page");
  revalidatePath("/dashboard");
  return {};
}

// Deliberately looser than bulkCreateSchema's 300-row cap on *new* items:
// the inventory table loads every item the household has and its header
// checkbox selects all of them at once, so this has to clear any realistic
// pantry while still bounding the `IN (…)` list a single request can build.
const MAX_BULK_FIELD_ITEM_IDS = 1_000;

const bulkFieldSchemas = {
  category: itemSchema.shape.category,
  location: itemSchema.shape.location,
  unit: itemSchema.shape.unit,
  quantity: itemSchema.shape.quantity,
  lowStockThreshold: itemSchema.shape.lowStockThreshold,
} satisfies Record<BulkEditableField, z.ZodTypeAny>;

// Sets one field to one value across many items at once — e.g. selecting
// every unassigned item and filing them all under "Fridge", or re-filing a
// batch of items under a different category, in one action instead of
// editing each item individually. `updateMany` is scoped to the household
// and the given ids together, so ids for another household's items (or
// already-deleted ids) are silently dropped rather than erroring.
export async function bulkUpdateFieldAction(
  itemIds: string[],
  field: BulkEditableField,
  rawValue: string,
): Promise<ActionState & { updated?: number; autoAdded?: AutoAddedItem[] }> {
  const { household, userId } = await requireHousehold();

  const ids = [...new Set(itemIds)].filter(Boolean);
  if (ids.length === 0) return await fail("noItemsSelected");
  if (ids.length > MAX_BULK_FIELD_ITEM_IDS) {
    return await fail("tooManyItemsAtOnce", { max: MAX_BULK_FIELD_ITEM_IDS });
  }

  if (!bulkEditableFields.includes(field)) {
    return await fail("invalidField");
  }

  const parsed = bulkFieldSchemas[field].safeParse(rawValue);
  if (!parsed.success) {
    return await zodFail(parsed.error, "invalidValue");
  }

  let data: Parameters<typeof prisma.inventoryItem.updateMany>[0]["data"];
  switch (field) {
    case "category":
      // Blank clears back to the locale's "Uncategorized" bucket, same as
      // the single-item form.
      data = { category: (parsed.data as string) || (await getDictionary()).inventory.uncategorized };
      break;
    case "location":
      // Blank explicitly un-assigns the location rather than being dropped
      // as a no-op update, matching the single-item edit form.
      data = { location: (parsed.data as string)?.trim() || null };
      break;
    case "unit":
      data = { unit: parsed.data as string };
      break;
    case "quantity":
      data = { quantity: parsed.data as number };
      break;
    case "lowStockThreshold":
      data = { lowStockThreshold: parsed.data as number };
      break;
  }

  let updated = 0;
  const autoAdded: AutoAddedItem[] = [];
  try {
    // Only needed to detect an out-of-stock/low-stock transition below — skipped for
    // every other field.
    const previousQuantities =
      field === "quantity"
        ? await prisma.inventoryItem.findMany({
            where: { id: { in: ids }, householdId: household.id },
            select: { id: true, quantity: true, lowStockThreshold: true },
          })
        : [];

    const result = await prisma.inventoryItem.updateMany({
      where: { id: { in: ids }, householdId: household.id },
      data: { ...data, updatedByUserId: userId },
    });
    updated = result.count;

    if (field === "quantity") {
      const nextQuantity = parsed.data as number;
      await Promise.all(
        previousQuantities.map((item) =>
          recordOutOfStockTransition(prisma, household.id, item.id, item.quantity, nextQuantity, userId),
        ),
      );
      // Sequential, unlike the notifications above: the first crossing may
      // have to create the default list, and running the rest in parallel
      // would only make them race to read it back.
      for (const item of previousQuantities) {
        const added = await addToDefaultListOnLowStock(prisma, household.id, item.id, item.quantity, nextQuantity);
        if (added) autoAdded.push(added);
      }
    }
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  revalidateAutoAdded(autoAdded);
  return { updated, autoAdded };
}

export async function deleteInventoryItemAction(itemId: string): Promise<ActionState> {
  const { household } = await requireHousehold();

  try {
    await prisma.inventoryItem.deleteMany({
      where: { id: itemId, householdId: household.id },
    });
  } catch (error) {
    return toFriendlyError(error);
  }

  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard");
  return {};
}
