// Shared low-stock predicate. Originally lived inline in
// `components/inventory/inventory-table.tsx` (a "use client" file), but the
// notification center needs the exact same predicate from a Server
// Component — and a Server Component can't safely import a plain function
// from a "use client" module (Next.js turns every export of that module
// into an opaque client reference, not the real function; see the Server
// and Client Components guide). Living in its own plain module lets both
// sides import the real implementation instead of duplicating the
// condition.

export type StockStatus = "out" | "low" | "in";

export function getStockStatus(quantity: number, threshold: number): StockStatus {
  if (quantity <= 0) return "out";
  // Strict: restocking back up to exactly your own threshold should read as
  // "in stock," not "still low" (UX_FRICTION_BACKLOG.md item 4) — otherwise
  // the badge never confirms the good news a restock notification just sent.
  if (quantity < threshold) return "low";
  return "in";
}
