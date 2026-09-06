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
  type InventoryGroupBy,
  type InventoryItemRow,
  type StockStatus,
} from "@/components/inventory/inventory-table";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const ALL = "__all__";

export function InventoryClient({
  items,
  categories,
  locations,
  dict,
  barcodeDict,
  initialStatus,
}: {
  items: InventoryItemRow[];
  categories: string[];
  locations: string[];
  dict: Dictionary["inventory"];
  barcodeDict: Dictionary["barcodeScanner"];
  initialStatus?: StockStatus;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const [status, setStatus] = useState<string>(initialStatus ?? ALL);
  const [groupBy, setGroupBy] = useState<InventoryGroupBy>("none");

  const statusLabels: Record<StockStatus, string> = {
    in: dict.statusIn,
    low: dict.statusLow,
    out: dict.statusOut,
  };

  const groupByLabels: Record<InventoryGroupBy, string> = {
    none: dict.groupByNone,
    category: dict.groupByCategory,
    location: dict.groupByLocation,
    both: dict.groupByBoth,
  };

  const filtered = useMemo(() => {
    const nameQuery = name.trim().toLowerCase();
    return items.filter((item) => {
      if (nameQuery && !item.name.toLowerCase().includes(nameQuery)) return false;
      if (category !== ALL && item.category !== category) return false;
      if (location !== ALL && (item.location ?? "") !== location) return false;
      if (status !== ALL && getStockStatus(item.quantity, item.lowStockThreshold) !== status) {
        return false;
      }
      return true;
    });
  }, [items, name, category, location, status]);

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
            <SelectValue>{(v: string) => (v === ALL ? dict.allLocations : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{dict.allLocations}</SelectItem>
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
        groupBy={groupBy}
        dict={dict}
        barcodeDict={barcodeDict}
        emptyMessage={items.length === 0 ? dict.emptyNoItems : dict.emptyNoMatches}
      />
    </div>
  );
}
