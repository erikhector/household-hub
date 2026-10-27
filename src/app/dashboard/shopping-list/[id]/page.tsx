import { withCommonUnits } from "@/lib/units";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary } from "@/lib/i18n/get-dictionary";
import { ShoppingListClient } from "@/components/shopping/shopping-list-client";
import { getStockStatus } from "@/lib/stock-status";
import type { SmartAddCandidate } from "@/lib/shopping/smart-add-suggestions";
import { parseLearnedOrder } from "@/lib/shopping/store-order";
import { loadRepurchaseSuggestions } from "@/lib/inventory/repurchase-suggestions";
import { RepurchaseSuggestions } from "@/components/shopping/repurchase-suggestions";
import { defersToPutAway } from "@/lib/shopping/put-away-calc";

// Same reasoning as inventory/page.tsx's maxDuration: ReceiptScanDialog can
// call scanReceiptPhotoAction (src/lib/actions/receipt-scan.ts), which has
// been observed taking up to ~40s for a vision API call — well past
// Vercel's 15s default Server Action timeout.
export const maxDuration = 60;

// Streamed in behind its own Suspense boundary, the same way the dashboard
// layout's EmailVerificationCheck is: the purchase-history read
// (loadRepurchaseSuggestions) scans a year of the household's purchased rows
// and takes three round trips of its own, and the chips are a nudge, not
// something anyone needs before they can see or tick off their list. The
// fallback is nothing rather than a skeleton because most visits have no
// suggestion to show.
async function RepurchaseSuggestionsSection({
  householdId,
  listId,
  dict,
}: {
  householdId: string;
  listId: string;
  dict: Dictionary["repurchase"];
}) {
  const suggestions = await loadRepurchaseSuggestions(householdId, new Date());
  return (
    <RepurchaseSuggestions
      listId={listId}
      suggestions={suggestions.map(({ inventoryItemId, name, intervalDays }) => ({
        inventoryItemId,
        name,
        intervalDays,
      }))}
      dict={dict}
    />
  );
}

export default async function ShoppingListDetailPage(
  props: PageProps<"/dashboard/shopping-list/[id]">,
) {
  const [{ household }, dict, locale, { id }] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.params,
  ]);

  // Everything the list itself needs, in ONE parallel round trip — this
  // page used to take ~7 sequential database round trips before it could
  // render, and on a hosted Postgres every one of those is a network hop.
  // Two things were behind that:
  //
  //   - Prisma (without the relationJoins preview) runs a nested
  //     `include`/`select` as a separate follow-up query per level, so
  //     list → items → inventoryItem was three queries back to back. The
  //     items are fetched on their own here (scoped to the household
  //     through their list, so an id from another household still finds
  //     nothing), and their linked item's category/barcode is looked up
  //     in the inventoryItems we load anyway: every linked row points at
  //     one of this household's items.
  //   - A nested `take: 1` isn't pushed down to SQL either: Prisma fetched
  //     EVERY purchased row the household has ever had and kept the
  //     newest per item in memory, so the page slowed down with every
  //     completed trip. A groupBy with `_max` gets the same "last
  //     purchased" answer as one row per item.
  //
  // The repurchase chips (AUTO-10), the heaviest read here, don't gate the
  // page at all any more — see RepurchaseSuggestionsSection above.
  const [list, items, inventoryItems, lastPurchased, aliases, activeDefault] = await Promise.all([
    prisma.shoppingList.findFirst({ where: { id, householdId: household.id } }),
    prisma.shoppingListItem.findMany({
      where: { shoppingListId: id, shoppingList: { householdId: household.id } },
      orderBy: { createdAt: "asc" },
    }),
    // Stock level rides along for the smart add line's suggestion ranking
    // (AUTO-1, rankSmartAddSuggestions) — one query for both the dialogs'
    // item pickers and the autocomplete, rather than a client fetch. The
    // category and barcode also serve the list rows (see above): shopping
    // mode (AUTO-3, groupPendingItemsByCategory) groups pending rows by
    // aisle, and ReceiptScanDialog matches a receipt line that prints an
    // EAN (AUTO-6) to its list row exactly (AUTO-11).
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        location: true,
        quantity: true,
        lowStockThreshold: true,
        barcode: true,
      },
      orderBy: { name: "asc" },
    }),
    // The ranking's "last purchased": the newest checked-off list row linked
    // to each item. ShoppingListItem has no purchasedAt, so its createdAt
    // stands in (a row is normally bought within days of being added, which
    // is plenty for ordering by recency).
    prisma.shoppingListItem.groupBy({
      by: ["inventoryItemId"],
      where: { purchased: true, inventoryItemId: { not: null }, shoppingList: { householdId: household.id } },
      _max: { createdAt: true },
    }),
    // MATCH-5: the household's learned names, for ReceiptScanDialog's line
    // matching and ResolveMappingsDialog's suggestions. Untracked ones never
    // link a list row, so they stay on the server.
    prisma.itemAlias.findMany({
      where: { householdId: household.id, inventoryItemId: { not: null } },
      select: { normalizedName: true, inventoryItemId: true },
    }),
    // UX-80: where the unbought rows go when this list is completed, so the
    // checkbox can name it. Same list completeShoppingListAction picks.
    prisma.shoppingList.findFirst({
      where: { householdId: household.id, isDefault: true, status: "ACTIVE" },
      select: { id: true, name: true },
    }),
  ]);
  if (!list) notFound();

  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
  const lastPurchasedById = new Map(
    lastPurchased.map((row) => [row.inventoryItemId, row._max.createdAt?.getTime() ?? null]),
  );

  const smartAddCandidates: SmartAddCandidate[] = inventoryItems.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    stockStatus: getStockStatus(item.quantity, item.lowStockThreshold),
    lastPurchasedAt: lastPurchasedById.get(item.id) ?? null,
  }));

  const categories = [...new Set(inventoryItems.map((item) => item.category))].sort();
  const units = withCommonUnits([...new Set(inventoryItems.map((item) => item.unit))].sort());
  const locations = [
    ...new Set(inventoryItems.flatMap((item) => (item.location?.trim() ? [item.location.trim()] : []))),
  ].sort();

  return (
    <ShoppingListClient
      list={{
        ...list,
        items: items.map((item) => {
          const inventoryItem = item.inventoryItemId ? inventoryById.get(item.inventoryItemId) : undefined;
          return {
            ...item,
            category: inventoryItem?.category ?? null,
            barcode: inventoryItem?.barcode ?? null,
            // Its location too, as the put-away dialog's "stays where it
            // is" placeholder.
            location: inventoryItem?.location ?? null,
          };
        }),
      }}
      inventoryItems={inventoryItems.map(({ id, name, category, unit }) => ({ id, name, category, unit }))}
      smartAddCandidates={smartAddCandidates}
      categories={categories}
      units={units}
      dict={dict.shoppingList}
      autoAddDict={dict.inventory.autoAdd}
      barcodeDict={dict.barcodeScanner}
      exportLabel={dict.export.button}
      // AUTO-9: the household's store order, straight off the Household row
      // requireHousehold already loaded, so it costs no extra query.
      storeOrder={{
        learned: parseLearnedOrder(household.categoryOrderLearned),
        manual: household.categoryOrderManual,
      }}
      locale={locale}
      // AUTO-10: only an ACTIVE list can take a tapped suggestion, so a
      // completed or archived one skips the history query altogether.
      repurchaseSuggestions={
        list.status === "ACTIVE" ? (
          <Suspense fallback={null}>
            <RepurchaseSuggestionsSection householdId={household.id} listId={list.id} dict={dict.repurchase} />
          </Suspense>
        ) : null
      }
      currencyCode={household.currencyCode}
      defersToPutAway={defersToPutAway(household)}
      aliases={aliases}
      locations={locations}
      carryOverListName={
        activeDefault && activeDefault.id !== list.id ? activeDefault.name : dict.shoppingList.defaultListName
      }
      nextListId={activeDefault && activeDefault.id !== list.id ? activeDefault.id : null}
    />
  );
}
