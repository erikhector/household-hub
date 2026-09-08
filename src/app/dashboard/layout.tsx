import { cookies } from "next/headers";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-items";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import { EmailVerificationBanner } from "@/components/dashboard/email-verification-banner";
import { requireHousehold } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { getNotifications } from "@/lib/notifications";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { userId, household, role, households } = await requireHousehold();
  const [cookieStore, dict, locale, notifications, user] = await Promise.all([
    cookies(),
    getDictionary(),
    getLocale(),
    getNotifications(household.id),
    prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } }),
  ]);
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
        {!user?.emailVerifiedAt && <EmailVerificationBanner dict={dict.emailVerification} />}
        <header className="border-b bg-background px-4 py-3 sm:hidden">
          <HouseholdSwitcher current={current} households={households} dict={dict} />
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 pb-24 sm:pb-8">{children}</main>
      </div>
      <BottomNav dict={dict} locale={locale} notifications={notifications} />
    </div>
  );
}
