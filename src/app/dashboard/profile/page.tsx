import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { UserAvatar } from "@/components/profile/avatar";
import { DisplayNameForm } from "@/components/profile/display-name-form";
import { EmailForm } from "@/components/profile/email-form";
import { PasswordForm } from "@/components/profile/password-form";
import { DeleteAccountDialog } from "@/components/profile/delete-account-dialog";
import { InstallAppCard } from "@/components/profile/install-app-card";
import { PushNotificationsCard } from "@/components/profile/push-notifications-card";
import { ExportButton } from "@/components/export/export-button";

export default async function ProfilePage() {
  const [{ userId }, dict] = await Promise.all([requireHousehold(), getDictionary()]);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <UserAvatar displayName={user.displayName} seed={user.id} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.profile.title}</h1>
          <p className="text-sm text-muted-foreground">{dict.profile.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{dict.profile.avatar.description}</p>
        </div>
      </div>
      <div className="flex max-w-md flex-col gap-6">
        <div className="rounded-md border p-4">
          <h2 className="mb-3 font-heading text-base font-semibold">
            {dict.profile.displayNameForm.title}
          </h2>
          <DisplayNameForm displayName={user.displayName} dict={dict.profile.displayNameForm} />
        </div>
        <div className="rounded-md border p-4">
          <EmailForm email={user.email} verified={Boolean(user.emailVerifiedAt)} dict={dict.profile.emailForm} />
        </div>
        <div className="rounded-md border p-4">
          <PasswordForm dict={dict.profile.passwordForm} />
        </div>
        <InstallAppCard dict={dict.profile.installApp} />
        <PushNotificationsCard dict={dict.profile.pushNotifications} />
        <div className="flex flex-col gap-2 rounded-md border p-4">
          <div>
            <h2 className="font-heading text-base font-semibold">{dict.profile.dataExport.title}</h2>
            <p className="text-sm text-muted-foreground">{dict.profile.dataExport.description}</p>
          </div>
          <div>
            <ExportButton href="/dashboard/profile/export-data" label={dict.profile.dataExport.button} />
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <div>
            <h2 className="font-heading text-base font-semibold">{dict.profile.dangerZoneTitle}</h2>
            <p className="text-sm text-muted-foreground">{dict.profile.dangerZoneDescription}</p>
          </div>
          <div>
            <DeleteAccountDialog dict={dict.profile.deleteAccount} />
          </div>
        </div>
      </div>
    </div>
  );
}
