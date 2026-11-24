import type { TaskItemUse } from "@/app/dashboard/tasks/task-item-use";
import { format, formatDecimal } from "@/lib/i18n/format";

/**
 * GAP-87: "Used 1 pcs Dishwasher tablets", the line the done toast gains once
 * the server says the tick took a pantry item off. Shared by the tasks page
 * and the overview's Today block, which tick the same way. The amount is
 * what was really used (less than asked when stock ran out), in the viewer's
 * decimal mark; `unitLabel` is useUnitLabel()'s, so "pcs" reads "st".
 */
export function usedToastText(
  template: string,
  used: TaskItemUse,
  locale: string,
  unitLabel: (unit: string, quantity?: number) => string,
): string {
  return format(template, {
    quantity: formatDecimal(used.quantity, locale, 6),
    unit: unitLabel(used.unit, used.quantity),
    name: used.itemName,
  });
}
