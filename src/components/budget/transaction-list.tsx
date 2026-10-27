"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ExternalLink, Pencil, Repeat, Trash2, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SearchInput } from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TransactionDialog,
  type MemberOption,
  type TransactionFormAction,
  type TransactionRow,
} from "@/components/budget/transaction-dialog";
import { format } from "@/lib/i18n/format";
import { remainingDue } from "@/lib/settle-up-calc";
import type { ActionState } from "@/lib/actions/auth";
import type { BudgetDict } from "@/components/budget/budget-dict";
import type { CategoryRow } from "@/components/budget/category-manager";
import type { Locale } from "@/lib/i18n/get-dictionary";
import { createMoneyFormat } from "@/lib/currency";
import { SwipeRow } from "@/components/shared/swipe-row";
import { startUndoableDelete } from "@/components/shared/start-undoable-delete";
import { settleOptimisticAction } from "@/components/shared/settle-optimistic-action";
import { dayHeading, groupByDay, localDateKey } from "@/lib/budget-transaction-days";
import { resolveCategoryFilter } from "@/lib/budget-url";
import { normalizeSearchTerm, transactionMatchesSearch } from "@/lib/budget-transaction-search";

export type TransactionListRow = TransactionRow & {
  categoryName: string;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
};

// This user's own share of a posted split household Transaction (see
// docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md) — merged straight into the
// normal transaction list, badged "Shared", rather than shown in a separate
// section. Read-only here: a "View in {household} Budget" link is the only
// control, since the household budget stays the one place these get logged,
// edited, or deleted. Only ever non-empty for the personal budget page
// (BUDGET-2) — the household budget page always passes `[]`, since a
// household's own transactions have no "shared with itself" concept.
export type SharedPostedRow = {
  id: string;
  categoryName: string;
  /** This user's own share (TransactionSplit.amountOwed) — never the
   * transaction's full amount. */
  amount: number;
  type: "INCOME" | "EXPENSE" | "SAVINGS";
  date: Date;
  /** The household this shared row actually belongs to — used to target the
   * "View in {household} Budget" link explicitly (F1), never left to
   * whichever household happens to be "active" elsewhere in the app, which
   * can silently differ when the user belongs to more than one. */
  householdId: string;
  householdName: string;
  /** Every member who has paid anything towards the bill — a bill can be
   * paid partly by several members (TransactionSplit.amountPaid). */
  paidByNames: string[];
  /** What this user has paid towards the bill themselves. */
  yourPaid: number;
  /** What nobody has paid on the whole bill yet (settle-up-calc.ts's
   * remainingDue) — 0 once it's fully paid. */
  leftDue: number;
};

type Kind = "INCOME" | "EXPENSE" | "SAVINGS";

// What the list sorts, groups by day and renders: date/amount/type at the
// top so groupByDay can read them, whichever kind of row it is.
type Row = ({ kind: "own"; row: TransactionListRow } | { kind: "shared"; row: SharedPostedRow }) & {
  date: Date;
  amount: number;
  type: Kind;
};

// Phone pass (Oct 2026), DESIGN.md Colour: `destructive` is for errors and
// over budget, and chart colours are for marks, not text — every expense
// used to be red and every saving chart-2. Money in is `success` with a
// plus; money out is plain `foreground` with a minus (a real U+2212, which
// screen readers say as "minus"); a saving keeps its arrow, money moved
// rather than spent.
function amountColor(type: Kind) {
  return type === "INCOME" ? "text-success" : "text-foreground";
}

function amountSign(type: Kind) {
  if (type === "INCOME") return "+";
  if (type === "SAVINGS") return "→";
  return "\u2212";
}

// The category filter's "All categories" value (Base UI's Select needs a
// string; no category id looks like this).
const ALL_CATEGORIES = "__all__";

// Never subscribes: the day only matters at render, see TransactionList.
const subscribeNever = () => () => {};

const frequencyLabelKey = {
  WEEKLY: "frequencyWeekly",
  MONTHLY: "frequencyMonthly",
  YEARLY: "frequencyYearly",
} as const satisfies Record<NonNullable<TransactionRow["recurrenceFrequency"]>, keyof BudgetDict>;

export function TransactionList({
  transactions,
  sharedRows = [],
  showHouseholdName = false,
  categories,
  members,
  currentMemberId,
  monthKey,
  todayKey,
  dict,
  locale,
  currencyCode,
  onDelete,
  createAction,
  updateAction,
  readOnly = false,
}: {
  transactions: TransactionListRow[];
  /** This user's own share of posted split household transactions this
   * month (see SharedPostedRow's doc comment) — merged into the list below,
   * badged "Shared". Always `[]` on the household budget page. */
  sharedRows?: SharedPostedRow[];
  /** Only show which household a shared row belongs to once the user is in
   * more than one — see docs/archive/PERSONAL_HOUSEHOLD_BUDGET_LINK.md §6.
   * Meaningless (and always `false`) whenever sharedRows is empty. */
  showHouseholdName?: boolean;
  categories: CategoryRow[];
  members: MemberOption[];
  currentMemberId: string;
  /** "YYYY-MM" — reused for a shared row's "View in {household} Budget"
   * link, required whenever sharedRows is non-empty. Also threaded into the
   * edit TransactionDialog below (F11). */
  monthKey?: string;
  /** The server's "YYYY-MM-DD" for today (localDateKey), for the "Today"
   * day header on the first render — see `today` below. */
  todayKey: string;
  dict: BudgetDict;
  locale: Locale;
  // GAP-13: the household's display currency; null keeps plain numbers.
  currencyCode?: string | null;
  /** deleteTransactionAction (household) or deletePersonalTransactionAction
   * (personal) — injected the same way TransactionDialog's createAction/
   * updateAction are (BUDGET-2). */
  onDelete: (id: string) => Promise<ActionState>;
  createAction: TransactionFormAction;
  updateAction: TransactionFormAction;
  /** The household budget is showing another household (`?household=`):
   * BudgetTabs' disabled fieldset already turns off every button, but a
   * swipe isn't a button, so the rows need telling to stay put. */
  readOnly?: boolean;
}) {
  const numberFormat = createMoneyFormat(locale, currencyCode);
  // No year: the month is the one picked right above the list.
  const dateFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  // "Today" is the viewer's own day, but the server can't know it (its clock
  // and time zone aren't the viewer's). It renders with the server's day
  // and hydrates with that same value (getServerSnapshot), then React
  // re-renders with the browser's — no hydration mismatch at midnight.
  const today = useSyncExternalStore(subscribeNever, () => localDateKey(new Date()), () => todayKey);
  const memberName = (id: string) => members.find((m) => m.id === id)?.displayName ?? "?";

  // Phone pass (Oct 2026), P3: `?category=` narrows the list to one
  // category — set by the select below or by a category row on Insights.
  // Only honoured when it names one of `categories` (this household's, or
  // this user's, as loaded by the server; see resolveCategoryFilter). The
  // select writes the URL with replaceState like the tab bar does, so
  // nothing refetches; "Clear filter" is a link so it also works in the
  // read-only household view, where the select is disabled with every
  // other control.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const categoryFilter = resolveCategoryFilter(searchParams.get("category"), categories);
  const filteredCategory = categories.find((c) => c.id === categoryFilter);
  function setCategoryFilter(next: string) {
    const url = new URL(window.location.href);
    if (next === ALL_CATEGORIES) url.searchParams.delete("category");
    else url.searchParams.set("category", next);
    window.history.replaceState(null, "", url);
  }
  // GAP-63: `?q=` is the search box's text. The input keeps its own state so
  // typing never waits on the URL; the URL is written with replaceState on
  // every change (so a reload or the back gesture keeps the term, and
  // MonthNavigator carries it when paging months) and only read here once,
  // for the first render.
  const [query, setQueryState] = useState(() => searchParams.get("q") ?? "");
  function setQuery(next: string) {
    setQueryState(next);
    const url = new URL(window.location.href);
    if (normalizeSearchTerm(next)) url.searchParams.set("q", next);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }
  const searchTerm = normalizeSearchTerm(query);
  const clearParams = new URLSearchParams(searchParams.toString());
  clearParams.delete("category");
  const clearHref = clearParams.size > 0 ? `${pathname}?${clearParams}` : pathname;

  // Who paid a split bill, for the "Split" badge's tooltip — several members
  // can each have paid part of it (TransactionSplit.amountPaid).
  function splitBadgeTitle(row: TransactionListRow) {
    const payers = row.splits.filter((s) => (s.amountPaid ?? 0) > 0);
    if (payers.length === 0) return undefined;
    return format(dict.split?.paidByBadge ?? "", {
      name: payers
        .map((s) => `${memberName(s.householdMemberId)} (${numberFormat.format(s.amountPaid ?? 0)})`)
        .join(", "),
    });
  }

  function splitLeftDue(row: TransactionListRow) {
    if (row.splits.length === 0) return 0;
    return remainingDue({
      amount: row.amount,
      splits: row.splits.map((s) => ({ ...s, amountPaid: s.amountPaid ?? 0 })),
    });
  }

  function sharedRowDetail(row: SharedPostedRow) {
    const parts = [
      row.paidByNames.length > 0
        ? format(dict.shared?.paidBy ?? "", { name: row.paidByNames.join(", ") })
        : "—",
    ];
    if (row.leftDue > 0) {
      parts.push(format(dict.shared?.leftDue ?? "", { amount: numberFormat.format(row.leftDue) }));
    }
    return parts.join(" · ");
  }

  // The recurring/split/left-due badges, shared by the table and the phone
  // rows.
  function ownBadges(row: TransactionListRow) {
    const leftDue = splitLeftDue(row);
    return (
      <>
        {row.isRecurring && row.recurrenceFrequency && (
          <Badge variant="secondary" className="gap-1">
            <Repeat className="size-3" />
            {dict[frequencyLabelKey[row.recurrenceFrequency]]}
          </Badge>
        )}
        {row.splits.length > 0 && (
          <Badge variant="secondary" className="gap-1" title={splitBadgeTitle(row)}>
            <Users className="size-3" />
            {dict.split?.splitBadge}
          </Badge>
        )}
        {leftDue > 0 && (
          <Badge variant="outline" className="border-warning/40 text-warning tabular-nums">
            {format(dict.split?.leftDue ?? "", { amount: numberFormat.format(leftDue) })}
          </Badge>
        )}
      </>
    );
  }

  function amount(type: Kind, value: number) {
    return (
      <>
        {amountSign(type)}
        {numberFormat.format(value)}
      </>
    );
  }

  function householdLink(row: SharedPostedRow, className: string) {
    const label = format(dict.shared?.viewInHouseholdBudget ?? "", { household: row.householdName });
    return (
      <Link
        href={`/dashboard/budget?month=${monthKey}&household=${row.householdId}`}
        className={className}
        title={label}
        aria-label={label}
      >
        <ExternalLink className="size-4" />
      </Link>
    );
  }

  // UX-49: every delete (the table's trash, the edit sheet's Delete, the
  // phone row's swipe) hides the row at once and offers Undo; the delete
  // goes out when the toast closes. The ids stay in the set once saved: the
  // refreshed list no longer has them.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  function removeTransaction(row: TransactionListRow) {
    const setRemoved = (removed: boolean) =>
      setRemovedIds((current) => {
        const next = new Set(current);
        if (removed) next.add(row.id);
        else next.delete(row.id);
        return next;
      });
    setRemoved(true);
    startUndoableDelete({
      run: async () => (await settleOptimisticAction(() => onDelete(row.id), dict.saveFailedToast)) !== null,
      restore: () => setRemoved(false),
      // The description is what the user typed to tell rows apart ("ICA",
      // "Netflix"); without one the category is the best name the row has.
      message: format(dict.swipe.deletedToast, { name: row.description || row.categoryName }),
      undoLabel: dict.swipe.undo,
    });
  }

  // sharedRows is always [] on the household budget page, so this sort is a
  // no-op there (a stable sort over an already date-desc-ordered array keeps
  // same-day ties in their original, createdAt-desc order) — see
  // SharedPostedRow's doc comment.
  const allRows: Row[] = [
    ...transactions.filter((row) => !removedIds.has(row.id)).map((row): Row => ({ kind: "own", row, date: row.date, amount: row.amount, type: row.type })),
    ...sharedRows.map((row): Row => ({ kind: "shared", row, date: row.date, amount: row.amount, type: row.type })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
  // A shared row is a household category, never one of the viewer's own,
  // so a filter always leaves it out.
  const inCategory = categoryFilter
    ? allRows.filter((item) => item.kind === "own" && item.row.categoryId === categoryFilter)
    : allRows;
  // The search narrows what the category filter left, on what each row
  // shows. Shared rows have no description, only a category and a share.
  const rows = searchTerm
    ? inCategory.filter((item) =>
        transactionMatchesSearch(
          { description: item.kind === "own" ? item.row.description : null, categoryName: item.row.categoryName, amount: item.amount },
          searchTerm,
        ),
      )
    : inCategory;

  if (allRows.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {dict.emptyTransactions}
      </p>
    );
  }

  const clearButton = (
    <Button variant="outline" render={<Link href={clearHref} replace scroll={false} />}>
      <X className="size-4" />
      {dict.filter.clear}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Pick, don't type (M4); on a phone the select has its own row (M1)
          and Clear sits under it. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* GAP-63: type="search" brings the phone's Search key; 16 px text
            and a 44 px field come from Input on a phone (M3, M9). */}
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={dict.search.placeholder}
          aria-label={dict.search.label}
          clearLabel={dict.search.clear}
          enterKeyHint="search"
          autoComplete="off"
          containerClassName="w-full sm:w-72"
        />
        <Select value={categoryFilter ?? ALL_CATEGORIES} onValueChange={(v) => setCategoryFilter(String(v))}>
          <SelectTrigger aria-label={dict.filter.label} className="w-full sm:w-64">
            <SelectValue>
              {(v: string) => categories.find((c) => c.id === v)?.name ?? dict.filter.all}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CATEGORIES}>{dict.filter.all}</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {categoryFilter && rows.length > 0 && <div className="flex">{clearButton}</div>}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed p-8 text-center">
          {searchTerm ? (
            <>
              <p className="text-sm text-muted-foreground">{format(dict.search.empty, { query: searchTerm })}</p>
              <Button variant="outline" onClick={() => setQuery("")}>
                <X className="size-4" />
                {dict.search.clear}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {format(dict.filter.empty, { category: filteredCategory?.name ?? "" })}
              </p>
              {clearButton}
            </>
          )}
        </div>
      ) : (
      <>
      <div className="hidden sm:block">
      <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{dict.columnDate}</TableHead>
          <TableHead>{dict.columnCategory}</TableHead>
          <TableHead>{dict.columnDescription}</TableHead>
          <TableHead className="text-right">{dict.columnAmount}</TableHead>
          <TableHead className="w-20" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) =>
          item.kind === "shared" ? (
            <TableRow key={item.row.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {dateFormat.format(item.row.date)}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="max-w-[10rem]">
                    <span className="min-w-0 truncate" title={item.row.categoryName}>
                      {item.row.categoryName}
                    </span>
                  </Badge>
                  <Badge variant="secondary" className="gap-1">
                    <Users className="size-3" />
                    {dict.shared?.sharedBadge}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="max-w-64 truncate text-muted-foreground">
                {sharedRowDetail(item.row)}
                {showHouseholdName ? ` · ${item.row.householdName}` : ""}
              </TableCell>
              <TableCell className={"text-right " + amountColor(item.row.type)}>
                <span className="block text-xs font-normal text-muted-foreground">{dict.shared?.yourShare}</span>
                <span className="font-medium tabular-nums">{amount(item.row.type, item.row.amount)}</span>
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end">
                  {householdLink(
                    item.row,
                    "inline-flex size-7 pointer-coarse:size-11 items-center justify-center text-muted-foreground hover:text-foreground",
                  )}
                </div>
              </TableCell>
            </TableRow>
          ) : (
          <TableRow key={item.row.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {dateFormat.format(item.row.date)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="max-w-[10rem]">
                  <span className="min-w-0 truncate" title={item.row.categoryName}>
                    {item.row.categoryName}
                  </span>
                </Badge>
                {ownBadges(item.row)}
              </div>
            </TableCell>
            <TableCell className="max-w-64 truncate text-muted-foreground">
              {item.row.description || "—"}
            </TableCell>
            <TableCell className={"text-right font-medium tabular-nums " + amountColor(item.row.type)}>
              {amount(item.row.type, item.row.amount)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                <TransactionDialog
                  numberFormat={numberFormat}
                  dict={dict}
                  categories={categories}
                  members={members}
                  currentMemberId={currentMemberId}
                  transaction={item.row}
                  createAction={createAction}
                  updateAction={updateAction}
                  onDelete={() => removeTransaction(item.row)}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      aria-label={dict.editAriaLabel}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={dict.deleteAriaLabel}
                  onClick={() => removeTransaction(item.row)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
          ),
        )}
      </TableBody>
      </Table>
      </div>

      {/* Phones (phone pass, Oct 2026): compact rows under day headers, the
          way a bank app lists them — about twice as many rows per screen as
          the old two-line cards, which repeated the full date on every row
          and carried an edit and a delete button each. The whole row opens
          the edit sheet (which holds Delete); swiping left is the quick
          path to Delete with Undo (SwipeRow, DESIGN.md M7). */}
      <div className="flex flex-col gap-4 sm:hidden">
        {groupByDay(rows).map((group) => (
          <section key={group.key} className="flex flex-col gap-1.5">
            <h3 className="flex items-baseline justify-between gap-2 px-1 text-xs font-medium text-muted-foreground">
              <span>{dayHeading(group.key, today, locale)}</span>
              <span className="tabular-nums">
                {group.net >= 0 ? "+" : "−"}
                {numberFormat.format(Math.abs(group.net))}
              </span>
            </h3>
            {/* overflow-hidden here, not on each SwipeRow: the list's
                rounded border clips a row's swipe underlay at its corners
                (the inventory phone list does the same). */}
            <ul className="list-bleed relative min-w-0 divide-y overflow-hidden rounded-lg border">
              {group.rows.map((item) =>
                item.kind === "shared" ? (
                  <li key={item.row.id} className="flex min-h-14 items-center gap-2 py-1.5 pl-3">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium" title={item.row.categoryName}>
                        {item.row.categoryName}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="gap-1">
                          <Users className="size-3" />
                          {dict.shared?.sharedBadge}
                        </Badge>
                        <span className="truncate">
                          {sharedRowDetail(item.row)}
                          {showHouseholdName ? ` · ${item.row.householdName}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className={"shrink-0 text-right " + amountColor(item.row.type)}>
                      <span className="block text-xs text-muted-foreground">{dict.shared?.yourShare}</span>
                      <span className="font-semibold tabular-nums">{amount(item.row.type, item.row.amount)}</span>
                    </span>
                    {householdLink(
                      item.row,
                      "inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground",
                    )}
                  </li>
                ) : (
                  <TransactionPhoneRow
                    key={item.row.id}
                    row={item.row}
                    badges={ownBadges(item.row)}
                    amount={amount(item.row.type, item.row.amount)}
                    numberFormat={numberFormat}
                    dict={dict}
                    categories={categories}
                    members={members}
                    currentMemberId={currentMemberId}
                    onRemove={() => removeTransaction(item.row)}
                    createAction={createAction}
                    updateAction={updateAction}
                    readOnly={readOnly}
                  />
                ),
              )}
            </ul>
          </section>
        ))}
      </div>
      </>
      )}
    </div>
  );
}

// One own transaction on a phone. Its own component so each row gets its
// own component; its swipe and edit sheet both go through onRemove.
function TransactionPhoneRow({
  row,
  badges,
  amount,
  numberFormat,
  dict,
  categories,
  members,
  currentMemberId,
  onRemove,
  createAction,
  updateAction,
  readOnly,
}: {
  row: TransactionListRow;
  badges: ReactNode;
  amount: ReactNode;
  numberFormat: Intl.NumberFormat;
  dict: BudgetDict;
  categories: CategoryRow[];
  members: MemberOption[];
  currentMemberId: string;
  onRemove: () => void;
  createAction: TransactionFormAction;
  updateAction: TransactionFormAction;
  readOnly: boolean;
}) {
  // The description is what the user typed to tell rows apart ("ICA",
  // "Netflix"); without one the category is the best name the row has.
  const title = row.description || row.categoryName;

  return (
    <li>
      <SwipeRow editLabel={dict.swipe.edit} deleteLabel={dict.swipe.delete} onDelete={onRemove} disabled={readOnly}>
        <TransactionDialog
          numberFormat={numberFormat}
          dict={dict}
          categories={categories}
          members={members}
          currentMemberId={currentMemberId}
          transaction={row}
          createAction={createAction}
          updateAction={updateAction}
          onDelete={onRemove}
          trigger={
            // A real button the width of the row: its text (title, category,
            // amount) is its accessible name, and SwipeRow's Edit clicks it.
            <button
              type="button"
              data-swipe-edit
              className="flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-1.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium">{title}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground empty:hidden">
                  {row.description && <span className="min-w-0 truncate">{row.categoryName}</span>}
                  {badges}
                </span>
              </span>
              <span className={"shrink-0 font-semibold tabular-nums " + amountColor(row.type)}>{amount}</span>
            </button>
          }
        />
      </SwipeRow>
    </li>
  );
}
