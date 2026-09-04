import { cookies } from "next/headers";
import { Sidebar } from "@/components/dashboard/sidebar";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { SIDEBAR_COOKIE } from "@/components/dashboard/nav-items";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { household, role, households } = await requireHousehold();
  const [cookieStore, dict, locale] = await Promise.all([
    cookies(),
    getDictionary(),
    getLocale(),
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
      />
      <div className="flex flex-1 flex-col">
        <header className="border-b bg-background px-4 py-3 sm:hidden">
          <HouseholdSwitcher current={current} households={households} dict={dict} />
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 pb-24 sm:pb-8">{children}</main>
      </div>
      <BottomNav dict={dict} locale={locale} />
    </div>
  );
}
