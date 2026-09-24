import { Suspense, cache } from "react";
import { ClipboardList, Plus, ScanLine, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary } from "@/lib/i18n/get-dictionary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ItemFormDialog } from "@/components/inventory/add-item-dialog";
import { BulkScanDialog } from "@/components/inventory/bulk-scan-dialog";
import { BulkPasteDialog } from "@/components/inventory/bulk-paste-dialog";
import { AiShelfScanDialog } from "@/components/inventory/ai-shelf-scan-dialog";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { parseInventoryViewPrefs } from "@/components/inventory/inventory-table-utils";
import { ExportButton } from "@/components/export/export-button";
import { getStockStatus, type StockStatus } from "@/lib/stock-status";
import { getUserPreferences } from "@/lib/preferences";
import { isAiCategoryFallbackConfigured } from "@/lib/inventory/ai-category-fallback";

// Vercel caps a Server Action's own runtime well below a Route Handler's
// (15s by default, regardless of function region/plan) — too tight for
// scanShelfPhotoAction (src/lib/actions/inventory-scan.ts), which has been
// observed taking ~40s for one Gemini free-tier call plus a possible retry
// on a transient "model overloaded" error. A "use server" file can only
// export async functions, so this can't be set in inventory-scan.ts itself
// — it has to live on the Server Component route that renders the trigger
// invoking it, which Next.js/Vercel honor as that action's own timeout.
// No effect outside Vercel (e.g. self-hosted Node/Docker per DEPLOYMENT.md
// has no such ceiling to begin with).
export const maxDuration = 60;

// Status values the notification bell's low-stock alerts link to (e.g.
// `/dashboard/inventory?status=low`) — see src/lib/notifications.ts and
// src/components/notifications/notification-bell.tsx.
const LINKABLE_STATUSES: StockStatus[] = ["low", "out"];

// The item table (and everything derived from it — categories/locations/
// units for the filter dropdowns and the create/scan dialogs, the "well
// stocked" note) is the one genuinely per-request DB round trip on this
// page; household/dict/locale/prefs above are all cheap (React `cache()`-
// deduped with dashboard/layout.tsx's own calls, or in-memory). Wrapped in
// `cache()` so the three Suspense-bound consumers below (well-stocked note,
// action buttons, table) share a single Prisma query instead of one each.
const getInventoryData = cache(async (householdId: string) => {
  const [items, householdMembers] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId },
      orderBy: { name: "asc" },
    }),
    // Resolved to display names for the "last updated by" note — see
    // InventoryItem.updatedByUserId's doc comment in schema.prisma.
    prisma.householdMember.findMany({
      where: { householdId },
      include: { user: { select: { displayName: true } } },
    }),
  ]);

  const members = householdMembers.map((m) => ({ userId: m.userId, displayName: m.user.displayName }));
  const categories = [...new Set(items.map((item) => item.category))].sort();
  const locations = [...new Set(items.flatMap((item) => (item.location ? [item.location] : [])))].sort();
  const units = [...new Set(items.map((item) => item.unit))].sort();

  // Footnote-weight positive state (see docs/archive/JOY_GAP_BACKLOG.md item 2): the
  // common case right after a restock — nothing low or out — otherwise gets
  // no acknowledgment at all. Deliberately quiet (small, muted text, no
  // badge/icon) so it doesn't compete with the item table below it.
  const isWellStocked =
    items.length > 0 && items.every((item) => getStockStatus(item.quantity, item.lowStockThreshold) === "in");

  return { items, members, categories, locations, units, isWellStocked };
});

async function InventoryWellStockedNote({ householdId, dict }: { householdId: string; dict: Dictionary["inventory"] }) {
  const { isWellStocked } = await getInventoryData(householdId);
  if (!isWellStocked) return null;
  return <p className="text-xs text-muted-foreground">{dict.wellStocked}</p>;
}

function InventoryActionButtonsSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-9 w-9 animate-pulse rounded-md bg-muted sm:w-24" />
      ))}
      <div className="h-9 w-9 animate-pulse rounded-md bg-muted sm:w-28" />
    </div>
  );
}

async function InventoryActionButtons({
  householdId,
  dict,
  barcodeDict,
}: {
  householdId: string;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
}) {
  const { categories, locations, units } = await getInventoryData(householdId);

  return (
    <>
      <BulkPasteDialog
        dict={dict}
        categories={categories}
        locations={locations}
        trigger={
          <Button variant="outline" className="gap-1.5">
            <ClipboardList className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.pasteList.triggerLabel}</span>
          </Button>
        }
      />
      <BulkScanDialog
        dict={dict}
        barcodeDict={barcodeDict}
        categories={categories}
        locations={locations}
        trigger={
          <Button variant="outline" className="gap-1.5">
            <ScanLine className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.bulkScan.triggerLabel}</span>
          </Button>
        }
      />
      <AiShelfScanDialog
        dict={dict}
        categories={categories}
        locations={locations}
        configured={Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)}
        trigger={
          <Button variant="outline" className="gap-1.5">
            <Sparkles className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.aiShelfScan.triggerLabel}</span>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {dict.aiShelfScan.betaBadge}
            </Badge>
          </Button>
        }
      />
      <ItemFormDialog
        mode="create"
        categories={categories}
        locations={locations}
        units={units}
        dict={dict}
        barcodeDict={barcodeDict}
        aiCategoryFallbackEnabled={isAiCategoryFallbackConfigured()}
        trigger={
          <Button className="gap-1.5">
            <Plus className="size-4" />
            <span className="sr-only sm:not-sr-only">{dict.addItem}</span>
          </Button>
        }
      />
    </>
  );
}

function InventoryTableSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-4" role="status" aria-label="Loading">
      <div className="flex items-center gap-2">
        <div className="h-9 w-48 rounded-md bg-muted" />
        <div className="hidden h-9 w-32 rounded-md bg-muted sm:block" />
        <div className="hidden h-9 w-32 rounded-md bg-muted sm:block" />
        <div className="hidden h-9 w-32 rounded-md bg-muted sm:block" />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 rounded-md bg-muted/40" />
        ))}
      </div>
    </div>
  );
}

async function InventoryTable({
  householdId,
  dict,
  barcodeDict,
  locale,
  initialStatus,
  initialViewPrefs,
}: {
  householdId: string;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  locale: Awaited<ReturnType<typeof getLocale>>;
  initialStatus?: StockStatus;
  initialViewPrefs: ReturnType<typeof parseInventoryViewPrefs>;
}) {
  const { items, members, categories, locations, units } = await getInventoryData(householdId);

  return (
    <InventoryClient
      items={items}
      categories={categories}
      locations={locations}
      units={units}
      members={members}
      locale={locale}
      dict={dict}
      barcodeDict={barcodeDict}
      initialStatus={initialStatus}
      initialViewPrefs={initialViewPrefs}
      aiCategoryFallbackEnabled={isAiCategoryFallbackConfigured()}
    />
  );
}

export default async function InventoryPage(props: PageProps<"/dashboard/inventory">) {
  const [{ household }, dict, locale, searchParams, prefs] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
    props.searchParams,
    getUserPreferences(),
  ]);

  const statusParam = searchParams.status;
  const statusParamValue = Array.isArray(statusParam) ? statusParam[0] : statusParam;
  // A notification-bell link's ?status= (see LINKABLE_STATUSES above) is an
  // explicit ask to view a specific status right now, so it overrides
  // whatever status filter was last saved.
  const initialStatus = LINKABLE_STATUSES.find((status) => status === statusParamValue);
  const initialViewPrefs = parseInventoryViewPrefs(prefs?.inventoryViewPrefs);

  return (
    // sm:h-[calc(100dvh-4rem)] pins this page's total height to the
    // viewport on desktop (4rem = main's own sm:pt-8 + pb-8 in the
    // dashboard shell — see layout.tsx), so the title/filters row below
    // keeps its natural size and the table area (sm:flex-1 sm:min-h-0,
    // set on InventoryClient/InventoryTable's own root) absorbs the rest
    // and scrolls internally instead of the whole document scrolling and
    // carrying the filters out of view. Mobile is unaffected (already
    // scrolls via `main` itself — see layout.tsx).
    <div className="flex flex-col gap-6 sm:h-[calc(100dvh-4rem)] sm:min-h-0">
      <div className="flex flex-col gap-3 sm:shrink-0 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.inventory.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.inventory.subtitle}</p>
          <Suspense fallback={null}>
            <InventoryWellStockedNote householdId={household.id} dict={dict.inventory} />
          </Suspense>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton href="/dashboard/inventory/export" label={dict.export.button} />
          <Suspense fallback={<InventoryActionButtonsSkeleton />}>
            <InventoryActionButtons householdId={household.id} dict={dict.inventory} barcodeDict={dict.barcodeScanner} />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={<InventoryTableSkeleton />}>
        <InventoryTable
          householdId={household.id}
          dict={dict.inventory}
          barcodeDict={dict.barcodeScanner}
          locale={locale}
          initialStatus={initialStatus}
          initialViewPrefs={initialViewPrefs}
        />
      </Suspense>
    </div>
  );
}
