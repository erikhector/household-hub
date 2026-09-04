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

export type InventoryItemRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  lowStockThreshold: number;
  location: string | null;
};

export type StockStatus = "out" | "low" | "in";

export function getStockStatus(quantity: number, threshold: number): StockStatus {
  if (quantity <= 0) return "out";
  if (quantity <= threshold) return "low";
  return "in";
}

function StockBadge({ status }: { status: StockStatus }) {
  if (status === "out") return <Badge variant="destructive">Out of stock</Badge>;
  if (status === "low") return <Badge className="bg-amber-500 text-white">Low stock</Badge>;
  return <Badge variant="secondary">In stock</Badge>;
}

export function InventoryTable({
  items,
  emptyMessage = "No items match your filters.",
}: {
  items: InventoryItemRow[];
  emptyMessage?: string;
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
          <TableHead>Name</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Status</TableHead>
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
              <StockBadge status={getStockStatus(item.quantity, item.lowStockThreshold)} />
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
