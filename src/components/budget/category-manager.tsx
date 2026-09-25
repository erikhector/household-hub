"use client";

import { useActionState, useState, useTransition, type ReactElement } from "react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

type CategoryType = "INCOME" | "EXPENSE" | "SAVINGS";

export type CategoryRow = {
  id: string;
  name: string;
  type: CategoryType;
  // GAP-12's optional monthly spending cap. Optional on the type because
  // CategoryRow is also built for pickers that never show it (the
  // transaction dialog, the personal page's household category list); only
  // the rows fed to CategoryManager need to carry it for the edit form.
  monthlyLimit?: number | null;
  // GAP-21's envelope carryover toggle, optional for the same reason.
  rolloverEnabled?: boolean;
  // GAP-22's savings goal (SAVINGS categories only), optional for the same
  // reason. goalDate is UTC midnight of the picked day — see goalDateField
  // in src/lib/savings-goal-calc.ts.
  goalAmount?: number | null;
  goalDate?: Date | null;
};

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
    limitLabel: string;
    limitPlaceholder: string;
    limitHint: string;
    rolloverLabel: string;
    rolloverHint: string;
    rolloverNeedsLimit: string;
    goalLabel: string;
    goalPlaceholder: string;
    goalHint: string;
    goalDateLabel: string;
    goalDateHint: string;
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
          {/* A category's type can't be changed, so the limit field is
              simply absent for income/savings categories (the action also
              stores null for them regardless of what's sent). */}
          {category.type === "EXPENSE" && (
            <MonthlyLimitField
              id={`category-limit-${category.id}`}
              defaultValue={category.monthlyLimit}
              defaultRollover={category.rolloverEnabled}
              dict={dict}
            />
          )}
          {/* GAP-22: likewise, only savings categories have a goal. */}
          {category.type === "SAVINGS" && (
            <SavingsGoalField
              id={`category-goal-${category.id}`}
              defaultAmount={category.goalAmount}
              defaultDate={category.goalDate}
              dict={dict}
            />
          )}
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
  // Controlled (rather than the Select's own defaultValue) only so the
  // monthly limit field below can appear for expense categories alone (and
  // GAP-22's savings goal for savings categories alone).
  const [type, setType] = useState<CategoryType>("EXPENSE");
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
            <Select
              name="type"
              value={type}
              onValueChange={(v) => setType((v as CategoryType | null) ?? "EXPENSE")}
            >
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
          {type === "EXPENSE" && <MonthlyLimitField id="category-limit" dict={dict} />}
          {type === "SAVINGS" && <SavingsGoalField id="category-goal" dict={dict} />}
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

/**
 * GAP-12's optional monthly spending cap, shared by the add and edit
 * dialogs. Empty means "no limit" (and clears an existing one on edit) —
 * see monthlyLimitField in src/lib/budget-category-limit.ts for the
 * server-side parsing.
 *
 * Also carries GAP-21's "Roll unspent budget over" checkbox, since rollover
 * only means something with a limit to carry (src/lib/budget-rollover-calc.ts).
 * The checkbox stays visible but disabled while the limit field is empty,
 * with a hint saying why, rather than popping in and out as the user types —
 * and a disabled checkbox isn't submitted, so the action stores "off"
 * (it also clears the flag itself whenever the limit ends up null).
 */
function MonthlyLimitField({
  id,
  defaultValue,
  defaultRollover,
  dict,
}: {
  id: string;
  defaultValue?: number | null;
  defaultRollover?: boolean;
  dict: CategoryManagerDict;
}) {
  // Only tracks whether the (still uncontrolled) input has something in
  // it, to enable the rollover checkbox below.
  const [hasLimit, setHasLimit] = useState(defaultValue != null);
  const rolloverId = `${id}-rollover`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{dict.categories.limitLabel}</Label>
        <Input
          id={id}
          name="monthlyLimit"
          type="number"
          min={0.01}
          step="any"
          inputMode="decimal"
          defaultValue={defaultValue ?? undefined}
          placeholder={dict.categories.limitPlaceholder}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setHasLimit(e.target.value.trim() !== "")}
        />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {dict.categories.limitHint}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={rolloverId} className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            id={rolloverId}
            name="rolloverEnabled"
            defaultChecked={defaultRollover ?? false}
            disabled={!hasLimit}
            aria-describedby={`${rolloverId}-hint`}
          />
          {dict.categories.rolloverLabel}
        </label>
        <p id={`${rolloverId}-hint`} className="text-xs text-muted-foreground">
          {hasLimit ? dict.categories.rolloverHint : dict.categories.rolloverNeedsLimit}
        </p>
      </div>
    </div>
  );
}

/**
 * GAP-22's optional savings goal, shared by the add and edit dialogs and
 * shown only for SAVINGS categories: a target amount and, optionally, a
 * date to reach it by. An empty amount means "no goal" (and clears one on
 * edit, date included) — see goalAmountField/goalDateField/goalForType in
 * src/lib/savings-goal-calc.ts for the server-side parsing. Unlike the
 * rollover checkbox above, the date stays enabled while the amount is
 * empty: filling the two in either order shouldn't fight the user, and a
 * date sent alone is simply dropped by the action.
 */
function SavingsGoalField({
  id,
  defaultAmount,
  defaultDate,
  dict,
}: {
  id: string;
  defaultAmount?: number | null;
  defaultDate?: Date | null;
  dict: CategoryManagerDict;
}) {
  const dateId = `${id}-date`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{dict.categories.goalLabel}</Label>
        <Input
          id={id}
          name="goalAmount"
          type="number"
          min={0.01}
          step="any"
          inputMode="decimal"
          defaultValue={defaultAmount ?? undefined}
          placeholder={dict.categories.goalPlaceholder}
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {dict.categories.goalHint}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={dateId}>{dict.categories.goalDateLabel}</Label>
        <Input
          id={dateId}
          name="goalDate"
          type="date"
          // Stored as UTC midnight of the picked day, so its UTC ISO date is
          // that same day whatever the viewer's time zone.
          defaultValue={defaultDate ? defaultDate.toISOString().slice(0, 10) : undefined}
          aria-describedby={`${dateId}-hint`}
        />
        <p id={`${dateId}-hint`} className="text-xs text-muted-foreground">
          {dict.categories.goalDateHint}
        </p>
      </div>
    </div>
  );
}
