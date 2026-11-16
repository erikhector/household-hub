import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { getNotificationHistory } from "@/lib/notifications";
import { NotificationsHistory } from "@/components/notifications/notifications-history";
import Link from "next/link";
import { Settings } from "lucide-react";
import { PageTitle } from "@/components/dashboard/page-title";

export default async function NotificationsPage() {
  const [{ household }, dict, locale] = await Promise.all([requireHousehold(), getDictionary(), getLocale()]);
  const items = await getNotificationHistory(household.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>{dict.notifications.history.title}</PageTitle>
        <p className="text-sm text-muted-foreground">{dict.notifications.history.subtitle}</p>
        {/* UX-191: which alerts arrive (tonight's dinner, tasks due, the
            digest, push) is set on Profile, so the page that shows them
            links straight there. The hash lands on that section's heading.
            touch-target makes it 44 px tall on phones (M3). */}
        <Link
          href="/dashboard/profile#profile-notifications"
          className="touch-target inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          <Settings className="size-4" aria-hidden />
          {dict.notifications.history.settingsLink}
        </Link>
      </div>
      <NotificationsHistory items={items} dict={dict.notifications} locale={locale} />
    </div>
  );
}
