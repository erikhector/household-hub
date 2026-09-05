// Pure presentational — no client interactivity needed, so this renders
// straight from the Server Component that fetches/aggregates the data
// (src/app/dashboard/budget/page.tsx), same convention as PeriodSummary.
//
// Charting approach: no charting library is installed in this app (checked
// package.json before writing this — no recharts/chart.js/etc.), so both
// charts here are hand-rolled: the monthly totals use plain CSS bars (same
// technique PeriodSummary's category-share bars already use), and the
// per-item price trend uses a small inline SVG polyline. Both are styled
// exclusively with the existing `--chart-1..5` tokens via Tailwind's
// auto-generated `bg-chart-*`/`stroke-chart-*`/`fill-chart-*` utilities, so
// they theme automatically in light/dark.

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dictionary, Locale } from "@/lib/i18n/get-dictionary";

export type MonthlySpendPoint = { month: string; total: number };
export type PricePoint = { date: Date; price: number };
export type ItemPriceTrend = {
  id: string;
  name: string;
  points: PricePoint[];
  changePercent: number;
};

export function CostAnalyzer({
  monthlySpending,
  itemTrends,
  dict,
  locale,
}: {
  monthlySpending: MonthlySpendPoint[];
  itemTrends: ItemPriceTrend[];
  dict: Dictionary["budget"]["costAnalyzer"];
  locale: Locale;
}) {
  const numberFormat = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" });
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });

  const maxMonthlyTotal = Math.max(0, ...monthlySpending.map((m) => m.total));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{dict.spendingTitle}</CardTitle>
          <CardDescription>{dict.spendingSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          {monthlySpending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{dict.noSpendingData}</p>
          ) : (
            <div className="flex h-52 items-end gap-2 overflow-x-auto">
              {monthlySpending.map((point) => {
                const heightPct =
                  maxMonthlyTotal > 0 ? Math.max((point.total / maxMonthlyTotal) * 100, 3) : 3;
                const label = monthFormat.format(new Date(`${point.month}-01T00:00:00`));
                return (
                  <div
                    key={point.month}
                    className="flex min-w-12 flex-1 flex-col items-center gap-2"
                  >
                    <div className="flex h-36 w-full items-end justify-center">
                      <div
                        className="w-full max-w-10 rounded-t-md bg-chart-1"
                        style={{ height: `${heightPct}%` }}
                        title={numberFormat.format(point.total)}
                      />
                    </div>
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                      {numberFormat.format(point.total)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{dict.trendsTitle}</CardTitle>
          <CardDescription>{dict.trendsSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          {itemTrends.length === 0 ? (
            <p className="text-sm text-muted-foreground">{dict.noTrendData}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {itemTrends.map((item) => (
                <ItemTrendCard
                  key={item.id}
                  item={item}
                  dict={dict}
                  numberFormat={numberFormat}
                  dateFormat={dateFormat}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ItemTrendCard({
  item,
  dict,
  numberFormat,
  dateFormat,
}: {
  item: ItemPriceTrend;
  dict: Dictionary["budget"]["costAnalyzer"];
  numberFormat: Intl.NumberFormat;
  dateFormat: Intl.DateTimeFormat;
}) {
  const latest = item.points[item.points.length - 1];
  const changeColor =
    item.changePercent > 0
      ? "text-destructive"
      : item.changePercent < 0
        ? "text-chart-5"
        : "text-muted-foreground";
  const changeSign = item.changePercent > 0 ? "+" : "";

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{item.name}</span>
        <span className={`shrink-0 text-xs font-medium tabular-nums ${changeColor}`}>
          {changeSign}
          {item.changePercent.toFixed(1)}%
        </span>
      </div>
      <Sparkline points={item.points.map((p) => p.price)} />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {dict.latestPrice} · {dateFormat.format(latest.date)}
        </span>
        <span className="tabular-nums text-foreground">{numberFormat.format(latest.price)}</span>
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const width = 200;
  const height = 48;
  const pad = 4;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((price, i) => ({
    x: pad + i * stepX,
    y: height - pad - ((price - min) / range) * (height - pad * 2),
  }));
  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-12 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={polylinePoints}
        fill="none"
        className="stroke-chart-4"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="2.5" className="fill-chart-4" />
      ))}
    </svg>
  );
}
