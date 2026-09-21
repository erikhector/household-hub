// Shared proportional-bar breakdown list — originally PeriodSummary's own
// (transaction totals by category), now also used by FixedBudgetSummary
// (recurring template totals by item) so both "how is this split up" views
// look and behave identically.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type CategoryTotal = { id: string; name: string; total: number };

export const CHART_COLORS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
] as const;

export function CategoryBreakdown({
  title,
  items,
  total,
  emptyMessage,
  numberFormat,
}: {
  title: string;
  items: CategoryTotal[];
  total: number;
  emptyMessage: string;
  numberFormat: Intl.NumberFormat;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item, index) => {
              const share = total > 0 ? (item.total / total) * 100 : 0;
              return (
                <div key={item.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {numberFormat.format(item.total)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${CHART_COLORS[index % CHART_COLORS.length]}`}
                      style={{ width: `${Math.max(share, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
