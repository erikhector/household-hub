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
  const current = { id: household.id, name: household.name, role };

  return (
    // max-sm: pinned to the actual device viewport bounds (not just sized to
    // match them) and never itself scrolls — only `main` does, internally.
    // A bottom nav living inside a page that scrolls at the document level
    // is what caused an earlier bug: `sticky` visibly lags/jumps during
    // momentum scrolling. Taking the whole shell out of document flow
    // removes that document-level scroll, so the header can be a plain,
    // static, unmoving flex child — no position tricks needed on it at all.
    // This also keeps the header (and its safe-area-inset-top padding)
    // permanently on screen instead of scrolling away, which is what was
    // letting the inventory page's sticky search bar stick up under the
    // notch. BottomNav is pinned separately via `fixed inset-x-0 bottom-0`
    // (see bottom-nav.tsx); `main` below reserves matching bottom padding
    // so its scrolled content doesn't end up underneath it.
    //
    // `overflow-hidden` here + `min-h-0` cascaded down through every flex
    // level to `main` guards against Safari's flexbox quirk where a nested
    // flex child ignores its container's bound and keeps `min-height: auto`
    // (growing to fit all content instead of scrolling internally) — which
    // would let the whole shell, nav included, overflow and become
    // draggable as part of the page instead of staying put. `main`'s
    // overscroll-contain stops the same thing happening transiently: iOS
    // rubber-banding past the end of the inner scroll and bleeding into a
    // drag of the outer page.
    <div className="flex flex-1 max-sm:fixed max-sm:inset-0 max-sm:overflow-hidden">
      <Sidebar
        defaultExpanded={sidebarExpanded}
        current={current}
        households={households}
        dict={dict}
        locale={locale}
        notifications={notifications}
      />
      <div className="flex flex-1 flex-col max-sm:min-h-0">
        <Suspense fallback={null}>
          <EmailVerificationCheck
            userId={userId}
            dict={dict.emailVerification}
            dismissed={emailVerificationDismissed}
          />
        </Suspense>
        <header className="shrink-0 border-b bg-background px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 sm:hidden">
          <HouseholdSwitcher current={current} households={households} dict={dict} />
        </header>
        <main className="mx-auto w-full max-w-[100dvw] flex-1 px-4 pb-8 max-sm:pb-24 sm:max-w-5xl sm:pt-8 max-sm:min-h-0 max-sm:overflow-y-auto max-sm:overscroll-contain">
          {children}
        </main>
        <BottomNav dict={dict} locale={locale} notifications={notifications} />
      </div>
    </div>
  );
}
