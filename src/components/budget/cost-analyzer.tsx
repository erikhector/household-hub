// Pure presentational — no client interactivity needed, so this renders
// straight from the Server Component that fetches/aggregates the data
// (src/app/dashboard/budget/page.tsx), same convention as PeriodSummary.
//
// Charting approach: no charting library is installed in this app. UX-39
// moved both charts here onto the shared kit in src/components/charts/
// (plain CSS bars and inline SVG, coloured with the `--chart-1..5` tokens so
// they theme with light/dark): the monthly totals are the tappable BarChart
// (a client island; this card stays a Server Component), and each item's
// price trend is a Sparkline.
//
// "Cheapest store" (GAP-6) is a third, much smaller section below the two
// charts — a plain one-line-per-item list rather than a chart, since the
// underlying data (which store had the cheapest last recorded price) isn't
// really a trend to visualize, just a fact worth surfacing once it exists.
// It's kept deliberately terse (no full per-store price breakdown) so it
// stays unobtrusive next to the two charts above it — see
// computeCheapestStoreComparisons (src/lib/cheapest-store-calc.ts) for the
// aggregation and its "≥2 distinct stores" bar for appearing here at all.
//
// "Your list, store by store" (GAP-34) sits right under it: the same
// last-recorded-price data summed over the household's unchecked list items
// per store (computeBasketStoreComparison). Every store row carries its
// "N of M items priced" coverage next to the total, and the "Cheapest"
// badge only goes to a fully priced store that beat at least one *other*
// fully priced store — a partial total is never crowned, since it may only
// look cheap because it's missing items.
//
// "Went past its date" (GAP-17) is the last section: a quiet monthly recap
// of food that expired unused, valued at what it cost last time. Same
// register as MealVarietyRecap — "here's what happened", never an alert
// (there's deliberately no notification for it). See
// src/lib/inventory/expired-waste.ts for which items count and why
// estimated dates are kept out of the headline figure.
//
// "On hand now" (GAP-33) sits just before it: the other side of the same
// coin — what's still in the cupboards, valued the same way (one last
// known price per item). It always says how many in-stock items that figure
// is built from ("based on N of M"), since a pantry where half the items
// have never been bought through a priced shopping line would otherwise
// read as worth half what it is. See src/lib/inventory/stock-value.ts.

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BasketComparison, StoreComparison } from "@/lib/cheapest-store-calc";
import type { ExpiredWasteSummary } from "@/lib/inventory/expired-waste";
import type { StockValueSummary } from "@/lib/inventory/stock-value";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { BarChart } from "@/components/charts/bar-chart";
import { Sparkline } from "@/components/charts/sparkline";

export type MonthlySpendPoint = { month: string; total: number };
export type PricePoint = { date: Date; price: number };
export type ItemPriceTrend = {
  id: string;
  name: string;
  points: PricePoint[];
  changePercent: number;
};
export type { StoreComparison };

export function CostAnalyzer({
  monthlySpending,
  itemTrends,
  storeComparisons,
  basketComparison,
  expiredThisMonth,
  expiredLastMonth,
  stockValue,
  dict,
  locale,
  currencyCode,
}: {
  monthlySpending: MonthlySpendPoint[];
  itemTrends: ItemPriceTrend[];
  storeComparisons: StoreComparison[];
  basketComparison: BasketComparison | null;
  expiredThisMonth: ExpiredWasteSummary;
  expiredLastMonth: ExpiredWasteSummary;
  stockValue: StockValueSummary;
  dict: Dictionary["budget"]["costAnalyzer"];
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" });
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  // UX-15: "+12,5 %" in sv, "+12.5%" in en — the locale decides the decimal
  // mark and the space before the sign, and signDisplay adds the "+".
  const percentFormat = new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  });

  // UX-114: a card with nothing to show doesn't get a box of its own. On a
  // household that hasn't scanned a receipt yet that was five or six cards of
  // "No ... yet" pushing Balances off the bottom of a phone. They're left out
  // and one quiet line below stands in for all of them; each card comes back
  // by itself as soon as it has data. "On hand now" with stock but no known
  // price still shows, since it says something true ("none has a price").
  const hasSpending = monthlySpending.length > 0;
  const hasTrends = itemTrends.length > 0;
  const hasCheapestStore = storeComparisons.length > 0;
  const hasStock = stockValue.inStockCount > 0;
  const hasExpired = expiredThisMonth.items.length > 0 || expiredLastMonth.items.length > 0;
  const anyEmpty = !(
    hasSpending &&
    hasTrends &&
    hasCheapestStore &&
    basketComparison &&
    hasStock &&
    hasExpired
  );

  return (
    <div className="flex flex-col gap-6">
      {hasSpending && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.spendingTitle}</CardTitle>
            <CardDescription>{dict.spendingSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
              <BarChart
                caption={dict.spendingTitle}
                groupHeader={dict.chartMonth}
                series={[{ key: "spend", label: dict.chartSpend }]}
                groups={monthlySpending.map((point) => ({
                  key: point.month,
                  label: monthFormat.format(new Date(`${point.month}-01T00:00:00`)),
                  values: [point.total],
                }))}
                locale={locale}
                currencyCode={currencyCode}
              />
          </CardContent>
        </Card>
      )}

      {hasTrends && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.trendsTitle}</CardTitle>
            <CardDescription>{dict.trendsSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {itemTrends.map((item) => (
                  <ItemTrendCard
                    key={item.id}
                    item={item}
                    dict={dict}
                    numberFormat={numberFormat}
                    dateFormat={dateFormat}
                    percentFormat={percentFormat}
                  />
                ))}
              </div>
          </CardContent>
        </Card>
      )}

      {hasCheapestStore && (
        <Card>
          <CardHeader>
            <CardTitle>{dict.cheapestStoreTitle}</CardTitle>
            <CardDescription>{dict.cheapestStoreSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
              <div className="flex flex-col divide-y divide-border">
                {storeComparisons.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {format(dict.cheapestStoreLabel, { store: c.cheapestStore })}{" "}
                      <span className="tabular-nums text-success">
                        {numberFormat.format(c.cheapestPrice)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
          </CardContent>
        </Card>
      )}

      {basketComparison && (
        <BasketComparisonCard
          comparison={basketComparison}
          dict={dict}
          numberFormat={numberFormat}
        />
      )}

      {hasStock && (
        <StockValueCard stockValue={stockValue} dict={dict} numberFormat={numberFormat} />
      )}

      {hasExpired && (
        <ExpiredWasteCard
          thisMonth={expiredThisMonth}
          lastMonth={expiredLastMonth}
          dict={dict}
          numberFormat={numberFormat}
          dateFormat={dateFormat}
        />
      )}

      {anyEmpty && <p className="text-sm text-muted-foreground">{dict.emptyCollapsed}</p>}
    </div>
  );
}

function StockValueCard({
  stockValue,
  dict,
  numberFormat,
}: {
  stockValue: StockValueSummary;
  dict: Dictionary["budget"]["costAnalyzer"];
  numberFormat: Intl.NumberFormat;
}) {
  const { value, pricedCount, inStockCount } = stockValue;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.stockValueTitle}</CardTitle>
        <CardDescription>{dict.stockValueSubtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {pricedCount === 0 ? (
          // "≈ 0 kr" here would read as "your pantry is worth nothing"
          // rather than "we don't know yet".
          <p className="text-sm text-muted-foreground">
            {format(plural(inStockCount, dict.stockValueNoPrices), { count: inStockCount })}
          </p>
        ) : (
          <>
            <p className="text-2xl font-semibold tabular-nums">≈ {numberFormat.format(value)}</p>
            <p className="text-xs text-muted-foreground">
              {format(plural(inStockCount, dict.stockValueBasis), {
                priced: pricedCount,
                count: inStockCount,
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BasketComparisonCard({
  comparison,
  dict,
  numberFormat,
}: {
  comparison: BasketComparison;
  dict: Dictionary["budget"]["costAnalyzer"];
  numberFormat: Intl.NumberFormat;
}) {
  const { itemCount, stores } = comparison;
  const fullyPriced = stores.filter((s) => s.pricedCount === itemCount);
  // Stores are ranked coverage-first, so if anything is fully priced it's
  // at the top — and only then, against another fully priced store, is
  // "cheapest" an honest claim about the whole list.
  const showCheapestBadge = fullyPriced.length >= 2;
  const hasPartial = fullyPriced.length < stores.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.basketTitle}</CardTitle>
        <CardDescription>{dict.basketSubtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col divide-y divide-border">
          {stores.map((s, i) => {
            const complete = s.pricedCount === itemCount;
            return (
              <div key={s.store} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-medium">{s.store}</span>
                  {showCheapestBadge && i === 0 && (
                    <Badge variant="outline" className="shrink-0">
                      {dict.basketCheapestBadge}
                    </Badge>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {complete
                    ? format(dict.basketAllPriced, { total: itemCount })
                    : format(dict.basketCoverage, { count: s.pricedCount, total: itemCount })}
                  {" · "}
                  <span
                    className={`tabular-nums ${
                      showCheapestBadge && i === 0 ? "text-success" : "text-foreground"
                    }`}
                  >
                    {numberFormat.format(s.total)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        {hasPartial && <p className="text-xs text-muted-foreground">{dict.basketPartialNote}</p>}
      </CardContent>
    </Card>
  );
}

// How many items the recap names before collapsing the rest into "+N more"
// — enough to recognize what went off, short enough to stay a recap.
const MAX_EXPIRED_ITEMS_SHOWN = 5;

function ExpiredWasteCard({
  thisMonth,
  lastMonth,
  dict,
  numberFormat,
  dateFormat,
}: {
  thisMonth: ExpiredWasteSummary;
  lastMonth: ExpiredWasteSummary;
  dict: Dictionary["budget"]["costAnalyzer"];
  numberFormat: Intl.NumberFormat;
  dateFormat: Intl.DateTimeFormat;
}) {
  const shown = thisMonth.items.slice(0, MAX_EXPIRED_ITEMS_SHOWN);
  const hiddenCount = thisMonth.items.length - shown.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.expiredTitle}</CardTitle>
        <CardDescription>{dict.expiredSubtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {thisMonth.items.length === 0 ? (
          // Only last month had items (the card is hidden when both are
          // empty), so say this month is clear rather than leaving the
          // "last month" line to read as the whole story.
          <p className="text-sm text-muted-foreground">{dict.noExpiredData}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-sm">
                {format(plural(thisMonth.items.length, dict.expiredCount), {
                  count: thisMonth.items.length,
                })}
                {thisMonth.confirmedValue > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium tabular-nums">
                      ≈ {numberFormat.format(thisMonth.confirmedValue)}
                    </span>
                  </>
                )}
              </p>
              {thisMonth.estimatedValue > 0 && (
                <p className="text-xs text-muted-foreground">
                  {format(dict.expiredEstimatedValue, {
                    amount: numberFormat.format(thisMonth.estimatedValue),
                  })}
                </p>
              )}
              {thisMonth.unpricedCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {format(plural(thisMonth.unpricedCount, dict.expiredUnpriced), {
                    count: thisMonth.unpricedCount,
                  })}
                </p>
              )}
            </div>
            <div className="flex flex-col divide-y divide-border">
              {shown.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate font-medium">{item.name}</span>
                    {item.estimated && (
                      <Badge variant="outline" className="shrink-0">
                        {dict.expiredEstimatedBadge}
                      </Badge>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {dateFormat.format(item.expiresAt)}
                    {item.value != null && (
                      <>
                        {" · "}
                        <span className="tabular-nums text-foreground">
                          {numberFormat.format(item.value)}
                        </span>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {hiddenCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {format(dict.expiredMore, { count: hiddenCount })}
              </p>
            )}
          </>
        )}
        {lastMonth.items.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {format(plural(lastMonth.items.length, dict.expiredLastMonth), {
              count: lastMonth.items.length,
            })}
            {lastMonth.confirmedValue > 0 && ` · ≈ ${numberFormat.format(lastMonth.confirmedValue)}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ItemTrendCard({
  item,
  dict,
  numberFormat,
  dateFormat,
  percentFormat,
}: {
  item: ItemPriceTrend;
  dict: Dictionary["budget"]["costAnalyzer"];
  numberFormat: Intl.NumberFormat;
  dateFormat: Intl.DateTimeFormat;
  percentFormat: Intl.NumberFormat;
}) {
  const latest = item.points[item.points.length - 1];
  const changeColor =
    item.changePercent > 0
      ? "text-destructive"
      : item.changePercent < 0
        ? "text-success"
        : "text-muted-foreground";

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{item.name}</span>
        <span className={`shrink-0 text-xs font-medium tabular-nums ${changeColor}`}>
          {percentFormat.format(item.changePercent / 100)}
        </span>
      </div>
      <Sparkline
        points={item.points.map((p) => p.price)}
        label={item.points
          .map((p) => `${dateFormat.format(p.date)} ${numberFormat.format(p.price)}`)
          .join(", ")}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {dict.latestPrice} · {dateFormat.format(latest.date)}
        </span>
        <span className="tabular-nums text-foreground">{numberFormat.format(latest.price)}</span>
      </div>
    </div>
  );
}
