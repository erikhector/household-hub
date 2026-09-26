// Tests settleDepartingMemberSplits directly (household.test.ts already
// checks that householdMemberActions calls it, but not what it does). All
// I/O is a fake `tx` object standing in for the caller's transaction client
// — no real Prisma client or database.
import { afterEach, describe, expect, it, vi } from "vitest";
import { settleDepartingMemberSplits } from "@/lib/settle-departing-member";

function fakeTx(splits: Array<{ id: string; amountOwed: number }>) {
  return {
    transactionSplit: {
      findMany: vi.fn(async () => splits),
      update: vi.fn(async () => ({})),
    },
  } as unknown as Parameters<typeof settleDepartingMemberSplits>[0];
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("settleDepartingMemberSplits", () => {
  it("looks up every other member's split on a transaction the departing member was part of", async () => {
    const tx = fakeTx([]);

    await settleDepartingMemberSplits(tx, "member-departing");

    expect(tx.transactionSplit.findMany).toHaveBeenCalledWith({
      where: {
        householdMemberId: { not: "member-departing" },
        transaction: { splits: { some: { householdMemberId: "member-departing" } } },
      },
      select: { id: true, amountOwed: true },
    });
  });

  it("marks each other member's split as fully paid (amountPaid = amountOwed)", async () => {
    const tx = fakeTx([
      { id: "split-a", amountOwed: 3000 },
      { id: "split-b", amountOwed: 1250 },
    ]);

    await settleDepartingMemberSplits(tx, "member-departing");

    expect(tx.transactionSplit.update).toHaveBeenCalledWith({
      where: { id: "split-a" },
      data: { amountPaid: 3000 },
    });
    expect(tx.transactionSplit.update).toHaveBeenCalledWith({
      where: { id: "split-b" },
      data: { amountPaid: 1250 },
    });
    expect(tx.transactionSplit.update).toHaveBeenCalledTimes(2);
  });

  it("is unconditional: it settles a split regardless of amountOwed, including zero", async () => {
    const tx = fakeTx([{ id: "split-zero", amountOwed: 0 }]);

    await settleDepartingMemberSplits(tx, "member-departing");

    expect(tx.transactionSplit.update).toHaveBeenCalledWith({
      where: { id: "split-zero" },
      data: { amountPaid: 0 },
    });
  });

  it("does nothing when the departing member had no shared transactions", async () => {
    const tx = fakeTx([]);

    await settleDepartingMemberSplits(tx, "member-departing");

    expect(tx.transactionSplit.update).not.toHaveBeenCalled();
  });
});
