import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Metadata } from "next";
import { titleOnlyMetadata } from "@/lib/page-metadata";
import { CreateFirstHouseholdForm } from "@/components/household/create-first-household-form";
import { LegalFooter } from "@/components/legal-footer";
import { LogoutButton } from "@/components/logout-button";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { requireUserWithoutHousehold } from "@/lib/session";

// Landing spot for a signed-in user with zero HouseholdMember rows (see
// NO_HOUSEHOLD_PATH in src/lib/session.ts). The two ways back into the app
// are the same two ways anyone gets a household in the first place: create
// one (they become its OWNER), or open an invite link, which /join/[token]
// already handles for signed-in users. Logging out is offered too, since
// this may not be the account they meant to use.
export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return titleOnlyMetadata(dict.auth.noHousehold.pageTitle);
}

export default async function NoHouseholdPage() {
  const [, dict] = await Promise.all([requireUserWithoutHousehold(), getDictionary()]);
  const t = dict.auth.noHousehold;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <main className="flex w-full flex-col items-center gap-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle as="h1" className="text-xl">{t.pageTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <p className="text-sm text-muted-foreground">{t.description}</p>
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">{t.createHeading}</h2>
              <CreateFirstHouseholdForm dict={t} />
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">{t.joinHeading}</h2>
              <p className="text-sm text-muted-foreground">{t.joinDescription}</p>
            </section>
            <LogoutButton className="w-full">{t.logOut}</LogoutButton>
          </CardContent>
        </Card>
      </main>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
