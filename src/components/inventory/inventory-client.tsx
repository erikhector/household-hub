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
  type InventoryItemRow,
  type StockStatus,
} from "@/components/inventory/inventory-table";

const ALL = "__all__";

const STATUS_LABELS: Record<StockStatus, string> = {
  in: "In stock",
  low: "Low stock",
  out: "Out of stock",
};

export function InventoryClient({
  items,
  categories,
  locations,
}: {
  items: InventoryItemRow[];
  categories: string[];
  locations: string[];
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(ALL);
  const [location, setLocation] = useState(ALL);
  const [status, setStatus] = useState(ALL);

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
          placeholder="Search by name…"
          className="w-48"
        />
        <Select value={category} onValueChange={(v) => setCategory(v ?? ALL)}>
          <SelectTrigger className="w-40">
            <SelectValue>{(v: string) => (v === ALL ? "All categories" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={location} onValueChange={(v) => setLocation(v ?? ALL)}>
          <SelectTrigger className="w-40">
            <SelectValue>{(v: string) => (v === ALL ? "All locations" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All locations</SelectItem>
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
              {(v: string) => (v === ALL ? "All statuses" : STATUS_LABELS[v as StockStatus])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {(Object.keys(STATUS_LABELS) as StockStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <InventoryTable
        items={filtered}
        emptyMessage={
          items.length === 0
            ? "No items yet. Add your first item to start tracking inventory."
            : "No items match your filters."
        }
      />
    </div>
  );
}
