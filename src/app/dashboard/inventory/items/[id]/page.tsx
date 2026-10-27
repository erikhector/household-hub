import Link from "next/link";
import { LazyDialogErrorMessage } from "@/components/ui/lazy-dialog";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { usedInRows } from "@/lib/inventory/item-units";
import { canonicalUnit, unitLabel, withCommonUnits } from "@/lib/units";
import { createMoneyFormat, HOUSEHOLD_BASE_CURRENCY } from "@/lib/currency";
import { getRecentPrices } from "@/lib/inventory/recent-prices";
import { ItemRecentPrices } from "@/components/inventory/item-page/item-recent-prices";
import { ItemUnitsAndUsage } from "@/components/inventory/item-page/item-units-and-usage";
import { LazyChangeUnit, LazyMergeInto } from "@/components/inventory/item-page/lazy-item-dialogs";
import { ItemPageControls } from "@/components/inventory/item-page/item-page-controls";
import { ItemAliasList } from "@/components/inventory/item-page/item-alias-list";
import { itemPageBackHref, parseItemPageOrigin } from "@/lib/inventory/item-page-origin";
import { PageTitle } from "@/components/dashboard/page-title";

// Amounts restated in another unit get three significant digits ("0.009
// pcs", "0.375 pcs"), the way the design shows them; stock and typed
// amounts are shown as stored.
const short = (value: number) => String(Number(value.toPrecision(3)));

// MATCH-6 (design §6.1): one inventory item, where it's used and its units.
// Everything comes from eight household-scoped queries run together, never
// one per recipe or list. The fifth lists the other items, for "Merge into
// another item…" (MATCH-7). The sixth names the household's members, so
// "Last updated … by …" can say who; phones don't show that on the
// inventory list (UX-45), so this page is where they find it. The seventh is
// the last purchases for "Recent prices" (GAP-47). The eighth is the
// household's low-stock auto-add setting, for the Mark-as-empty menu
// (UX-124, same as the list's).
export default async function InventoryItemPage(props: PageProps<"/dashboard/inventory/items/[id]">) {
  const [{ household }, fullDict, locale, { id }, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.params,
    props.searchParams,
  ]);
  const dict = fullDict.inventory.itemPage;
  // The back arrow goes to wherever this page was opened from (see
  // item-page-origin.ts), e.g. the catalog's "Unit problems" list.
  const origin = parseItemPageOrigin(searchParams.from);
  const backLabel = { inventory: dict.back, catalog: dict.backToCatalog, recipes: dict.backToRecipes }[origin.kind];

  const [item, ingredients, listRows, templateRows, otherItems, members, recentPrices, householdSettings] = await Promise.all([
    prisma.inventoryItem.findFirst({
      where: { id, householdId: household.id },
      select: {
        id: true,
        name: true,
        category: true,
        location: true,
        quantity: true,
        unit: true,
        lowStockThreshold: true,
        expiresAt: true,
        expiresAtEstimated: true,
        shelfLifeDays: true,
        openedAt: true,
        useWithinDaysOpened: true,
        frozenAt: true,
        useWithinDaysFrozen: true,
        updatedAt: true,
        updatedByUserId: true,
        unitConversions: { select: { id: true, fromUnit: true, factor: true }, orderBy: { createdAt: "asc" } },
        aliases: { select: { id: true, normalizedName: true }, orderBy: { normalizedName: "asc" } },
      },
    }),
    prisma.recipeIngredient.findMany({
      where: { inventoryItemId: id, recipe: { householdId: household.id } },
      select: { id: true, quantity: true, unit: true, recipe: { select: { id: true, name: true } } },
    }),
    // Pending rows only: what's still to buy on a list in use.
    prisma.shoppingListItem.findMany({
      where: {
        inventoryItemId: id,
        purchased: false,
        shoppingList: { householdId: household.id, status: "ACTIVE" },
      },
      select: { id: true, quantity: true, unit: true, shoppingList: { select: { id: true, name: true } } },
      orderBy: { shoppingList: { name: "asc" } },
    }),
    prisma.shoppingListTemplateItem.findMany({
      where: { inventoryItemId: id, template: { householdId: household.id } },
      select: { id: true, template: { select: { id: true, name: true } } },
      orderBy: { template: { name: "asc" } },
    }),
    prisma.inventoryItem.findMany({
      where: { householdId: household.id, id: { not: id } },
      select: { id: true, name: true, category: true, location: true, unit: true },
      orderBy: { name: "asc" },
    }),
    prisma.householdMember.findMany({
      where: { householdId: household.id },
      select: { userId: true, user: { select: { displayName: true } } },
    }),
    getRecentPrices(id),
    prisma.household.findUnique({ where: { id: household.id }, select: { autoAddLowStockToList: true } }),
  ]);
  if (!item) notFound();

  const conversions = item.unitConversions;
  const rows = usedInRows(
    ingredients.map((ingredient) => ({
      id: ingredient.id,
      recipeId: ingredient.recipe.id,
      recipeName: ingredient.recipe.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    })),
    item,
    conversions,
  );
  // Units the page offers: the item's own, its conversions', and every
  // unit a recipe uses it in — for the "Try it" and conversion unit fields.
  const units = [
    ...new Set([item.unit, ...conversions.map((conversion) => conversion.fromUnit), ...rows.map((row) => canonicalUnit(row.unit))]),
  ];
  // The edit form's suggestions, the way the list builds them.
  const everyItem = [item, ...otherItems];
  const categories = [...new Set(everyItem.map((row) => row.category))].sort();
  const locations = [...new Set(everyItem.flatMap((row) => (row.location ? [row.location] : [])))].sort();
  const allUnits = withCommonUnits([...new Set(everyItem.map((row) => row.unit))].sort());
  const bestBefore = item.expiresAt
    ? format(dict.bestBefore, {
        date: `${item.expiresAtEstimated ? "≈ " : ""}${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(item.expiresAt)}`,
      })
    : null;
  const subtitle = [item.category, item.location].filter(Boolean).join(" · ");
  // Same sentence and date style as the desktop table's "Last updated" cell
  // (last-updated-cell.tsx). The name is left out when the updater has left
  // the household or the change predates tracking (updatedByUserId null).
  const updatedDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(item.updatedAt);
  const updaterName = members.find((member) => member.userId === item.updatedByUserId)?.user.displayName;
  const lastUpdated = updaterName
    ? format(fullDict.inventory.lastUpdatedWithUser, { date: updatedDate, name: updaterName })
    : format(fullDict.inventory.lastUpdatedNoUser, { date: updatedDate });

  return (
    <LazyDialogErrorMessage message={fullDict.errors.generic}>
    <div className="flex max-w-3xl min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={itemPageBackHref(origin)}
          className="touch-target inline-flex w-fit items-center gap-1 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <PageTitle morph={{ kind: "inventory-item", id: item.id }}>{item.name}</PageTitle>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <ItemPageControls
          item={item}
          categories={categories}
          locations={locations}
          units={allUnits}
          members={members.map((member) => ({ userId: member.userId, displayName: member.user.displayName }))}
          locale={locale}
          dict={fullDict.inventory}
          barcodeDict={fullDict.barcodeScanner}
          autoAddEnabled={householdSettings?.autoAddLowStockToList ?? false}
          backHref={itemPageBackHref(origin)}
          bestBeforeLabel={bestBefore}
        >
          <span className="text-sm text-muted-foreground">
            {format(dict.lowStockAt, { amount: `${item.lowStockThreshold} ${unitLabel(item.unit, fullDict.units)}` })}
          </span>
          <LazyChangeUnit
            item={{
              id: item.id,
              unit: item.unit,
              quantity: item.quantity,
              lowStockThreshold: item.lowStockThreshold,
              conversions: conversions.map(({ fromUnit, factor }) => ({ fromUnit, factor })),
            }}
            units={units}
            dict={dict}
            comboDict={fullDict.inventory}
          />
        </ItemPageControls>
        <p className="text-sm text-muted-foreground">{lastUpdated}</p>
      </div>

      <ItemUnitsAndUsage
        item={{ id: item.id, name: item.name, unit: item.unit }}
        conversions={conversions}
        rows={rows.map((row) => ({ ...row, convertedLabel: row.converted === null ? null : short(row.converted) }))}
        units={units}
        dict={dict}
        comboDict={fullDict.inventory}
      />

      <section aria-labelledby="also-on" className="flex flex-col gap-2">
        <h2 id="also-on" className="font-heading text-lg font-semibold">
          {dict.alsoOn}
        </h2>
        {listRows.length === 0 && templateRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.notOnLists}</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {listRows.map((row) => (
              <li key={row.id}>
                <Link href={`/dashboard/shopping-list/${row.shoppingList.id}`} className="touch-target text-primary underline underline-offset-4 hover:no-underline">
                  {row.shoppingList.name}
                </Link>{" "}
                <span className="text-muted-foreground">
                  ({row.quantity} {unitLabel(row.unit, fullDict.units)})
                </span>
              </li>
            ))}
            {templateRows.map((row) => (
              <li key={row.id}>
                <Link href="/dashboard/shopping-list" className="touch-target text-primary underline underline-offset-4 hover:no-underline">
                  {format(dict.template, { name: row.template.name })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* PriceHistory rows are stored in the base currency (GAP-13). */}
      <ItemRecentPrices
        prices={recentPrices}
        money={createMoneyFormat(locale, HOUSEHOLD_BASE_CURRENCY)}
        locale={locale}
        unitLabels={fullDict.units}
        dict={dict}
      />

      <ItemAliasList aliases={item.aliases} dict={dict} />

      <LazyMergeInto
        item={{ id: item.id, name: item.name }}
        origin={origin}
        targets={otherItems.map((other) => ({ id: other.id, label: other.name }))}
        dict={fullDict.inventory.catalog}
        locale={locale}
      />
    </div>
    </LazyDialogErrorMessage>
  );
}
