// Tests the /dashboard/inventory/export Route Handler. Prisma,
// requireHousehold, and getDictionary are mocked — no database is touched,
// same pattern as src/app/dashboard/budget/export/route.test.ts. See
// REQUIREMENTS.md's "Data export (CSV)" subsection: the household is always
// re-derived server-side via requireHousehold(), never a client-supplied id.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, inventoryFindManyMock, memberFindManyMock } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  inventoryFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
  memberFindManyMock: vi.fn<() => Promise<unknown[]>>(async () => []),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: { findMany: inventoryFindManyMock },
    householdMember: { findMany: memberFindManyMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({
    export: {
      yes: "Yes",
      no: "No",
      inventory: {
        fileNamePrefix: "inventory",
        headerName: "Name",
        headerCategory: "Category",
        headerQuantity: "Quantity",
        headerUnit: "Unit",
        headerLocation: "Location",
        headerLowStockThreshold: "Low stock threshold",
        headerLastKnownPrice: "Last known price",
        headerLastUpdated: "Last updated",
        headerUpdatedBy: "Updated by",
      },
    },
  })),
}));

const { GET } = await import("@/app/dashboard/inventory/export/route");

const household = { id: "household-1" };

beforeEach(() => {
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("GET /dashboard/inventory/export", () => {
  it("scopes both queries to the session's household id, never a client-supplied one", async () => {
    await GET();

    expect(requireHouseholdMock).toHaveBeenCalledTimes(1);
    expect(inventoryFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
    expect(memberFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-1" } }),
    );
  });

  it("returns CSV Content-Type and a dated Content-Disposition attachment filename", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="inventory-2026-03-15.csv"');
  });

  it("renders an item row with every column, resolving updatedByUserId to that member's display name", async () => {
    inventoryFindManyMock.mockResolvedValue([
      {
        name: "Milk",
        category: "Dairy",
        quantity: 2,
        unit: "L",
        location: "Fridge",
        lowStockThreshold: 1,
        lastKnownPrice: 19.9,
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedByUserId: "user-1",
      },
    ]);
    memberFindManyMock.mockResolvedValue([
      { userId: "user-1", user: { displayName: "Alex" } },
    ]);

    const response = await GET();
    const csv = await response.text();

    expect(csv).toBe(
      "Name,Category,Quantity,Unit,Location,Low stock threshold,Last known price,Last updated,Updated by\r\n" +
        "Milk,Dairy,2,L,Fridge,1,19.9,2026-03-10,Alex\r\n",
    );
  });

  it("leaves location, lastKnownPrice, and updatedBy blank when unset, without throwing on an unmatched updatedByUserId", async () => {
    inventoryFindManyMock.mockResolvedValue([
      {
        name: "Flour",
        category: "Baking",
        quantity: 1,
        unit: "kg",
        location: null,
        lowStockThreshold: 1,
        lastKnownPrice: null,
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedByUserId: "user-deleted",
      },
    ]);
    memberFindManyMock.mockResolvedValue([]);

    const csv = await (await GET()).text();

    expect(csv).toBe(
      "Name,Category,Quantity,Unit,Location,Low stock threshold,Last known price,Last updated,Updated by\r\n" +
        "Flour,Baking,1,kg,,1,,2026-03-10,\r\n",
    );
  });

  it("guards a formula-shaped item name against spreadsheet injection", async () => {
    inventoryFindManyMock.mockResolvedValue([
      {
        name: '=HYPERLINK("https://evil.example","click")',
        category: "Baking",
        quantity: 1,
        unit: "kg",
        location: null,
        lowStockThreshold: 1,
        lastKnownPrice: null,
        updatedAt: new Date("2026-03-10T00:00:00.000Z"),
        updatedByUserId: null,
      },
    ]);
    memberFindManyMock.mockResolvedValue([]);

    const csv = await (await GET()).text();

    expect(csv).toContain('"\'=HYPERLINK(""https://evil.example"",""click"")"');
  });

  it("rejects an unauthenticated request the same way requireHousehold does elsewhere (redirect)", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("REDIRECT:/login"));

    await expect(GET()).rejects.toThrow("REDIRECT:/login");
    expect(inventoryFindManyMock).not.toHaveBeenCalled();
  });
});
