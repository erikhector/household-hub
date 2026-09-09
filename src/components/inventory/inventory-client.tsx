"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InventoryTable,
  getStockStatus,
  matchesUpdatedFilter,
  type HouseholdMemberOption,
  type InventoryGroupBy,
  type InventoryItemRow,
  type StockStatus,
  type UpdatedFilter,
} from "@/components/inventory/inventory-table";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

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
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const [status, setStatus] = useState<string>(initialStatus ?? ALL);
  const [updatedFilter, setUpdatedFilter] = useState<UpdatedFilter>("all");
  const [groupBy, setGroupBy] = useState<InventoryGroupBy>("none");

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
    const now = Date.now();
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
  }, [items, name, category, location, status, updatedFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={dict.searchPlaceholder}
          className="w-48"
        />
        <Select value={category} onValueChange={(v) => setCategory(v ?? ALL)}>
          <SelectTrigger className="w-40">
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
          <SelectTrigger className="w-40">
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
          <SelectTrigger className="w-40">
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
          <SelectTrigger className="w-48">
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
          <SelectTrigger className="w-44">
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
      />
    </div>
  );
}
