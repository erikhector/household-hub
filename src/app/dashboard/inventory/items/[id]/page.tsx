import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { usedInRows } from "@/lib/inventory/item-units";
import { canonicalUnit, unitLabel } from "@/lib/units";
import { ItemUnitsAndUsage } from "@/components/inventory/item-page/item-units-and-usage";
import { ChangeUnitDialog } from "@/components/inventory/item-page/change-unit-dialog";
import { ItemAliasList } from "@/components/inventory/item-page/item-alias-list";
import { MergeIntoDialog } from "@/components/inventory/catalog/merge-into-dialog";
import { itemPageBackHref, parseItemPageOrigin } from "@/lib/inventory/item-page-origin";
import { PageTitle } from "@/components/dashboard/page-title";

// Amounts restated in another unit get three significant digits ("0.009
// pcs", "0.375 pcs"), the way the design shows them; stock and typed
// amounts are shown as stored.
const short = (value: number) => String(Number(value.toPrecision(3)));

// MATCH-6 (design §6.1): one inventory item, where it's used and its units.
// Everything comes from five household-scoped queries run together, never
// one per recipe or list. The fifth lists the other items, for "Merge into
// another item…" (MATCH-7).
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

  const [item, ingredients, listRows, templateRows, otherItems] = await Promise.all([
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
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
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
  const subtitle = [item.category, item.location].filter(Boolean).join(" · ");

  return (
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
          <PageTitle>{item.name}</PageTitle>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p>
            {format(dict.inStock, { amount: `${item.quantity} ${unitLabel(item.unit, fullDict.units)}` })}
            <span className="text-sm text-muted-foreground">
              {" · "}
              {format(dict.lowStockAt, { amount: `${item.lowStockThreshold} ${unitLabel(item.unit, fullDict.units)}` })}
            </span>
          </p>
          <ChangeUnitDialog
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
        </div>
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
                <Link href={`/dashboard/shopping-list/${row.shoppingList.id}`} className="touch-target underline-offset-4 hover:underline">
                  {row.shoppingList.name}
                </Link>{" "}
                <span className="text-muted-foreground">
                  ({row.quantity} {unitLabel(row.unit, fullDict.units)})
                </span>
              </li>
            ))}
            {templateRows.map((row) => (
              <li key={row.id}>
                <Link href="/dashboard/shopping-list" className="touch-target underline-offset-4 hover:underline">
                  {format(dict.template, { name: row.template.name })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ItemAliasList aliases={item.aliases} dict={dict} />

      <MergeIntoDialog
        item={{ id: item.id, name: item.name }}
        origin={origin}
        targets={otherItems.map((other) => ({ id: other.id, label: other.name }))}
        dict={fullDict.inventory.catalog}
        locale={locale}
      />
    </div>
  );
}
