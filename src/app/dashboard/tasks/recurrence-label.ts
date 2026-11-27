// GAP-84: how a repeat interval reads, in the dialog's Repeat select and on
// a row's Repeat badge. The model counts days, never calendar months
// (recurrence.ts), so "every 3 months" would be a promise it can't keep:
// 90 days drifts off the date a few days a year. The long presets therefore
// carry a name *and* their day count ("Every year (365 days)"), and every
// other interval, including any older row's odd value, reads as plain days.

import { format, plural, type PluralForms } from "@/lib/i18n/format";

/** The dialog's Repeat choices, in days (the server accepts 1–366). */
export const RECURRENCE_OPTION_DAYS = [1, 2, 3, 7, 14, 30, 90, 182, 365] as const;

/** The dictionary key for each preset that has a name of its own. */
const NAMED_INTERVALS = {
  14: "twoWeeks",
  90: "threeMonths",
  182: "sixMonths",
  365: "year",
} as const satisfies Record<number, string>;

export type NamedRecurrenceLabels = Record<(typeof NAMED_INTERVALS)[keyof typeof NAMED_INTERVALS], string>;

/** The dictionary key of each weekday, indexed 0 Sunday … 6 Saturday (as `Date#getDay`). */
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The day picker's order: the week starts on Monday, as the meal plan's does. */
export const WEEKDAY_PICKER_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "Every year (365 days)" for a named preset, else the counted form ("Every 30 days"). */
export function recurrenceText(days: number, counted: PluralForms, named: NamedRecurrenceLabels): string {
  const key = (NAMED_INTERVALS as Record<number, keyof NamedRecurrenceLabels | undefined>)[days];
  return key ? named[key] : format(plural(days, counted), { count: days });
}
