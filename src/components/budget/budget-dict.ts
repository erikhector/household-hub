// A shared `dict` shape for the budget components that now serve both the
// household budget (dict.budget) and the personal budget (dict.personalBudget)
// pages — see BACKLOG.md's now-deleted BUDGET-2 entry and
// docs/archive/PERSONAL_BUDGET_UNIFICATION.md for the merge this supports.
// Both real dictionary namespaces are structurally compatible with this type
// (same field names/types for everything below), which is what lets either
// one be passed in directly with no adapter object.
//
// A few nested groups only exist on one side — household-only `split`
// sections (expense splitting has no personal-budget meaning) and
// personal-only `shared`/`logShared` sections (mirroring a split household
// bill has no household-budget meaning) — so those are optional here even
// though the object actually passed always either has or lacks the whole
// group, never a partial one. Every read of an optional group in these
// components is already behind a runtime condition that's false on the side
// whose dict lacks it (`canSplit`, `sharedRows.length`, …), so the optional
// chaining this forces is a type-checking formality, not a real "what if
// it's missing" case.
export type BudgetDict = {
  add: string;
  addTransactionDialogTitle: string;
  amountLabel: string;
  categoryLabel: string;
  categoryNoResults: string;
  categoryPlaceholder: string;
  categoryToggleLabel: string;
  columnAmount: string;
  columnCategory: string;
  columnDate: string;
  columnDescription: string;
  confirmDeleteTransaction: {
    cancel: string;
    confirm: string;
    confirming: string;
    description: string;
    title: string;
  };
  dateLabel: string;
  deleteAriaLabel: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  dueWidget: {
    allCaughtUpBody: string;
    allCaughtUpTitle: string;
    manageButton: string;
    noTemplatesBody: string;
    subtitle: string;
    title: string;
  };
  editAriaLabel: string;
  editTransactionDialogTitle: string;
  emptyTransactions: string;
  // Phone pass (Oct 2026): a transaction row's swipe-left tray and its
  // Undo toast (SwipeRow, useUndoableDelete), and the toast when the
  // deferred delete then fails.
  swipe: {
    edit: string;
    delete: string;
    deletedToast: string;
    undo: string;
  };
  saveFailedToast: string;
  // Phone pass (Oct 2026): TransactionList's category filter.
  filter: {
    label: string;
    all: string;
    clear: string;
    empty: string;
  };
  frequencyLabel: string;
  frequencyMonthly: string;
  frequencyWeekly: string;
  frequencyYearly: string;
  recurringLabel: string;
  save: string;
  saving: string;
  // Household-only: TransactionDialog's/TransactionList's expense-split UI.
  split?: {
    amountAriaLabel: string;
    mismatchWarning: string;
    paidByBadge: string;
    sharesLabel: string;
    splitBadge: string;
    splitEvenlyButton: string;
    toggleLabel: string;
    // SplitEditor's "share" + "paid" columns (partial payments) and the
    // transaction list's "left due" badge.
    shareColumn: string;
    paidColumn: string;
    paidAriaLabel: string;
    overpaidWarning: string;
    leftDueHint: string;
    leftDue: string;
  };
  // Personal-only: a household RecurringTemplate/Transaction split the user
  // has opted into, mirrored read-only into their personal budget — see
  // docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md.
  shared?: {
    leftDue: string;
    paidBy: string;
    sharedBadge: string;
    viewInHouseholdBudget: string;
    yourShare: string;
  };
  // Personal-only: "Log a shared expense" / "Log payment" — see
  // LogSharedExpenseDialog (src/components/personal-budget/log-shared-expense-dialog.tsx),
  // which stays personal-only and takes the full Dictionary["personalBudget"]
  // itself, not this narrower type.
  logShared?: {
    logPayment: string;
  };
  recurring: {
    // Household-only: RecurringTemplatesPanel attributes "Mark accounted
    // for" to whoever ran it (F7) — meaningless for a single-user personal
    // budget, so personalBudget's dict omits both fields entirely. Their
    // presence doubles as the household/personal switch for that line (see
    // RecurringTemplatesPanel), same convention `members.length > 1` serves
    // for split UI.
    acknowledgedByLabel?: string;
    acknowledgedByUnknown?: string;
    acknowledgedToast: string;
    add: string;
    addDialogTitle: string;
    addTemplate: string;
    amountLabel: string;
    confirmDelete: {
      cancel: string;
      confirm: string;
      confirming: string;
      description: string;
      title: string;
    };
    dayOfMonthLabel: string;
    dayOfMonthPlaceholder: string;
    deleteAriaLabel: string;
    dueDayLabel: string;
    editAriaLabel: string;
    editDialogTitle: string;
    empty: string;
    logAsIs: string;
    loggedAsIsToast: string;
    loggedToast: string;
    logTransaction: string;
    markAccountedFor: string;
    nameLabel: string;
    namePlaceholder: string;
    pause: string;
    pausedBadge: string;
    resume: string;
    save: string;
    saving: string;
    sectionAcknowledged: string;
    sectionDue: string;
    sectionPosted: string;
    // Household-only: RecurringTemplateDialog's/RecurringTemplatesPanel's
    // template-level expense-split UI, mirroring the top-level `split`
    // above.
    split?: {
      amountAriaLabel: string;
      mismatchWarning: string;
      sharesLabel: string;
      splitBadge: string;
      splitEvenlyButton: string;
      toggleLabel: string;
    };
    statusLegend: string;
    subtitle: string;
    title: string;
    undo: string;
    undoToast: string;
  };
};
