import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { XCircle } from "lucide-react";
import { BrandBadge } from "@/components/brand/brand-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getInvitationForDisplay } from "@/lib/actions/household";
import { AcceptInviteForm } from "@/components/household/accept-invite-form";
import { JoinSignupForm } from "@/components/household/join-signup-form";
import { StatusCard, StatusCardLink } from "@/components/auth/status-card";
import { LegalFooter } from "@/components/legal-footer";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";
import { buildMetadata } from "@/lib/page-metadata";

// UX-64: generateMetadata and the page both need the invitation; cache()
// makes it one lookup per request.
const loadInvitation = cache(getInvitationForDisplay);

// The link preview WhatsApp or iMessage draws for an invite names the
// household, so the person receiving it sees what they're being asked to join.
export async function generateMetadata(props: PageProps<"/join/[token]">): Promise<Metadata> {
  const { token } = await props.params;
  const [invitation, dict] = await Promise.all([loadInvitation(token), getDictionary()]);
  if (!invitation) {
    return buildMetadata({
      title: dict.auth.join.invalidTitle,
      description: dict.meta.fallbackDescription,
    });
  }
  return buildMetadata({
    title: format(dict.auth.join.joinTitle, { name: invitation.householdName }),
    description: format(dict.meta.joinDescription, { name: invitation.householdName }),
  });
}

export default async function JoinPage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const [invitation, session, dict] = await Promise.all([
    loadInvitation(token),
    auth(),
    getDictionary(),
  ]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <main className="flex w-full flex-col items-center gap-6">
        {!invitation ? (
          <StatusCard
            brand={dict.auth.brand}
            icon={XCircle}
            tone="error"
            title={dict.auth.join.invalidTitle}
          >
            <p className="text-sm text-muted-foreground">{dict.auth.join.invalidDescription}</p>
            {/* Someone who followed a dead invite may never have had an account,
                so "Back to log in" was wrong: offer the front door first (UX-62). */}
            {session?.user ? (
              <StatusCardLink href="/dashboard">{dict.auth.join.goToDashboard}</StatusCardLink>
            ) : (
              <>
                <StatusCardLink href="/">{dict.auth.join.goToSquirrel}</StatusCardLink>
                <StatusCardLink href="/login">{dict.auth.join.logIn}</StatusCardLink>
              </>
            )}
          </StatusCard>
        ) : (
          <>
            <Link
              href="/"
              className="flex min-h-11 items-center gap-2 font-heading text-lg font-bold tracking-tight"
            >
              <BrandBadge />
              {dict.auth.brand}
            </Link>
            <Card className="w-full max-w-sm">
              <CardHeader>
                <CardTitle as="h1" className="text-xl break-words">
                  {invitation.inviterName
                    ? format(dict.auth.join.invitedBy, {
                        inviter: invitation.inviterName,
                        household: invitation.householdName,
                      })
                    : format(dict.auth.join.invitedNoName, { household: invitation.householdName })}
                </CardTitle>
                <CardDescription>{dict.auth.join.pitch}</CardDescription>
              </CardHeader>
              <CardContent>
                {session?.user ? (
                  <AcceptInviteForm token={token} dict={dict.auth.join} />
                ) : (
                  <JoinSignupForm token={token} dict={dict.auth.join} legalDict={dict.legal} />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
