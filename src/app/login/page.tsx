import Link from "next/link";
import type { Metadata } from "next";
import { titleOnlyMetadata } from "@/lib/page-metadata";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { LegalFooter } from "@/components/legal-footer";
import { BrandBadge } from "@/components/brand/brand-badge";
import { getDictionary } from "@/lib/i18n/get-dictionary";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return titleOnlyMetadata(dict.auth.login.submit);
}

export default async function LoginPage(props: PageProps<"/login">) {
  const [dict, searchParams] = await Promise.all([getDictionary(), props.searchParams]);

  const resetParam = searchParams.reset;
  const showPasswordResetSuccess =
    (Array.isArray(resetParam) ? resetParam[0] : resetParam) === "success";

  const deletedParam = searchParams.deleted;
  const showAccountDeletedSuccess =
    (Array.isArray(deletedParam) ? deletedParam[0] : deletedParam) === "success";

  // Set by src/app/session-expired/route.ts after it clears a session that
  // a password change revoked (SCALE-H), so the user isn't left guessing
  // why they suddenly had to log in again.
  const expiredParam = searchParams.expired;
  const showSessionExpired =
    (Array.isArray(expiredParam) ? expiredParam[0] : expiredParam) === "password";

  // UX-61: pre-fills the email after verifying it or resetting the password.
  const emailParam = searchParams.email;
  const initialEmail = (Array.isArray(emailParam) ? emailParam[0] : emailParam)?.slice(0, 254);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Link
        href="/"
        className="flex min-h-11 items-center gap-2 font-heading text-lg font-bold tracking-tight"
      >
        <BrandBadge />
        {dict.auth.brand}
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle as="h1" className="text-xl">{dict.auth.login.welcomeTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {showPasswordResetSuccess && (
            <p className="mb-4 text-sm text-success">{dict.auth.login.passwordResetSuccess}</p>
          )}
          {showAccountDeletedSuccess && (
            <p className="mb-4 text-sm text-success">{dict.auth.login.accountDeletedSuccess}</p>
          )}
          {showSessionExpired && (
            <p className="mb-4 text-sm text-muted-foreground">
              {dict.auth.login.sessionExpiredPasswordChanged}
            </p>
          )}
          <LoginForm dict={dict.auth.login} initialEmail={initialEmail} />
        </CardContent>
      </Card>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
