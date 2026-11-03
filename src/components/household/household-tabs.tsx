"use client";

// UX-174: the Household page's three sections behind the shared pill tabs
// (Members / Notes / Settings), the same shell the budget page uses. The
// panels are Server Components rendered by the page and passed in as nodes;
// `hidden` (not conditional rendering) keeps them mounted so switching tabs
// re-fetches nothing and a half-typed note survives a look at Settings.
// The open tab is read from `?tab=` (see src/lib/household-url.ts), so a
// link such as the danger zone's "Go to the members" opens the right one.

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, tabPanelProps } from "@/components/ui/tabs";
import { HOUSEHOLD_TABS, parseHouseholdTab, type HouseholdTab } from "@/lib/household-url";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const ID_PREFIX = "household";

export function HouseholdTabs({
  dict,
  members,
  notes,
  settings,
}: {
  dict: Dictionary["household"]["tabs"];
  members: ReactNode;
  notes: ReactNode;
  settings: ReactNode;
}) {
  const searchParams = useSearchParams();
  const tab = parseHouseholdTab(searchParams.get("tab"));
  const setTab = (next: HouseholdTab) => {
    const url = new URL(window.location.href);
    if (next === "members") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };
  const panels: Record<HouseholdTab, ReactNode> = { members, notes, settings };

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        idPrefix={ID_PREFIX}
        tabs={HOUSEHOLD_TABS.map((value) => ({ value, label: dict[value] }))}
        value={tab}
        onChange={setTab}
      />
      {HOUSEHOLD_TABS.map((value) => (
        <div
          key={value}
          hidden={tab !== value}
          className="flex flex-col gap-6"
          {...tabPanelProps(ID_PREFIX, value)}
        >
          {panels[value]}
        </div>
      ))}
    </div>
  );
}
