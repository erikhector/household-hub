// Tests GAP-4's template actions in
// src/app/dashboard/shopping-list/template-actions.ts. All I/O (Prisma,
// requireHousehold, next/cache, next/navigation) is mocked — no database is
// touched — following src/app/dashboard/shopping-list/share-actions.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const m = vi.hoisted(() => ({
  requireHousehold: vi.fn(),
  listFindFirst: vi.fn(),
  listCreate: vi.fn(),
  templateFindFirst: vi.fn(),
  templateCreate: vi.fn(),
  templateDeleteMany: vi.fn(),
  inventoryFindMany: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shoppingList: { findFirst: m.listFindFirst, create: m.listCreate },
    shoppingListTemplate: {
      findFirst: m.templateFindFirst,
      create: m.templateCreate,
      deleteMany: m.templateDeleteMany,
    },
    inventoryItem: { findMany: m.inventoryFindMany },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: m.requireHousehold }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: vi.fn(async () => en), getLocale: vi.fn(async () => "en") };
});
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));

const {
  saveAsTemplateAction,
  createListFromTemplateAction,
  deleteShoppingListTemplateAction,
  restoreShoppingListTemplateAction,
} = await import("@/app/dashboard/shopping-list/template-actions");
const { en } = await import("@/lib/i18n/dictionaries/en");
const errors = en.shoppingList.templates.errors;

const household = { id: "household-1" };
m.requireHousehold.mockResolvedValue({ household, userId: "user-1" });

afterEach(() => {
  vi.clearAllMocks();
  m.requireHousehold.mockResolvedValue({ household, userId: "user-1" });
  m.redirect.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const listItem = (name: string, extra: Partial<{ quantity: number; unit: string; inventoryItemId: string | null }> = {}) => ({
  name,
  quantity: 1,
  unit: "pcs",
  inventoryItemId: null,
  ...extra,
});

describe("saveAsTemplateAction", () => {
  it("rejects a blank name without touching the database", async () => {
    const result = await saveAsTemplateAction({}, formData({ listId: "list-1", name: "   " }));
    expect(result.error).toBe(errors.invalidName);
    expect(m.listFindFirst).not.toHaveBeenCalled();
  });

  it("scopes the list lookup to the caller's household", async () => {
    m.listFindFirst.mockResolvedValue(null);
    const result = await saveAsTemplateAction({}, formData({ listId: "someone-elses", name: "BBQ" }));
    expect(result.error).toBe(errors.listNotFound);
    expect(m.listFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "someone-elses", householdId: "household-1" } }),
    );
    expect(m.templateCreate).not.toHaveBeenCalled();
  });

  it("refuses an empty list", async () => {
    m.listFindFirst.mockResolvedValue({ id: "list-1", items: [] });
    const result = await saveAsTemplateAction({}, formData({ listId: "list-1", name: "BBQ" }));
    expect(result.error).toBe(errors.emptyList);
  });

  it("refuses a list over the item cap", async () => {
    m.listFindFirst.mockResolvedValue({
      id: "list-1",
      items: Array.from({ length: 301 }, (_, i) => listItem(`Item ${i}`)),
    });
    const result = await saveAsTemplateAction({}, formData({ listId: "list-1", name: "Huge" }));
    expect(result.error).toBe(errors.tooManyItems.replace("{max}", "300"));
    expect(m.templateCreate).not.toHaveBeenCalled();
  });

  it("refuses a name already taken, case-insensitively", async () => {
    m.listFindFirst.mockResolvedValue({ id: "list-1", items: [listItem("Charcoal")] });
    m.templateFindFirst.mockResolvedValue({ id: "t-1" });
    const result = await saveAsTemplateAction({}, formData({ listId: "list-1", name: "bbq" }));
    expect(result.error).toBe(errors.nameTaken.replace("{name}", "bbq"));
    expect(m.templateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: "household-1", name: { equals: "bbq", mode: "insensitive" } },
      }),
    );
    expect(m.templateCreate).not.toHaveBeenCalled();
  });

  it("maps a concurrent unique violation to the name-taken error", async () => {
    m.listFindFirst.mockResolvedValue({ id: "list-1", items: [listItem("Charcoal")] });
    m.templateFindFirst.mockResolvedValue(null);
    m.templateCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );
    const result = await saveAsTemplateAction({}, formData({ listId: "list-1", name: "BBQ" }));
    expect(result.error).toBe(errors.nameTaken.replace("{name}", "BBQ"));
  });

  it("saves the list's items, deduplicated and positioned, under the household", async () => {
    m.listFindFirst.mockResolvedValue({
      id: "list-1",
      items: [
        listItem("Sausages", { quantity: 2, inventoryItemId: "inv-1" }),
        listItem("Charcoal", { unit: "bag" }),
        listItem("sausages", { quantity: 1 }),
      ],
    });
    m.templateFindFirst.mockResolvedValue(null);
    m.templateCreate.mockResolvedValue({ id: "t-1" });

    const result = await saveAsTemplateAction({}, formData({ listId: "list-1", name: "  BBQ  " }));

    expect(result).toEqual({});
    expect(m.templateCreate).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        name: "BBQ",
        items: {
          create: [
            { name: "Sausages", quantity: 3, unit: "pcs", inventoryItemId: "inv-1", position: 0 },
            { name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: null, position: 1 },
          ],
        },
      },
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/dashboard/shopping-list");
  });
});

describe("createListFromTemplateAction", () => {
  it("refuses a template outside the caller's household", async () => {
    m.templateFindFirst.mockResolvedValue(null);
    const result = await createListFromTemplateAction("foreign");
    expect(result.error).toBe(errors.notFound);
    expect(m.templateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "foreign", householdId: "household-1" } }),
    );
    expect(m.listCreate).not.toHaveBeenCalled();
  });

  it("creates a new list with re-resolved rows and redirects to it", async () => {
    m.templateFindFirst.mockResolvedValue({
      id: "t-1",
      name: "BBQ",
      items: [
        { name: "Sausages", quantity: 3, unit: "pcs", inventoryItemId: "gone" },
        { name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: null },
      ],
    });
    m.inventoryFindMany.mockResolvedValue([{ id: "inv-9", name: "Sausages", unit: "pcs", lastKnownPrice: 40 }]);
    m.listCreate.mockResolvedValue({ id: "list-new" });

    await expect(createListFromTemplateAction("t-1")).rejects.toThrow("REDIRECT:/dashboard/shopping-list/list-new");

    expect(m.inventoryFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { householdId: "household-1" } }));
    const { data } = m.listCreate.mock.calls[0][0];
    expect(data.householdId).toBe("household-1");
    expect(data.name).toBe("BBQ");
    // No status: a new list defaults to ACTIVE, and it's never the default list.
    expect(data.status).toBeUndefined();
    expect(data.isDefault).toBeUndefined();
    expect(data.items.create).toEqual([
      { inventoryItemId: "inv-9", name: "Sausages", quantity: 3, unit: "pcs", estimatedPrice: 40 },
      { inventoryItemId: null, name: "Charcoal", quantity: 1, unit: "bag", estimatedPrice: undefined },
    ]);
  });

  it("returns a friendly error when the create fails", async () => {
    m.templateFindFirst.mockResolvedValue({ id: "t-1", name: "BBQ", items: [] });
    m.inventoryFindMany.mockResolvedValue([]);
    m.listCreate.mockRejectedValue(new Error("db down"));
    const result = await createListFromTemplateAction("t-1");
    expect(result.error).toBeTruthy();
    expect(m.redirect).not.toHaveBeenCalled();
  });
});

describe("deleteShoppingListTemplateAction", () => {
  it("refuses a template outside the caller's household", async () => {
    m.templateFindFirst.mockResolvedValue(null);
    const result = await deleteShoppingListTemplateAction("foreign");
    expect(result.error).toBe(errors.notFound);
    expect(m.templateDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes household-scoped and hands back a snapshot for undo", async () => {
    m.templateFindFirst.mockResolvedValue({
      id: "t-1",
      name: "BBQ",
      items: [{ id: "i-1", templateId: "t-1", position: 0, name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: null }],
    });
    m.templateDeleteMany.mockResolvedValue({ count: 1 });

    const result = await deleteShoppingListTemplateAction("t-1");

    expect(m.templateDeleteMany).toHaveBeenCalledWith({ where: { id: "t-1", householdId: "household-1" } });
    expect(result.snapshot).toEqual({
      name: "BBQ",
      items: [{ name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: null }],
    });
  });
});

describe("restoreShoppingListTemplateAction", () => {
  it("rejects an invalid snapshot", async () => {
    const result = await restoreShoppingListTemplateAction({ name: "BBQ", items: [] });
    expect(result.error).toBeTruthy();
    expect(m.templateCreate).not.toHaveBeenCalled();
  });

  it("drops inventory links that aren't the caller's before recreating", async () => {
    m.templateFindFirst.mockResolvedValue(null);
    m.inventoryFindMany.mockResolvedValue([{ id: "mine" }]);
    m.templateCreate.mockResolvedValue({ id: "t-2" });

    const result = await restoreShoppingListTemplateAction({
      name: "BBQ",
      items: [
        { name: "Sausages", quantity: 3, unit: "pcs", inventoryItemId: "mine" },
        { name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: "theirs" },
      ],
    });

    expect(result).toEqual({});
    expect(m.inventoryFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["mine", "theirs"] }, householdId: "household-1" },
      select: { id: true },
    });
    expect(m.templateCreate).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        name: "BBQ",
        items: {
          create: [
            { name: "Sausages", quantity: 3, unit: "pcs", inventoryItemId: "mine", position: 0 },
            { name: "Charcoal", quantity: 1, unit: "bag", inventoryItemId: null, position: 1 },
          ],
        },
      },
    });
  });
});
