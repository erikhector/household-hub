import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { buildCsv, csvResponse } from "@/lib/csv";

// Streams the active household's own inventory as a CSV download — see
// REQUIREMENTS.md's "Data export (CSV)" subsection. Household is always
// re-derived server-side via requireHousehold(), never from a query param.
export async function GET() {
  const [{ household }, dict] = await Promise.all([requireHousehold(), getDictionary()]);

  const items = await prisma.inventoryItem.findMany({
    where: { householdId: household.id },
    orderBy: { name: "asc" },
  });

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
    ],
    items.map((item) => [
      item.name,
      item.category,
      item.quantity,
      item.unit,
      item.location ?? "",
      item.lowStockThreshold,
      item.lastKnownPrice ?? "",
    ]),
  );

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(csv, `${t.fileNamePrefix}-${date}.csv`);
}
