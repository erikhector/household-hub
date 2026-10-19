import Link from "next/link";
import type { Metadata } from "next";
import { BrandBadge } from "@/components/brand/brand-badge";
import { LegalFooter } from "@/components/legal-footer";
import { ReleaseList } from "@/components/whats-new/release-list";
import { format } from "@/lib/i18n/format";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { CURRENT_VERSION } from "@/lib/release-notes";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: `${dict.whatsNew.title} — Squirrel` };
}

// The public release history, linked from every public page's footer with
// the current version, so someone weighing up Squirrel can see that it's
// alive and what changed lately. Same list as /dashboard/whats-new, minus
// the "seen" cookie: that only clears a member's unread dot, and a visitor
// has no dot. Open to everyone, logged in or not, like /privacy.
export default async function PublicWhatsNewPage() {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const t = dict.whatsNew;

  return (
    <div className="flex flex-1 flex-col items-center px-4 pt-12">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 self-start font-heading text-lg font-bold tracking-tight"
        >
          <BrandBadge />
          {dict.auth.brand}
        </Link>
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
          <p className="text-xs text-muted-foreground">
            {format(t.latestVersion, { version: CURRENT_VERSION })}
          </p>
        </header>
        <ReleaseList dict={t} locale={locale} />
      </div>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
