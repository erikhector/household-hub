import { XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { StatusCard, StatusCardLink } from "@/components/auth/status-card";
import { LegalFooter } from "@/components/legal-footer";
import { getDictionary } from "@/lib/i18n/get-dictionary";
import { isPasswordResetTokenUsable } from "@/lib/reset-token";

// UX-28: like /join/[token], the link is checked up front so a dead one
// (unknown, used or expired) shows the shared status card with a way to ask
// for a new link, not a form that only fails after a new password is typed.
// resetPasswordAction still re-validates on submit, since the token can be
// used or expire between this render and the submit.
export default async function ResetPasswordPage(props: PageProps<"/reset-password/[token]">) {
  const [{ token }, dict] = await Promise.all([props.params, getDictionary()]);
  const usable = await isPasswordResetTokenUsable(token);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      {usable ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">{dict.auth.resetPassword.pageTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm token={token} dict={dict.auth.resetPassword} />
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
    </div>
  );
}
