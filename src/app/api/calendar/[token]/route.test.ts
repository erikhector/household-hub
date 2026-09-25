// Tests the GAP-3 calendar feed Route Handler. Prisma is mocked (same
// pattern as src/app/api/health/route.test.ts); the in-memory rate limiter is
// the real one, reset between tests.
import { afterEach, describe, expect, it, vi } from "vitest";

const { householdFindUniqueMock, mealPlanEntryFindManyMock, recurringTemplateFindManyMock } = vi.hoisted(() => ({
  householdFindUniqueMock: vi.fn(),
  mealPlanEntryFindManyMock: vi.fn(async (): Promise<unknown[]> => []),
  recurringTemplateFindManyMock: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    household: { findUnique: householdFindUniqueMock },
    mealPlanEntry: { findMany: mealPlanEntryFindManyMock },
    recurringTemplate: { findMany: recurringTemplateFindManyMock },
  },
}));

const { GET } = await import("@/app/api/calendar/[token]/route");
const { _resetRateLimitsForTests } = await import("@/lib/rate-limit");

const TOKEN = "A".repeat(21) + "_-" + "b".repeat(20);

function call(token: string, query = "") {
  const request = new Request(`http://localhost/api/calendar/${token}${query}`);
  return GET(request, { params: Promise.resolve({ token }) });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  _resetRateLimitsForTests();
});

describe("GET /api/calendar/[token]", () => {
  it("404s a malformed token without touching the database", async () => {
    const response = await call("not-a-token");
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(householdFindUniqueMock).not.toHaveBeenCalled();
  });

  it("404s a well-formed but unknown (or turned-off) token", async () => {
    householdFindUniqueMock.mockResolvedValue(null);
    const response = await call(TOKEN);
    expect(response.status).toBe(404);
    expect(householdFindUniqueMock).toHaveBeenCalledWith({
      where: { calendarFeedToken: TOKEN },
      select: { id: true, name: true },
    });
    expect(mealPlanEntryFindManyMock).not.toHaveBeenCalled();
  });

  it("returns a text/calendar feed of the household's meals and monthly bills", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    householdFindUniqueMock.mockResolvedValue({ id: "h1", name: "Home" });
    mealPlanEntryFindManyMock.mockResolvedValue([
      {
        id: "m1",
        date: new Date("2026-09-26T00:00:00Z"),
        mealType: "DINNER",
        freeformName: null,
        recipe: { name: "Lasagna" },
      },
      { id: "m2", date: new Date("2026-09-27T00:00:00Z"), mealType: "LUNCH", freeformName: "Picnic", recipe: null },
    ]);
    recurringTemplateFindManyMock.mockResolvedValue([
      { id: "b1", name: "Rent", frequency: "MONTHLY", dayOfMonth: 28 },
    ]);

    const response = await call(TOKEN);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(body).toContain("X-WR-CALNAME:Home (Squirrel)\r\n");
    expect(body).toContain("SUMMARY:Dinner: Lasagna\r\n");
    expect(body).toContain("SUMMARY:Lunch: Picnic\r\n");
    expect(body).toContain("UID:bill-b1-20260928@squirrel-calendar-feed\r\n");
    expect(body).toContain("SUMMARY:Due: Rent\r\n");
    expect(body).toContain("DTSTAMP:20260925T120000Z\r\n");
  });

  it("scopes both queries to the token's household and the bounded window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    householdFindUniqueMock.mockResolvedValue({ id: "h1", name: "Home" });

    await call(TOKEN);

    expect(mealPlanEntryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          mealPlan: { householdId: "h1" },
          date: { gte: new Date("2026-08-26T00:00:00Z"), lte: new Date("2027-03-27T00:00:00Z") },
        },
      }),
    );
    expect(recurringTemplateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ householdId: "h1", active: true, type: "EXPENSE" }),
      }),
    );
    // No amount is ever selected, so it can't end up in the feed.
    const select = (recurringTemplateFindManyMock.mock.calls[0] as unknown as [{ select: object }])[0].select;
    expect(select).not.toHaveProperty("amount");
  });

  it("uses the locale from ?lang=, falling back to English", async () => {
    householdFindUniqueMock.mockResolvedValue({ id: "h1", name: "Hemma" });
    recurringTemplateFindManyMock.mockResolvedValue([{ id: "b1", name: "Hyra", frequency: "MONTHLY", dayOfMonth: 1 }]);

    const sv = await (await call(TOKEN, "?lang=sv")).text();
    expect(sv).toContain("SUMMARY:Förfaller: Hyra");

    const fallback = await (await call(TOKEN, "?lang=xx")).text();
    expect(fallback).toContain("SUMMARY:Due: Hyra");
  });

  it("rate-limits per token", async () => {
    householdFindUniqueMock.mockResolvedValue(null);
    for (let i = 0; i < 120; i++) expect((await call(TOKEN)).status).toBe(404);
    const limited = await call(TOKEN);
    expect(limited.status).toBe(429);
    expect(householdFindUniqueMock).toHaveBeenCalledTimes(120);

    // A different token has its own budget.
    const other = "c".repeat(43);
    expect((await call(other)).status).toBe(404);
  });
});
