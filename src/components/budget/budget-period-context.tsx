"use client";

import { createContext, useContext, type ReactNode } from "react";

// UX-134: the budget month start day (the household's, or the user's own on
// the personal budget), for the dialogs deep in the budget tabs that choose a
// default date (TransactionDialog). BudgetTabs provides it once instead of
// every panel between them passing it along next to `monthKey`. Outside a
// provider it is 1, the calendar month.
const BudgetStartDayContext = createContext(1);

export function BudgetStartDayProvider({ startDay, children }: { startDay: number; children: ReactNode }) {
  return <BudgetStartDayContext.Provider value={startDay}>{children}</BudgetStartDayContext.Provider>;
}

export function useBudgetStartDay(): number {
  return useContext(BudgetStartDayContext);
}
