import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { getNotificationHistory } from "@/lib/notifications";
import { NotificationsHistory } from "@/components/notifications/notifications-history";
import { PageTitle } from "@/components/dashboard/page-title";

export default async function NotificationsPage() {
  const [{ household }, dict, locale] = await Promise.all([requireHousehold(), getDictionary(), getLocale()]);
  const items = await getNotificationHistory(household.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>{dict.notifications.history.title}</PageTitle>
        <p className="text-sm text-muted-foreground">{dict.notifications.history.subtitle}</p>
      </div>
      <NotificationsHistory items={items} dict={dict.notifications} locale={locale} />
    </div>
  );
}
