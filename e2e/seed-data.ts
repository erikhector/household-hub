// Fixed ids for the rows e2e/seed.ts creates. Kept apart from seed.ts
// (which imports pg and bcrypt) so e2e/routes.ts, which Vitest also loads,
// can reference them without pulling a database driver into the unit suite.
export const E2E_SHOPPING_LIST = { id: "e2e-shopping-list", name: "E2E Groceries" };
// A pantry item with recipes, a list row, a template, a conversion and a
// learned name, so the item page (MATCH-6) renders every section.
export const E2E_ITEM = { id: "e2e-inv-flour", name: "Wheat flour" };
