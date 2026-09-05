import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { buildCsv, csvResponse } from "@/lib/csv";

// Streams the active household's current-month transactions as a CSV
// download — see REQUIREMENTS.md's "Data export (CSV)" subsection. Reuses
// the same [monthStart, monthEnd) window the budget page's PeriodSummary
// already computes, rather than exporting every transaction ever recorded.
export async function GET() {
  const [{ household }, dict] = await Promise.all([requireHousehold(), getDictionary()]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const transactions = await prisma.transaction.findMany({
    where: { householdId: household.id, date: { gte: monthStart, lt: monthEnd } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { category: true },
  });

  const t = dict.export.budget;
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
      tx.type === "INCOME" ? dict.budget.type.income : dict.budget.type.expense,
      tx.amount,
      tx.description ?? "",
      tx.isRecurring ? dict.export.yes : dict.export.no,
    ]),
  );

  const month = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
  return csvResponse(csv, `${t.fileNamePrefix}-${month}.csv`);
}
