import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyEmailClient } from "@/components/auth/verify-email-client";
import { LegalFooter } from "@/components/legal-footer";
import { auth } from "@/lib/auth";
import { getDictionary } from "@/lib/i18n/get-dictionary";

// No server-side token-validity check before rendering (same reasoning as
// /reset-password/[token]'s page comment) — verifyEmailAction already
// validates the token exists/unused/unexpired and reports that inline. The
// actual mark-as-verified write deliberately does NOT happen here during
// render: node_modules/next/dist/docs/01-app/02-guides/data-security.md's
// "Avoiding side-effects during rendering" section calls a GET-triggered DB
// mutation during render an anti-pattern (its "BAD" example is structurally
// the same shape a render-time token-consuming verify page would be) and
// recommends a Server Action instead — see VerifyEmailClient, which
// auto-submits a real <form>/Server Action on mount to keep the "click the
// link, see verified" UX without mutating inside this Server Component.
//
// `session` is only used to point an invalid/expired-link error state at
// the right recovery link: an already-signed-in visitor gets sent to the
// dashboard (where the resend banner lives), everyone else to /login first.
export default async function VerifyEmailPage(props: PageProps<"/verify-email/[token]">) {
  const [{ token }, session, dict] = await Promise.all([props.params, auth(), getDictionary()]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{dict.auth.verifyEmail.pageTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <VerifyEmailClient
            token={token}
            isAuthenticated={Boolean(session?.user)}
            dict={dict.auth.verifyEmail}
          />
        </CardContent>
      </Card>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
