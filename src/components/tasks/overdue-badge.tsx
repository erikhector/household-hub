// UX-133: "Overdue · 5 days" on a late task, on the task list and the
// overview's Today block. Warning-tinted text with an icon, so lateness never
// rides on colour alone (DESIGN.md). The label's count is a plural pair.

import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function TaskOverdueBadge({ days, label }: { days: number; label: Dictionary["tasks"]["overdueLabel"] }) {
  return (
    <Badge variant="warning" className="shrink-0 gap-1">
      <AlertCircle className="size-3" aria-hidden />
      {format(plural(days, label), { count: days })}
    </Badge>
  );
}
