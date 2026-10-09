import { afterEach, describe, expect, it, vi } from "vitest";

const requireHouseholdMock = vi.fn();
const preparedBatchFindFirstMock = vi.fn();
const preparedBatchUpdateMock = vi.fn();
const preparedBatchUpdateManyMock = vi.fn();
const mealPlanEntryFindFirstMock = vi.fn();
const mealPlanEntryUpdateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    preparedBatch: { findFirst: preparedBatchFindFirstMock, update: preparedBatchUpdateMock, updateMany: preparedBatchUpdateManyMock },
    mealPlanEntry: { findFirst: mealPlanEntryFindFirstMock, update: mealPlanEntryUpdateMock },
    $transaction: async (cb: (tx: any) => unknown) => cb({ preparedBatch: { findFirst: preparedBatchFindFirstMock, update: preparedBatchUpdateMock, updateMany: preparedBatchUpdateManyMock }, mealPlanEntry: { findFirst: mealPlanEntryFindFirstMock, update: mealPlanEntryUpdateMock } }),
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));

const { assignPreparedPortionsAction, unassignPreparedPortionsAction } = await import("./prepared-batches-actions");

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" } });
});

describe("assignPreparedPortionsAction", () => {
  it("assigns portions when enough remain", async () => {
    preparedBatchFindFirstMock.mockResolvedValue({ id: "batch-1", remainingPortions: 3 });
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });
    preparedBatchUpdateMock.mockResolvedValue({});
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const fd = new FormData();
    fd.set("entryId", "entry-1");
    fd.set("batchId", "batch-1");
    fd.set("portions", "2");

    const res = await assignPreparedPortionsAction({}, fd);
    expect(res).toEqual({});
    expect(preparedBatchUpdateMock).toHaveBeenCalled();
    expect(mealPlanEntryUpdateMock).toHaveBeenCalled();
  });

  it("errors when not enough portions", async () => {
    preparedBatchFindFirstMock.mockResolvedValue({ id: "batch-1", remainingPortions: 1 });
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1" });
    const fd = new FormData();
    fd.set("entryId", "entry-1");
    fd.set("batchId", "batch-1");
    fd.set("portions", "2");

    const res = await assignPreparedPortionsAction({}, fd);
    expect(res.error).toMatch(/Not enough portions/);
  });
});

describe("unassignPreparedPortionsAction", () => {
  it("returns portions to the batch and clears the entry", async () => {
    mealPlanEntryFindFirstMock.mockResolvedValue({ id: "entry-1", preparedBatchId: "batch-1", preparedPortionsUsed: 2 });
    preparedBatchUpdateManyMock.mockResolvedValue({});
    mealPlanEntryUpdateMock.mockResolvedValue({});

    const res = await unassignPreparedPortionsAction("entry-1");
    expect(res).toEqual({});
    expect(preparedBatchUpdateManyMock).toHaveBeenCalled();
    expect(mealPlanEntryUpdateMock).toHaveBeenCalledWith({ where: { id: "entry-1" }, data: { preparedBatchId: null, preparedPortionsUsed: 0 } });
  });
});
