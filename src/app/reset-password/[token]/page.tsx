import type { Metadata } from "next";
import { titleOnlyMetadata } from "@/lib/page-metadata";
import { XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { StatusCard, StatusCardLink } from "@/components/auth/status-card";
import { LegalFooter } from "@/components/legal-footer";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { getUsablePasswordResetEmail } from "@/lib/reset-token";

// UX-28: like /join/[token], the link is checked up front so a dead one
// (unknown, used or expired) shows the shared status card with a way to ask
// for a new link, not a form that only fails after a new password is typed.
// resetPasswordAction still re-validates on submit, since the token can be
// used or expire between this render and the submit.
export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return titleOnlyMetadata(dict.auth.resetPassword.pageTitle);
}

export default async function ResetPasswordPage(props: PageProps<"/reset-password/[token]">) {
  const [{ token }, dict] = await Promise.all([props.params, getDictionary()]);
  const email = await getUsablePasswordResetEmail(token);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      {email ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle as="h1" className="text-xl">{dict.auth.resetPassword.pageTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm token={token} email={email} dict={dict.auth.resetPassword} />
          </CardContent>
        </Card>
      ) : (
        <StatusCard
          brand={dict.auth.brand}
          icon={XCircle}
          tone="error"
          title={dict.auth.resetPassword.invalidTitle}
        >
          <p className="text-sm text-muted-foreground">
            {dict.auth.resetPassword.invalidDescription}
          </p>
          <StatusCardLink href="/forgot-password">
            {dict.auth.resetPassword.requestNewLink}
          </StatusCardLink>
        </StatusCard>
      )}
      <LegalFooter dict={dict.legal} />
    </main>
  );
}
