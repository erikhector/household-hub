// Tests src/lib/weekly-digest.ts's who-gets-it and has-it-already-gone-out
// logic (GAP-27). Prisma is replaced by a small in-memory fake that honours
// exactly the filters the module relies on (opt-in, verified address, the
// WeeklyDigestSend claim and its unique constraint), so the opt-in and
// idempotency rules are exercised as behaviour rather than as call shapes.
// The email transport is mocked; no database or network is touched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { verifyDigestUnsubscribeToken } from "@/lib/digest-unsubscribe-token";

vi.mock("server-only", () => ({}));

type FakeUser = {
  id: string;
  email: string;
  locale: string;
  displayName: string;
  weeklyDigestEnabled: boolean;
  emailVerifiedAt: Date | null;
};
type FakeSend = { userId: string; householdId: string; weekKey: string; sentAt: Date };
type HouseholdData = {
  inventoryItems?: { name: string; expiresAt: Date | null; expiresAtEstimated: boolean }[];
  budgetCategoryCount?: number;
  limitedCategories?: unknown[];
  transactions?: unknown[];
  templates?: unknown[];
  plannedExpenses?: unknown[];
};

const db = vi.hoisted(() => ({
  users: [] as FakeUser[],
  households: [] as { id: string; name: string; budgetMonthStartDay: number }[],
  memberships: [] as { id: string; householdId: string; userId: string }[],
  sends: [] as FakeSend[],
  data: new Map<string, HouseholdData>(),
}));

const {
  sendWeeklyDigestEmailMock,
  weeklyDigestSendCreateMock,
  inventoryItemFindManyMock,
  plannedExpenseFindManyMock,
  transactionFindManyMock,
} = vi.hoisted(() => ({
    sendWeeklyDigestEmailMock: vi.fn(),
    weeklyDigestSendCreateMock: vi.fn(),
    inventoryItemFindManyMock: vi.fn(),
    plannedExpenseFindManyMock: vi.fn(),
    transactionFindManyMock: vi.fn(),
  }));

type UserFilter = {
  weeklyDigestEnabled?: boolean;
  emailVerifiedAt?: { not: null };
  weeklyDigestSends?: { none: { householdId: string; weekKey: string } };
};

function userMatches(user: FakeUser, filter: UserFilter): boolean {
  if (filter.weeklyDigestEnabled !== undefined && user.weeklyDigestEnabled !== filter.weeklyDigestEnabled) return false;
  if (filter.emailVerifiedAt && user.emailVerifiedAt === null) return false;
  if (filter.weeklyDigestSends) {
    const { householdId, weekKey } = filter.weeklyDigestSends.none;
    if (db.sends.some((s) => s.userId === user.id && s.householdId === householdId && s.weekKey === weekKey)) {
      return false;
    }
  }
  return true;
}

const userById = (id: string) => db.users.find((u) => u.id === id)!;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    household: {
      findMany: vi.fn(async ({ where }: { where: { members: { some: { user: UserFilter } } } }) =>
        db.households
          .filter((h) =>
            db.memberships.some(
              (m) => m.householdId === h.id && userMatches(userById(m.userId), where.members.some.user),
            ),
          )
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    },
    householdMember: {
      findMany: vi.fn(async ({ where }: { where: { householdId: string; user?: UserFilter } }) => {
        const members = db.memberships.filter((m) => m.householdId === where.householdId);
        if (where.user) {
          const filter = where.user;
          return members
            .map((m) => userById(m.userId))
            .filter((u) => userMatches(u, filter))
            .map((u) => ({ user: { id: u.id, email: u.email, locale: u.locale } }));
        }
        return members.map((m) => ({ id: m.id, user: { displayName: userById(m.userId).displayName } }));
      }),
    },
    mealPlanEntry: { findMany: vi.fn(async () => []) },
    householdTask: { findMany: vi.fn(async () => []) },
    inventoryItem: { findMany: inventoryItemFindManyMock },
    budgetCategory: {
      count: vi.fn(async ({ where }: { where: { householdId: string } }) => db.data.get(where.householdId)?.budgetCategoryCount ?? 0),
      findMany: vi.fn(async ({ where }: { where: { householdId: string } }) => db.data.get(where.householdId)?.limitedCategories ?? []),
    },
    transaction: {
      findMany: transactionFindManyMock,
    },
    recurringTemplate: {
      findMany: vi.fn(async ({ where }: { where: { householdId: string } }) => db.data.get(where.householdId)?.templates ?? []),
    },
    plannedExpense: { findMany: plannedExpenseFindManyMock },
    recurringTemplateAck: { findMany: vi.fn(async () => []) },
    weeklyDigestSend: {
      create: weeklyDigestSendCreateMock,
      deleteMany: vi.fn(
        async ({ where }: { where: { userId?: string; householdId?: string; weekKey?: string; sentAt?: { lt: Date } } }) => {
          const before = db.sends.length;
          db.sends = db.sends.filter((s) => {
            if (where.sentAt) return !(s.sentAt < where.sentAt.lt);
            return !(s.userId === where.userId && s.householdId === where.householdId && s.weekKey === where.weekKey);
          });
          return { count: before - db.sends.length };
        },
      ),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendWeeklyDigestEmail: sendWeeklyDigestEmailMock,
  emailLogoUrl: () => undefined,
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", () => ({ reportError: reportErrorMock }));

const { prisma } = await import("@/lib/prisma");
const { runWeeklyDigest, sendHouseholdDigest, digestWeekKey, DIGEST_BATCH_SIZE } = await import("@/lib/weekly-digest");

const DAY = 24 * 60 * 60 * 1000;
// Sunday 2026-09-27 16:00 UTC — the scheduled run time.
const NOW = new Date("2026-09-27T16:00:00.000Z");
const APP_URL = "https://app.example.com";
const SECRET = "test-auth-secret";

function addUser(id: string, overrides: Partial<FakeUser> = {}) {
  db.users.push({
    id,
    email: `${id}@example.com`,
    locale: "en",
    displayName: id,
    weeklyDigestEnabled: true,
    emailVerifiedAt: new Date("2026-01-01"),
    ...overrides,
  });
}

function addHousehold(id: string, userIds: string[], data: HouseholdData = {}, budgetMonthStartDay = 1) {
  db.households.push({ id, name: `Household ${id}`, budgetMonthStartDay });
  userIds.forEach((userId, i) => db.memberships.push({ id: `${id}-m${i}`, householdId: id, userId }));
  // Default: one item about to expire, so the digest has something to say.
  db.data.set(id, {
    inventoryItems: [{ name: "Milk", expiresAt: new Date(NOW.getTime() + DAY), expiresAtEstimated: false }],
    ...data,
  });
}

function run(now = NOW) {
  return runWeeklyDigest({ now, appUrl: APP_URL, secret: SECRET });
}

const sentTo = () => sendWeeklyDigestEmailMock.mock.calls.map(([args]) => args.to as string);

beforeEach(() => {
  db.users = [];
  db.households = [];
  db.memberships = [];
  db.sends = [];
  db.data = new Map();
  sendWeeklyDigestEmailMock.mockResolvedValue({});
  transactionFindManyMock.mockImplementation(
    async ({ where }: { where: { householdId: string } }) => db.data.get(where.householdId)?.transactions ?? [],
  );
  plannedExpenseFindManyMock.mockImplementation(
    async ({ where }: { where: { householdId: string } }) => db.data.get(where.householdId)?.plannedExpenses ?? [],
  );
  inventoryItemFindManyMock.mockImplementation(
    async ({ where }: { where: { householdId: string } }) => db.data.get(where.householdId)?.inventoryItems ?? [],
  );
  weeklyDigestSendCreateMock.mockImplementation(async ({ data }: { data: Omit<FakeSend, "sentAt"> }) => {
    if (db.sends.some((s) => s.userId === data.userId && s.householdId === data.householdId && s.weekKey === data.weekKey)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    }
    db.sends.push({ ...data, sentAt: NOW });
    return data;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("digestWeekKey", () => {
  it("is the Monday (UTC) of the week", () => {
    expect(digestWeekKey(NOW)).toBe("2026-09-21");
    expect(digestWeekKey(new Date("2026-09-21T00:00:00Z"))).toBe("2026-09-21");
    expect(digestWeekKey(new Date("2026-09-28T00:00:00Z"))).toBe("2026-09-28");
  });
});

describe("opt-in", () => {
  it("emails only members who opted in and have a verified address", async () => {
    addUser("in");
    addUser("off", { weeklyDigestEnabled: false });
    addUser("unverified", { emailVerifiedAt: null });
    addHousehold("h1", ["in", "off", "unverified"]);

    const result = await run();

    expect(sentTo()).toEqual(["in@example.com"]);
    expect(result).toEqual({ householdsProcessed: 1, emailsSent: 1, emailsFailed: 0, failedHouseholdIds: [] });
  });

  it("skips households where nobody opted in without loading their data", async () => {
    addUser("off", { weeklyDigestEnabled: false });
    addHousehold("h1", ["off"]);

    const result = await run();

    expect(sendWeeklyDigestEmailMock).not.toHaveBeenCalled();
    expect(inventoryItemFindManyMock).not.toHaveBeenCalled();
    expect(result.householdsProcessed).toBe(0);
  });

  it("sends a member of two households one digest per household", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"]);
    addHousehold("h2", ["u1"]);

    await run();

    expect(sendWeeklyDigestEmailMock).toHaveBeenCalledTimes(2);
    const subjects = sendWeeklyDigestEmailMock.mock.calls.map(([args]) => args.subject);
    expect(subjects).toEqual(["Your week at Household h1", "Your week at Household h2"]);
  });

  it("renders each recipient's digest in their own stored locale", async () => {
    addUser("en-user", { locale: "en" });
    addUser("sv-user", { locale: "sv" });
    addUser("odd-user", { locale: "xx" });
    addHousehold("h1", ["en-user", "sv-user", "odd-user"]);

    await run();

    const byRecipient = Object.fromEntries(
      sendWeeklyDigestEmailMock.mock.calls.map(([args]) => [args.to, args.subject]),
    );
    expect(byRecipient["en-user@example.com"]).toBe("Your week at Household h1");
    expect(byRecipient["sv-user@example.com"]).toBe("Din vecka i Household h1");
    // An unrecognised stored locale falls back to the app default.
    expect(byRecipient["odd-user@example.com"]).toBe("Your week at Household h1");
  });

  it("gives every email a signed unsubscribe link for its own recipient", async () => {
    addUser("u1");
    addUser("u2");
    addHousehold("h1", ["u1", "u2"]);

    await run();

    for (const [args] of sendWeeklyDigestEmailMock.mock.calls) {
      const prefix = `${APP_URL}/api/digest/unsubscribe/`;
      expect(args.unsubscribeUrl.startsWith(prefix)).toBe(true);
      const token = decodeURIComponent(args.unsubscribeUrl.slice(prefix.length));
      expect(`${verifyDigestUnsubscribeToken(token, SECRET)}@example.com`).toBe(args.to);
      expect(args.html).toContain(args.unsubscribeUrl);
      expect(args.text).toContain(args.unsubscribeUrl);
    }
  });
});

describe("empty digests", () => {
  it("sends nothing, and records nothing, when the household has nothing to report", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"], { inventoryItems: [] });

    const result = await run();

    expect(sendWeeklyDigestEmailMock).not.toHaveBeenCalled();
    expect(db.sends).toEqual([]);
    expect(result).toEqual({ householdsProcessed: 1, emailsSent: 0, emailsFailed: 0, failedHouseholdIds: [] });
  });

  it("includes the household budget headline once there is activity this month", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"], {
      inventoryItems: [],
      budgetCategoryCount: 1,
      transactions: [
        {
          categoryId: "c1",
          category: { name: "Salary" },
          type: "INCOME",
          amount: 1000,
          date: new Date(NOW.getTime() - DAY),
          isRecurring: false,
          recurringTemplateId: null,
        },
        {
          categoryId: "c2",
          category: { name: "Food" },
          type: "EXPENSE",
          amount: 250,
          date: new Date(NOW.getTime() - DAY),
          isRecurring: false,
          recurringTemplateId: null,
        },
      ],
    });

    await run();

    expect(sendWeeklyDigestEmailMock).toHaveBeenCalledTimes(1);
    expect(sendWeeklyDigestEmailMock.mock.calls[0][0].text).toContain(
      "Remaining after expenses and savings this month: 750.00",
    );
  });

  // UX-138: the digest holds back what's left of a limit, like the Budget page.
  it("holds back the unspent remainder of a category limit", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"], {
      inventoryItems: [],
      budgetCategoryCount: 2,
      limitedCategories: [
        { id: "c2", type: "EXPENSE", monthlyLimit: 400, rolloverEnabled: false, createdAt: new Date(2020, 0, 1) },
      ],
      transactions: [
        {
          categoryId: "c1",
          category: { name: "Salary" },
          type: "INCOME",
          amount: 1000,
          date: new Date(NOW.getTime() - DAY),
          isRecurring: false,
          recurringTemplateId: null,
        },
        {
          categoryId: "c2",
          category: { name: "Food" },
          type: "EXPENSE",
          amount: 250,
          date: new Date(NOW.getTime() - DAY),
          isRecurring: false,
          recurringTemplateId: null,
        },
      ],
    });

    await run();

    // 1000 - 250 spent - 150 still budgeted in Food's 400 limit.
    expect(sendWeeklyDigestEmailMock.mock.calls[0][0].text).toContain(
      "Remaining after expenses and savings this month: 600.00",
    );
  });
});

// UX-134: a household that moved its budget month to payday.
describe("budget month start day", () => {
  // 10 Oct with start day 25: the household is in its "October" period,
  // 25 Sep to 24 Oct (end exclusive 25 Oct).
  const OCT_10 = new Date(2026, 9, 10, 12);

  it("uses the household's period: bounds the query and counts rent logged on 28 Sep as paid", async () => {
    addUser("u1");
    addHousehold(
      "h1",
      ["u1"],
      {
        inventoryItems: [],
        budgetCategoryCount: 1,
        templates: [
          { id: "tpl-rent", name: "Rent", categoryId: "c2", type: "EXPENSE", amount: 4000, frequency: "MONTHLY", active: true, createdAt: new Date(2026, 0, 1) },
        ],
        transactions: [
          { categoryId: "c1", category: { name: "Salary" }, type: "INCOME", amount: 10000, date: new Date(2026, 8, 25), isRecurring: false, recurringTemplateId: null },
          { categoryId: "c2", category: { name: "Rent" }, type: "EXPENSE", amount: 4000, date: new Date(2026, 8, 28), isRecurring: false, recurringTemplateId: "tpl-rent" },
        ],
      },
      25,
    );

    await run(OCT_10);

    // The query's upper bound is the period's end, 25 Oct (exclusive).
    expect(transactionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ date: expect.objectContaining({ lt: new Date(2026, 9, 25) }) }),
      }),
    );
    // Rent (28 Sep) is in this period and posted: not still due, so it is
    // spent once (10000 - 4000), not subtracted a second time as due.
    expect(sendWeeklyDigestEmailMock.mock.calls[0][0].text).toContain(
      "Remaining after expenses and savings this month: 6,000.00",
    );
  });

  it("selects each household's start day", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"], {}, 25);

    await run(OCT_10);

    expect(prisma.household.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ budgetMonthStartDay: true }) }),
    );
  });
});

describe("planned bills", () => {
  const salary = {
    categoryId: "c1",
    category: { name: "Salary" },
    type: "INCOME",
    amount: 1000,
    date: new Date(NOW.getTime() - DAY),
    isRecurring: false,
    recurringTemplateId: null,
  };

  it("takes due and overdue planned bills off the headline, like the Budget page", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"], {
      inventoryItems: [],
      budgetCategoryCount: 1,
      transactions: [salary],
      plannedExpenses: [
        // Due this month (September 2026), unpaid: counts in full.
        { id: "p1", name: "Car insurance", amount: 300, dueDate: new Date("2026-09-30T00:00:00.000Z"), category: { type: "EXPENSE" }, transaction: null },
        // Overdue from August, unpaid: counts too.
        { id: "p2", name: "Dentist", amount: 100, dueDate: new Date("2026-08-15T00:00:00.000Z"), category: { type: "EXPENSE" }, transaction: null },
        // Due next month: not this month's money.
        { id: "p3", name: "Tyres", amount: 500, dueDate: new Date("2026-10-10T00:00:00.000Z"), category: { type: "EXPENSE" }, transaction: null },
      ],
    });

    await run();

    expect(sendWeeklyDigestEmailMock.mock.calls[0][0].text).toContain(
      "Remaining after expenses and savings this month: 600.00",
    );
  });

  it("scopes the planned bill query to the household and skips bills paid before this month", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"], { budgetCategoryCount: 1, transactions: [salary] });

    await run();

    expect(plannedExpenseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId: "h1",
          OR: [
            { transaction: { is: null } },
            { transaction: { is: { date: { gte: new Date("2026-09-01T00:00:00.000Z") } } } },
          ],
        },
      }),
    );
  });
});

describe("idempotency", () => {
  it("doesn't email anyone twice when the cron runs again in the same week", async () => {
    addUser("u1");
    addUser("u2");
    addHousehold("h1", ["u1", "u2"]);

    await run();
    const second = await run(new Date(NOW.getTime() + 60 * 60 * 1000));

    expect(sendWeeklyDigestEmailMock).toHaveBeenCalledTimes(2);
    expect(second.emailsSent).toBe(0);
    expect(db.sends.map((s) => [s.userId, s.weekKey])).toEqual([
      ["u1", "2026-09-21"],
      ["u2", "2026-09-21"],
    ]);
  });

  it("sends again the following week", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"]);

    await run();
    const nextWeek = new Date(NOW.getTime() + 7 * DAY);
    db.data.get("h1")!.inventoryItems = [
      { name: "Eggs", expiresAt: new Date(nextWeek.getTime() + DAY), expiresAtEstimated: false },
    ];
    await run(nextWeek);

    expect(sendWeeklyDigestEmailMock).toHaveBeenCalledTimes(2);
  });

  it("skips a recipient another concurrent run already claimed", async () => {
    addUser("u1");
    addUser("u2");
    addHousehold("h1", ["u1", "u2"]);
    // Simulates the race: u1 wasn't claimed when recipients were listed,
    // but a parallel invocation inserts the row before this one does.
    weeklyDigestSendCreateMock.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    });

    const result = await sendHouseholdDigest({ household: db.households[0], now: NOW, appUrl: APP_URL, secret: SECRET });

    expect(sentTo()).toEqual(["u2@example.com"]);
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it("claims before sending", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"]);
    sendWeeklyDigestEmailMock.mockImplementation(async () => {
      expect(db.sends).toHaveLength(1);
      return {};
    });

    await run();

    expect(sendWeeklyDigestEmailMock).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when the send fails, so the next run retries", async () => {
    addUser("u1");
    addHousehold("h1", ["u1"]);
    sendWeeklyDigestEmailMock.mockResolvedValueOnce({ error: "Resend down" });

    const first = await run();
    expect(first).toEqual({ householdsProcessed: 1, emailsSent: 0, emailsFailed: 1, failedHouseholdIds: ["h1"] });
    expect(db.sends).toEqual([]);

    const retry = await run();
    expect(retry.emailsSent).toBe(1);
    expect(sendWeeklyDigestEmailMock).toHaveBeenCalledTimes(2);
  });

  it("prunes old send records", async () => {
    db.sends.push(
      { userId: "old", householdId: "h", weekKey: "2026-06-01", sentAt: new Date(NOW.getTime() - 60 * DAY) },
      { userId: "recent", householdId: "h", weekKey: "2026-09-14", sentAt: new Date(NOW.getTime() - 13 * DAY) },
    );

    await run();

    expect(db.sends.map((s) => s.userId)).toEqual(["recent"]);
  });
});

describe("batching and failure isolation", () => {
  it(`processes households at most ${DIGEST_BATCH_SIZE} at a time`, async () => {
    for (let i = 0; i < 25; i += 1) {
      const id = `h${String(i).padStart(2, "0")}`;
      addUser(`u${i}`);
      addHousehold(id, [`u${i}`]);
    }
    let concurrent = 0;
    let maxConcurrent = 0;
    inventoryItemFindManyMock.mockImplementation(async ({ where }: { where: { householdId: string } }) => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return db.data.get(where.householdId)?.inventoryItems ?? [];
    });

    const result = await run();

    expect(result.emailsSent).toBe(25);
    expect(maxConcurrent).toBeLessThanOrEqual(DIGEST_BATCH_SIZE);
  });

  it("keeps going when one household throws", async () => {
    addUser("u1");
    addUser("u2");
    addUser("u3");
    addHousehold("h1", ["u1"]);
    addHousehold("h2", ["u2"]);
    addHousehold("h3", ["u3"]);
    inventoryItemFindManyMock.mockImplementation(async ({ where }: { where: { householdId: string } }) => {
      if (where.householdId === "h2") throw new Error("boom");
      return db.data.get(where.householdId)?.inventoryItems ?? [];
    });

    const result = await run();

    expect(sentTo().sort()).toEqual(["u1@example.com", "u3@example.com"]);
    expect(result).toEqual({ householdsProcessed: 2, emailsSent: 2, emailsFailed: 0, failedHouseholdIds: ["h2"] });
    // Reported to Sentry with the household id, not just console-logged.
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("household"),
      expect.objectContaining({ message: "boom" }),
      { householdId: "h2" },
    );
  });
});
