// Tests the /dashboard/shopping-list/[id]/export Route Handler. Prisma,
// requireHousehold, and getDictionary are mocked — no database is touched,
// same pattern as src/app/dashboard/inventory/export/route.test.ts. See
// REQUIREMENTS.md's "Data export (CSV)" subsection: the list is re-resolved
// scoped to the session's household id (never trusting the [id] param
// alone), so a list belonging to another household 404s instead of leaking
// its contents.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireHouseholdMock, shoppingListFindFirstMock } = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn<() => Promise<unknown>>(async () => null),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { shoppingList: { findFirst: shoppingListFindFirstMock } },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: vi.fn(async () => ({
    export: {
      yes: "Yes",
      no: "No",
      shoppingList: {
        fileNamePrefix: "shopping-list",
        headerName: "Name",
        headerQuantity: "Quantity",
        headerUnit: "Unit",
        headerEstimatedPrice: "Estimated price",
        headerPurchased: "Purchased",
        headerNote: "Note",
      },
    },
  })),
}));

const { GET } = await import("@/app/dashboard/shopping-list/[id]/export/route");

const household = { id: "household-1" };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /dashboard/shopping-list/[id]/export", () => {
  it("scopes the lookup to the session's household id, not just the [id] param", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "Weekly", items: [] });

    await GET(new Request("https://app.example.com/dashboard/shopping-list/list-1/export"), ctx("list-1"));

    expect(requireHouseholdMock).toHaveBeenCalledTimes(1);
    expect(shoppingListFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "list-1", householdId: "household-1" } }),
    );
  });

  it("404s a list id that exists but belongs to another household, rather than leaking it", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    await expect(
      GET(new Request("https://app.example.com/dashboard/shopping-list/foreign/export"), ctx("foreign")),
    ).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("returns CSV Content-Type and a slugified Content-Disposition filename derived from the list name", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "Weekly Groceries!", items: [] });

    const response = await GET(
      new Request("https://app.example.com/dashboard/shopping-list/list-1/export"),
      ctx("list-1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="shopping-list-weekly-groceries.csv"',
    );
  });

  it("falls back to the bare prefix when the list name slugifies to nothing", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", name: "!!!", items: [] });

    const response = await GET(
      new Request("https://app.example.com/dashboard/shopping-list/list-1/export"),
      ctx("list-1"),
    );

    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="shopping-list.csv"');
  });

  it("renders a row per item with the note moved last so older five-column consumers still line up", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "Weekly",
      items: [
        {
          name: "Milk",
          quantity: 2,
          unit: "L",
          estimatedPrice: 19.9,
          purchased: true,
          note: "Oat milk if out",
        },
        {
          name: "Eggs",
          quantity: 12,
          unit: "pcs",
          estimatedPrice: null,
          purchased: false,
          note: null,
        },
      ],
    });

    const response = await GET(
      new Request("https://app.example.com/dashboard/shopping-list/list-1/export"),
      ctx("list-1"),
    );
    const csv = await response.text();

    expect(csv).toBe(
      "Name,Quantity,Unit,Estimated price,Purchased,Note\r\n" +
        "Milk,2,L,19.9,Yes,Oat milk if out\r\n" +
        "Eggs,12,pcs,,No,\r\n",
    );
  });

  it("guards a formula-shaped note against spreadsheet injection", async () => {
    shoppingListFindFirstMock.mockResolvedValue({
      id: "list-1",
      name: "Weekly",
      items: [
        { name: "Eggs", quantity: 1, unit: "pcs", estimatedPrice: null, purchased: false, note: "=SUM(A1:A9)" },
      ],
    });

    const csv = await (
      await GET(new Request("https://app.example.com/dashboard/shopping-list/list-1/export"), ctx("list-1"))
    ).text();

    expect(csv).toContain("'=SUM(A1:A9)");
  });

  it("rejects an unauthenticated request the same way requireHousehold does elsewhere (redirect)", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("REDIRECT:/login"));

    await expect(
      GET(new Request("https://app.example.com/dashboard/shopping-list/list-1/export"), ctx("list-1")),
    ).rejects.toThrow("REDIRECT:/login");
    expect(shoppingListFindFirstMock).not.toHaveBeenCalled();
  });
});
