import Link from "next/link";
import type { Metadata } from "next";
import { titleOnlyMetadata } from "@/lib/page-metadata";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "@/components/auth/signup-form";
import { LegalFooter } from "@/components/legal-footer";
import { BrandBadge } from "@/components/brand/brand-badge";
import { getDictionary } from "@/lib/i18n/get-dictionary";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return titleOnlyMetadata(dict.auth.signup.pageTitle);
}

export default async function SignupPage() {
  const dict = await getDictionary();

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
          <CardTitle as="h1" className="text-xl">{dict.auth.signup.pageTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupForm dict={dict.auth.signup} legalDict={dict.legal} />
        </CardContent>
      </Card>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
