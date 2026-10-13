// Fixed ids for the rows e2e/seed.ts creates. Kept apart from seed.ts
// (which imports pg and bcrypt) so e2e/routes.ts, which Vitest also loads,
// can reference them without pulling a database driver into the unit suite.
//
// Specs run in parallel, so each Playwright worker gets its own copy of
// the seeded household, users and rows: two specs never race on the same
// list or budget. Playwright sets TEST_PARALLEL_INDEX (0 .. workers - 1)
// in each worker process before it loads the config and the specs, so the
// constants below already point at that worker's copy, and specs import
// them unchanged. Outside a worker (the runner listing tests, Vitest)
// they're worker 0's, which is why a test title must never contain one.
// Every id is a primary key across the whole database, hence a suffix per
// worker rather than the same id in each household.
export const E2E_WORKER = Number(process.env.TEST_PARALLEL_INDEX ?? 0);

export const E2E_PASSWORD = "e2e-password-123";

export function e2eWorkerData(worker: number) {
  const id = (base: string) => `${base}-w${worker}`;
  return {
    id,
    household: { id: id("e2e-household"), name: "E2E Household" },
    user: { id: id("e2e-user"), email: `e2e-w${worker}@squirrel.test`, password: E2E_PASSWORD, displayName: "E2E Tester" },
    userSv: {
      id: id("e2e-user-sv"),
      email: `e2e-sv-w${worker}@squirrel.test`,
      password: E2E_PASSWORD,
      displayName: "E2E Testare",
    },
    // The two users' memberships, which specs that split a bill between
    // them point TransactionSplit rows at.
    member: id("e2e-member"),
    memberSv: id("e2e-member-sv"),
    storageState: `e2e/.auth/user-w${worker}.json`,
    storageStateSv: `e2e/.auth/user-sv-w${worker}.json`,
    shoppingList: { id: id("e2e-shopping-list"), name: "E2E Groceries" },
    // A pantry item with recipes, a list row, a template, a conversion and a
    // learned name, so the item page (MATCH-6) renders every section.
    item: { id: id("e2e-inv-flour"), name: "Wheat flour" },
  };
}

const current = e2eWorkerData(E2E_WORKER);
export const E2E_SHOPPING_LIST = current.shoppingList;
export const E2E_ITEM = current.item;
