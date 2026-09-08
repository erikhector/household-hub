import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getInvitationForDisplay } from "@/lib/actions/household";
import { AcceptInviteForm } from "@/components/household/accept-invite-form";
import { JoinSignupForm } from "@/components/household/join-signup-form";
import { LegalFooter } from "@/components/legal-footer";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";

export default async function JoinPage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const [invitation, session, dict] = await Promise.all([
    getInvitationForDisplay(token),
    auth(),
    getDictionary(),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl break-words">
            {invitation
              ? format(dict.auth.join.joinTitle, { name: invitation.householdName })
              : dict.auth.join.invalidTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!invitation ? (
            <p className="text-sm text-muted-foreground">{dict.auth.join.invalidDescription}</p>
          ) : session?.user ? (
            <AcceptInviteForm token={token} dict={dict.auth.join} />
          ) : (
            <JoinSignupForm token={token} dict={dict.auth.join} legalDict={dict.legal} />
          )}
        </CardContent>
      </Card>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
