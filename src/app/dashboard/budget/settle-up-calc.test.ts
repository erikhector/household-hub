import { describe, expect, it } from "vitest";
import { computeNetBalances, simplifyDebts, type SplitTransaction } from "./settle-up-calc";

describe("computeNetBalances", () => {
  it("returns nothing for transactions with no splits", () => {
    expect(computeNetBalances([])).toEqual([]);
  });

  it("nets a single evenly-split transaction: payer is owed by everyone else", () => {
    const transactions: SplitTransaction[] = [
      {
        amount: 90,
        paidByMemberId: "alice",
        splits: [
          { householdMemberId: "alice", amountOwed: 30 },
          { householdMemberId: "bob", amountOwed: 30 },
          { householdMemberId: "carol", amountOwed: 30 },
        ],
      },
    ];
    const balances = computeNetBalances(transactions);
    expect(balances).toEqual(
      expect.arrayContaining([
        { householdMemberId: "alice", netBalance: 60 },
        { householdMemberId: "bob", netBalance: -30 },
        { householdMemberId: "carol", netBalance: -30 },
      ]),
    );
    expect(balances).toHaveLength(3);
  });

  it("nets multiple transactions across different payers", () => {
    const transactions: SplitTransaction[] = [
      {
        amount: 100,
        paidByMemberId: "alice",
        splits: [
          { householdMemberId: "alice", amountOwed: 50 },
          { householdMemberId: "bob", amountOwed: 50 },
        ],
      },
      {
        amount: 40,
        paidByMemberId: "bob",
        splits: [
          { householdMemberId: "alice", amountOwed: 20 },
          { householdMemberId: "bob", amountOwed: 20 },
        ],
      },
    ];
    // Alice: +100 (paid) - 50 (own share) - 20 (share of Bob's tx) = 30
    // Bob: +40 (paid) - 50 (share of Alice's tx) - 20 (own share) = -30
    const balances = computeNetBalances(transactions);
    expect(balances).toEqual(
      expect.arrayContaining([
        { householdMemberId: "alice", netBalance: 30 },
        { householdMemberId: "bob", netBalance: -30 },
      ]),
    );
  });

  it("drops balances that net out to (near) zero", () => {
    const transactions: SplitTransaction[] = [
      {
        amount: 20,
        paidByMemberId: "alice",
        splits: [
          { householdMemberId: "alice", amountOwed: 10 },
          { householdMemberId: "bob", amountOwed: 10 },
        ],
      },
      {
        amount: 20,
        paidByMemberId: "bob",
        splits: [
          { householdMemberId: "alice", amountOwed: 10 },
          { householdMemberId: "bob", amountOwed: 10 },
        ],
      },
    ];
    expect(computeNetBalances(transactions)).toEqual([]);
  });

  it("nets a degenerate split with only one member included: everything owed to that person", () => {
    // Only one member is in `splits` and it isn't the payer — a
    // "split" in name only, equivalent to alice fronting the whole
    // thing on bob's behalf.
    const transactions: SplitTransaction[] = [
      {
        amount: 50,
        paidByMemberId: "alice",
        splits: [{ householdMemberId: "bob", amountOwed: 50 }],
      },
    ];
    const balances = computeNetBalances(transactions);
    expect(balances).toEqual(
      expect.arrayContaining([
        { householdMemberId: "alice", netBalance: 50 },
        { householdMemberId: "bob", netBalance: -50 },
      ]),
    );
    expect(balances).toHaveLength(2);
  });

  it("nets a degenerate split where the only member is the payer themselves: balance cancels out", () => {
    // Payer is also the sole split member for their own share — nets to
    // zero and drops out entirely, like any other zero balance.
    const transactions: SplitTransaction[] = [
      {
        amount: 50,
        paidByMemberId: "alice",
        splits: [{ householdMemberId: "alice", amountOwed: 50 }],
      },
    ];
    expect(computeNetBalances(transactions)).toEqual([]);
  });

  it("stays correct to the cent across many small transactions despite floating-point summation", () => {
    // 25 transactions of $10.10 each, split three ways as 3.37/3.37/3.36
    // (sums to 10.10 per transaction). Repeated float addition of
    // sub-dollar amounts is the classic case for cumulative drift; the
    // result should still land within a cent of the exact decimal answer.
    const transactions: SplitTransaction[] = Array.from({ length: 25 }, () => ({
      amount: 10.1,
      paidByMemberId: "alice",
      splits: [
        { householdMemberId: "alice", amountOwed: 3.37 },
        { householdMemberId: "bob", amountOwed: 3.37 },
        { householdMemberId: "carol", amountOwed: 3.36 },
      ],
    }));

    const balances = computeNetBalances(transactions);
    const byId = Object.fromEntries(balances.map((b) => [b.householdMemberId, b.netBalance]));

    // alice: paid 25*10.10 = 252.50, owes her own share 25*3.37 = 84.25
    expect(byId.alice).toBeCloseTo(252.5 - 84.25, 2);
    // bob owes his share across all 25 transactions
    expect(byId.bob).toBeCloseTo(-84.25, 2);
    // carol owes her (slightly smaller) share across all 25 transactions
    expect(byId.carol).toBeCloseTo(-84.0, 2);

    const settlements = simplifyDebts(balances);
    const total = settlements.reduce((sum, s) => sum + s.amount, 0);
    // bob and carol collectively owe alice exactly her net balance.
    expect(total).toBeCloseTo(252.5 - 84.25, 2);
    expect(settlements.every((s) => s.toMemberId === "alice")).toBe(true);
  });
});

describe("simplifyDebts", () => {
  it("returns nothing when every balance is zero", () => {
    expect(simplifyDebts([])).toEqual([]);
  });

  it("settles a simple two-person debt in one transfer", () => {
    const settlements = simplifyDebts([
      { householdMemberId: "alice", netBalance: 30 },
      { householdMemberId: "bob", netBalance: -30 },
    ]);
    expect(settlements).toEqual([{ fromMemberId: "bob", toMemberId: "alice", amount: 30 }]);
  });

  it("nets a three-way cycle down to the minimum number of transfers", () => {
    // Alice is owed 60 overall, Bob owes 30, Carol owes 30 — the minimum
    // settle-up is 2 transfers (Bob->Alice, Carol->Alice), never a 3rd
    // linking Bob and Carol directly since neither owes the other anything.
    const settlements = simplifyDebts([
      { householdMemberId: "alice", netBalance: 60 },
      { householdMemberId: "bob", netBalance: -30 },
      { householdMemberId: "carol", netBalance: -30 },
    ]);
    expect(settlements).toHaveLength(2);
    const total = settlements.reduce((sum, s) => sum + s.amount, 0);
    expect(total).toBe(60);
    for (const s of settlements) {
      expect(s.toMemberId).toBe("alice");
    }
  });

  it("simplifies a chain (A owes B, B owes C) into a single direct transfer", () => {
    // If the raw ledger were "Alice owes Bob 20" and "Bob owes Carol 20",
    // net balances collapse Bob out entirely: Alice -20, Carol +20 — the
    // whole point of debt simplification vs. a raw list of every split.
    const settlements = simplifyDebts([
      { householdMemberId: "alice", netBalance: -20 },
      { householdMemberId: "carol", netBalance: 20 },
    ]);
    expect(settlements).toEqual([{ fromMemberId: "alice", toMemberId: "carol", amount: 20 }]);
  });

  it("handles unequal debtor/creditor counts with multiple transfers", () => {
    const settlements = simplifyDebts([
      { householdMemberId: "alice", netBalance: 50 },
      { householdMemberId: "bob", netBalance: 10 },
      { householdMemberId: "carol", netBalance: -60 },
    ]);
    expect(settlements).toHaveLength(2);
    const total = settlements.reduce((sum, s) => sum + s.amount, 0);
    expect(total).toBe(60);
    expect(settlements.every((s) => s.fromMemberId === "carol")).toBe(true);
  });
});
