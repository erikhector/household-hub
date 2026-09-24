"use client";

import { useActionState, useState, useTransition, type ReactElement } from "react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createPersonalCategoryAction,
  deletePersonalCategoryAction,
  updatePersonalCategoryAction,
} from "@/app/dashboard/personal-budget/actions";
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type PersonalCategoryRow = {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
};

const initialState: ActionState = {};

export function PersonalCategoryManager({
  categories,
  dict,
}: {
  categories: PersonalCategoryRow[];
  dict: Dictionary["personalBudget"];
}) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(categoryId: string) {
    startTransition(async () => {
      const result = await deletePersonalCategoryAction(categoryId);
      if (result.error) toast.error(result.error);
    });
  }

  const income = categories.filter((c) => c.type === "INCOME");
  const expense = categories.filter((c) => c.type === "EXPENSE");
  const savings = categories.filter((c) => c.type === "SAVINGS");

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">{dict.categories.title}</h2>
        <AddCategoryDialog dict={dict} />
      </div>
      {categories.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {dict.categories.empty}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <CategoryGroup
            label={dict.categories.incomeSection}
            items={income}
            dict={dict}
            isPending={isPending}
            onDelete={handleDelete}
          />
          <CategoryGroup
            label={dict.categories.expenseSection}
            items={expense}
            dict={dict}
            isPending={isPending}
            onDelete={handleDelete}
          />
          <CategoryGroup
            label={dict.categories.savingsSection}
            items={savings}
            dict={dict}
            isPending={isPending}
            onDelete={handleDelete}
          />
        </div>
      )}
    </div>
  );
}

function CategoryGroup({
  label,
  items,
  dict,
  isPending,
  onDelete,
}: {
  label: string;
  items: PersonalCategoryRow[];
  dict: Dictionary["personalBudget"];
  isPending: boolean;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((category) => (
          <Badge
            key={category.id}
            variant="outline"
            className="max-w-[12rem] gap-1.5 py-1 pl-2.5"
          >
            <span className="min-w-0 truncate" title={category.name}>
              {category.name}
            </span>
            <EditCategoryDialog
              category={category}
              dict={dict}
              trigger={
                <button
                  type="button"
                  aria-label={format(dict.categories.editAriaLabel, { name: category.name })}
                  disabled={isPending}
                  className="-m-1.5 shrink-0 p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Pencil className="size-3" />
                </button>
              }
            />
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  aria-label={format(dict.categories.deleteAriaLabel, { name: category.name })}
                  disabled={isPending}
                  className="-m-1.5 shrink-0 p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-3" />
                </button>
              }
              title={format(dict.categories.confirmDelete.title, { name: category.name })}
              description={dict.categories.confirmDelete.description}
              cancelLabel={dict.categories.confirmDelete.cancel}
              confirmLabel={dict.categories.confirmDelete.confirm}
              pendingLabel={dict.categories.confirmDelete.confirming}
              onConfirm={() => onDelete(category.id)}
            />
          </Badge>
        ))}
      </div>
    </div>
  );
}

function EditCategoryDialog({
  category,
  dict,
  trigger,
}: {
  category: PersonalCategoryRow;
  dict: Dictionary["personalBudget"];
  trigger: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await updatePersonalCategoryAction(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.categories.editDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={category.id} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`personal-category-name-${category.id}`}>
              {dict.categories.nameLabel}
            </Label>
            <Input
              id={`personal-category-name-${category.id}`}
              name="name"
              required
              maxLength={60}
              defaultValue={category.name}
              placeholder={dict.categories.namePlaceholder}
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? dict.categories.saving : dict.categories.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AddCategoryDialog({ dict }: { dict: Dictionary["personalBudget"] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createPersonalCategoryAction(prevState, formData);
    if (!result.error) setOpen(false);
    return result;
  }, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {dict.categories.addCategory}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dict.categories.addDialogTitle}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="personal-category-name">{dict.categories.nameLabel}</Label>
            <Input
              id="personal-category-name"
              name="name"
              required
              maxLength={60}
              placeholder={dict.categories.namePlaceholder}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="personal-category-type">{dict.categories.typeLabel}</Label>
            <Select name="type" defaultValue="EXPENSE">
              <SelectTrigger id="personal-category-type" className="w-full">
                <SelectValue>
                  {(v: string) =>
                    v === "INCOME"
                      ? dict.type.income
                      : v === "SAVINGS"
                        ? dict.type.savings
                        : dict.type.expense
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EXPENSE">{dict.type.expense}</SelectItem>
                <SelectItem value="INCOME">{dict.type.income}</SelectItem>
                <SelectItem value="SAVINGS">{dict.type.savings}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? dict.categories.adding : dict.categories.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
