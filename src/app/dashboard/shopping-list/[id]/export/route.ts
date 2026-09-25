import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { buildCsv, csvResponse } from "@/lib/csv";

// Streams one shopping list's items as a CSV download, scoped to the active
// household — see REQUIREMENTS.md's "Data export (CSV)" subsection. The list
// is re-looked-up scoped by householdId (never trusting the [id] param alone)
// the same way the list detail page does.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ household }, dict, { id }] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    params,
  ]);

  const list = await prisma.shoppingList.findFirst({
    where: { id, householdId: household.id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!list) notFound();

  const t = dict.export.shoppingList;
  // GAP-5's note goes last rather than next to the name, so a spreadsheet
  // or script built against the older five-column export keeps reading the
  // same columns — and parseImportCsv matches columns by header, so an
  // exported file still re-imports cleanly (the note is simply ignored).
  const csv = buildCsv(
    [t.headerName, t.headerQuantity, t.headerUnit, t.headerEstimatedPrice, t.headerPurchased, t.headerNote],
    list.items.map((item) => [
      item.name,
      item.quantity,
      item.unit,
      item.estimatedPrice ?? "",
      item.purchased ? dict.export.yes : dict.export.no,
      item.note ?? "",
    ]),
  );

  const slug = list.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const filename = `${t.fileNamePrefix}${slug ? `-${slug}` : ""}.csv`;
  return csvResponse(csv, filename);
}
