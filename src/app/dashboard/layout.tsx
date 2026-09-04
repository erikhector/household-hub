import { Button } from "@/components/ui/button";
import { DashboardNav } from "@/components/dashboard/nav";
import { HouseholdSwitcher } from "@/components/household/household-switcher";
import { logoutAction } from "@/lib/actions/auth";
import { requireHousehold } from "@/lib/session";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const { household, role, households } = await requireHousehold();

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <HouseholdSwitcher
            current={{ id: household.id, name: household.name, role }}
            households={households}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <DashboardNav />
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
