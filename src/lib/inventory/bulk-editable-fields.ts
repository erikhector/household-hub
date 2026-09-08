// Fields a bulk edit can target — a deliberate subset of the inventory item
// schema. `name` is excluded (a shared name across distinct items isn't
// meaningful) but every other editable field is here.
//
// Lives outside `actions.ts` on purpose: a "use server" file may only export
// async functions, so a plain const/array exported from one gets proxied
// into a server-action reference for client imports instead of its real
// value (breaking `.map`, `.includes`, etc. on the client).
export const bulkEditableFields = ["category", "location", "unit", "quantity", "lowStockThreshold"] as const;
export type BulkEditableField = (typeof bulkEditableFields)[number];
