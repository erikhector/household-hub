import Link from "next/link";
import type { Metadata } from "next";
import { titleOnlyMetadata } from "@/lib/page-metadata";
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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6 sm:py-12">
      <main className="flex w-full flex-col items-center gap-6">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 font-heading text-lg font-bold tracking-tight"
        >
          <BrandBadge />
          {dict.auth.brand}
        </Link>
        <SignupForm dict={dict.auth.signup} legalDict={dict.legal} />
      </main>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
