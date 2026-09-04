import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getInvitationForDisplay } from "@/lib/actions/household";
import { AcceptInviteForm } from "@/components/household/accept-invite-form";
import { JoinSignupForm } from "@/components/household/join-signup-form";

export default async function JoinPage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const [invitation, session] = await Promise.all([
    getInvitationForDisplay(token),
    auth(),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            {invitation ? `Join ${invitation.householdName}` : "Invalid invite"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!invitation ? (
            <p className="text-sm text-muted-foreground">
              This invite link is invalid or has expired. Ask a household member
              to send you a new one.
            </p>
          ) : session?.user ? (
            <AcceptInviteForm token={token} />
          ) : (
            <JoinSignupForm token={token} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
