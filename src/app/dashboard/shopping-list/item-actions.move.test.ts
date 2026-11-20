// GAP-82: moveShoppingListItemAction and undoMergedShoppingListMoveAction in
// item-actions.ts. Kept apart from item-actions.test.ts, whose shared mock
// set is built around adding and ticking rows; these two need only a list
// and row lookup and the transaction's writes. All I/O is mocked, as in
// src/lib/actions/household.test.ts: no database is touched.
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";

const mocks = vi.hoisted(() => {
  const tx = {
    shoppingListItem: {
      findFirst: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ id: "recreated" })),
    },
  };
  return {
    tx,
    requireHousehold: vi.fn(),
    itemFindFirst: vi.fn(),
    listFindFirst: vi.fn(),
    memberFindFirst: vi.fn(),
    transaction: vi.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shoppingListItem: { findFirst: mocks.itemFindFirst },
    shoppingList: { findFirst: mocks.listFindFirst },
    householdMember: { findFirst: mocks.memberFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: mocks.requireHousehold }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: vi.fn(async () => en) }));

const { moveShoppingListItemAction, undoMergedShoppingListMoveAction } = await import("./item-actions");

const household = { id: "household-1" };

function setup() {
  mocks.requireHousehold.mockResolvedValue({ household, userId: "user-1" });
}
setup();
afterEach(() => {
  vi.clearAllMocks();
  mocks.tx.shoppingListItem.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.shoppingListItem.deleteMany.mockResolvedValue({ count: 1 });
  setup();
});

const row = {
  id: "row-1",
  name: "Milk",
  shoppingListId: "list-a",
  purchased: false,
  inventoryItemId: "inv-milk",
  quantity: 2,
  unit: "l",
  note: "the organic one",
  urgent: false,
  estimatedPrice: 30,
  addedByUserId: "user-2",
  addedAutomatically: true,
  sample: "sample-batch-1",
};
const target = { id: "list-b", name: "Hardware store" };

describe("moveShoppingListItemAction", () => {
  it("scopes the row and the target list to the session's household and rejects a foreign target", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(row);
    mocks.listFindFirst.mockResolvedValueOnce(null);

    const result = await moveShoppingListItemAction("row-1", "foreign-list");

    expect(result.error).toBe(en.errors.listNotEditable);
    expect(mocks.itemFindFirst.mock.calls[0][0].where).toEqual({
      id: "row-1",
      shoppingList: { householdId: household.id },
    });
    expect(mocks.listFindFirst.mock.calls[0][0].where).toEqual({
      id: "foreign-list",
      householdId: household.id,
      status: "ACTIVE",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("only takes an ACTIVE list as the target", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(row);
    // A COMPLETED or ARCHIVED list fails the `status: "ACTIVE"` filter.
    mocks.listFindFirst.mockResolvedValueOnce(null);

    const result = await moveShoppingListItemAction("row-1", "completed-list");

    expect(result.error).toBe(en.errors.listNotEditable);
    expect(mocks.listFindFirst.mock.calls[0][0].where.status).toBe("ACTIVE");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses a row from another household", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(null);

    const result = await moveShoppingListItemAction("someone-elses-row", "list-b");

    expect(result.error).toBe(en.errors.itemNotFound);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses a ticked-off row", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce({ ...row, purchased: true });

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(result.error).toBe(en.errors.moveItemPurchased);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses the row's own list as the target", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(row);
    mocks.listFindFirst.mockResolvedValueOnce({ id: "list-a", name: "Groceries" });

    const result = await moveShoppingListItemAction("row-1", "list-a");

    expect(result.error).toBe(en.errors.listNotEditable);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("moves the row itself when the item isn't pending on the target, so note, price and author travel with it", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(row);
    mocks.listFindFirst.mockResolvedValueOnce(target);
    mocks.tx.shoppingListItem.findFirst.mockResolvedValueOnce(null);

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(result).toEqual({ sourceListId: "list-a", listName: "Hardware store" });
    expect(mocks.tx.shoppingListItem.findFirst.mock.calls[0][0].where).toEqual({
      shoppingListId: "list-b",
      inventoryItemId: "inv-milk",
      purchased: false,
    });
    // Only the list changes: note, estimatedPrice and addedByUserId are untouched.
    expect(mocks.tx.shoppingListItem.updateMany).toHaveBeenCalledWith({
      where: { id: "row-1", shoppingListId: "list-a", purchased: false },
      data: { shoppingListId: "list-b" },
    });
    expect(mocks.tx.shoppingListItem.deleteMany).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/shopping-list/list-a");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/shopping-list/list-b");
  });

  it("moves an unlinked row without looking for a row to merge into", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce({ ...row, inventoryItemId: null });
    mocks.listFindFirst.mockResolvedValueOnce(target);

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(result.error).toBeUndefined();
    expect(mocks.tx.shoppingListItem.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.shoppingListItem.updateMany).toHaveBeenCalledTimes(1);
  });

  it("says the item is gone when it was ticked or moved between the read and the write", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(row);
    mocks.listFindFirst.mockResolvedValueOnce(target);
    mocks.tx.shoppingListItem.findFirst.mockResolvedValueOnce(null);
    mocks.tx.shoppingListItem.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(result.error).toBe(en.errors.itemNotFound);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("merges into the target's pending row in the same unit, summing the quantity and deleting the moved row", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(row);
    mocks.listFindFirst.mockResolvedValueOnce(target);
    mocks.tx.shoppingListItem.findFirst.mockResolvedValueOnce({ id: "row-b", unit: "l", urgent: false });

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(mocks.tx.shoppingListItem.deleteMany).toHaveBeenCalledWith({
      where: { id: "row-1", shoppingListId: "list-a", purchased: false },
    });
    // The target row keeps its own note, price and author: only quantity
    // changes, and only while it's still unticked on the target list.
    expect(mocks.tx.shoppingListItem.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.shoppingListItem.updateMany).toHaveBeenCalledWith({
      where: { id: "row-b", shoppingListId: "list-b", purchased: false },
      data: { quantity: { increment: 2 } },
    });
    expect(result).toEqual({
      sourceListId: "list-a",
      listName: "Hardware store",
      merged: {
        targetItemId: "row-b",
        quantity: 2,
        note: "the organic one",
        urgent: false,
        madeTargetUrgent: false,
        estimatedPrice: 30,
        addedByUserId: "user-2",
        addedAutomatically: true,
        sample: "sample-batch-1",
      },
    });
  });

  it("makes the target row urgent when an urgent row merges into it, and says so for the Undo (GAP-86)", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce({ ...row, urgent: true });
    mocks.listFindFirst.mockResolvedValueOnce(target);
    mocks.tx.shoppingListItem.findFirst.mockResolvedValueOnce({ id: "row-b", unit: "l", urgent: false });

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(mocks.tx.shoppingListItem.updateMany).toHaveBeenCalledWith({
      where: { id: "row-b", shoppingListId: "list-b", purchased: false },
      data: { quantity: { increment: 2 }, urgent: true },
    });
    expect(result.merged).toMatchObject({ urgent: true, madeTargetUrgent: true });
  });

  it("leaves an already urgent target alone, so the Undo doesn't clear its own flag (GAP-86)", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce({ ...row, urgent: true });
    mocks.listFindFirst.mockResolvedValueOnce(target);
    mocks.tx.shoppingListItem.findFirst.mockResolvedValueOnce({ id: "row-b", unit: "l", urgent: true });

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(mocks.tx.shoppingListItem.updateMany).toHaveBeenCalledWith({
      where: { id: "row-b", shoppingListId: "list-b", purchased: false },
      data: { quantity: { increment: 2 } },
    });
    expect(result.merged).toMatchObject({ urgent: true, madeTargetUrgent: false });
  });

  it("rolls the merge back when the target row was ticked between the read and the write", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(row);
    mocks.listFindFirst.mockResolvedValueOnce(target);
    mocks.tx.shoppingListItem.findFirst.mockResolvedValueOnce({ id: "row-b", unit: "l" });
    // The moved row's delete matches, but the target row is no longer
    // unticked (someone put it in the cart on another device).
    mocks.tx.shoppingListItem.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(result.error).toBe(en.errors.itemNotFound);
    // The transaction callback rejects, which is what makes Prisma roll the
    // delete back: a resolved callback would commit it.
    expect(mocks.tx.shoppingListItem.deleteMany).toHaveBeenCalledTimes(1);
    await expect(mocks.transaction.mock.results[0].value).rejects.toThrow();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a merge across units and changes nothing", async () => {
    mocks.itemFindFirst.mockResolvedValueOnce(row);
    mocks.listFindFirst.mockResolvedValueOnce(target);
    mocks.tx.shoppingListItem.findFirst.mockResolvedValueOnce({ id: "row-b", unit: "pcs" });

    const result = await moveShoppingListItemAction("row-1", "list-b");

    expect(result.error).toBe("Milk is already on Hardware store in another unit");
    expect(mocks.tx.shoppingListItem.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.shoppingListItem.deleteMany).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("undoMergedShoppingListMoveAction", () => {
  const undo = {
    targetItemId: "row-b",
    sourceListId: "list-a",
    quantity: 2,
    note: "the organic one",
    urgent: false,
    madeTargetUrgent: false,
    estimatedPrice: 30,
    addedByUserId: "user-2",
    addedAutomatically: false,
    sample: null,
  };
  const targetRow = { id: "row-b", shoppingListId: "list-b", name: "Milk", unit: "l", inventoryItemId: "inv-milk" };

  it("takes the quantity off the target row and recreates the row on the source list", async () => {
    mocks.listFindFirst.mockResolvedValueOnce({ id: "list-a" });
    mocks.itemFindFirst.mockResolvedValueOnce(targetRow);
    mocks.memberFindFirst.mockResolvedValueOnce({ userId: "user-2" });

    const result = await undoMergedShoppingListMoveAction(undo);

    expect(result).toEqual({});
    expect(mocks.listFindFirst.mock.calls[0][0].where).toEqual({
      id: "list-a",
      householdId: household.id,
      status: "ACTIVE",
    });
    expect(mocks.itemFindFirst.mock.calls[0][0].where).toEqual({
      id: "row-b",
      shoppingList: { householdId: household.id },
    });
    expect(mocks.tx.shoppingListItem.updateMany).toHaveBeenCalledWith({
      where: { id: "row-b", purchased: false, quantity: { gt: 2 } },
      data: { quantity: { decrement: 2 } },
    });
    // Name, unit and link come from the target row, not from the client.
    expect(mocks.tx.shoppingListItem.create).toHaveBeenCalledWith({
      data: {
        shoppingListId: "list-a",
        inventoryItemId: "inv-milk",
        name: "Milk",
        unit: "l",
        quantity: 2,
        note: "the organic one",
        urgent: false,
        estimatedPrice: 30,
        addedByUserId: "user-2",
        addedAutomatically: false,
        sample: null,
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/shopping-list/list-a");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard/shopping-list/list-b");
  });

  it("recreates an urgent row as urgent and takes back the urgency the merge lent the target (GAP-86)", async () => {
    mocks.listFindFirst.mockResolvedValueOnce({ id: "list-a" });
    mocks.itemFindFirst.mockResolvedValueOnce(targetRow);
    mocks.memberFindFirst.mockResolvedValueOnce({ userId: "user-2" });

    await undoMergedShoppingListMoveAction({ ...undo, urgent: true, madeTargetUrgent: true });

    expect(mocks.tx.shoppingListItem.updateMany).toHaveBeenCalledWith({
      where: { id: "row-b", purchased: false, quantity: { gt: 2 } },
      data: { quantity: { decrement: 2 }, urgent: false },
    });
    expect(mocks.tx.shoppingListItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ urgent: true }),
    });
  });

  it("recreates an auto-added sample row as one, so AUTO-8's undo and Clear sample data still find it", async () => {
    mocks.listFindFirst.mockResolvedValueOnce({ id: "list-a" });
    mocks.itemFindFirst.mockResolvedValueOnce(targetRow);
    mocks.memberFindFirst.mockResolvedValueOnce({ userId: "user-2" });

    await undoMergedShoppingListMoveAction({ ...undo, addedAutomatically: true, sample: "sample-batch-1" });

    expect(mocks.tx.shoppingListItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ addedAutomatically: true, sample: "sample-batch-1" }),
    });
  });

  it("drops an author who isn't a member of the household", async () => {
    mocks.listFindFirst.mockResolvedValueOnce({ id: "list-a" });
    mocks.itemFindFirst.mockResolvedValueOnce(targetRow);
    mocks.memberFindFirst.mockResolvedValueOnce(null);

    await undoMergedShoppingListMoveAction({ ...undo, addedByUserId: "outsider" });

    expect(mocks.memberFindFirst.mock.calls[0][0].where).toEqual({ householdId: household.id, userId: "outsider" });
    expect(mocks.tx.shoppingListItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ addedByUserId: null }),
    });
  });

  it("rejects a source list outside the household or no longer active", async () => {
    mocks.listFindFirst.mockResolvedValueOnce(null);
    mocks.itemFindFirst.mockResolvedValueOnce(targetRow);

    const result = await undoMergedShoppingListMoveAction({ ...undo, sourceListId: "foreign-list" });

    expect(result.error).toBe(en.errors.listNotEditable);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a target row outside the household", async () => {
    mocks.listFindFirst.mockResolvedValueOnce({ id: "list-a" });
    mocks.itemFindFirst.mockResolvedValueOnce(null);

    const result = await undoMergedShoppingListMoveAction({ ...undo, targetItemId: "foreign-row" });

    expect(result.error).toBe(en.errors.moveUndoStale);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses, changing nothing, when the target row was bought, edited down or deleted meanwhile", async () => {
    mocks.listFindFirst.mockResolvedValueOnce({ id: "list-a" });
    mocks.itemFindFirst.mockResolvedValueOnce(targetRow);
    mocks.memberFindFirst.mockResolvedValueOnce({ userId: "user-2" });
    // The conditional write (unpurchased, more than the moved quantity) matches nothing.
    mocks.tx.shoppingListItem.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await undoMergedShoppingListMoveAction(undo);

    expect(result.error).toBe(en.errors.moveUndoStale);
    expect(mocks.tx.shoppingListItem.create).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("validates the values like the edit dialog does", async () => {
    const result = await undoMergedShoppingListMoveAction({ ...undo, quantity: 0 });

    expect(result.error).toBe(en.errors.quantityPositive);
    expect(mocks.listFindFirst).not.toHaveBeenCalled();

    const tooLong = await undoMergedShoppingListMoveAction({ ...undo, note: "x".repeat(201) });
    expect(tooLong.error).toBe(en.errors.noteTooLong);

    const negative = await undoMergedShoppingListMoveAction({ ...undo, estimatedPrice: -1 });
    expect(negative.error).toBe(en.errors.priceNegative);
  });
});
