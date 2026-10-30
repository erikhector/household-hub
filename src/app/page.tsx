import Link from "next/link";
import { ArrowRight, LogIn, Package, Receipt, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/legal-footer";
import { BrandBadge } from "@/components/brand/brand-badge";
import { PhonePreview } from "@/components/landing/phone-preview";
import { UnitsProvider } from "@/components/units-provider";
import { handwriting } from "@/components/landing/handwriting";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { buildMetadata } from "@/lib/page-metadata";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return buildMetadata({
    title: dict.meta.homeTitle,
    description: dict.meta.homeDescription,
    absoluteTitle: true,
  });
}

export default async function Home() {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const landing = dict.landing;

  // UX-58, list-first: the page makes one promise (the shared shopping list
  // that keeps itself up to date), shows it once (the phone preview and its
  // demo), names the three things the list does for a household every
  // week, and asks once. The pantry, meals and budget are mentioned as
  // what's there when you want it, not sold one by one: a new household
  // starts from the list, and the rest of the app follows from it.
  const benefits = [
    { icon: ShoppingCart, ...landing.benefits.list, tile: "text-chart-1 bg-chart-1/15" },
    { icon: Package, ...landing.benefits.pantry, tile: "text-chart-2 bg-chart-2/15" },
    { icon: Receipt, ...landing.benefits.receipt, tile: "text-chart-3 bg-chart-3/15" },
  ];

  // The landing CTAs carry user text that can wrap in Swedish, so they opt
  // out of the fixed button heights (UX-28) and keep a 44 px floor on touch.
  const ctaClass =
    "h-auto max-sm:h-auto pointer-coarse:h-auto max-w-full min-h-11 py-2.5 px-5 text-base whitespace-normal";

  // The hero's entrance: each piece rises in after the one before it, on
  // the entrance tokens. The delays sit under motion-safe too, because the
  // reduced-motion block collapses durations but not delays, and a delayed
  // `both` animation would hold the text invisible until it ran.
  const rise = "motion-safe:animate-landing-rise";

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-6 [@media(max-height:500px)]:py-3">
        <div className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
          <BrandBadge />
          {dict.auth.brand}
        </div>
        <Button variant="ghost" className="min-h-11" render={<Link href="/login" />}>
          <LogIn className="size-4" />
          {landing.logIn}
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center">
        {/* The hero: the pitch beside the phone from `lg`, above it on a
            phone, where the preview still starts in the first screen
            (e2e/landing.spec.ts). UX-28: in landscape on a phone (≈ 400 px
            tall) the greeting hides and the padding tightens so the button
            stays on screen. UX-9: at 200% text a single word of the
            headline is wider than a phone, so the column is capped at the
            screen and breaks long words rather than scrolling. */}
        <section className="flex w-full max-w-6xl flex-col items-center gap-10 px-4 pt-4 pb-16 sm:pt-10 sm:pb-24 lg:flex-row lg:items-center lg:justify-between lg:gap-14 [@media(max-height:500px)]:pt-2">
          <div className="flex w-full max-w-xl min-w-0 flex-col items-start gap-5 break-words sm:gap-6">
            <p
              className={cn(
                handwriting.className,
                rise,
                "-rotate-3 text-3xl font-bold text-primary [@media(max-height:500px)]:hidden",
              )}
            >
              {landing.heroEyebrow}
            </p>
            <h1
              className={cn(
                rise,
                "max-w-full font-heading text-5xl leading-[0.95] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl motion-safe:[animation-delay:60ms] [@media(max-height:500px)]:text-4xl",
              )}
            >
              {landing.heroPrefix}
              <span className="relative inline-block max-w-full text-primary">
                {landing.heroHighlight}
                {/* The suffix sits before the underline: Chrome puts a
                    space around an <svg> in the heading's accessible name. */}
                <span className="text-foreground">{landing.heroSuffix}</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 320 40"
                  preserveAspectRatio="none"
                  className="absolute -bottom-[0.18em] -left-[2%] h-[0.3em] w-[104%] text-chart-2"
                >
                  <path
                    d="M6 28 C 80 8, 170 6, 314 22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="9"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>
            <p
              className={cn(
                rise,
                "max-w-md text-pretty text-muted-foreground sm:text-lg motion-safe:[animation-delay:120ms]",
              )}
            >
              {landing.heroDescription}
            </p>
            <div className={cn(rise, "flex flex-wrap items-center gap-x-5 gap-y-3 motion-safe:[animation-delay:180ms]")}>
              <Button size="lg" className={ctaClass} render={<Link href="/signup" />}>
                {landing.getStarted}
                <ArrowRight className="size-4" />
              </Button>
              <p className="max-w-xs text-sm text-muted-foreground">{landing.freeNote}</p>
            </div>
          </div>
          {/* The product shot is the shopping list's own member view with
              example rows (see PhonePreview), so it takes the unit labels and
              dictionary slices the dashboard page gives it. */}
          <UnitsProvider labels={dict.units} plurals={dict.unitsPlural}>
            <PhonePreview
              dict={landing.preview}
              listDict={dict.shoppingList}
              autoAddDict={dict.inventory.autoAdd}
              barcodeDict={dict.barcodeScanner}
              exportLabel={dict.export.button}
              locale={locale}
              className={cn(rise, "motion-safe:[animation-delay:240ms]")}
            />
          </UnitsProvider>
        </section>

        <section className="flex w-full max-w-6xl flex-col gap-8 px-4 pb-20 sm:pb-28">
          <div className="flex flex-col gap-2">
            <h2 className="max-w-2xl font-heading text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
              {landing.benefitsTitle}
            </h2>
            <p className="max-w-2xl text-muted-foreground">{landing.benefitsSubtitle}</p>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
            {benefits.map(({ icon: Icon, title, description, example, tile }) => (
              <li
                key={title}
                className="flex flex-col gap-3 rounded-3xl bg-card p-6 ring-1 ring-foreground/10 motion-safe:transition-transform motion-safe:duration-(--motion-duration-base) motion-safe:hover:-translate-y-0.5"
              >
                <span className={cn("flex size-11 items-center justify-center rounded-xl", tile)}>
                  <Icon className="size-5" />
                </span>
                <h3 className="font-heading text-xl leading-tight font-bold">{title}</h3>
                <p className="text-muted-foreground">{description}</p>
                <p
                  aria-hidden="true"
                  className={cn(handwriting.className, "mt-auto rounded-xl bg-muted px-3 py-1.5 text-xl font-medium")}
                >
                  {example}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* The closing call to action, as the sticky note you'd leave
            yourself. Paper in both themes, like the notes beside the phone. */}
        <section className="w-full px-4 pb-24">
          <div className="relative mx-auto flex w-full max-w-xl -rotate-1 flex-col items-center gap-4 bg-note-yellow px-6 pt-14 pb-12 text-center text-note-ink shadow-md motion-safe:transition-transform motion-safe:duration-(--motion-duration-base) motion-safe:hover:rotate-0 sm:px-12">
            <span aria-hidden="true" className="absolute -top-3 left-1/2 h-7 w-28 -translate-x-1/2 -rotate-2 bg-note-paper/60" />
            <p className={cn(handwriting.className, "text-3xl font-bold")}>{landing.ctaEyebrow}</p>
            <h2 className="font-heading text-4xl leading-none font-extrabold tracking-tight text-balance sm:text-5xl">
              {landing.ctaTitle}
            </h2>
            <p className="max-w-md">{landing.ctaDescription}</p>
            <Button size="lg" className={cn(ctaClass, "mt-2")} render={<Link href="/signup" />}>
              {landing.ctaButton}
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      </main>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
