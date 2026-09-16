import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { LegalFooter } from "@/components/legal-footer";
import { getDictionary } from "@/lib/i18n/get-dictionary";

// No server-side token-validity check before rendering (unlike
// /join/[token], which looks up the invitation up front to show an
// "invalid invite" state immediately) — resetPasswordAction already
// validates the token exists/unused/unexpired on submit and reports that
// inline, which keeps this page simple without adding another code path
// that touches PasswordResetToken rows.
export default async function ResetPasswordPage(props: PageProps<"/reset-password/[token]">) {
  const [{ token }, dict] = await Promise.all([props.params, getDictionary()]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{dict.auth.resetPassword.pageTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm token={token} dict={dict.auth.resetPassword} />
        </CardContent>
      </Card>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
