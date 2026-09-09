import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { buildCsv, csvResponse } from "@/lib/csv";

// Streams the active household's own inventory as a CSV download — see
// REQUIREMENTS.md's "Data export (CSV)" subsection. Household is always
// re-derived server-side via requireHousehold(), never from a query param.
export async function GET() {
  const [{ household }, dict] = await Promise.all([requireHousehold(), getDictionary()]);

  const [items, householdMembers] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { householdId: household.id },
      orderBy: { name: "asc" },
    }),
    prisma.householdMember.findMany({
      where: { householdId: household.id },
      include: { user: { select: { displayName: true } } },
    }),
  ]);
  const displayNameByUserId = new Map(householdMembers.map((m) => [m.userId, m.user.displayName]));

  const t = dict.export.inventory;
  const csv = buildCsv(
    [
      t.headerName,
      t.headerCategory,
      t.headerQuantity,
      t.headerUnit,
      t.headerLocation,
      t.headerLowStockThreshold,
      t.headerLastKnownPrice,
      t.headerLastUpdated,
      t.headerUpdatedBy,
    ],
    items.map((item) => [
      item.name,
      item.category,
      item.quantity,
      item.unit,
      item.location ?? "",
      item.lowStockThreshold,
      item.lastKnownPrice ?? "",
      item.updatedAt.toISOString().slice(0, 10),
      (item.updatedByUserId && displayNameByUserId.get(item.updatedByUserId)) || "",
    ]),
  );

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(csv, `${t.fileNamePrefix}-${date}.csv`);
}
