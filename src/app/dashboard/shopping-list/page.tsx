import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { NewListDialog, ShoppingListsOverview } from "@/components/shopping/shopping-lists-overview";
import { RegisterReceiptDialog } from "@/components/shopping/register-receipt-dialog";

// Same reasoning as inventory/page.tsx's maxDuration: RegisterReceiptDialog
// can call scanReceiptPhotoAction (src/lib/actions/receipt-scan.ts), which
// has been observed taking up to ~40s for a vision API call — well past
// Vercel's 15s default Server Action timeout.
export const maxDuration = 60;

function ShoppingListsSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2" role="status" aria-label="Loading">
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
  const lists = await prisma.shoppingList.findMany({
    where: { householdId },
    // The default "Next shop" list (AUTO-8) always leads the Active section
    // — it's the one the household is actually filling — then newest first.
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { items: { where: { purchased: false } } } } },
  });

  const toSummary = (list: (typeof lists)[number]) => ({
    id: list.id,
    name: list.name,
    status: list.status,
    isDefault: list.isDefault,
    pendingItemCount: list._count.items,
  });

  return (
    <ShoppingListsOverview
      dict={dict}
      active={lists.filter((l) => l.status === "ACTIVE").map(toSummary)}
      completed={lists.filter((l) => l.status === "COMPLETED").map(toSummary)}
      archived={lists.filter((l) => l.status === "ARCHIVED").map(toSummary)}
    />
  );
}

export default async function ShoppingListPage() {
  const [{ household }, dict] = await Promise.all([requireHousehold(), getDictionary()]);

  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { householdId: household.id },
    // barcode (AUTO-6) lets RegisterReceiptDialog match a receipt line that
    // prints an EAN exactly — see matchReceiptLines.
    select: { id: true, name: true, category: true, unit: true, barcode: true },
    orderBy: { name: "asc" },
  });

  const units = [...new Set(inventoryItems.map((item) => item.unit))].sort();
  const categories = [...new Set(inventoryItems.map((item) => item.category))].sort();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.shoppingList.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.shoppingList.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <RegisterReceiptDialog
            inventoryItems={inventoryItems}
            units={units}
            categories={categories}
            dict={dict.shoppingList.registerReceipt}
          />
          <NewListDialog dict={dict.shoppingList} />
        </div>
      </div>
      <Suspense fallback={<ShoppingListsSkeleton />}>
        <ShoppingListsSection householdId={household.id} dict={dict.shoppingList} />
      </Suspense>
    </div>
  );
}
