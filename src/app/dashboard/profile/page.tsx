import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireHousehold } from "@/lib/session";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { UserAvatar } from "@/components/profile/avatar";
import { DisplayNameForm } from "@/components/profile/display-name-form";
import { EmailForm } from "@/components/profile/email-form";
import { SwishNumberForm } from "@/components/profile/swish-number-form";
import { PasswordForm } from "@/components/profile/password-form";
import { DeleteAccountDialog } from "@/components/profile/delete-account-dialog";
import { InstallAppCard } from "@/components/profile/install-app-card";
import { PushNotificationsCard } from "@/components/profile/push-notifications-card";
import { WeeklyDigestSetting } from "@/components/profile/weekly-digest-setting";
import { ProfileDisclosure } from "@/components/profile/profile-disclosure";
import { LogoutButton } from "@/components/logout-button";
import { ExportButton } from "@/components/export/export-button";
import { format } from "@/lib/i18n/format";
import { CURRENT_VERSION } from "@/lib/release-notes";
import { PageTitle } from "@/components/dashboard/page-title";

const sectionHeading = "font-heading text-lg font-semibold";

// UX-76: four sections instead of eleven loose cards (DESIGN.md M6 and
// Hierarchy). Account, Preferences, Notifications, then Data & privacy, with
// the rare items (the version, deleting the account) behind disclosures and
// Log out as the last thing on the page. One column on phones; two from `lg`
// up, filling row by row so the DOM order is the phone order.
export default async function ProfilePage() {
  const [{ userId }, dict] = await Promise.all([requireHousehold(), getDictionary()]);
  const [user, pushSubscriptions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    // Only what PushNotificationsCard needs to show this browser's quiet
    // hours (GAP-14) — never the subscription keys.
    prisma.pushSubscription.findMany({
      where: { userId },
      select: { endpoint: true, quietHoursStart: true, quietHoursEnd: true },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <UserAvatar displayName={user.displayName} seed={user.id} />
        <div>
          <PageTitle>{dict.profile.title}</PageTitle>
          <p className="text-sm text-muted-foreground">{dict.profile.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{dict.profile.avatar.description}</p>
        </div>
      </div>
      <div className="grid max-w-4xl items-start gap-x-6 gap-y-8 grid-cols-1 lg:grid-cols-2">
        <section aria-labelledby="profile-account" className="flex flex-col gap-3">
          <h2 id="profile-account" className={sectionHeading}>
            {dict.profile.sections.account}
          </h2>
          {/* One card for the three account forms: each keeps its own Save
              (separate actions, UX-24's dirty-state button), but they read as
              one group, and the name field is no longer labelled twice. */}
          <div className="list-bleed flex flex-col divide-y rounded-md border">
            <div className="p-4">
              <DisplayNameForm displayName={user.displayName} dict={dict.profile.displayNameForm} />
            </div>
            <div className="p-4">
              <EmailForm email={user.email} verified={Boolean(user.emailVerifiedAt)} dict={dict.profile.emailForm} />
            </div>
            <div className="p-4">
              <PasswordForm email={user.email} dict={dict.profile.passwordForm} />
            </div>
          </div>
        </section>
        <section aria-labelledby="profile-preferences" className="flex flex-col gap-3">
          <h2 id="profile-preferences" className={sectionHeading}>
            {dict.profile.sections.preferences}
          </h2>
          <div className="list-bleed rounded-md border p-4">
            <SwishNumberForm swishNumber={user.swishNumber} dict={dict.profile.swishForm} />
          </div>
        </section>
        <section aria-labelledby="profile-notifications" className="flex flex-col gap-3">
          <h2 id="profile-notifications" className={sectionHeading}>
            {dict.profile.sections.notifications}
          </h2>
          <PushNotificationsCard subscriptions={pushSubscriptions} dict={dict.profile.pushNotifications} />
          <WeeklyDigestSetting
            enabled={user.weeklyDigestEnabled}
            emailVerified={Boolean(user.emailVerifiedAt)}
            dict={dict.profile.weeklyDigest}
          />
          <InstallAppCard dict={dict.profile.installApp} />
        </section>
        <section aria-labelledby="profile-data" className="flex flex-col gap-3">
          <h2 id="profile-data" className={sectionHeading}>
            {dict.profile.sections.data}
          </h2>
          <div className="list-bleed flex flex-col gap-2 rounded-md border p-4">
            <div>
              <h3 className="font-heading text-base font-semibold">{dict.profile.dataExport.title}</h3>
              <p className="text-sm text-muted-foreground">{dict.profile.dataExport.description}</p>
            </div>
            <div>
              <ExportButton href="/dashboard/profile/export-data" label={dict.profile.dataExport.button} />
            </div>
          </div>
          <ProfileDisclosure title={dict.profile.about.title}>
            <p className="text-sm text-muted-foreground tabular-nums">
              {format(dict.profile.about.version, { version: CURRENT_VERSION })}
            </p>
            <Link href="/dashboard/whats-new" className="touch-target text-sm font-medium text-primary underline-offset-4 hover:underline">
              {dict.profile.about.whatsNewLink}
            </Link>
          </ProfileDisclosure>
          <ProfileDisclosure title={dict.profile.dangerZoneTitle} tone="destructive">
            <p className="text-sm text-muted-foreground">{dict.profile.dangerZoneDescription}</p>
            <div>
              <DeleteAccountDialog dict={dict.profile.deleteAccount} />
            </div>
          </ProfileDisclosure>
        </section>
        {/* The end of the page. The sidebar and More menu have the same
            button, but a settings page should be able to end the session. */}
        <div className="lg:col-span-2">
          <LogoutButton>{dict.nav.logOut}</LogoutButton>
        </div>
      </div>
    </div>
  );
}
