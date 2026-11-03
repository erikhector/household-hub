import { randomUUID } from "node:crypto";

/**
 * UX-179: what a new transaction's "Repeats" switch turns into — a monthly
 * recurring item (Bills & income). Shared by the household and Personal
 * Budget create actions so both name and date it the same way.
 *
 * `id` is chosen here rather than by the database so the same database
 * transaction can create the item and the row that logs it (the row needs
 * the item's id). The name is the transaction's description, falling back to
 * its category's name, and is cut to the 120 characters a recurring item's
 * name allows. `dayOfMonth` is the display-only "due on the Nth" hint, read
 * from the `YYYY-MM-DD` date the form sends (never shifted by a time zone).
 */
export function repeatTemplateFields(input: {
  description: string | undefined;
  categoryName: string;
  date: string;
}): { id: string; name: string; dayOfMonth: number | null } {
  const name = (input.description?.trim() || input.categoryName).slice(0, 120);
  const day = Number(/^\d{4}-\d{2}-(\d{2})/.exec(input.date)?.[1]);
  return {
    id: randomUUID(),
    name,
    dayOfMonth: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
  };
}
