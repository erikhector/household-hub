import { XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getInvitationForDisplay } from "@/lib/actions/household";
import { AcceptInviteForm } from "@/components/household/accept-invite-form";
import { JoinSignupForm } from "@/components/household/join-signup-form";
import { StatusCard, StatusCardLink } from "@/components/auth/status-card";
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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      {!invitation ? (
        <StatusCard
          brand={dict.auth.brand}
          icon={XCircle}
          tone="error"
          title={dict.auth.join.invalidTitle}
        >
          <p className="text-sm text-muted-foreground">{dict.auth.join.invalidDescription}</p>
          <StatusCardLink href={session?.user ? "/dashboard" : "/login"}>
            {session?.user ? dict.auth.join.goToDashboard : dict.auth.join.backToLogin}
          </StatusCardLink>
        </StatusCard>
      ) : (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl break-words">
              {format(dict.auth.join.joinTitle, { name: invitation.householdName })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {session?.user ? (
              <AcceptInviteForm token={token} dict={dict.auth.join} />
            ) : (
              <JoinSignupForm token={token} dict={dict.auth.join} legalDict={dict.legal} />
            )}
          </CardContent>
        </Card>
      )}
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
