"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createInventoryItemAction } from "@/app/dashboard/inventory/actions";
import type { ActionState } from "@/lib/actions/auth";

const initialState: ActionState = {};

export function AddItemDialog({
  categories,
  locations,
}: {
  categories: string[];
  locations: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createInventoryItemAction(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Add item</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add inventory item</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                name="category"
                required
                placeholder="e.g. Dairy"
                list="category-options"
                autoComplete="off"
              />
              <datalist id="category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                name="location"
                placeholder="e.g. Fridge"
                list="location-options"
                autoComplete="off"
              />
              <datalist id="location-options">
                {locations.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={0}
                step="any"
                defaultValue={1}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" name="unit" defaultValue="pcs" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lowStockThreshold">Low stock at</Label>
              <Input
                id="lowStockThreshold"
                name="lowStockThreshold"
                type="number"
                min={0}
                step="any"
                defaultValue={1}
                required
              />
            </div>
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
