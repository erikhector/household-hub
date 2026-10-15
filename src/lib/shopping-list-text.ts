// GAP-53 — pure formatter for the "Copy as text" action in the shopping
// list's overflow menu (src/components/shopping/shopping-list-client.tsx).
// Plain text so it pastes into a message to someone with no account; nothing
// is shared through the app. Mirrors src/lib/recipe-text.ts (GAP-43).

import { formatCookQuantity } from "@/lib/cook-mode-calc";

export type ShoppingListTextGroup = {
  // null is the "Other" group (no category), same as ShoppingModeGroup.key.
  key: string | null;
  label: string;
  items: { name: string; quantity: number; unit: string; purchased?: boolean }[];
};

/**
 * The list's name, then what's still left to buy as `- 2 dl Milk` lines.
 * The caller passes the groups in the household's store order
 * (groupPendingItemsByCategory); a ticked (`purchased`) item is left out
 * here too, and a heading with nothing open under it with it, so the text
 * never lists what's already in the cart. When at least one group has a real category the lines
 * sit under their category headings (the same ones the screen shows, "Other"
 * included); when nothing has a category the headings would all say "Other",
 * so the list is flat. An item with no amount (quantity 0) is just its
 * name. Amounts use the Cook view's locale-aware rounding; `unitLabel` maps
 * a stored unit to its display label.
 */
export function formatShoppingListText(
  listName: string,
  groups: readonly ShoppingListTextGroup[],
  locale: string,
  unitLabel: (unit: string) => string = (unit) => unit,
): string {
  const line = (item: ShoppingListTextGroup["items"][number]) => {
    const amount =
      item.quantity > 0
        ? `${formatCookQuantity(item.quantity, 1, locale)}${item.unit ? ` ${unitLabel(item.unit)}` : ""} `
        : "";
    return `- ${amount}${item.name}`;
  };

  const open = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.purchased) }))
    .filter((group) => group.items.length > 0);
  const grouped = open.some((group) => group.key !== null);
  if (!grouped) {
    const lines = open.flatMap((group) => group.items.map(line));
    return lines.length > 0 ? `${listName}\n${lines.join("\n")}` : listName;
  }
  const sections = open.map((group) => `${group.label}\n${group.items.map(line).join("\n")}`);
  return [listName, ...sections].join("\n\n");
}
