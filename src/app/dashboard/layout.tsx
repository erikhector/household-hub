import { Suspense } from "react";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-items";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import {
  EmailVerificationBanner,
  EMAIL_VERIFICATION_DISMISSED_COOKIE,
} from "@/components/dashboard/email-verification-banner";
import { requireHousehold } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { getActiveNotifications } from "@/lib/notifications";
import { hasUnseenRelease, LAST_SEEN_RELEASE_COOKIE } from "@/lib/release-notes";

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
    <div className="flex flex-1">
      <Sidebar
        defaultExpanded={sidebarExpanded}
        current={current}
        households={households}
        dict={dict}
        locale={locale}
        notifications={notifications}
        unseenRelease={unseenRelease}
      />
      <div className="flex flex-1 flex-col max-sm:h-dvh max-sm:overflow-hidden">
        <header className="shrink-0 border-b bg-background px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:hidden">
          <HouseholdSwitcher current={current} households={households} dict={dict} />
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
            edge, which is behind BottomNav. */}
        <main className="mx-auto w-full max-w-[100dvw] flex-1 px-4 pb-8 max-sm:mt-3 sm:max-w-5xl sm:pt-8 max-sm:min-h-0 max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:pb-[calc(3.75rem+min(2.125rem,env(safe-area-inset-bottom)))] max-sm:scroll-pb-[calc(3.75rem+min(2.125rem,env(safe-area-inset-bottom)))]">
          {children}
        </main>
      </div>
      <BottomNav dict={dict} locale={locale} notifications={notifications} unseenRelease={unseenRelease} />
    </div>
  );
}
