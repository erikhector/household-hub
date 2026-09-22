// End-to-end golden-path smoke test (Wave 3, task N — see
// PRODUCTION_READINESS.md), covering the same Server Action layer as
// auth.test.ts / household.test.ts but with a meaningfully different goal:
// those files mock Prisma per-test with static `mockResolvedValueOnce`
// return values for one action in isolation, so nothing actually connects
// signup's user to login's credentials to the household a later action
// scopes itself to. This test drives signup -> verify email -> log in ->
// add an inventory item -> create a shopping list -> log a budget
// transaction as one sequence against a small stateful in-memory fake of
// just the Prisma delegates this path touches, so state genuinely flows
// between steps: the user id created in step 1 is the one whose password
// hash step 3's login checks, and the household id from step 1 is the one
// every step 4 action is asserted to have written against.
//
// Still within this codebase's existing vitest conventions (no Playwright,
// no jsdom/@testing-library, no real database) — see vitest.config.ts's
// scope comment and the identical mocking mechanism every other
// *.actions.test.ts file already uses.
import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// The real "next-auth" package's index imports "next/server", which Vitest's
// Node environment can't resolve outside a Next.js build — mock it with a
// minimal stand-in so `error instanceof AuthError` in auth.ts still works
// (identical convention to auth.test.ts/household.test.ts).
class AuthError extends Error {}
vi.mock("next-auth", () => ({ AuthError }));

// Mirrors src/lib/auth.ts's real EmailNotVerifiedSignin (see the identical
// stand-in in auth.test.ts) — signInMock's real implementation below throws
// this the same way the real `authorize` callback does, so this golden path
// actually exercises the hard-gate-on-verification bug fix end to end.
class EmailNotVerifiedSignin extends AuthError {}

const {
  store,
  fakePrisma,
  signInMock,
  signOutMock,
  sendVerificationEmailMock,
  sendPasswordResetEmailMock,
  requireHouseholdMock,
  requireUserIdMock,
  redirectMock,
  revalidatePathMock,
  headersMock,
} = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };

  const store = {
    users: [] as Row[],
    households: [] as Row[],
    householdMembers: [] as Row[],
    emailVerificationTokens: [] as Row[],
    inventoryItems: [] as Row[],
    shoppingLists: [] as Row[],
    shoppingListItems: [] as Row[],
    budgetCategories: [] as Row[],
    transactions: [] as Row[],
    // The "logged in as" pointer every mocked auth-adjacent function below
    // reads/writes — this is what makes signIn (step 3) and
    // requireHousehold (step 4) see the same user/household signup (step 1)
    // created, instead of each step working from disconnected fixtures.
    currentUserId: null as string | null,
  };

  const counters = new Map<string, number>();
  function nextId(prefix: string): string {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}-${n}`;
  }

  // undefined and null are treated as the same "absent" value throughout —
  // mirrors how an omitted optional column and an explicit NULL both read
  // back the same way from a real database.
  function normalize(value: unknown): unknown {
    return value === undefined ? null : value;
  }

  // Just enough of Prisma's `where` shape for what this golden path's
  // actions actually query with: plain equality, `{ equals, mode:
  // "insensitive" }`, `{ not }`, and `{ in }`.
  function matchesWhere(record: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, cond]) => {
      const actual = normalize(record[key]);
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        const condObj = cond as Record<string, unknown>;
        if ("equals" in condObj) {
          const val = normalize(condObj.equals);
          if (condObj.mode === "insensitive" && typeof val === "string" && typeof actual === "string") {
            return actual.toLowerCase() === val.toLowerCase();
          }
          return actual === val;
        }
        if ("not" in condObj) return actual !== normalize(condObj.not);
        if ("in" in condObj) return (condObj.in as unknown[]).map(normalize).includes(actual);
        return actual === normalize(cond);
      }
      return actual === normalize(cond);
    });
  }

  function makeDelegate(list: Row[], prefix: string, defaults: Record<string, unknown> = {}) {
    return {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: nextId(prefix), ...defaults, ...data } as Row;
        list.push(row);
        return row;
      },
      findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        (where ? list.find((r) => matchesWhere(r, where)) : list[0]) ?? null,
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        list.find((r) => matchesWhere(r, where)) ?? null,
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        where ? list.filter((r) => matchesWhere(r, where)) : [...list],
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = list.find((r) => matchesWhere(r, where));
        if (!row) throw new Error(`${prefix}: no record matches ${JSON.stringify(where)} for update`);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = list.filter((r) => matchesWhere(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      deleteMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const keep: Row[] = [];
        let removed = 0;
        for (const r of list) {
          if (where && !matchesWhere(r, where)) keep.push(r);
          else removed++;
        }
        list.length = 0;
        list.push(...keep);
        return { count: removed };
      },
    };
  }

  // emailVerificationToken.findUnique is the one query in this golden path
  // that needs a Prisma `include` (verifyEmailAction reads `.user` off the
  // token) — handled with a thin override rather than teaching the generic
  // delegate about `include` for a single caller.
  const emailVerificationTokenBase = makeDelegate(store.emailVerificationTokens, "email-verification-token", {
    usedAt: null,
  });
  const emailVerificationTokenDelegate = {
    ...emailVerificationTokenBase,
    findUnique: async ({
      where,
      include,
    }: {
      where: Record<string, unknown>;
      include?: { user?: boolean };
    }) => {
      const row = store.emailVerificationTokens.find((r) => matchesWhere(r, where));
      if (!row) return null;
      if (include?.user) {
        return { ...row, user: store.users.find((u) => u.id === row.userId) ?? null };
      }
      return { ...row };
    },
  };

  const fakePrisma = {
    user: makeDelegate(store.users, "user"),
    household: makeDelegate(store.households, "household"),
    householdMember: makeDelegate(store.householdMembers, "household-member"),
    emailVerificationToken: emailVerificationTokenDelegate,
    inventoryItem: makeDelegate(store.inventoryItems, "inventory-item"),
    // ShoppingList.status defaults to ACTIVE in the real schema
    // (prisma/schema.prisma) — createShoppingListAction relies on that
    // default rather than setting it explicitly, so the fake must too.
    shoppingList: makeDelegate(store.shoppingLists, "shopping-list", { status: "ACTIVE" }),
    shoppingListItem: makeDelegate(store.shoppingListItems, "shopping-list-item", { purchased: false }),
    budgetCategory: makeDelegate(store.budgetCategories, "budget-category"),
    transaction: makeDelegate(store.transactions, "transaction"),
    // Callback form only (`prisma.$transaction(async (tx) => ...)`) — the
    // only form signupAction/verifyEmailAction use. Since everything here
    // is a synchronous in-memory array under the hood, `tx` can just be
    // `fakePrisma` itself: no real isolation is needed for this test's
    // purpose (proving ids flow between steps), and nothing in this golden
    // path exercises rollback-on-error behavior.
    $transaction: async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => unknown)(fakePrisma);
      }
      return Promise.all(arg as Promise<unknown>[]);
    },
  };

  // signIn's real implementation (needs `bcrypt`, a real import) is wired up
  // after this file's own imports are evaluated — see below. Left as a bare
  // vi.fn() here since vi.hoisted's factory runs before those imports exist.
  const signInMock = vi.fn();
  const signOutMock = vi.fn(async () => {});
  const sendVerificationEmailMock = vi.fn(async () => ({}));
  const sendPasswordResetEmailMock = vi.fn(async () => ({}));
  const redirectMock = vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
  const revalidatePathMock = vi.fn();
  const headersMock = vi.fn(async () => new Map([["host", "localhost:3000"]]));

  // Real requireHousehold/requireUserId (src/lib/session.ts) resolve the
  // caller from a NextAuth session + a cookie; every other *.actions.test.ts
  // file mocks the whole module and feeds it a static membership per test.
  // Here it instead reads store.currentUserId (set by signInMock below) and
  // looks up that user's real membership row from step 1 — so a household
  // action scoping itself via requireHousehold is provably looking at the
  // household signupAction actually created, not a disconnected fixture.
  const requireHouseholdMock = vi.fn(async () => {
    const userId = store.currentUserId;
    if (!userId) throw new Error("test requireHousehold called with no logged-in user");
    const membership = store.householdMembers.find((m) => m.userId === userId);
    if (!membership) throw new Error("test requireHousehold called for a user with no household");
    const household = store.households.find((h) => h.id === membership.householdId);
    return {
      userId,
      household,
      role: membership.role,
      households: store.householdMembers
        .filter((m) => m.userId === userId)
        .map((m) => {
          const h = store.households.find((hh) => hh.id === m.householdId)!;
          return { id: h.id, name: h.name, role: m.role };
        }),
    };
  });
  const requireUserIdMock = vi.fn(async () => {
    if (!store.currentUserId) throw new Error("test requireUserId called with no logged-in user");
    return store.currentUserId;
  });

  return {
    store,
    fakePrisma,
    signInMock,
    signOutMock,
    sendVerificationEmailMock,
    sendPasswordResetEmailMock,
    requireHouseholdMock,
    requireUserIdMock,
    redirectMock,
    revalidatePathMock,
    headersMock,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: fakePrisma }));
vi.mock("@/lib/auth", () => ({
  signIn: signInMock,
  signOut: signOutMock,
  EmailNotVerifiedSignin,
}));
// src/lib/email.ts imports "server-only", which Vitest's Node environment
// can't resolve outside a Next.js build — stub it out (same as auth.test.ts).
vi.mock("@/lib/email", () => ({
  sendVerificationEmail: sendVerificationEmailMock,
  sendPasswordResetEmail: sendPasswordResetEmailMock,
}));
vi.mock("@/lib/session", () => ({
  requireHousehold: requireHouseholdMock,
  requireUserId: requireUserIdMock,
}));
// Real getDictionary/getLocale (src/lib/i18n/get-dictionary.ts) go through
// React's request-scoped `cache()` over a real `cookies()` call, which has
// no meaning outside an actual request/render — every existing test that
// touches an action calling getDictionary (inventory/shopping-list
// actions.test.ts) mocks this module directly instead. Only
// createShoppingListAction (step 4) in this golden path needs it.
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({ shoppingList: { defaultNamePrefix: "Shopping list" } })),
  getLocale: vi.fn(async () => "en"),
}));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

// Now that this file's own imports (bcrypt) have been evaluated, wire up
// signIn's real behavior: look the email up in the fake store and validate
// the password against the *real* bcrypt hash signupAction produced —
// resolving unconditionally here would prove nothing about whether login
// actually checks the account created in step 1 (see task brief).
signInMock.mockImplementation(async (_provider: string, options: { email: string; password: string }) => {
  const user = store.users.find((u) => u.email === options.email);
  if (!user || !(await bcrypt.compare(options.password, user.passwordHash as string))) {
    throw new AuthError("CredentialsSignin");
  }
  if (!user.emailVerifiedAt) {
    throw new EmailNotVerifiedSignin();
  }
  store.currentUserId = user.id;
});

const { signupAction, loginAction, verifyEmailAction } = await import("@/lib/actions/auth");
const { createInventoryItemAction } = await import("@/app/dashboard/inventory/actions");
const { createShoppingListAction, addAdHocItemAction } = await import(
  "@/app/dashboard/shopping-list/actions"
);
const { createCategoryAction, createTransactionAction } = await import(
  "@/app/dashboard/budget/actions"
);
const { _resetRateLimitsForTests } = await import("@/lib/rate-limit");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  _resetRateLimitsForTests();
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

const signupData = {
  displayName: "Erik",
  householdName: "The Hectors",
  email: "erik@example.com",
  password: "supersecret",
  confirmPassword: "supersecret",
};

describe("golden path: signup -> verify email -> log in -> household actions", () => {
  it("carries the same user/household ids through every step, end to end", async () => {
    delete process.env.APP_URL;

    // --- Step 1: signupAction --------------------------------------------
    const signupResult = await signupAction({}, formData(signupData));
    expect(signupResult).toEqual({ status: "verification-sent", email: signupData.email });
    // No session handed out at signup time (see signupAction's doc comment
    // in src/lib/actions/auth.ts) — signIn is never even called.
    expect(signInMock).not.toHaveBeenCalled();

    expect(store.users).toHaveLength(1);
    const user = store.users[0];
    expect(user.email).toBe(signupData.email);
    expect(user.emailVerifiedAt).toBeFalsy();

    expect(store.households).toHaveLength(1);
    const household = store.households[0];
    expect(household.name).toBe(signupData.householdName);

    expect(store.householdMembers).toHaveLength(1);
    const membership = store.householdMembers[0];
    expect(membership.userId).toBe(user.id);
    expect(membership.householdId).toBe(household.id);
    expect(membership.role).toBe("OWNER");

    expect(store.emailVerificationTokens).toHaveLength(1);
    const verificationToken = store.emailVerificationTokens[0];
    expect(verificationToken.userId).toBe(user.id);
    expect(sendVerificationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: signupData.email }),
    );

    // --- Step 1.5: loginAction before verifying — this is the exact bug ---
    // this golden path guards against: the account's correct password must
    // not be enough to sign in on its own until the email is verified (see
    // EmailNotVerifiedSignin in src/lib/auth.ts).
    const preVerifyLogin = await loginAction(
      {},
      formData({ email: signupData.email, password: signupData.password }),
    );
    expect(preVerifyLogin.unverifiedEmail).toBe(signupData.email);
    expect(store.currentUserId).toBeNull();

    // --- Step 2: verifyEmailAction, using the real token from the store ---
    // (never a hardcoded string — see task brief).
    const verifyResult = await verifyEmailAction({}, formData({ token: verificationToken.token as string }));
    expect(verifyResult).toEqual({ status: "verified" });

    const verifiedUser = store.users.find((u) => u.id === user.id)!;
    expect(verifiedUser.emailVerifiedAt).toBeInstanceOf(Date);
    const consumedToken = store.emailVerificationTokens.find((t) => t.id === verificationToken.id)!;
    expect(consumedToken.usedAt).toBeInstanceOf(Date);

    // --- Step 3: loginAction, actually checked against the fake store's --
    // real bcrypt hash via signInMock's implementation above.
    const badLogin = await loginAction(
      {},
      formData({ email: signupData.email, password: "totally-wrong-password" }),
    );
    expect(badLogin.error).toBe("Invalid email or password");
    expect(store.currentUserId).toBeNull();

    const loginResult = await loginAction(
      {},
      formData({ email: signupData.email, password: signupData.password }),
    );
    expect(loginResult).toEqual({});
    expect(store.currentUserId).toBe(user.id);

    // --- Step 4a: createInventoryItemAction, scoped via requireHousehold --
    // to the household step 1 created for this now-logged-in user.
    const inventoryResult = await createInventoryItemAction(
      {},
      formData({ name: "Milk", category: "Dairy", quantity: "2", unit: "L", lowStockThreshold: "1" }),
    );
    expect(inventoryResult).toEqual({});
    expect(store.inventoryItems).toHaveLength(1);
    const inventoryItem = store.inventoryItems[0];
    expect(inventoryItem.householdId).toBe(household.id);
    expect(inventoryItem.name).toBe("Milk");

    // --- Step 4b: createShoppingListAction + addAdHocItemAction ----------
    // createShoppingListAction redirects on success (like the real app) —
    // that's the expected "it worked" signal, same convention as
    // household.test.ts's createHouseholdAction assertion.
    await expect(createShoppingListAction({}, formData({}))).rejects.toThrow(
      /^REDIRECT:\/dashboard\/shopping-list\//,
    );
    expect(store.shoppingLists).toHaveLength(1);
    const shoppingList = store.shoppingLists[0];
    expect(shoppingList.householdId).toBe(household.id);

    const addItemResult = await addAdHocItemAction(
      {},
      formData({ listId: shoppingList.id as string, name: "Milk", quantity: "1" }),
    );
    expect(addItemResult).toEqual({ autoLinkedName: "Milk", needsMapping: false });
    expect(store.shoppingListItems).toHaveLength(1);
    const shoppingListItem = store.shoppingListItems[0];
    expect(shoppingListItem.shoppingListId).toBe(shoppingList.id);
    // Auto-linked to the inventory item from step 4a via createAdHocShoppingListItem's
    // exact-name match — further proof these steps share real state, not
    // disconnected fixtures.
    expect(shoppingListItem.inventoryItemId).toBe(inventoryItem.id);

    // --- Step 4c: createCategoryAction + createTransactionAction ---------
    const categoryResult = await createCategoryAction({}, formData({ name: "Groceries", type: "EXPENSE" }));
    expect(categoryResult).toEqual({});
    expect(store.budgetCategories).toHaveLength(1);
    const category = store.budgetCategories[0];
    expect(category.householdId).toBe(household.id);

    const transactionResult = await createTransactionAction(
      {},
      formData({
        categoryId: category.id as string,
        amount: "42.50",
        description: "Weekly groceries",
        date: "2026-01-01",
      }),
    );
    expect(transactionResult).toEqual({});
    expect(store.transactions).toHaveLength(1);
    const transaction = store.transactions[0];
    expect(transaction.householdId).toBe(household.id);
    expect(transaction.categoryId).toBe(category.id);
    // The user who's actually logged in (step 3), not whoever happened to
    // be created first — this is the assertion that would catch a broken
    // chain (e.g. a hardcoded/mismatched user id sneaking into any step).
    expect(transaction.createdByUserId).toBe(user.id);
    expect(transaction.amount).toBe(42.5);
  });
});
