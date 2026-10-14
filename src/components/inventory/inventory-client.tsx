"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { getStockStatus, type StockStatus } from "@/lib/stock-status";
import {
  matchesUpdatedFilter,
  type HouseholdMemberOption,
  type InventoryGroupBy,
  type InventoryItemRow,
  type InventoryViewPrefs,
  type UpdatedFilter,
} from "@/components/inventory/inventory-table-utils";
import { setInventoryViewPrefsAction } from "@/lib/actions/preferences";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { ListTransitionScope } from "@/components/shared/view-transitions";

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";

// Stale filters (least-recently-touched first) surface the items most worth
// a physical recount; recency filters (most-recently-touched first) are more
// about reviewing what changed recently.
const OLDEST_FIRST_FILTERS = new Set<UpdatedFilter>(["stale30", "stale90"]);
const NEWEST_FIRST_FILTERS = new Set<UpdatedFilter>(["today", "week"]);

export function InventoryClient({
  items,
  categories,
  locations,
  units,
  members,
  locale,
  dict,
  barcodeDict,
  initialStatus,
  initialViewPrefs,
  aiCategoryFallbackEnabled = false,
}: {
  items: InventoryItemRow[];
  categories: string[];
  locations: string[];
  units: string[];
  members: HouseholdMemberOption[];
  locale: Locale;
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  initialStatus?: StockStatus;
  initialViewPrefs: Partial<InventoryViewPrefs>;
  /** AUTO-2b(a): forwarded to the empty state's ItemFormDialog — see its
   * own doc comment in add-item-dialog.tsx. */
  aiCategoryFallbackEnabled?: boolean;
}) {
  const [name, setName] = useState("");
  // A saved category/location is only honored if it's still one the
  // household actually has (items get deleted, categories/locations change)
  // — otherwise it'd silently filter the table down to nothing.
  const [category, setCategory] = useState(() =>
    initialViewPrefs.category && categories.includes(initialViewPrefs.category)
      ? initialViewPrefs.category
      : ALL,
  );
  const [location, setLocation] = useState(() => {
    const saved = initialViewPrefs.location;
    if (saved === UNASSIGNED) return UNASSIGNED;
    return saved && locations.includes(saved) ? saved : ALL;
  });
  // initialStatus (a notification-bell ?status= link) is an explicit ask to
  // view that status right now, so it overrides the saved preference.
  const [status, setStatus] = useState<string>(initialStatus ?? initialViewPrefs.status ?? ALL);
  const [updatedFilter, setUpdatedFilter] = useState<UpdatedFilter>(initialViewPrefs.updatedFilter ?? "all");
  const [groupBy, setGroupBy] = useState<InventoryGroupBy>(initialViewPrefs.groupBy ?? "none");
  const [now] = useState(() => Date.now());

  // Persists grouping/filter changes to the account (src/lib/actions/preferences.ts)
  // so they're there on reload and on other devices. Skips the render that
  // just applied initialViewPrefs, so loading a saved value doesn't
  // immediately "persist" it right back unchanged.
  const skipNextPersist = useRef(true);
  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    void setInventoryViewPrefsAction({ groupBy, category, location, status, updatedFilter });
  }, [groupBy, category, location, status, updatedFilter]);

  const statusLabels: Record<StockStatus, string> = {
    in: dict.statusIn,
    low: dict.statusLow,
    out: dict.statusOut,
  };

  const updatedFilterLabels: Record<UpdatedFilter, string> = {
    all: dict.updatedFilterAll,
    today: dict.updatedFilterToday,
    week: dict.updatedFilterWeek,
    stale30: dict.updatedFilterStale30,
    stale90: dict.updatedFilterStale90,
  };

  const groupByLabels: Record<InventoryGroupBy, string> = {
    none: dict.groupByNone,
    category: dict.groupByCategory,
    location: dict.groupByLocation,
    both: dict.groupByBoth,
  };

  const filtered = useMemo(() => {
    const nameQuery = name.trim().toLowerCase();
    const result = items.filter((item) => {
      if (nameQuery && !item.name.toLowerCase().includes(nameQuery)) return false;
      if (category !== ALL && item.category !== category) return false;
      if (location === UNASSIGNED && item.location) return false;
      if (location !== ALL && location !== UNASSIGNED && (item.location ?? "") !== location) return false;
      if (status !== ALL && getStockStatus(item.quantity, item.lowStockThreshold) !== status) {
        return false;
      }
      if (!matchesUpdatedFilter(item, updatedFilter, now)) return false;
      return true;
    });

    // Surface the most relevant end of the list first when a freshness
    // filter is active, rather than leaving the default name sort — see the
    // OLDEST_FIRST_FILTERS/NEWEST_FIRST_FILTERS comment above.
    if (OLDEST_FIRST_FILTERS.has(updatedFilter)) {
      result.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    } else if (NEWEST_FIRST_FILTERS.has(updatedFilter)) {
      result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }

    return result;
  }, [items, name, category, location, status, updatedFilter, now]);

  // Counts real filters only — groupBy is a view option, not a filter, so it
  // doesn't count toward the mobile "Filters" button's badge.
  const activeFilterCount = [category !== ALL, location !== ALL, status !== ALL, updatedFilter !== "all"].filter(
    Boolean,
  ).length;

  function clearFilters() {
    setCategory(ALL);
    setLocation(ALL);
    setStatus(ALL);
    setUpdatedFilter("all");
  }

  return (
    <div className="flex flex-col gap-4 sm:min-h-0 sm:flex-1">
      {/* Sticks to the top of the scrollable area on phones (flush under the
          always-visible header — see dashboard/layout.tsx) once the page
          title scrolls past it, so search stays reachable without
          scrolling back up — desktop has room to spare and stays static
          (see the page's roomy:h-[calc(...)] wrapper, which keeps this row
          fixed and lets the table below scroll internally instead).
          Translucent with a blur, not flat opaque: an opaque band painted
          over the page gradient (UX-25). */}
      <div className="flex flex-col gap-2 max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:-mx-4 max-sm:bg-background/85 max-sm:px-4 max-sm:pt-1 max-sm:pb-2 max-sm:backdrop-blur-sm sm:shrink-0">
        <div className="flex items-center gap-2">
          <SearchInput
            value={name}
            onValueChange={setName}
            placeholder={dict.searchPlaceholder}
            clearLabel={dict.clearSearch}
            containerClassName="flex-1 sm:flex-none sm:w-48"
          />
          {/* Mobile only: the five selects below fold into this single
              button instead of eating several rows above the fold — see the
              sm:flex row for the unfolded desktop equivalent. */}
          <Dialog>
            <DialogTrigger
              render={
                <Button variant="outline" className="shrink-0 gap-1.5 sm:hidden">
                  <SlidersHorizontal className="size-4" />
                  {dict.filtersButton}
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="px-1.5 tabular-nums">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{dict.filtersDialogTitle}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label id="mobile-category-label" className="text-xs font-medium text-muted-foreground">{dict.categoryLabel}</Label>
                  <Select value={category} onValueChange={(v) => setCategory(v ?? ALL)}>
                    <SelectTrigger aria-labelledby="mobile-category-label" className="w-full">
                      <SelectValue>{(v: string) => (v === ALL ? dict.allCategories : v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{dict.allCategories}</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label id="mobile-location-label" className="text-xs font-medium text-muted-foreground">{dict.locationLabel}</Label>
                  <Select value={location} onValueChange={(v) => setLocation(v ?? ALL)}>
                    <SelectTrigger aria-labelledby="mobile-location-label" className="w-full">
                      <SelectValue>
                        {(v: string) =>
                          v === ALL ? dict.allLocations : v === UNASSIGNED ? dict.unassignedLocation : v
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{dict.allLocations}</SelectItem>
                      <SelectItem value={UNASSIGNED}>{dict.unassignedLocation}</SelectItem>
                      {locations.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label id="mobile-status-label" className="text-xs font-medium text-muted-foreground">{dict.columnStatus}</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v ?? ALL)}>
                    <SelectTrigger aria-labelledby="mobile-status-label" className="w-full">
                      <SelectValue>
                        {(v: string) => (v === ALL ? dict.allStatuses : statusLabels[v as StockStatus])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{dict.allStatuses}</SelectItem>
                      {(Object.keys(statusLabels) as StockStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {statusLabels[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label id="mobile-updated-label" className="text-xs font-medium text-muted-foreground">{dict.updatedFilterLabel}</Label>
                  <Select value={updatedFilter} onValueChange={(v) => setUpdatedFilter((v as UpdatedFilter) ?? "all")}>
                    <SelectTrigger aria-labelledby="mobile-updated-label" className="w-full">
                      <SelectValue>{(v: string) => updatedFilterLabels[v as UpdatedFilter]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(updatedFilterLabels) as UpdatedFilter[]).map((f) => (
                        <SelectItem key={f} value={f}>
                          {updatedFilterLabels[f]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{dict.groupByLabel}</span>
                  <Select value={groupBy} onValueChange={(v) => setGroupBy((v as InventoryGroupBy) ?? "none")}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{(v: string) => groupByLabels[v as InventoryGroupBy]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(groupByLabels) as InventoryGroupBy[]).map((g) => (
                        <SelectItem key={g} value={g}>
                          {groupByLabels[g]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={clearFilters} disabled={activeFilterCount === 0}>
                  {dict.clearFilters}
                </Button>
                <DialogClose render={<Button>{dict.doneButton}</Button>} />
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {/* Desktop/tablet only — wraps onto as many rows as needed rather
            than scrolling sideways; each select is a fixed, modest width so
            2-3 fit per row. Phones get the folded "Filters" button above
            instead. */}
        <div className="hidden flex-wrap gap-2 sm:flex">
          <Select value={category} onValueChange={(v) => setCategory(v ?? ALL)}>
            <SelectTrigger className="w-40 shrink-0">
              <SelectValue>{(v: string) => (v === ALL ? dict.allCategories : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{dict.allCategories}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={location} onValueChange={(v) => setLocation(v ?? ALL)}>
            <SelectTrigger className="w-40 shrink-0">
              <SelectValue>
                {(v: string) => (v === ALL ? dict.allLocations : v === UNASSIGNED ? dict.unassignedLocation : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{dict.allLocations}</SelectItem>
              <SelectItem value={UNASSIGNED}>{dict.unassignedLocation}</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v ?? ALL)}>
            <SelectTrigger className="w-40 shrink-0">
              <SelectValue>
                {(v: string) => (v === ALL ? dict.allStatuses : statusLabels[v as StockStatus])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{dict.allStatuses}</SelectItem>
              {(Object.keys(statusLabels) as StockStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={updatedFilter} onValueChange={(v) => setUpdatedFilter((v as UpdatedFilter) ?? "all")}>
            <SelectTrigger className="w-48 shrink-0">
              <SelectValue>
                {(v: string) => `${dict.updatedFilterLabel}: ${updatedFilterLabels[v as UpdatedFilter]}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(updatedFilterLabels) as UpdatedFilter[]).map((f) => (
                <SelectItem key={f} value={f}>
                  {updatedFilterLabels[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={groupBy} onValueChange={(v) => setGroupBy((v as InventoryGroupBy) ?? "none")}>
            <SelectTrigger className="w-44 shrink-0">
              <SelectValue>{(v: string) => `${dict.groupByLabel}: ${groupByLabels[v as InventoryGroupBy]}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(groupByLabels) as InventoryGroupBy[]).map((g) => (
                <SelectItem key={g} value={g}>
                  {groupByLabels[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* UX-33: see ListTransitionScope. */}
      <ListTransitionScope>
        <InventoryTable
          items={filtered}
          categories={categories}
          locations={locations}
          units={units}
          members={members}
          locale={locale}
          groupBy={groupBy}
          dict={dict}
          barcodeDict={barcodeDict}
          emptyMessage={items.length === 0 ? dict.emptyNoItems : dict.emptyNoMatches}
          isHouseholdEmpty={items.length === 0}
          aiCategoryFallbackEnabled={aiCategoryFallbackEnabled}
        />
      </ListTransitionScope>
    </div>
  );
}
