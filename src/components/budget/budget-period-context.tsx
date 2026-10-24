"use client";

import { createContext, useContext, type ReactNode } from "react";

// UX-134: the household's budget month start day, for the dialogs deep in the
// budget tabs that choose a default date (TransactionDialog). BudgetTabs
// provides it once instead of every panel between them passing it along next
// to `monthKey`. Outside a provider (the personal budget, whose months stay
// calendar months) it is 1.
const BudgetStartDayContext = createContext(1);

export function BudgetStartDayProvider({ startDay, children }: { startDay: number; children: ReactNode }) {
  return <BudgetStartDayContext.Provider value={startDay}>{children}</BudgetStartDayContext.Provider>;
}

export function useBudgetStartDay(): number {
  return useContext(BudgetStartDayContext);
}
