// Pure "who owes whom" aggregation/debt-simplification logic for household
// expense splitting — see REQUIREMENTS.md's "Household expense splitting"
// subsection under Budgeting. Kept dependency-free (no Prisma import), same
// pattern as src/lib/safe-to-spend-calc.ts, so it's unit-testable with plain
// fixtures. Callers: src/app/dashboard/budget/page.tsx (the Balances card and
// each bill's "left due") and src/lib/personal-budget-position.ts (a member's
// own debt, for Personal Budget and the dashboard).
//
// The model: every split transaction is a bill with a total `amount`. Each
// member included in it has a share (`amountOwed`) and has paid something
// towards the bill itself (`amountPaid`, possibly 0, possibly more than their
// share). Whatever nobody has paid yet is still owed *to the bill* (the
// landlord, the shop …), not to another member. On top of that,
// MemberSettlement rows record members paying each other back.

export type SplitShare = {
  householdMemberId: string;
  amountOwed: number;
  amountPaid: number;
};

export type SplitTransaction = {
  /** The bill's full amount. */
  amount: number;
  /** One entry per member included in the split, plus any member who paid
   * without owing a share (amountOwed 0). Shares should sum to `amount`
   * and payments to at most `amount` — the action layer enforces both, this
   * module just works with whatever it's given. */
  splits: SplitShare[];
};

/** A recorded repayment between two members (MemberSettlement). */
export type MemberTransfer = {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
};

export type Balance = { householdMemberId: string; netBalance: number };

/** A suggested transfer that would zero out the balances. */
export type Settlement = {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
};

// Amounts smaller than this are treated as zero — guards against floating
// point noise (e.g. an even split of 10 three ways) producing a phantom
// settlement of a fraction of a cent.
const EPSILON = 0.005;

/** How much of a bill nobody has paid yet. Never negative. */
export function remainingDue(tx: SplitTransaction): number {
  const paid = tx.splits.reduce((sum, s) => sum + s.amountPaid, 0);
  const remaining = tx.amount - paid;
  return remaining > EPSILON ? remaining : 0;
}

export type MemberBillPosition = {
  owed: number;
  paid: number;
  /** Positive: this bill left this member owed money by the others (they
   * paid more than their share). Negative: this member owes the others. */
  memberBalance: number;
  /** The part of this member's own share nobody has paid yet — owed to the
   * bill, not to another member. */
  owedToBill: number;
};

/**
 * Splits one bill into what each member owes the *other members* and what
 * is still owed *to the bill*.
 *
 * Every member who paid more than their share (`over`) is owed that much by
 * the others. Every member who paid less (`short`) still has that much of
 * their share outstanding. The shortfalls cover two things: the others'
 * overpayments and the bill's unpaid remainder. Each short member's
 * shortfall is split between the two in proportion — with two members (the
 * common case) that's exact: if I paid 4000 of a 6000 bill split 3000/3000,
 * my partner owes me 1000 and the bill 2000. With three or more it's a fair
 * approximation, since nothing records *whose* shortfall the overpayment was
 * meant to cover.
 */
export function computeBillPositions(tx: SplitTransaction): Map<string, MemberBillPosition> {
  let totalOver = 0;
  let totalShort = 0;
  for (const s of tx.splits) {
    const diff = s.amountPaid - s.amountOwed;
    if (diff > 0) totalOver += diff;
    else totalShort -= diff;
  }
  // Share of every shortfall that goes to members rather than the bill.
  // Clamped to 1: payments summing to more than the bill (which the actions
  // reject) must not invent debt out of nothing.
  const toMembersRatio = totalShort > EPSILON ? Math.min(1, totalOver / totalShort) : 0;
  // Overpayments are only owed back as far as the shortfalls can cover them.
  const overRatio = totalOver > EPSILON ? Math.min(1, totalShort / totalOver) : 0;

  const positions = new Map<string, MemberBillPosition>();
  for (const s of tx.splits) {
    const diff = s.amountPaid - s.amountOwed;
    const over = diff > 0 ? diff : 0;
    const short = diff < 0 ? -diff : 0;
    const existing = positions.get(s.householdMemberId);
    const position: MemberBillPosition = {
      owed: s.amountOwed,
      paid: s.amountPaid,
      memberBalance: over * overRatio - short * toMembersRatio,
      owedToBill: short * (1 - toMembersRatio),
    };
    if (existing) {
      // A member should only ever have one split row per transaction (a
      // unique constraint in the schema), but summing keeps this total
      // rather than silently dropping a row if that ever changes.
      existing.owed += position.owed;
      existing.paid += position.paid;
      existing.memberBalance += position.memberBalance;
      existing.owedToBill += position.owedToBill;
    } else {
      positions.set(s.householdMemberId, position);
    }
  }
  return positions;
}

/**
 * Nets every split transaction and recorded repayment down to one balance
 * per household member: positive means the other members owe them money
 * (net creditor), negative means they owe the other members (net debtor).
 * Money still owed to a bill is left out (see computeBillPositions) — it
 * isn't a debt to anyone in the household. A repayment raises the payer's
 * balance and lowers the receiver's, the same as paying part of a bill.
 */
export function computeNetBalances(
  transactions: SplitTransaction[],
  transfers: MemberTransfer[] = [],
): Balance[] {
  const balances = new Map<string, number>();
  const add = (memberId: string, delta: number) => {
    balances.set(memberId, (balances.get(memberId) ?? 0) + delta);
  };

  for (const tx of transactions) {
    for (const [memberId, position] of computeBillPositions(tx)) {
      add(memberId, position.memberBalance);
    }
  }
  for (const t of transfers) {
    add(t.fromMemberId, t.amount);
    add(t.toMemberId, -t.amount);
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

export type DatedSplitTransaction = SplitTransaction & { date: Date };
export type DatedMemberTransfer = MemberTransfer & { date: Date };

export type MemberPosition = {
  /** Same sign as Balance.netBalance: negative means this member owes the
   * other members, positive means they're owed. */
  memberBalance: number;
  /** This member's still-unpaid share of bills (never negative). */
  owedToBills: number;
};

/**
 * One member's position in one household, counting only bills and
 * repayments dated before `asOf` — how Personal Budget works out what was
 * still owed when a month started (see src/lib/personal-budget-position.ts).
 *
 * `amountPaid` itself isn't dated, so a bill's payments always count at
 * their current value; only the bill's own date and each repayment's date
 * decide whether they're in. Paying off an old bill's remainder therefore
 * shows up as if it had been paid on time.
 */
export function computeMemberPosition({
  memberId,
  transactions,
  transfers,
  asOf,
}: {
  memberId: string;
  transactions: DatedSplitTransaction[];
  transfers: DatedMemberTransfer[];
  asOf: Date;
}): MemberPosition {
  let memberBalance = 0;
  let owedToBills = 0;
  for (const tx of transactions) {
    if (tx.date >= asOf) continue;
    const position = computeBillPositions(tx).get(memberId);
    if (!position) continue;
    memberBalance += position.memberBalance;
    owedToBills += position.owedToBill;
  }
  for (const t of transfers) {
    if (t.date >= asOf) continue;
    if (t.fromMemberId === memberId) memberBalance += t.amount;
    if (t.toMemberId === memberId) memberBalance -= t.amount;
  }
  return {
    memberBalance: Math.abs(memberBalance) > EPSILON ? memberBalance : 0,
    owedToBills: owedToBills > EPSILON ? owedToBills : 0,
  };
}
