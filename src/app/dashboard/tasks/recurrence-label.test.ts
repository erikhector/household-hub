import { describe, expect, it } from "vitest";
import { RECURRENCE_OPTION_DAYS, recurrenceText } from "@/app/dashboard/tasks/recurrence-label";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";

const t = en.tasks;

describe("recurrenceText", () => {
  it("counts days for the short presets and any interval without a name", () => {
    expect(recurrenceText(1, t.recurrenceOption, t.recurrenceNamedOption)).toBe("Every day");
    expect(recurrenceText(7, t.recurrenceOption, t.recurrenceNamedOption)).toBe("Every 7 days");
    expect(recurrenceText(30, t.recurrenceOption, t.recurrenceNamedOption)).toBe("Every 30 days");
    expect(recurrenceText(45, t.recurrenceBadge, t.recurrenceNamedBadge)).toBe("Repeats every 45 days");
  });

  it("names the long presets and still says how many days they are", () => {
    expect(recurrenceText(14, t.recurrenceOption, t.recurrenceNamedOption)).toBe("Every 2 weeks");
    expect(recurrenceText(90, t.recurrenceOption, t.recurrenceNamedOption)).toBe("Every 3 months (90 days)");
    expect(recurrenceText(182, t.recurrenceBadge, t.recurrenceNamedBadge)).toBe("Repeats every 6 months (182 days)");
    expect(recurrenceText(365, t.recurrenceBadge, t.recurrenceNamedBadge)).toBe("Repeats every year (365 days)");
    expect(recurrenceText(365, sv.tasks.recurrenceOption, sv.tasks.recurrenceNamedOption)).toBe("Varje år (365 dagar)");
  });

  it("offers every preset up to a year, within the server's 366-day cap", () => {
    expect(RECURRENCE_OPTION_DAYS).toEqual([1, 2, 3, 7, 14, 30, 90, 182, 365]);
    expect(Math.max(...RECURRENCE_OPTION_DAYS)).toBeLessThanOrEqual(366);
  });
});
