import { requireHousehold } from "@/lib/session";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { getNotificationHistory } from "@/lib/notifications";
import { NotificationsHistory } from "@/components/notifications/notifications-history";

export default async function NotificationsPage() {
  const [{ household }, dict, locale] = await Promise.all([requireHousehold(), getDictionary(), getLocale()]);
  const items = await getNotificationHistory(household.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{dict.notifications.history.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.notifications.history.subtitle}</p>
      </div>
      <NotificationsHistory items={items} dict={dict.notifications} locale={locale} />
    </div>
  );
}
