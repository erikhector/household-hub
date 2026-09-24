import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { ShoppingListClient } from "@/components/shopping/shopping-list-client";
import { getStockStatus } from "@/lib/stock-status";
import type { SmartAddCandidate } from "@/lib/shopping/smart-add-suggestions";

// Same reasoning as inventory/page.tsx's maxDuration: ReceiptScanDialog can
// call scanReceiptPhotoAction (src/lib/actions/receipt-scan.ts), which has
// been observed taking up to ~40s for a vision API call — well past
// Vercel's 15s default Server Action timeout.
export const maxDuration = 60;

export default async function ShoppingListDetailPage(
  props: PageProps<"/dashboard/shopping-list/[id]">,
) {
  const [{ household }, dict, locale, { id }] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.params,
  ]);

  const [list, inventoryItems] = await Promise.all([
    prisma.shoppingList.findFirst({
      where: { id, householdId: household.id },
      include: {
        // The linked InventoryItem's category rides along for shopping mode
        // (AUTO-3, groupPendingItemsByCategory): grouping pending rows by
        // aisle needs it on every row, not just the picker's own item list
        // below.
        items: { orderBy: { createdAt: "asc" }, include: { inventoryItem: { select: { category: true } } } },
      },
    }),
    // Stock level and last purchase ride along for the smart add line's
    // suggestion ranking (AUTO-1, rankSmartAddSuggestions) — one query for
    // both the dialogs' item pickers and the autocomplete, rather than a
    // client fetch. "Last purchased" is the newest checked-off list row
    // linked to the item; ShoppingListItem has no purchasedAt, so its
    // createdAt stands in (a row is normally bought within days of being
    // added, which is plenty for ordering by recency).
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        quantity: true,
        lowStockThreshold: true,
        shoppingListItems: {
          where: { purchased: true },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!list) notFound();

  const smartAddCandidates: SmartAddCandidate[] = inventoryItems.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    stockStatus: getStockStatus(item.quantity, item.lowStockThreshold),
    lastPurchasedAt: item.shoppingListItems[0]?.createdAt.getTime() ?? null,
  }));

  const categories = [...new Set(inventoryItems.map((item) => item.category))].sort();
  const units = [...new Set(inventoryItems.map((item) => item.unit))].sort();

  return (
    <ShoppingListClient
      list={{
        ...list,
        // Flatten the linked item down to the one field shopping mode
        // needs, rather than handing the client component Prisma's nested
        // include shape.
        items: list.items.map(({ inventoryItem, ...item }) => ({
          ...item,
          category: inventoryItem?.category ?? null,
        })),
      }}
      inventoryItems={inventoryItems.map(({ id, name, category, unit }) => ({ id, name, category, unit }))}
      smartAddCandidates={smartAddCandidates}
      categories={categories}
      units={units}
      dict={dict.shoppingList}
      barcodeDict={dict.barcodeScanner}
      exportLabel={dict.export.button}
      locale={locale}
    />
  );
}
