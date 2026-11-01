import { Suspense } from "react";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { COMPACT_TITLE_SLOT_ID, SIDEBAR_COOKIE, type ShellDictionary } from "@/components/dashboard/nav-items";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import {
  EmailVerificationBanner,
  EMAIL_VERIFICATION_DISMISSED_COOKIE,
} from "@/components/dashboard/email-verification-banner";
import { LazyDialogErrorMessage } from "@/components/ui/lazy-dialog";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { UnitsProvider } from "@/components/units-provider";
import { requireHousehold } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { getActiveNotifications } from "@/lib/notifications";
import { TimeZoneCookie } from "@/components/dashboard/time-zone-cookie";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone";
import { CURRENT_VERSION, hasUnseenRelease, LAST_SEEN_RELEASE_COOKIE } from "@/lib/release-notes";

// Isolated behind its own Suspense boundary (see below) so the
// emailVerifiedAt lookup doesn't gate the rest of the dashboard shell —
// this banner is a soft, non-blocking nudge anyway (see
// email-verification-banner.tsx).
async function EmailVerificationCheck({
  userId,
  dict,
  dismissed,
}: {
  userId: string;
  dict: Dictionary["emailVerification"];
  dismissed: boolean;
}) {
  // Checked before the DB round trip: once dismissed for this session there's
  // nothing this lookup could change about what renders, so skip it entirely.
  if (dismissed) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
  if (user?.emailVerifiedAt) return null;
  return <EmailVerificationBanner dict={dict} />;
}

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { userId, household, role, households } = await requireHousehold();
  const [cookieStore, dict, locale] = await Promise.all([cookies(), getDictionary(), getLocale()]);
  // Not awaited: this layout uses cookies()/auth() above, which forces it to
  // re-run on every navigation within /dashboard (it can't be served from
  // the router cache). Passing the promise straight through to the Sidebar
  // and BottomNav client components — which unwrap it with `use()` under
  // their own Suspense boundaries — lets the shell paint immediately instead
  // of every navigation waiting on this DB round trip too.
  const notifications = getActiveNotifications(household.id);
  const sidebarExpanded = cookieStore.get(SIDEBAR_COOKIE)?.value !== "0";
  const emailVerificationDismissed = cookieStore.get(EMAIL_VERIFICATION_DISMISSED_COOKIE)?.value === "1";
  const unseenRelease = hasUnseenRelease(cookieStore.get(LAST_SEEN_RELEASE_COOKIE)?.value);
  // Only the slices the client shell reads: passing `dict` whole would
  // serialize all ~87 KB of it into every dashboard document and every
  // layout-re-rendering action response (PERF-5).
  const shellDict: ShellDictionary = {
    nav: dict.nav,
    notifications: dict.notifications,
    language: dict.language,
    theme: dict.theme,
  };
  const current = { id: household.id, name: household.name, role };

  return (
    // max-sm: pinned to the actual device viewport bounds via `h-dvh` and
    // never itself scrolls — only `main` does, internally. A bottom nav
    // living inside a page that scrolls at the document level is what
    // caused an earlier bug: `sticky` visibly lags/jumps during momentum
    // scrolling. Taking the whole shell out of document flow removes that
    // document-level scroll, so the header can stay a plain, static,
    // unmoving flex child with no position tricks needed. This also keeps
    // the header (and its safe-area-inset-top padding) permanently on
    // screen instead of scrolling away, which is what was letting the
    // inventory page's sticky search bar stick up under the notch.
    //
    // This column is sized with `h-dvh`, the unit purpose-built to resolve
    // to the true visible viewport (it's what stays correct as a browser's
    // dynamic toolbar shows/hides — irrelevant in standalone PWA mode, but
    // the unit still resolves against the real device screen there too).
    //
    // BottomNav itself is `position: fixed` (see bottom-nav.tsx) — the
    // standard pattern for a PWA bottom bar — rendered as a sibling here
    // rather than inside `main`/this column so it's unambiguously pinned
    // to the viewport regardless of this column's own layout.
    //
    // `overflow-hidden` here + `min-h-0` cascaded down through every flex
    // level to `main` guards against Safari's flexbox quirk where a nested
    // flex child ignores its container's bound and keeps `min-height: auto`
    // (growing to fit all content instead of scrolling internally) — which
    // would let the whole shell overflow and become draggable as part of
    // the page instead of staying put. `main`'s overscroll-contain stops
    // the same thing happening transiently: iOS rubber-banding past the end
    // of the inner scroll and bleeding into a drag of the outer page.
    //
    // min-w-0 on the content column (UX-7): a flex item won't shrink below
    // its content's width by default, so one wide row (the inventory
    // header's action buttons) grew the column, and the whole page,
    // past the screen on a tablet or a landscape phone. With it, the
    // column stays the width the sidebar leaves and its content wraps.
    // main's left/right padding grows to the safe-area insets so a
    // landscape notch doesn't cover content; from `sm` the sidebar sits on
    // the left and clears that side itself (see sidebar.tsx).
    //
    // print: (GAP-24, the shopping list's "Print") undoes all of that on
    // paper. A viewport-sized, internally scrolling column would clip the
    // printout to its first screenful, so the column and `main` go back to
    // plain document flow, and the chrome (Sidebar, header, BottomNav, the
    // email banner, each hiding itself) drops out so only the page prints.
    // PERF-27: the shell's popups load on first use; a failed load toasts.
    <LazyDialogErrorMessage message={dict.errors.generic}>
    <div className="flex flex-1">
      {/* UX-164 (WCAG 2.4.1): the first tab stop, hidden until focused, so
          a keyboard user skips the sidebar's ~16 stops. main takes focus
          (tabIndex -1) rather than the anchor just scrolling. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:flex focus:min-h-11 focus:items-center focus:rounded-md focus:bg-primary focus:px-4 focus:text-sm focus:font-medium focus:text-primary-foreground print:hidden"
      >
        {dict.nav.skipToContent}
      </a>
      <Sidebar
        defaultExpanded={sidebarExpanded}
        current={current}
        households={households}
        dict={shellDict}
        switcherDict={dict.household.switcher}
        locale={locale}
        notifications={notifications}
        unseenRelease={unseenRelease}
        version={CURRENT_VERSION}
      />
      <div className="flex min-w-0 flex-1 flex-col max-sm:h-dvh max-sm:overflow-hidden print:h-auto! print:overflow-visible!">
        {/* relative + the empty slot: once a page's large title scrolls
            away, its PageTitle portals a compact copy over this bar
            (UX-40, page-title.tsx), iOS style, instead of adding a bar.
            Named for view transitions (UX-33): it stays still and on top
            while the page below animates, like BottomNav. */}
        <header className="relative shrink-0 border-b bg-background px-4 [view-transition-name:app-header] pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:hidden print:hidden">
          <HouseholdSwitcher current={current} households={households} dict={dict.household.switcher} />
          <div id={COMPACT_TITLE_SLOT_ID} className="contents" />
        </header>
        {/* Below the header, not above it: the header is what carries the
            safe-area-inset-top padding, so anything rendered before it
            lands under the iOS status bar / Dynamic Island. */}
        <Suspense fallback={null}>
          <EmailVerificationCheck
            userId={userId}
            dict={dict.emailVerification}
            dismissed={emailVerificationDismissed}
          />
        </Suspense>
        {/* mt-3, not pt-3: margin sits outside main's scrollport so this
            gap stays put as the page scrolls, whereas padding would get
            scrolled away — breaking the inventory search bar's sticky-to-top
            behavior by leaving it flush against the header once scrolled.
            max-sm:pb-[...] reserves room for BottomNav, which is
            `position: fixed` (see bottom-nav.tsx) and so sits outside
            normal flow — without this, its last ~3.75rem of tap targets
            would sit on top of this page's own content instead of below
            it. The value mirrors BottomNav's own rendered height (icon
            tile + label + padding) plus its capped safe-area inset.
            max-sm:scroll-pb-[...] is the same reservation for
            scrollIntoView (e.g. the shopping list scrolling a just-added
            row into view): without it "nearest" stops at main's bottom
            edge, which is behind BottomNav. A page with a floating
            primary action (PrimaryAction, UX-40) reserves another 4.5rem
            (the 3rem button and its gaps) so the last row can scroll out
            from under it. data-app-main is how globals.css finds the
            dashboard's cards to give them list-bleed on phones (UX-139). */}
        <main id="main-content" tabIndex={-1} data-app-main className="outline-none mx-auto w-full max-w-[100dvw] flex-1 pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] pb-8 sm:pl-4 max-sm:mt-3 sm:max-w-5xl sm:pt-8 max-sm:min-h-0 max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:pb-[calc(var(--bottom-nav-h)+var(--cookie-notice-h,0px))] max-sm:scroll-pb-[calc(var(--bottom-nav-h)+var(--cookie-notice-h,0px))] max-sm:has-[[data-primary-action]]:pb-[calc(4.5rem+var(--bottom-nav-h)+var(--cookie-notice-h,0px))] max-sm:has-[[data-primary-action]]:scroll-pb-[calc(4.5rem+var(--bottom-nav-h)+var(--cookie-notice-h,0px))] print:m-0! print:max-w-none! print:overflow-visible! print:p-0!">
          <TimeZoneCookie current={cookieStore.get(TIME_ZONE_COOKIE)?.value ?? null} />
          <UnitsProvider labels={dict.units} plurals={dict.unitsPlural}>{children}</UnitsProvider>
        </main>
      </div>
      <CommandPalette dict={dict.commandPalette} nav={dict.nav} />
      <BottomNav dict={shellDict} locale={locale} notifications={notifications} unseenRelease={unseenRelease} version={CURRENT_VERSION} />
    </div>
    </LazyDialogErrorMessage>
  );
}
