import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { buildCsv, csvResponse } from "@/lib/csv";

// Personal Budget's counterpart to /dashboard/budget/export (F9 — Household
// Budget had a CSV export, Personal Budget didn't). Mirrors that route's
// shape/format as closely as makes sense for personal (non-shared) data:
// same [monthStart, monthEnd) current-calendar-month window, same column
// order, scoped by requireUserId() instead of requireHousehold() since a
// personal budget has no household to scope by. Deliberately exports only
// this user's own PersonalTransaction rows — never the read-only "shared
// with your household" mirror (sharedPostedRows in page.tsx), which isn't
// this user's own ledger entry and is already exportable from the household
// budget's own CSV export.
export async function GET() {
  const [userId, dict] = await Promise.all([requireUserId(), getDictionary()]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const transactions = await prisma.personalTransaction.findMany({
    where: { userId, date: { gte: monthStart, lt: monthEnd } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { category: true },
  });

  const t = dict.export.personalBudget;
  const csv = buildCsv(
    [
      t.headerDate,
      t.headerCategory,
      t.headerType,
      t.headerAmount,
      t.headerDescription,
      t.headerRecurring,
    ],
    transactions.map((tx) => [
      tx.date.toISOString().slice(0, 10),
      tx.category.name,
      tx.type === "INCOME"
        ? dict.personalBudget.type.income
        : tx.type === "SAVINGS"
          ? dict.personalBudget.type.savings
          : dict.personalBudget.type.expense,
      tx.amount,
      tx.description ?? "",
      tx.isRecurring ? dict.export.yes : dict.export.no,
    ]),
  );

  const month = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
  return csvResponse(csv, `${t.fileNamePrefix}-${month}.csv`);
}
