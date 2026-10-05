import Link from "next/link";
import { format } from "@/lib/i18n/format";
import { getDictionary, getLocale, type Dictionary } from "@/lib/i18n/get-dictionary";
import { PublicLanguageToggle } from "@/components/language/public-language-toggle";

/**
 * Small Terms/Privacy links + copyright line for the app's public-facing
 * pages (landing, login, signup, join). There's no shared public-page
 * layout to hang this off of (each of those pages already composes its own
 * header independently — see AGENTS.md), so it's rendered directly by each
 * page rather than via a root layout. It also carries the language toggle,
 * since a logged-out visitor has no dashboard sidebar to switch from. Not used inside the authenticated
 * dashboard shell (`src/app/dashboard/layout.tsx`), since that already has
 * its own persistent nav and doesn't need a repeated legal footer on every
 * page.
 */
export async function LegalFooter({ dict }: { dict: Dictionary["legal"] }) {
  const [locale, { language }] = await Promise.all([getLocale(), getDictionary()]);
  return (
    <footer className="flex flex-col items-center gap-1 py-4 text-xs text-muted-foreground">
      <nav className="flex items-center gap-4">
        <Link href="/terms" className="hover:text-foreground hover:underline">
          {dict.termsNavLabel}
        </Link>
        <Link href="/privacy" className="hover:text-foreground hover:underline">
          {dict.privacyNavLabel}
        </Link>
        <Link href="/privacy#cookies" className="hover:text-foreground hover:underline">
          {dict.cookiesNavLabel}
        </Link>
      </nav>
      <PublicLanguageToggle locale={locale} dict={language} />
      <p>{format(dict.footerCopyright, { year: new Date().getFullYear() })}</p>
    </footer>
  );
}
