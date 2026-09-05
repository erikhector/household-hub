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
  const csv = buildCsv(
    [t.headerName, t.headerQuantity, t.headerEstimatedPrice, t.headerPurchased],
    list.items.map((item) => [
      item.name,
      item.quantity,
      item.estimatedPrice ?? "",
      item.purchased ? dict.export.yes : dict.export.no,
    ]),
  );

  const slug = list.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const filename = `${t.fileNamePrefix}${slug ? `-${slug}` : ""}.csv`;
  return csvResponse(csv, filename);
}
