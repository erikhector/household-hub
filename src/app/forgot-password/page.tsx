import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { LegalFooter } from "@/components/legal-footer";
import { BrandBadge } from "@/components/brand/brand-badge";
import { getDictionary } from "@/lib/i18n/get-dictionary";

export default async function ForgotPasswordPage() {
  const dict = await getDictionary();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-12">
      <Link
        href="/"
        className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight"
      >
        <BrandBadge />
        {dict.auth.brand}
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{dict.auth.forgotPassword.pageTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm dict={dict.auth.forgotPassword} />
        </CardContent>
      </Card>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
