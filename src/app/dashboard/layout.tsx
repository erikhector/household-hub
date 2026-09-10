import { Suspense } from "react";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-items";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import { EmailVerificationBanner } from "@/components/dashboard/email-verification-banner";
import { requireHousehold } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { getNotifications } from "@/lib/notifications";

// Isolated behind its own Suspense boundary (see below) so the
// emailVerifiedAt lookup doesn't gate the rest of the dashboard shell —
// this banner is a soft, non-blocking nudge anyway (see
// email-verification-banner.tsx).
async function EmailVerificationCheck({
  userId,
  dict,
}: {
  userId: string;
  dict: Dictionary["emailVerification"];
}) {
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
  const notifications = getNotifications(household.id);
  const sidebarExpanded = cookieStore.get(SIDEBAR_COOKIE)?.value !== "0";
  const current = { id: household.id, name: household.name, role };

  return (
    <div className="flex flex-1">
      <Sidebar
        defaultExpanded={sidebarExpanded}
        current={current}
        households={households}
        dict={dict}
        locale={locale}
        notifications={notifications}
      />
      <div className="flex flex-1 flex-col">
        <Suspense fallback={null}>
          <EmailVerificationCheck userId={userId} dict={dict.emailVerification} />
        </Suspense>
        <header className="border-b bg-background px-4 py-3 sm:hidden">
          <HouseholdSwitcher current={current} households={households} dict={dict} />
        </header>
        <main className="mx-auto w-full max-w-[100dvw] flex-1 px-4 py-8 pb-24 sm:max-w-5xl sm:pb-8">{children}</main>
      </div>
      <BottomNav dict={dict} locale={locale} notifications={notifications} />
    </div>
  );
}
