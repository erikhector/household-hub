// All I/O is mocked (see AGENTS.md "Testing"): these check the guards and the
// scoping of what the two actions write and delete, not the database.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const model = () => ({
    count: vi.fn(async () => 0),
    createMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(async () => ({})),
    upsert: vi.fn(async () => ({})),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    updateMany: vi.fn(async () => ({ count: 0 })),
  });
  return {
    inventoryItem: model(),
    shoppingList: model(),
    shoppingListItem: model(),
    recipe: model(),
    mealPlan: model(),
    mealPlanEntry: model(),
    householdTask: model(),
    transaction: vi.fn(async (ops: unknown[]) => ops),
    requireHousehold: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    inventoryItem: m.inventoryItem,
    shoppingList: m.shoppingList,
    shoppingListItem: m.shoppingListItem,
    recipe: m.recipe,
    mealPlan: m.mealPlan,
    mealPlanEntry: m.mealPlanEntry,
    householdTask: m.householdTask,
    $transaction: m.transaction,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: m.requireHousehold }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/i18n/get-dictionary", async () => {
  const { en } = await import("@/lib/i18n/dictionaries/en");
  return { getDictionary: async () => en };
});

import { clearSampleDataAction, seedSampleDataAction } from "@/lib/actions/sample-data";

beforeEach(() => {
  vi.clearAllMocks();
  m.requireHousehold.mockResolvedValue({ household: { id: "h1" }, userId: "u1" });
  for (const k of ["inventoryItem", "shoppingList", "recipe", "mealPlanEntry", "householdTask"] as const) {
    m[k].count.mockResolvedValue(0);
  }
});

describe("seedSampleDataAction", () => {
  it("seeds every kind in one transaction, tagged and scoped to the session household", async () => {
    await seedSampleDataAction();
    expect(m.transaction).toHaveBeenCalledTimes(1);
    const inv = (m.inventoryItem.createMany.mock.calls[0] as unknown[])[0] as {
      data: { householdId: string; sample: string }[];
    };
    expect(inv.data.length).toBe(6);
    expect(inv.data.every((r) => r.householdId === "h1" && typeof r.sample === "string")).toBe(true);
    expect(m.recipe.create).toHaveBeenCalledTimes(3);
    expect(m.shoppingList.create).toHaveBeenCalledTimes(1);
    expect(m.mealPlan.upsert).toHaveBeenCalledTimes(1);
    const tasks = (m.householdTask.createMany.mock.calls[0] as unknown[])[0] as { data: { householdId: string }[] };
    expect(tasks.data.every((r) => r.householdId === "h1")).toBe(true);
  });

  it("does nothing when the household already has data", async () => {
    m.recipe.count.mockResolvedValue(1);
    await seedSampleDataAction();
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.inventoryItem.createMany).not.toHaveBeenCalled();
  });
});

describe("clearSampleDataAction", () => {
  it("only deletes tagged rows, always inside the session household", async () => {
    await clearSampleDataAction();
    expect(m.transaction).toHaveBeenCalledTimes(1);
    const tagged = { not: null };
    expect(m.inventoryItem.deleteMany).toHaveBeenCalledWith({ where: { householdId: "h1", sample: tagged } });
    expect(m.recipe.deleteMany).toHaveBeenCalledWith({ where: { householdId: "h1", sample: tagged } });
    expect(m.householdTask.deleteMany).toHaveBeenCalledWith({ where: { householdId: "h1", sample: tagged } });
    expect(m.shoppingListItem.deleteMany).toHaveBeenCalledWith({
      where: { sample: tagged, shoppingList: { householdId: "h1" } },
    });
    expect(m.mealPlanEntry.deleteMany).toHaveBeenCalledWith({
      where: { sample: tagged, mealPlan: { householdId: "h1" } },
    });
  });

  it("keeps a list or week plan that gained a row of the person's own, untagging it", async () => {
    await clearSampleDataAction();
    expect(m.shoppingList.deleteMany).toHaveBeenCalledWith({
      where: { householdId: "h1", sample: { not: null }, items: { none: {} } },
    });
    expect(m.shoppingList.updateMany).toHaveBeenCalledWith({
      where: { householdId: "h1", sample: { not: null } },
      data: { sample: null },
    });
    expect(m.mealPlan.deleteMany).toHaveBeenCalledWith({
      where: { householdId: "h1", sample: { not: null }, entries: { none: {} }, picks: { none: {} } },
    });
  });
});
