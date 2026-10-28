import { createLazyDialogLoader } from "@/components/ui/lazy-dialog";

// PERF-30: the budget pages' dialogs, loaded on first use with the lazy-dialog
// helper (components/ui/lazy-dialog.tsx). One loader per dialog, shared by every
// host that mounts it and every opener that wants to warm its chunk, and kept
// in one module so the import() paths are in a single place and out of the
// page's own chunk.

export const loadTransactionDialog = createLazyDialogLoader(() =>
  import("@/components/budget/transaction-dialog").then((m) => m.TransactionDialog),
);
export const loadRecurringTemplateDialog = createLazyDialogLoader(() =>
  import("@/components/budget/recurring-template-dialog").then((m) => m.RecurringTemplateDialog),
);
export const loadPlannedExpenseDialog = createLazyDialogLoader(() =>
  import("@/components/budget/planned-expense-dialog").then((m) => m.PlannedExpenseDialog),
);
export const loadLogSharedExpenseDialog = createLazyDialogLoader(() =>
  import("@/components/personal-budget/log-shared-expense-dialog").then((m) => m.LogSharedExpenseDialog),
);
