// Pure "who owes whom" aggregation/debt-simplification logic for household
// expense splitting — see REQUIREMENTS.md's "Household expense splitting"
// subsection under Budgeting. Kept dependency-free (no Prisma import), same
// pattern as src/lib/safe-to-spend-calc.ts, so it's unit-testable with plain
// fixtures; src/app/dashboard/budget/page.tsx is the only caller, feeding it
// the splits/payer data from the same `transaction.findMany` query it
// already runs for the rest of the page.

export type SplitTransaction = {
  /** The full transaction amount the payer fronted. */
  amount: number;
  paidByMemberId: string;
  /** One entry per member included in the split; amounts should sum to
   * `amount` (the caller/action layer is responsible for that invariant —
   * this function just nets whatever it's given). */
  splits: { householdMemberId: string; amountOwed: number }[];
};

export type Balance = { householdMemberId: string; netBalance: number };

export type Settlement = {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
};

// Amounts smaller than this are treated as zero — guards against floating
// point noise (e.g. an even split of 10 three ways) producing a phantom
// settlement of a fraction of a cent.
const EPSILON = 0.005;

/**
 * Nets every split transaction down to one balance per household member:
 * positive means the household owes them money (net creditor), negative
 * means they owe the household money (net debtor). A member who paid a
 * transaction has their balance increased by the full amount; every member
 * with a split on that transaction (payer included) has their balance
 * reduced by their own share — so a payer's own share nets out to what
 * they're actually owed by everyone else.
 */
export function computeNetBalances(transactions: SplitTransaction[]): Balance[] {
  const balances = new Map<string, number>();
  const add = (memberId: string, delta: number) => {
    balances.set(memberId, (balances.get(memberId) ?? 0) + delta);
  };

  for (const tx of transactions) {
    add(tx.paidByMemberId, tx.amount);
    for (const split of tx.splits) {
      add(split.householdMemberId, -split.amountOwed);
    }
  }

  return [...balances.entries()]
    .map(([householdMemberId, netBalance]) => ({ householdMemberId, netBalance }))
    .filter((b) => Math.abs(b.netBalance) > EPSILON);
}

/**
 * Splitwise-style debt simplification: given each member's net balance,
 * produces the minimum number of settle-up transfers (debtor -> creditor)
 * that would zero every balance out, rather than a raw list of every
 * individual split. Greedy approach: repeatedly match the largest debtor
 * against the largest creditor for the smaller of the two amounts.
 */
export function simplifyDebts(balances: Balance[]): Settlement[] {
  const debtors = balances
    .filter((b) => b.netBalance < -EPSILON)
    .map((b) => ({ householdMemberId: b.householdMemberId, amount: -b.netBalance }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((b) => b.netBalance > EPSILON)
    .map((b) => ({ householdMemberId: b.householdMemberId, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount);

  const settlements: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > EPSILON) {
      settlements.push({
        fromMemberId: debtor.householdMemberId,
        toMemberId: creditor.householdMemberId,
        amount,
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount <= EPSILON) i++;
    if (creditor.amount <= EPSILON) j++;
  }

  return settlements;
}
