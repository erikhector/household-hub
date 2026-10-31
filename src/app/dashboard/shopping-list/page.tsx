import { withCommonUnits } from "@/lib/units";
import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { NewListDialog, ShoppingListsOverview } from "@/components/shopping/shopping-lists-overview";
import { RegisterReceiptDialog } from "@/components/shopping/register-receipt-dialog";
import { ListTemplatesSection } from "@/components/shopping/list-templates";
import { PageTitle } from "@/components/dashboard/page-title";
import { PrimaryAction } from "@/components/dashboard/primary-action";
import { SHARE_TEXT_PARAM } from "@/lib/share-target";
import { ADD_PARAM } from "@/components/dashboard/command-palette-commands";

// Same reasoning as inventory/page.tsx's maxDuration: RegisterReceiptDialog
// can call scanReceiptPhotoAction (src/lib/actions/receipt-scan.ts), which
// has been observed taking up to ~40s for a vision API call — well past
// Vercel's 15s default Server Action timeout.
export const maxDuration = 60;

function ShoppingListsSkeleton({ label }: { label: string }) {
  return (
    <div className="list-bleed flex animate-pulse flex-col gap-2" role="status" aria-label={label}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-16 rounded-md border bg-muted/40" />
      ))}
    </div>
  );
}

async function ShoppingListsSection({
  householdId,
  dict,
  newListDialog,
}: {
  householdId: string;
  dict: Awaited<ReturnType<typeof getDictionary>>["shoppingList"];
  /** UX-50: "New list", for the empty state to hold while there are no lists. */
  newListDialog: ReactNode;
}) {
  const [lists, templates] = await Promise.all([
    prisma.shoppingList.findMany({
      where: { householdId },
      // The default "Next shop" list (AUTO-8) always leads the Active section
      // — it's the one the household is actually filling — then newest first.
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { items: { where: { purchased: false } } } } },
    }),
    // GAP-4: saved templates, alphabetical — they're picked by name.
    prisma.shoppingListTemplate.findMany({
      where: { householdId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { items: true } } },
    }),
  ]);

  const toSummary = (list: (typeof lists)[number]) => ({
    id: list.id,
    name: list.name,
    status: list.status,
    isDefault: list.isDefault,
    pendingItemCount: list._count.items,
  });

  return (
    <div className="flex flex-col gap-6">
      <ShoppingListsOverview
        dict={dict}
        emptyAction={newListDialog}
        active={lists.filter((l) => l.status === "ACTIVE").map(toSummary)}
        completed={lists.filter((l) => l.status === "COMPLETED").map(toSummary)}
        archived={lists.filter((l) => l.status === "ARCHIVED").map(toSummary)}
      />
      <ListTemplatesSection
        dict={dict.templates}
        templates={templates.map((t) => ({ id: t.id, name: t.name, itemCount: t._count.items }))}
      />
    </div>
  );
}

export default async function ShoppingListPage(props: PageProps<"/dashboard/shopping-list">) {
  const [{ household }, dict, locale, searchParams] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.searchParams,
  ]);

  // UX-41a: the command palette's "Add to shopping list" can't name a list,
  // so it lands here with `?add=1` and goes on to the one the household is
  // filling (the default "Next shop" leads the active lists, as in the
  // overview below), where SmartAddBar takes focus. With no active list it
  // falls through to the overview, whose "New list" is the next step.
  //
  // GAP-67: text shared to Squirrel from another app (src/app/dashboard/share)
  // goes to the same list, whose "Paste a list" opens with it filled in.
  const sharedText = searchParams[SHARE_TEXT_PARAM];
  const shared = typeof sharedText === "string" && sharedText ? sharedText : null;
  if (searchParams[ADD_PARAM] === "1" || shared) {
    const target = await prisma.shoppingList.findFirst({
      where: { householdId: household.id, status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
    if (target) {
      redirect(
        shared
          ? `/dashboard/shopping-list/${target.id}?${SHARE_TEXT_PARAM}=${encodeURIComponent(shared)}`
          : `/dashboard/shopping-list/${target.id}?${ADD_PARAM}=1`,
      );
    }
  }

  // UX-85: what the New list sheet can start from: saved templates, and the
  // latest few lists (any status, the default "Next shop" included: repeating
  // last week's shop is the common case). A list with no rows has nothing to
  // copy, so it isn't offered; the unbought count lets the sheet default a
  // finished trip, where every row is ticked, to "All items".
  const [inventoryItems, aliases, startTemplates, recentLists, listCount] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      // barcode (AUTO-6) lets RegisterReceiptDialog match a receipt line that
      // prints an EAN exactly — see matchReceiptLines.
      select: { id: true, name: true, category: true, unit: true, barcode: true },
      orderBy: { name: "asc" },
    }),
    // MATCH-5: the learned names a receipt line links through. Only the
    // tracked ones: an untracked alias is never a receipt match.
    prisma.itemAlias.findMany({
      where: { householdId: household.id, inventoryItemId: { not: null } },
      select: { normalizedName: true, inventoryItemId: true },
    }),
    prisma.shoppingListTemplate.findMany({
      where: { householdId: household.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.shoppingList.findMany({
      where: { householdId: household.id, items: { some: {} } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, _count: { select: { items: { where: { purchased: false } } } } },
    }),
    // UX-50: with no lists at all "New list" lives in the empty state.
    prisma.shoppingList.count({ where: { householdId: household.id } }),
  ]);
  const startLists = recentLists.map((list) => ({ id: list.id, name: list.name, unbought: list._count.items }));

  const units = withCommonUnits([...new Set(inventoryItems.map((item) => item.unit))].sort());
  const categories = [...new Set(inventoryItems.map((item) => item.category))].sort();

  const newListDialog = (
    <NewListDialog dict={dict.shoppingList} locale={locale} templates={startTemplates} recentLists={startLists} />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <PageTitle>{dict.shoppingList.title}</PageTitle>
          <p className="text-sm text-muted-foreground">{dict.shoppingList.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RegisterReceiptDialog
            inventoryItems={inventoryItems}
            units={units}
            categories={categories}
            dict={dict.shoppingList.registerReceipt}
            locale={locale}
            aliases={aliases}
          />
          {listCount > 0 && <PrimaryAction>{newListDialog}</PrimaryAction>}
        </div>
      </div>
      <Suspense fallback={<ShoppingListsSkeleton label={dict.common.loading} />}>
        <ShoppingListsSection householdId={household.id} dict={dict.shoppingList} newListDialog={newListDialog} />
      </Suspense>
    </div>
  );
}
