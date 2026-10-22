import { withCommonUnits } from "@/lib/units";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { NewListDialog, ShoppingListsOverview } from "@/components/shopping/shopping-lists-overview";
import { RegisterReceiptDialog } from "@/components/shopping/register-receipt-dialog";
import { ListTemplatesSection } from "@/components/shopping/list-templates";
import { PageTitle } from "@/components/dashboard/page-title";
import { PrimaryAction } from "@/components/dashboard/primary-action";

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
}: {
  householdId: string;
  dict: Awaited<ReturnType<typeof getDictionary>>["shoppingList"];
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

export default async function ShoppingListPage() {
  const [{ household }, dict, locale] = await Promise.all([requireHousehold(), getDictionary(), getLocale()]);

  // UX-85: what the New list sheet can start from: saved templates, and the
  // latest few lists (any status, the default "Next shop" included: repeating
  // last week's shop is the common case).
  const [inventoryItems, aliases, startTemplates, startLists] = await Promise.all([
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
      where: { householdId: household.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true },
    }),
  ]);

  const units = withCommonUnits([...new Set(inventoryItems.map((item) => item.unit))].sort());
  const categories = [...new Set(inventoryItems.map((item) => item.category))].sort();

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
          <PrimaryAction>
            <NewListDialog
              dict={dict.shoppingList}
              locale={locale}
              templates={startTemplates}
              recentLists={startLists}
            />
          </PrimaryAction>
        </div>
      </div>
      <Suspense fallback={<ShoppingListsSkeleton label={dict.common.loading} />}>
        <ShoppingListsSection householdId={household.id} dict={dict.shoppingList} />
      </Suspense>
    </div>
  );
}
