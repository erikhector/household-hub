import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { unitLabel } from "@/lib/units";
import type { RecentPrice } from "@/lib/inventory/recent-prices";

// GAP-47: "Recent prices" on the item page — the last purchases from
// PriceHistory, newest first. An item with no history renders nothing at all
// (no heading, no empty chart): prices appear once the household has bought
// the item with a price. A plain list rather than a table so a phone gets
// one wrapped line per purchase and no horizontal scroll.
export function ItemRecentPrices({
  prices,
  money,
  locale,
  unitLabels,
  dict,
}: {
  prices: RecentPrice[];
  money: Intl.NumberFormat;
  locale: string;
  unitLabels: Readonly<Record<string, string>>;
  dict: Dictionary["inventory"]["itemPage"];
}) {
  if (prices.length === 0) return null;
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  return (
    <section aria-labelledby="recent-prices" className="flex flex-col gap-2">
      <h2 id="recent-prices" className="font-heading text-lg font-semibold">
        {dict.recentPricesTitle}
      </h2>
      <ul className="flex flex-col divide-y rounded-lg border text-sm">
        {prices.map((price) => (
          <li key={price.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
            <span className="min-w-0">
              <span>{dateFormat.format(price.date)}</span>
              {price.store && <span className="text-muted-foreground"> · {price.store}</span>}
            </span>
            <span className="text-right">
              <span className="font-medium">{money.format(price.price)}</span>
              {price.unitPrice !== null && price.unit && (
                <span className="text-muted-foreground">
                  {" · "}
                  {format(dict.recentPricePerUnit, {
                    price: money.format(price.unitPrice),
                    unit: unitLabel(price.unit, unitLabels),
                  })}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
