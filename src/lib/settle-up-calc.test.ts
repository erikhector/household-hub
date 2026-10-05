import { describe, expect, it } from "vitest";
import {
  computeBillPositions,
  computeMemberPosition,
  computeNetBalances,
  isSettledBill,
  remainingDue,
  sumTransfersByPair,
  simplifyDebts,
  type SplitTransaction,
} from "./settle-up-calc";

// The pre-partial-payments shape: one member paid the whole bill. Keeps the
// original single-payer tests readable now that payments live on the split
// rows (a payer without a share of their own gets a 0-share row, the same
// thing the migration backfilled).
function paidBy(
  payer: string,
  amount: number,
  shares: { householdMemberId: string; amountOwed: number }[],
): SplitTransaction {
  const splits = shares.map((s) => ({ ...s, amountPaid: s.householdMemberId === payer ? amount : 0 }));
  if (!splits.some((s) => s.householdMemberId === payer)) {
    splits.push({ householdMemberId: payer, amountOwed: 0, amountPaid: amount });
  }
  return { amount, splits };
}

describe("computeNetBalances", () => {
  it("returns nothing for transactions with no splits", () => {
    expect(computeNetBalances([])).toEqual([]);
  });

  it("nets a single evenly-split transaction: payer is owed by everyone else", () => {
    const transactions: SplitTransaction[] = [
      paidBy("alice", 90, [
          { householdMemberId: "alice", amountOwed: 30 },
          { householdMemberId: "bob", amountOwed: 30 },
          { householdMemberId: "carol", amountOwed: 30 },
        ]),
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
      paidBy("alice", 100, [
          { householdMemberId: "alice", amountOwed: 50 },
          { householdMemberId: "bob", amountOwed: 50 },
        ]),
      paidBy("bob", 40, [
          { householdMemberId: "alice", amountOwed: 20 },
          { householdMemberId: "bob", amountOwed: 20 },
        ]),
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
      paidBy("alice", 20, [
          { householdMemberId: "alice", amountOwed: 10 },
          { householdMemberId: "bob", amountOwed: 10 },
        ]),
      paidBy("bob", 20, [
          { householdMemberId: "alice", amountOwed: 10 },
          { householdMemberId: "bob", amountOwed: 10 },
        ]),
    ];
    expect(computeNetBalances(transactions)).toEqual([]);
  });

  it("nets a degenerate split with only one member included: everything owed to that person", () => {
    // Only one member is in `splits` and it isn't the payer — a
    // "split" in name only, equivalent to alice fronting the whole
    // thing on bob's behalf.
    const transactions: SplitTransaction[] = [
      paidBy("alice", 50, [{ householdMemberId: "bob", amountOwed: 50 }]),
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
      paidBy("alice", 50, [{ householdMemberId: "alice", amountOwed: 50 }]),
    ];
    expect(computeNetBalances(transactions)).toEqual([]);
  });

  it("stays correct to the cent across many small transactions despite floating-point summation", () => {
    // 25 transactions of $10.10 each, split three ways as 3.37/3.37/3.36
    // (sums to 10.10 per transaction). Repeated float addition of
    // sub-dollar amounts is the classic case for cumulative drift; the
    // result should still land within a cent of the exact decimal answer.
    const transactions: SplitTransaction[] = Array.from({ length: 25 }, () => (paidBy("alice", 10.1, [
        { householdMemberId: "alice", amountOwed: 3.37 },
        { householdMemberId: "bob", amountOwed: 3.37 },
        { householdMemberId: "carol", amountOwed: 3.36 },
      ])));

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

describe("partial payments", () => {
  it("leaves the unpaid part owed to the bill, not to the member who paid their share", () => {
    // 6000 split 3000/3000, I pay my 3000 and my partner nothing yet: 3000
    // is left due on the bill and nobody owes anybody.
    const tx: SplitTransaction = {
      amount: 6000,
      splits: [
        { householdMemberId: "me", amountOwed: 3000, amountPaid: 3000 },
        { householdMemberId: "partner", amountOwed: 3000, amountPaid: 0 },
      ],
    };
    expect(remainingDue(tx)).toBe(3000);
    expect(computeNetBalances([tx])).toEqual([]);
    expect(computeBillPositions(tx).get("partner")?.owedToBill).toBe(3000);
    expect(computeBillPositions(tx).get("me")?.owedToBill).toBe(0);
  });

  it("splits a shortfall between the overpayer and the bill", () => {
    // I pay 4000 of a 6000 bill split 3000/3000: partner owes me 1000 and
    // still owes the bill 2000.
    const tx: SplitTransaction = {
      amount: 6000,
      splits: [
        { householdMemberId: "me", amountOwed: 3000, amountPaid: 4000 },
        { householdMemberId: "partner", amountOwed: 3000, amountPaid: 0 },
      ],
    };
    expect(remainingDue(tx)).toBe(2000);
    const positions = computeBillPositions(tx);
    expect(positions.get("me")?.memberBalance).toBeCloseTo(1000, 6);
    expect(positions.get("me")?.owedToBill).toBeCloseTo(0, 6);
    expect(positions.get("partner")?.memberBalance).toBeCloseTo(-1000, 6);
    expect(positions.get("partner")?.owedToBill).toBeCloseTo(2000, 6);
    expect(computeNetBalances([tx])).toEqual(
      expect.arrayContaining([
        { householdMemberId: "me", netBalance: 1000 },
        { householdMemberId: "partner", netBalance: -1000 },
      ]),
    );
  });

  it("owes nothing once both members have paid their share", () => {
    const tx: SplitTransaction = {
      amount: 6000,
      splits: [
        { householdMemberId: "me", amountOwed: 3000, amountPaid: 3000 },
        { householdMemberId: "partner", amountOwed: 3000, amountPaid: 3000 },
      ],
    };
    expect(remainingDue(tx)).toBe(0);
    expect(computeNetBalances([tx])).toEqual([]);
  });

  it("never invents debt when payments add up to more than the bill", () => {
    const tx: SplitTransaction = {
      amount: 100,
      splits: [
        { householdMemberId: "me", amountOwed: 50, amountPaid: 100 },
        { householdMemberId: "partner", amountOwed: 50, amountPaid: 100 },
      ],
    };
    expect(remainingDue(tx)).toBe(0);
    expect(computeNetBalances([tx])).toEqual([]);
  });
});

describe("repayments", () => {
  const rent = paidBy("me", 6000, [
    { householdMemberId: "me", amountOwed: 3000 },
    { householdMemberId: "partner", amountOwed: 3000 },
  ]);

  it("clears a debt once it's repaid in full", () => {
    expect(
      computeNetBalances([rent], [{ fromMemberId: "partner", toMemberId: "me", amount: 3000 }]),
    ).toEqual([]);
  });

  it("reduces a debt by a partial repayment", () => {
    expect(
      computeNetBalances([rent], [{ fromMemberId: "partner", toMemberId: "me", amount: 1000 }]),
    ).toEqual(
      expect.arrayContaining([
        { householdMemberId: "me", netBalance: 2000 },
        { householdMemberId: "partner", netBalance: -2000 },
      ]),
    );
  });

  it("carries debts across as many bills as it's given", () => {
    // Balances are no longer reset per month — two months of rent add up.
    const balances = computeNetBalances([rent, rent]);
    expect(simplifyDebts(balances)).toEqual([
      { fromMemberId: "partner", toMemberId: "me", amount: 6000 },
    ]);
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

describe("computeMemberPosition", () => {
  const aug = new Date(2026, 7, 1);
  const sep = new Date(2026, 8, 1);
  const oct = new Date(2026, 9, 1);
  const augRent = {
    ...paidBy("me", 6000, [
      { householdMemberId: "me", amountOwed: 3000 },
      { householdMemberId: "partner", amountOwed: 3000 },
    ]),
    date: new Date(2026, 7, 3),
  };

  it("ignores bills dated on or after asOf", () => {
    expect(
      computeMemberPosition({ memberId: "partner", transactions: [augRent], transfers: [], asOf: aug }),
    ).toEqual({ memberBalance: 0, owedToBills: 0 });
  });

  it("carries a debt into later months until it's repaid", () => {
    const transfers = [
      { fromMemberId: "partner", toMemberId: "me", amount: 3000, date: new Date(2026, 8, 10) },
    ];
    expect(
      computeMemberPosition({ memberId: "partner", transactions: [augRent], transfers, asOf: sep }),
    ).toEqual({ memberBalance: -3000, owedToBills: 0 });
    expect(
      computeMemberPosition({ memberId: "partner", transactions: [augRent], transfers, asOf: oct }),
    ).toEqual({ memberBalance: 0, owedToBills: 0 });
    expect(
      computeMemberPosition({ memberId: "me", transactions: [augRent], transfers, asOf: sep }),
    ).toEqual({ memberBalance: 3000, owedToBills: 0 });
  });

  it("reports an unpaid share of a bill separately from debts to members", () => {
    const halfPaid = {
      amount: 6000,
      date: new Date(2026, 7, 3),
      splits: [
        { householdMemberId: "me", amountOwed: 3000, amountPaid: 3000 },
        { householdMemberId: "partner", amountOwed: 3000, amountPaid: 0 },
      ],
    };
    expect(
      computeMemberPosition({ memberId: "partner", transactions: [halfPaid], transfers: [], asOf: sep }),
    ).toEqual({ memberBalance: 0, owedToBills: 3000 });
  });
});

// PERF-12: the budget page no longer loads every split bill and repayment the
// household has ever logged. These pin that what it loads instead (unsettled
// bills only, repayments summed per pair) yields the same balances,
// settle-up transfers and "left due" list as the full history did.
describe("PERF-12 bounded inputs match the full history", () => {
  const evenSplit = (
    id: string,
    amount: number,
    paid: Record<string, number>,
  ): SplitTransaction & { id: string } => ({
    id,
    amount,
    splits: [
      { householdMemberId: "a", amountOwed: amount / 2, amountPaid: paid.a ?? 0 },
      { householdMemberId: "b", amountOwed: amount / 2, amountPaid: paid.b ?? 0 },
    ],
  });
  const bills = [
    evenSplit("settled-1", 1000, { a: 500, b: 500 }),
    evenSplit("settled-2", 300, { a: 150, b: 150 }),
    evenSplit("a-paid-all", 6000, { a: 6000 }),
    evenSplit("half-paid", 4000, { a: 1000, b: 500 }),
    evenSplit("unpaid", 800, {}),
    evenSplit("settled-3", 90, { a: 45, b: 45 }),
  ];
  const transfers = [
    { fromMemberId: "b", toMemberId: "a", amount: 1000 },
    { fromMemberId: "b", toMemberId: "a", amount: 250.5 },
    { fromMemberId: "a", toMemberId: "b", amount: 75 },
  ];

  it("recognises only fully paid, exactly shared bills as settled", () => {
    expect(bills.filter(isSettledBill).map((b) => b.id)).toEqual(["settled-1", "settled-2", "settled-3"]);
    // Right total, wrong payer: balances move, so it is not settled.
    expect(isSettledBill(evenSplit("x", 100, { a: 100 }))).toBe(false);
    // Shares paid in full but the bill's amount exceeds them: money is still left due.
    expect(
      isSettledBill({ amount: 100, splits: [{ householdMemberId: "a", amountOwed: 40, amountPaid: 40 }] }),
    ).toBe(false);
    // A sub-cent difference still counts (exact comparison, no EPSILON).
    expect(isSettledBill(evenSplit("y", 100, { a: 50.001, b: 50 }))).toBe(false);
  });

  it("gives settled bills a zero position", () => {
    for (const bill of bills.filter(isSettledBill)) {
      for (const p of computeBillPositions(bill).values()) {
        expect(p.memberBalance).toBe(0);
        expect(p.owedToBill).toBe(0);
      }
      expect(remainingDue(bill)).toBe(0);
    }
  });

  it("produces identical balances and settle-up transfers", () => {
    const full = computeNetBalances(bills, transfers);
    const bounded = computeNetBalances(bills.filter((b) => !isSettledBill(b)), sumTransfersByPair(transfers));
    expect(bounded).toEqual(full);
    expect(simplifyDebts(bounded)).toEqual(simplifyDebts(full));
  });

  it("keeps the unpaid-bills list identical", () => {
    const leftDue = (list: typeof bills) =>
      list.map((b) => ({ id: b.id, due: remainingDue(b) })).filter((b) => b.due > 0);
    expect(leftDue(bills.filter((b) => !isSettledBill(b)))).toEqual(leftDue(bills));
  });

  it("handles a household with only settled bills", () => {
    const settled = bills.filter(isSettledBill);
    expect(computeNetBalances(settled)).toEqual([]);
    expect(computeNetBalances([])).toEqual([]);
  });

  it("sums repayments per pair without mixing directions or mutating the input", () => {
    const input = transfers.map((t) => ({ ...t }));
    expect(sumTransfersByPair(input)).toEqual([
      { fromMemberId: "b", toMemberId: "a", amount: 1250.5 },
      { fromMemberId: "a", toMemberId: "b", amount: 75 },
    ]);
    expect(input).toEqual(transfers);
    expect(sumTransfersByPair([])).toEqual([]);
  });
});
