"use client";

import { useTransition } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adjustQuantityAction, deleteInventoryItemAction } from "@/app/dashboard/inventory/actions";
import { getStockStatus, type StockStatus } from "@/lib/stock-status";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type InventoryItemRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  location: string | null;
};

// Re-exported for existing consumers (InventoryClient) — the real
// implementation now lives in `@/lib/stock-status` so it's importable from
// Server Components too (see that file's comment for why).
export { getStockStatus, type StockStatus };

function StockBadge({ status, dict }: { status: StockStatus; dict: Dictionary["inventory"] }) {
  if (status === "out") return <Badge variant="destructive">{dict.statusOut}</Badge>;
  if (status === "low") return <Badge className="bg-amber-500 text-white">{dict.statusLow}</Badge>;
  return <Badge variant="secondary">{dict.statusIn}</Badge>;
}

export function InventoryTable({
  items,
  emptyMessage,
  dict,
}: {
  items: InventoryItemRow[];
  emptyMessage: string;
  dict: Dictionary["inventory"];
}) {
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{dict.columnName}</TableHead>
          <TableHead>{dict.columnCategory}</TableHead>
          <TableHead>{dict.columnLocation}</TableHead>
          <TableHead>{dict.columnQuantity}</TableHead>
          <TableHead>{dict.columnStatus}</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">{item.name}</TableCell>
            <TableCell className="text-muted-foreground">{item.category}</TableCell>
            <TableCell className="text-muted-foreground">{item.location ?? "—"}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={isPending}
                  onClick={() => startTransition(() => adjustQuantityAction(item.id, -1))}
                >
                  <Minus className="size-3.5" />
                </Button>
                <span className="w-14 text-center tabular-nums">
                  {item.quantity} {item.unit}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7"
                  disabled={isPending}
                  onClick={() => startTransition(() => adjustQuantityAction(item.id, 1))}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <StockBadge status={getStockStatus(item.quantity, item.lowStockThreshold)} dict={dict} />
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                disabled={isPending}
                onClick={() => startTransition(() => deleteInventoryItemAction(item.id))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
