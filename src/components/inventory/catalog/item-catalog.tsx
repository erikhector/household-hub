"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Radio } from "@/components/ui/radio";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MergePreviewBody } from "@/components/inventory/catalog/merge-preview";
import { dismissDuplicatesAction } from "@/app/dashboard/inventory/items/actions";
import {
  CATALOG_FILTERS,
  filterCatalogRows,
  parseCatalogFilter,
  type CatalogFilter,
  type CatalogRow,
} from "@/lib/inventory/catalog";
import type { DuplicateGroup, DuplicateMember } from "@/lib/inventory/duplicates";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import { format, plural } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import { catalogHref, itemPageHref } from "@/lib/inventory/item-page-origin";

type CatalogDict = Dictionary["inventory"]["catalog"];

// The item catalog (MATCH-7, design §6.2): every item behind filter chips,
// and the possible-duplicate groups with merge and "Not duplicates". Rows
// are a grid on wider screens and stacked cards on phones.
export function ItemCatalog({
  rows,
  groups,
  dict,
  locale,
}: {
  rows: CatalogRow[];
  groups: DuplicateGroup[];
  dict: CatalogDict;
  locale: Locale;
}) {
  // The chip lives in `?filter=` (replaced, not pushed, so chips don't pile
  // up history), so the browser's own back button from an item page lands
  // on the same filter as the page's back arrow does. It's read back from
  // useSearchParams, not kept in useState seeded from the server: on a
  // browser back, Next restores the page from its router cache, rendered
  // for the URL as first loaded, so a server-seeded state would reset to
  // that filter. useSearchParams follows replaceState and back/forward.
  const filter = parseCatalogFilter(useSearchParams().get("filter"));
  const selectFilter = (key: CatalogFilter) => window.history.replaceState(null, "", catalogHref(key));
  const counts: Record<CatalogFilter, number> = {
    all: rows.length,
    duplicates: groups.length,
    neverStocked: filterCatalogRows(rows, "neverStocked").length,
    unitProblems: filterCatalogRows(rows, "unitProblems").length,
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="group" aria-label={dict.filtersLabel} className="flex flex-wrap gap-2">
        {CATALOG_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => selectFilter(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors max-sm:min-h-11 pointer-coarse:min-h-11",
              filter === key
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:border-primary/50",
            )}
          >
            {dict.filters[key]} <span className="tabular-nums">({counts[key]})</span>
          </button>
        ))}
      </div>

      {filter === "duplicates" ? (
        groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dict.empty.duplicates}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {groups.map((group) => (
              <DuplicateGroupCard
                key={group.members.map((member) => member.id).join(",")}
                group={group}
                dict={dict}
                locale={locale}
              />
            ))}
          </ul>
        )
      ) : (
        <CatalogRows rows={filterCatalogRows(rows, filter)} filter={filter} emptyText={dict.empty[filter]} dict={dict} />
      )}
    </div>
  );
}

function CatalogRows({
  rows,
  filter,
  emptyText,
  dict,
}: {
  rows: CatalogRow[];
  filter: CatalogFilter;
  emptyText: string;
  dict: CatalogDict;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const grid = "sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4";
  return (
    <div className="flex min-w-0 flex-col">
      <div aria-hidden="true" className={cn("hidden px-3 pb-2 text-xs font-medium text-muted-foreground", grid)}>
        <span>{dict.columns.name}</span>
        <span>{dict.columns.category}</span>
        <span>{dict.columns.stock}</span>
        <span>{dict.columns.usedIn}</span>
      </div>
      <ul className="flex flex-col gap-2 sm:gap-0 sm:divide-y sm:rounded-lg sm:border">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border sm:rounded-none sm:border-0">
            <Link
              href={itemPageHref(row.id, { kind: "catalog", filter })}
              className={cn("flex flex-col gap-1 p-3 text-sm hover:bg-muted/50 max-sm:min-h-11 pointer-coarse:min-h-11", grid)}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium break-words">{row.name}</span>
                {row.neverStocked && <Badge variant="secondary">{dict.neverStocked}</Badge>}
                {row.unitProblems.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="size-3.5" aria-hidden="true" />
                    {format(dict.unitProblem, { units: row.unitProblems.join(", ") })}
                  </span>
                )}
              </span>
              <span className="break-words text-muted-foreground">{row.category}</span>
              <span className="tabular-nums">
                {row.quantity} {row.unit}
              </span>
              <span className="text-muted-foreground">
                {format(plural(row.recipeCount, dict.recipes), { count: row.recipeCount })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function memberDetails(member: DuplicateMember, dict: CatalogDict): string {
  return [
    `${member.quantity} ${member.unit}`,
    ...(member.recipeCount > 0 ? [format(plural(member.recipeCount, dict.recipes), { count: member.recipeCount })] : []),
    ...(member.barcode ? [dict.barcode] : []),
    ...(member.neverStocked ? [dict.neverStocked] : []),
  ].join(" · ");
}

/**
 * One group, as in the design's mockup: a radio picks the keeper (the
 * suggested one first) and a checkbox each of the others to merge into it,
 * all ticked to start with. "Not duplicates" stores every pair in the
 * group, so it doesn't come back for anyone in the household.
 */
function DuplicateGroupCard({ group, dict, locale }: { group: DuplicateGroup; dict: CatalogDict; locale: Locale }) {
  const [keeperId, setKeeperId] = useState(group.members[0].id);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const keeper = group.members.find((member) => member.id === keeperId)!;
  const mergeIds = group.members
    .filter((member) => member.id !== keeperId && !unticked.has(member.id))
    .map((member) => member.id);
  const radioName = `keep-${group.members[0].id}`;
  const headingId = `group-${group.members[0].id}`;

  const toggle = (id: string, checked: boolean) =>
    setUnticked((current) => {
      const next = new Set(current);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleDismiss = () =>
    startTransition(async () => {
      const result = await dismissDuplicatesAction(group.members.map((member) => member.id));
      if (result.error) toast.error(result.error);
      else toast.success(dict.notDuplicatesDone);
    });

  return (
    <li aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3 sm:p-4">
      <h2 id={headingId} className="font-heading font-semibold break-words">
        {keeper.name}
      </h2>
      <ul className="flex flex-col gap-2">
        {group.members.map((member) => {
          const isKeeper = member.id === keeperId;
          return (
            <li key={member.id} className="flex min-w-0 items-start gap-3 text-sm">
              <Radio
                name={radioName}
                className="mt-1"
                checked={isKeeper}
                onChange={() => setKeeperId(member.id)}
                aria-label={format(dict.keepLabel, { name: member.name })}
              />
              <Checkbox
                className={cn("mt-1", isKeeper && "invisible")}
                checked={!isKeeper && !unticked.has(member.id)}
                disabled={isKeeper}
                onChange={(event) => toggle(member.id, event.target.checked)}
                aria-label={format(dict.mergeLabel, { name: member.name })}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <Link
                  href={itemPageHref(member.id, { kind: "catalog", filter: "duplicates" })}
                  className="touch-target font-medium break-words underline-offset-4 hover:underline"
                >
                  {member.name}
                </Link>
                <span className="text-muted-foreground">{memberDetails(member, dict)}</span>
              </div>
              {isKeeper && <Badge variant="secondary">{dict.keep}</Badge>}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={mergeIds.length === 0} onClick={() => setMergeOpen(true)}>
          {format(plural(mergeIds.length, dict.mergeButton), { count: mergeIds.length, name: keeper.name })}
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={handleDismiss}>
          {dict.notDuplicates}
        </Button>
      </div>
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{format(dict.mergeDialog.title, { name: keeper.name })}</DialogTitle>
            <DialogDescription>{format(dict.mergeDialog.description, { name: keeper.name })}</DialogDescription>
          </DialogHeader>
          {mergeOpen && (
            <MergePreviewBody
              keeperId={keeperId}
              mergeIds={mergeIds}
              dict={dict}
              locale={locale}
              onCancel={() => setMergeOpen(false)}
              onMerged={() => setMergeOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}
