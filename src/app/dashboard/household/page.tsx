import { cache } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { absoluteAppUrl } from "@/lib/app-url";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale, type Dictionary, type Locale } from "@/lib/i18n/get-dictionary";
import { format, plural } from "@/lib/i18n/format";
import { InviteButton } from "@/components/household/invite-button";
import { MemberList } from "@/components/household/member-list";
import { DeleteHouseholdDialog } from "@/components/household/delete-household-dialog";
import { AutoAddSetting } from "@/components/household/auto-add-setting";
import { HouseholdNotes } from "@/components/household/household-notes";
import { CalendarFeedSetting } from "@/components/household/calendar-feed-setting";
import { RenameHousehold } from "@/components/household/rename-household";
import { CurrencySetting } from "@/components/household/currency-setting";
import { InventorySyncSetting } from "@/components/household/inventory-sync-setting";
import { ShoppingExpenseSetting } from "@/components/household/shopping-expense-setting";
import { calendarFeedPath } from "@/lib/calendar-feed";
import { PageTitle } from "@/components/dashboard/page-title";
import { PrimaryAction } from "@/components/dashboard/primary-action";


// Wrapped in `cache()` so the "shared with" note and the member list below
// share one query instead of one each, the same convention as
// getInventoryData in the inventory page.
const getHouseholdMembers = cache(async (householdId: string) => {
  const members = await prisma.householdMember.findMany({
    where: { householdId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    displayName: m.user.displayName,
    email: m.user.email,
  }));
});

async function SharedWithNote({
  householdId,
  userId,
  dict,
}: {
  householdId: string;
  userId: string;
  dict: Dictionary["household"];
}) {
  const members = await getHouseholdMembers(householdId);
  const otherMembers = members.filter((m) => m.userId !== userId).length;
  if (otherMembers === 0) return null;
  return (
    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
      <Users className="size-4 shrink-0" />
      {format(plural(otherMembers, dict.sharedWith), { count: otherMembers })}
    </p>
  );
}

async function HouseholdMemberList({
  householdId,
  userId,
  isOwner,
  dict,
}: {
  householdId: string;
  userId: string;
  isOwner: boolean;
  dict: Dictionary["household"];
}) {
  const members = await getHouseholdMembers(householdId);
  return <MemberList isOwner={isOwner} currentUserId={userId} dict={dict} members={members} />;
}

// GAP-16. Newest first — the board is for what's current, so the latest note
// belongs at the top. The author's name is resolved through the (nullable)
// authorMember relation rather than getHouseholdMembers: a note whose author
// has left has authorMemberId null (onDelete: SetNull) and renders as
// "former member", which is exactly what a join that finds nothing gives us.
async function HouseholdNotesSection({
  householdId,
  locale,
  dict,
}: {
  householdId: string;
  locale: Locale;
  dict: Dictionary["household"]["notes"];
}) {
  const notes = await prisma.householdNote.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      authorMember: { select: { user: { select: { displayName: true } } } },
    },
  });
  return (
    <HouseholdNotes
      locale={locale}
      dict={dict}
      notes={notes.map((n) => ({
        id: n.id,
        body: n.body,
        createdAt: n.createdAt,
        authorName: n.authorMember?.user.displayName ?? null,
      }))}
    />
  );
}

export default async function HouseholdPage() {
  const [{ household, userId, role, households }, dict, locale] = await Promise.all([
    requireHousehold(),
    getDictionary(),
    getLocale(),
  ]);
  const isOwner = role === "OWNER";
  const [feedUrl, expenseCategories] = await Promise.all([
    household.calendarFeedToken
      ? absoluteAppUrl(calendarFeedPath(household.calendarFeedToken, locale))
      : null,
    prisma.budgetCategory.findMany({
      where: { householdId: household.id, type: "EXPENSE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <PageTitle>{dict.household.title}</PageTitle>
          <p className="line-clamp-2 break-words sm:line-clamp-1 text-sm text-muted-foreground" title={household.name}>
            {household.name}
          </p>
          {/* MAINT-31: no Suspense around the three async sections on this
              page. Each used to stream in after the first paint behind a
              fallback of a different height (nothing at all for this note),
              so under load the settings cards below jumped by the difference
              (CLS 0.0647 against the 0.05 budget). The queries are small and
              route-level loading.tsx already covers the wait, so the page
              now arrives complete and nothing moves. */}
          <SharedWithNote householdId={household.id} userId={userId} dict={dict.household} />
        </div>
        <PrimaryAction>
          <InviteButton dict={dict.household.invite} />
        </PrimaryAction>
      </div>
      <HouseholdMemberList householdId={household.id} userId={userId} isOwner={isOwner} dict={dict.household} />
      <HouseholdNotesSection householdId={household.id} locale={locale} dict={dict.household.notes} />
      {/* Owner-only (see renameHouseholdAction). */}
      {isOwner && <RenameHousehold name={household.name} dict={dict.household.rename} />}
      {/* Not owner-gated (see setAutoAddLowStockToListAction): day-to-day
          shopping behaviour every member already fully operates. */}
      <AutoAddSetting enabled={household.autoAddLowStockToList} dict={dict.household.shoppingSettings} />
      {/* Owner-gated inside (see setInventorySyncModeAction); contributors
          see the current value read-only. */}
      <InventorySyncSetting
        mode={household.inventorySyncMode}
        isOwner={isOwner}
        dict={dict.household.inventorySync}
      />
      {/* Not owner-gated (see setShoppingExpenseCategoryAction). */}
      <ShoppingExpenseSetting
        categoryId={household.shoppingExpenseCategoryId}
        categories={expenseCategories}
        dict={dict.household.shoppingExpense}
      />
      {/* Owner-gated inside (see setHouseholdCurrencyAction); contributors
          see the current value read-only. */}
      <CurrencySetting
        currencyCode={household.currencyCode}
        isOwner={isOwner}
        locale={locale}
        dict={dict.household.currency}
      />
      <CalendarFeedSetting
        feedUrl={feedUrl}
        isOwner={isOwner}
        dict={dict.household.calendarFeed}
      />
      {isOwner && (
        <div className="list-bleed flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <div>
            <h2 className="font-heading text-base font-semibold">{dict.household.dangerZoneTitle}</h2>
            <p className="text-sm text-muted-foreground">{dict.household.dangerZoneDescription}</p>
          </div>
          {/* The server refuses to delete a user's only household (see
              deleteHouseholdAction), so with one household we say so and
              point at the way out instead of offering a button that opens a
              refusal (UX-77, User control). */}
          {households.length <= 1 ? (
            <p className="text-sm">
              {dict.household.delete.onlyHousehold}{" "}
              <Link
                href="/dashboard/profile#profile-data"
                className="touch-target font-medium text-primary underline-offset-4 hover:underline"
              >
                {dict.household.delete.onlyHouseholdLink}
              </Link>
            </p>
          ) : (
            <div>
              <DeleteHouseholdDialog householdName={household.name} dict={dict.household.delete} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
