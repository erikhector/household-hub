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
import { format } from "@/lib/i18n/format";
import type { ActionState } from "@/lib/actions/auth";

export type CategoryRow = { id: string; name: string; type: "INCOME" | "EXPENSE" | "SAVINGS" };

// Shared by both createCategoryAction/updateCategoryAction/deleteCategoryAction
// (household, src/app/dashboard/budget/actions.ts) and
// createPersonalCategoryAction/updatePersonalCategoryAction/
// deletePersonalCategoryAction (personal, src/app/dashboard/personal-budget/actions.ts).
// Injected as props (BUDGET-3) rather than imported directly, since the two
// actions.ts files — and the Prisma model families they front,
// BudgetCategory vs. PersonalBudgetCategory — stay separate by design (see
// docs/archive/PERSONAL_BUDGET_UNIFICATION.md §1). This is the same
// injected-action shape BUDGET-2 used for TransactionDialog's
// create/updateAction.
export type CategoryFormAction = (
  prevState: ActionState,
  formData: FormData,
) => Promise<ActionState>;
export type DeleteCategoryAction = (categoryId: string) => Promise<ActionState>;

// A narrow, structural dict shape both Dictionary["budget"] and
// Dictionary["personalBudget"] already satisfy as-is — their `categories`
// and `type` sections are identical field-for-field — so either real
// dictionary can be passed straight in with no adapter object. Scoped down
// to exactly what this file reads, unlike BUDGET-2's wider `BudgetDict`
// (src/components/budget/budget-dict.ts), which covers the five components
// that also read `dict.recurring`/`dict.split`/etc.
export type CategoryManagerDict = {
  categories: {
    title: string;
    addCategory: string;
    addDialogTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    typeLabel: string;
    adding: string;
    add: string;
    empty: string;
    editAriaLabel: string;
    editDialogTitle: string;
    save: string;
    saving: string;
    deleteAriaLabel: string;
    confirmDelete: {
      title: string;
      description: string;
      cancel: string;
      confirm: string;
      confirming: string;
    };
    incomeSection: string;
    expenseSection: string;
    savingsSection: string;
  };
  type: {
    income: string;
    expense: string;
    savings: string;
  };
};

const initialState: ActionState = {};

export function CategoryManager({
  categories,
  dict,
  createAction,
  updateAction,
  deleteAction,
}: {
  categories: CategoryRow[];
  dict: CategoryManagerDict;
  /** createCategoryAction / createPersonalCategoryAction — see
   * CategoryFormAction's doc comment. */
  createAction: CategoryFormAction;
  /** updateCategoryAction / updatePersonalCategoryAction. */
  updateAction: CategoryFormAction;
  /** deleteCategoryAction / deletePersonalCategoryAction. */
  deleteAction: DeleteCategoryAction;
}) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(categoryId: string) {
    startTransition(async () => {
      const result = await deleteAction(categoryId);
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
        <AddCategoryDialog dict={dict} createAction={createAction} />
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
            updateAction={updateAction}
          />
          <CategoryGroup
            label={dict.categories.expenseSection}
            items={expense}
            dict={dict}
            isPending={isPending}
            onDelete={handleDelete}
            updateAction={updateAction}
          />
          <CategoryGroup
            label={dict.categories.savingsSection}
            items={savings}
            dict={dict}
            isPending={isPending}
            onDelete={handleDelete}
            updateAction={updateAction}
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
  updateAction,
}: {
  label: string;
  items: CategoryRow[];
  dict: CategoryManagerDict;
  isPending: boolean;
  onDelete: (id: string) => void;
  updateAction: CategoryFormAction;
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
              updateAction={updateAction}
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
  updateAction,
}: {
  category: CategoryRow;
  dict: CategoryManagerDict;
  trigger: ReactElement;
  updateAction: CategoryFormAction;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await updateAction(prevState, formData);
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
            <Label htmlFor={`category-name-${category.id}`}>{dict.categories.nameLabel}</Label>
            <Input
              id={`category-name-${category.id}`}
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

export function AddCategoryDialog({
  dict,
  createAction,
}: {
  dict: CategoryManagerDict;
  /** createCategoryAction / createPersonalCategoryAction — see
   * CategoryFormAction's doc comment. Also the one prop callers that only
   * ever render this dialog on its own (BudgetOnboarding/
   * PersonalBudgetOnboarding, when there are zero categories yet) need to
   * thread through from their own page. */
  createAction: CategoryFormAction;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (
    prevState: ActionState,
    formData: FormData,
  ) => {
    const result = await createAction(prevState, formData);
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
            <Label htmlFor="category-name">{dict.categories.nameLabel}</Label>
            <Input
              id="category-name"
              name="name"
              required
              maxLength={60}
              placeholder={dict.categories.namePlaceholder}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="category-type">{dict.categories.typeLabel}</Label>
            <Select name="type" defaultValue="EXPENSE">
              <SelectTrigger id="category-type" className="w-full">
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
