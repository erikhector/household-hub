import Link from "next/link";
import { format } from "@/lib/i18n/format";
import { getDictionary, getLocale, type Dictionary } from "@/lib/i18n/get-dictionary";
import { PublicLanguageToggle } from "@/components/language/public-language-toggle";
import { PublicThemeToggle } from "@/components/theme/public-theme-toggle";
import { CURRENT_VERSION } from "@/lib/release-notes";

/**
 * Small Terms/Privacy links + copyright line for the app's public-facing
 * pages (landing, login, signup, join). There's no shared public-page
 * layout to hang this off of (each of those pages already composes its own
 * header independently — see AGENTS.md), so it's rendered directly by each
 * page rather than via a root layout. It also carries the language toggle,
 * and the theme toggle (UX-51), since a logged-out visitor has no dashboard
 * sidebar to switch from. Not used inside the authenticated
 * dashboard shell (`src/app/dashboard/layout.tsx`), since that already has
 * its own persistent nav and doesn't need a repeated legal footer on every
 * page. The What's new link carries the current version, the same
 * "What's new · vX.Y.Z" the dashboard sidebar shows, so a visitor can see
 * which Squirrel they're looking at and what changed lately.
 */
export async function LegalFooter({ dict }: { dict: Dictionary["legal"] }) {
  const [locale, { language, theme }] = await Promise.all([getLocale(), getDictionary()]);
  return (
    <footer className="flex flex-col items-center gap-1 py-4 text-xs text-muted-foreground">
      <nav className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/terms" className="touch-target hover:text-foreground hover:underline">
          {dict.termsNavLabel}
        </Link>
        <Link href="/privacy" className="touch-target hover:text-foreground hover:underline">
          {dict.privacyNavLabel}
        </Link>
        <Link href="/privacy#cookies" className="touch-target hover:text-foreground hover:underline">
          {dict.cookiesNavLabel}
        </Link>
        <Link href="/whats-new" className="touch-target hover:text-foreground hover:underline">
          {/* One string: the link is a flex box (touch-target), which would
              trim the space before a separate version <span>. */}
          {`${dict.whatsNewNavLabel} · v${CURRENT_VERSION}`}
        </Link>
      </nav>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <PublicLanguageToggle locale={locale} dict={language} />
        <PublicThemeToggle dict={theme} />
      </div>
      <p>{format(dict.footerCopyright, { year: new Date().getFullYear() })}</p>
    </footer>
  );
}
