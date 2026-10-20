"use client";

import { createContext, useContext, type ReactNode } from "react";
import { unitLabel, unitLabelForQuantity } from "@/lib/units";

// UX-44: stored units render in the user's language ("pcs" → "st"). About
// 60 display sites in 26 client components need the same ~30-entry map, so
// it's provided once by the dashboard layout (and the public share page)
// instead of being threaded through every dialog's props, and kept out of
// the per-feature dictionary slices (PERF-5). Server code calls
// `unitLabel(unit, dict.units)` directly.
const UnitsContext = createContext<Readonly<Record<string, string>>>({});

const UnitsPluralContext = createContext<Readonly<Record<string, string>>>({});

export function UnitsProvider({
  labels,
  plurals = {},
  children,
}: {
  labels: Readonly<Record<string, string>>;
  plurals?: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  return (
    <UnitsContext.Provider value={labels}>
      <UnitsPluralContext.Provider value={plurals}>{children}</UnitsPluralContext.Provider>
    </UnitsContext.Provider>
  );
}

/** Display label for a stored unit; unknown units show as stored. */
export function useUnitLabel(): (unit: string, quantity?: number) => string {
  const labels = useContext(UnitsContext);
  const plurals = useContext(UnitsPluralContext);
  return (unit, quantity) =>
    quantity === undefined ? unitLabel(unit, labels) : unitLabelForQuantity(unit, quantity, labels, plurals);
}
