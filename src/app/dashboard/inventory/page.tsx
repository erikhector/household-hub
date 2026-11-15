import { LazyDialogErrorMessage } from "@/components/ui/lazy-dialog";
import { withCommonUnits } from "@/lib/units";
import { cache } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary } from "@/lib/i18n/get-dictionary";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InventoryClient } from "@/components/inventory/inventory-client";
import { InventoryHeaderActionsClient } from "@/components/inventory/inventory-header-actions";
import { parseInventoryViewPrefs } from "@/components/inventory/inventory-table-utils";
import { ExportButton } from "@/components/export/export-button";
import { getStockStatus, isNeverStockedAtZero } from "@/lib/stock-status";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import type { InventoryStatusFilter } from "@/components/inventory/inventory-table-utils";
import { getUserPreferences } from "@/lib/preferences";
import { isAiCategoryFallbackConfigured } from "@/lib/inventory/ai-category-fallback";
import { loadIncomingByItem } from "@/lib/incoming-stock";
import { countDuplicateGroups } from "@/lib/inventory/catalog-data";
import { format, plural } from "@/lib/i18n/format";
import { PageTitle } from "@/components/dashboard/page-title";

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
const LINKABLE_STATUSES: InventoryStatusFilter[] = ["low", "out", "expiring", "expired"];

// The item table (and everything derived from it — categories/locations/
// units for the filter dropdowns and the create/scan dialogs, the "well
// stocked" note) is the one genuinely per-request DB round trip on this
// page; household/dict/locale/prefs above are all cheap (React `cache()`-
// deduped with dashboard/layout.tsx's own calls, or in-memory). Wrapped in
// `cache()` so the three async consumers below (well-stocked note, action
// buttons, table) share a single Prisma query instead of one each.
const getInventoryData = cache(async (householdId: string) => {
  const [rawItems, householdMembers, incoming, onListRows, householdSettings] = await Promise.all([
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
    // Put-away flow: what's ticked off a shopping list but not home yet, for
    // each row's "+N on the way" hint (src/lib/incoming-stock.ts).
    loadIncomingByItem(prisma, householdId, new Date()),
    // UX-122: items with a row still to buy on an active list, for the
    // row's "On list" tag. Any active list counts, not just the default.
    prisma.shoppingListItem.findMany({
      where: {
        purchased: false,
        inventoryItemId: { not: null },
        shoppingList: { householdId, status: "ACTIVE" },
      },
      select: { inventoryItemId: true },
    }),
    // UX-122: with auto-add on, the menu's two mark-empty entries do the
    // same thing, so it shows just one.
    prisma.household.findUnique({ where: { id: householdId }, select: { autoAddLowStockToList: true } }),
  ]);
  const onList = new Set(onListRows.map((row) => row.inventoryItemId));
  const items = rawItems.map((item) => ({
    ...item,
    incoming: incoming.get(item.id) ?? 0,
    onList: onList.has(item.id),
  }));
  const autoAddEnabled = householdSettings?.autoAddLowStockToList ?? false;

  const members = householdMembers.map((m) => ({ userId: m.userId, displayName: m.user.displayName }));
  const categories = [...new Set(items.map((item) => item.category))].sort();
  const locations = [...new Set(items.flatMap((item) => (item.location ? [item.location] : [])))].sort();
  const units = withCommonUnits([...new Set(items.map((item) => item.unit))].sort());

  // Footnote-weight positive state (see docs/archive/JOY_GAP_BACKLOG.md item 2): the
  // common case right after a restock — nothing low or out — otherwise gets
  // no acknowledgment at all. Deliberately quiet (small, muted text, no
  // badge/icon) so it doesn't compete with the item table below it.
  // UX-121: an expiring or expired item rules the note out too, since the
  // header's counts now say otherwise.
  const now = Date.now();
  const isWellStocked =
    items.length > 0 &&
    items.every(
      (item) =>
        // UX-89: an item that was never stocked doesn't make the pantry
        // "not well stocked".
        (isNeverStockedAtZero(item) || getStockStatus(item.quantity, item.lowStockThreshold) === "in") &&
        !getExpiryStatus(item.expiresAt, now),
    );

  return { items, members, categories, locations, units, isWellStocked, autoAddEnabled };
});

async function InventoryWellStockedNote({ householdId, dict }: { householdId: string; dict: Dictionary["inventory"] }) {
  const { isWellStocked } = await getInventoryData(householdId);
  if (!isWellStocked) return null;
  return <p className="text-xs text-muted-foreground">{dict.wellStocked}</p>;
}

// One duplicate-group count per render, shared by the desktop link and the
// phone ⋯ menu (react `cache` dedupes it across both).
const getDuplicateGroups = cache(async (householdId: string) => {
  const { items } = await getInventoryData(householdId);
  return countDuplicateGroups(householdId, items);
});

async function InventoryActionButtons({
  householdId,
  dict,
  barcodeDict,
  exportLabel,
  manageItemsLabel,
}: {
  householdId: string;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  exportLabel: string;
  manageItemsLabel: string;
}) {
  const { items, categories, locations, units } = await getInventoryData(householdId);
  // The phone ⋯ menu carries the manage-items link, so it needs the same
  // duplicate count + deep link ManageItemsLink gives desktop.
  const groups = await getDuplicateGroups(householdId);
  // Env vars are server-only; the client component can't read them.
  const aiShelfScanConfigured = Boolean(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);
  // Render a client component that provides the labelled mobile header
  // and preserves the desktop icon buttons.
  return (
    <InventoryHeaderActionsClient
      items={items}
      categories={categories}
      locations={locations}
      units={units}
      dict={dict}
      barcodeDict={barcodeDict}
      exportLabel={exportLabel}
      manageItemsLabel={manageItemsLabel}
      manageItemsHref={groups > 0 ? "/dashboard/inventory/items?filter=duplicates" : "/dashboard/inventory/items"}
      duplicateGroups={groups}
      aiShelfScanConfigured={aiShelfScanConfigured}
      aiCategoryFallbackEnabled={isAiCategoryFallbackConfigured()}
    />
  );
}

// Decision 5 in the design (§7): the item catalog is reached from here, not
// from a bottom-nav tab, and the badge counts its open duplicate groups so
// they get noticed. With groups open, the link lands on them.
async function ManageItemsLink({ householdId, dict }: { householdId: string; dict: Dictionary["inventory"]["catalog"] }) {
  const groups = await getDuplicateGroups(householdId);
  const href = groups > 0 ? "/dashboard/inventory/items?filter=duplicates" : "/dashboard/inventory/items";

  return (
    // A plain link styled as a button: Button's `render` would give it the
    // button role, and this navigates.
    <Link href={href} className={buttonVariants({ variant: "outline", className: "gap-1.5" })}>
      <ListChecks className="size-4" />
      <span className="sr-only sm:not-sr-only">{dict.manageItems}</span>
      {groups > 0 && (
        <Badge variant="secondary">
          <span aria-hidden="true">{groups}</span>
          <span className="sr-only">{format(plural(groups, dict.duplicateBadge), { count: groups })}</span>
        </Badge>
      )}
    </Link>
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
  initialStatus?: InventoryStatusFilter;
  initialViewPrefs: ReturnType<typeof parseInventoryViewPrefs>;
}) {
  const { items, members, categories, locations, units, autoAddEnabled } = await getInventoryData(householdId);

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
      autoAddEnabled={autoAddEnabled}
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
    // roomy:h-[calc(100dvh-4rem)] pins this page's total height to the
    // viewport on desktop (4rem = main's own sm:pt-8 + pb-8 in the
    // dashboard shell — see layout.tsx), so the title/filters row below
    // keeps its natural size and the table area (sm:flex-1 sm:min-h-0,
    // set on InventoryClient/InventoryTable's own root) absorbs the rest
    // and scrolls internally instead of the whole document scrolling and
    // carrying the filters out of view. Only from `roomy` (lg wide and
    // 600 px tall, see globals.css): on a tablet or a landscape phone the
    // header and filters take most of the height, which left the table a
    // one-row window (UX-7), so there the document scrolls as a whole.
    // Mobile is unaffected (already scrolls via `main` itself — see
    // layout.tsx).
    //
    // UX-188: from `sm` the toolbar sits under the title until the page
    // itself (a container query, so a collapsed sidebar counts) is 90rem
    // wide. Its eight labelled buttons are ~1 140 px in Swedish, so side by
    // side at `lg` they squeezed the title into a narrow column (subtitle
    // over three lines) and wrapped into three ragged rows. Stacked, they
    // get the full width and wrap at most once.
    //
    // MAINT-102: no Suspense around the async sections below (the
    // well-stocked note, the toolbar, the manage-items link, the table), the
    // same as the household page (MAINT-31). They all wait on the one cached
    // query, but each used to stream in behind its own fallback, and under
    // load the browser painted them one at a time: the note pushed the
    // toolbar and table down a line, then the real toolbar wrapped onto a
    // second row its one-row skeleton hadn't held open and pushed the
    // already-painted table down another 36 px (CLS 0.298 on desktop, budget
    // 0.05). A skeleton can't know how the buttons wrap (label widths differ
    // per language, two buttons and the duplicates badge depend on the data),
    // so the page now arrives in one piece behind `loading.tsx`, and nothing
    // already on screen moves.
    <LazyDialogErrorMessage message={dict.errors.generic}>
    <div className="@container flex flex-col gap-6 roomy:h-[calc(100dvh-4rem)] roomy:min-h-0">
      <div className="flex flex-col gap-3 sm:shrink-0 max-sm:flex-row max-sm:items-start max-sm:justify-between @min-[90rem]:flex-row @min-[90rem]:items-center @min-[90rem]:justify-between">
        <div className="min-w-0">
          <PageTitle>{dict.inventory.title}</PageTitle>
          <p className="text-sm text-muted-foreground">{dict.inventory.subtitle}</p>
          <InventoryWellStockedNote householdId={household.id} dict={dict.inventory} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* UX-188: the action buttons, "Add item" first among them, lead
              the toolbar, so the screen's one primary action is the first
              thing you see and tab to. Catalog and export follow. */}
          <InventoryActionButtons
            householdId={household.id}
            dict={dict.inventory}
            barcodeDict={dict.barcodeScanner}
            exportLabel={dict.export.button}
            manageItemsLabel={dict.inventory.catalog.manageItems}
          />
          {/* Desktop-only like export below: on mobile manage-items
              lives inside the ⋯ menu so it isn't duplicated. */}
          <div className="hidden sm:block">
            <ManageItemsLink householdId={household.id} dict={dict.inventory.catalog} />
          </div>
          {/* Page-level export stays desktop-only: on mobile it lives
              inside the ⋯ menu (InventoryHeaderActionsClient) so there is
              only one export action per viewport. */}
          <div className="hidden sm:block">
            <ExportButton href="/dashboard/inventory/export" label={dict.export.button} />
          </div>
        </div>
      </div>
      <InventoryTable
        householdId={household.id}
        dict={dict.inventory}
        barcodeDict={dict.barcodeScanner}
        locale={locale}
        initialStatus={initialStatus}
        initialViewPrefs={initialViewPrefs}
      />
    </div>
    </LazyDialogErrorMessage>
  );
}
