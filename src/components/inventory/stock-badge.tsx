"use client";

import { Badge } from "@/components/ui/badge";
import type { StockStatus } from "@/lib/stock-status";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function StockBadge({ status, dict }: { status: StockStatus; dict: Pick<Dictionary["inventory"], "statusOut" | "statusLow" | "statusIn"> }) {
  if (status === "out") return <Badge variant="destructive">{dict.statusOut}</Badge>;
  if (status === "low") return <Badge variant="warning">{dict.statusLow}</Badge>;
  return <Badge variant="secondary">{dict.statusIn}</Badge>;
}
