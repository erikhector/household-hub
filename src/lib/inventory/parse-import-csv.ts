// Maps a raw CSV file (e.g. one round-tripped from this app's own inventory
// export, see src/app/dashboard/inventory/export/route.ts, or a spreadsheet a
// household put together by hand) into the same ParsedItem[] shape
// parse-pasted-list.ts produces, so both ingestion paths converge on the one
// review step/UI and bulkCreateInventoryItemsAction call in
// bulk-paste-dialog.tsx. Deliberately narrow: only `name` (required) plus
// `quantity`/`unit` (optional) are read here — `category`/`location` stay
// shared fields the household picks once for the whole batch in the review
// step, same as the paste flow, so a category/location column in an
// imported file (e.g. this app's own export) is simply ignored rather than
// read per-row.

import { parseCsv } from "@/lib/csv";
import type { ParsedItem } from "@/lib/inventory/parse-pasted-list";

export type ImportCsvError = "emptyFile" | "missingNameColumn";
// `ok` is the discriminant (a boolean literal in each branch, unlike
// `error`'s string type) so callers get real control-flow narrowing —
// `if (result.ok)` narrows to `items`, the `else` to `error` — instead of
// having to non-null-assert one field or the other.
export type ImportCsvResult = { ok: true; items: ParsedItem[] } | { ok: false; error: ImportCsvError };

// Header aliases are matched case-insensitively and with surrounding
// whitespace trimmed, so both a hand-typed "Name" and this app's own export
// header line up without the user having to rename columns.
const NAME_HEADERS = new Set(["name", "item name", "item"]);
const QUANTITY_HEADERS = new Set(["quantity", "qty"]);
const UNIT_HEADERS = new Set(["unit", "units"]);

function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase();
}

/** Parses raw CSV text (from an uploaded .csv file) into the rows the bulk
 * import review step expects. Returns `{ error }` — rather than throwing or
 * returning an empty/garbage list — when the file is empty, unparseable, or
 * missing a recognizable name column, so the UI has something concrete to
 * show the user instead of silently doing nothing. */
export function parseImportCsv(text: string): ImportCsvResult {
  const grid = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (grid.length === 0) {
    return { ok: false, error: "emptyFile" };
  }

  const [headerRow, ...dataRows] = grid;
  const headers = headerRow.map(normalizeHeader);
  const nameIndex = headers.findIndex((h) => NAME_HEADERS.has(h));
  if (nameIndex === -1) {
    return { ok: false, error: "missingNameColumn" };
  }
  const quantityIndex = headers.findIndex((h) => QUANTITY_HEADERS.has(h));
  const unitIndex = headers.findIndex((h) => UNIT_HEADERS.has(h));

  const items: ParsedItem[] = [];
  for (const row of dataRows) {
    const name = (row[nameIndex] ?? "").trim();
    if (!name) continue;

    const rawQuantity = quantityIndex !== -1 ? (row[quantityIndex] ?? "").trim() : "";
    const quantity = rawQuantity ? Number(rawQuantity.replace(",", ".")) : 1;

    const rawUnit = unitIndex !== -1 ? (row[unitIndex] ?? "").trim() : "";
    const unit = rawUnit || "pcs";

    items.push({
      name,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unit,
    });
  }

  if (items.length === 0) {
    return { ok: false, error: "emptyFile" };
  }

  return { ok: true, items };
}
