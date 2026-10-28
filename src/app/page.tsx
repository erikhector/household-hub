import Link from "next/link";
import {
  Sparkles,
  Package,
  ShoppingCart,
  CalendarDays,
  ChefHat,
  ListChecks,
  ScanBarcode,
  Wallet,
  LogIn,
  ArrowRight,
  UserPlus,
  ClipboardList,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LegalFooter } from "@/components/legal-footer";
import { BrandBadge } from "@/components/brand/brand-badge";
import { PhonePreview } from "@/components/landing/phone-preview";
import { ChoresNote, FridgeDoor, ReceiptNote, ShoppingNote } from "@/components/landing/fridge-door";
import { handwriting } from "@/components/landing/handwriting";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n/get-dictionary";
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
  const dict = await getDictionary();
  const landing = dict.landing;

  // The fridge-door redesign: three of the six features are shown beside
  // the fridge note they replace (the dark "swap" band); the other three
  // are magnets underneath. Between them every part of the app is still
  // named (UX-58). The magnets' icon tiles take the chart tokens, as before;
  // on the dark band they take its accent instead.
  const swaps = [
    {
      icon: ShoppingCart,
      ...landing.features.shoppingLists,
      note: <ShoppingNote dict={landing.fridge.shoppingNote} className="w-52 -rotate-3" />,
    },
    {
      icon: ListChecks,
      ...landing.features.tasks,
      note: <ChoresNote dict={landing.fridge.choresNote} className="w-48 rotate-3" />,
    },
    {
      icon: Wallet,
      ...landing.features.budget,
      note: <ReceiptNote dict={landing.fridge.receipt} className="w-44 -rotate-2" />,
    },
  ];
  const magnets = [
    { icon: Package, ...landing.features.pantry, pin: "bg-chart-1", tile: "text-chart-1 bg-chart-1/15", tilt: "-rotate-2" },
    { icon: ChefHat, ...landing.features.meals, pin: "bg-chart-2", tile: "text-chart-2 bg-chart-2/15", tilt: "rotate-1" },
    { icon: ScanBarcode, ...landing.features.scanning, pin: "bg-chart-3", tile: "text-chart-4 bg-chart-4/15", tilt: "-rotate-1" },
  ];

  const howItWorksSteps = [
    { icon: UserPlus, ...landing.howItWorks.steps.setup },
    { icon: ClipboardList, ...landing.howItWorks.steps.stock },
    { icon: CalendarDays, ...landing.howItWorks.steps.plan },
    { icon: Share2, ...landing.howItWorks.steps.share },
  ];

  // The landing CTAs carry user text that can wrap in Swedish, so they opt
  // out of the fixed button heights (UX-28) and keep a 44 px floor on touch.
  const ctaClass =
    "h-auto max-sm:h-auto pointer-coarse:h-auto max-w-full min-h-11 py-2.5 px-5 text-base whitespace-normal";

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
        {/* The hero: the pitch beside the fridge door from `lg`, above it on
            a phone, where the door puts the phone-framed list first so it's
            in the first screen. UX-28: in landscape on a phone (≈ 400 px
            tall) the greeting hides and the padding tightens so "Get
            started free" stays on screen. */}
        <section className="flex w-full max-w-6xl flex-col items-center gap-8 px-4 pt-4 pb-16 sm:pt-10 sm:pb-24 lg:flex-row lg:items-center lg:justify-between lg:gap-14 [@media(max-height:500px)]:pt-2">
          <div className="flex max-w-xl flex-col items-start gap-5 sm:gap-6">
            <p
              className={cn(
                handwriting.className,
                "-rotate-3 text-3xl font-bold text-primary [@media(max-height:500px)]:hidden",
              )}
            >
              {landing.heroEyebrow}
            </p>
            <h1 className="font-heading text-5xl leading-[0.95] font-extrabold tracking-tight text-balance sm:text-7xl lg:text-[5.5rem] [@media(max-height:500px)]:text-5xl">
              {landing.heroPrefix}
              <span className="relative inline-block text-primary">
                {landing.heroHighlight}
                {/* The full stop sits before the underline: Chrome puts a
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
            <p className="max-w-md text-pretty text-muted-foreground sm:text-lg">{landing.heroDescription}</p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <Button size="lg" className={ctaClass} render={<Link href="/signup" />}>
                {landing.getStarted}
                <ArrowRight className="size-4" />
              </Button>
              <p
                className={cn(
                  handwriting.className,
                  "max-w-xs -rotate-2 text-2xl leading-tight font-medium text-muted-foreground",
                )}
              >
                {landing.freeNote}
              </p>
            </div>
          </div>
          <FridgeDoor dict={landing.fridge} brand={dict.auth.brand}>
            <PhonePreview dict={landing.preview} className="relative rotate-2" />
          </FridgeDoor>
        </section>

        <section className="w-full bg-night px-4 py-20 text-night-foreground sm:py-28">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-12">
            <div>
              <p className={cn(handwriting.className, "-rotate-2 text-3xl font-bold text-night-accent")}>
                {landing.swap.eyebrow}
              </p>
              <h2 className="mt-3 font-heading text-4xl leading-none font-extrabold tracking-tight text-balance sm:text-6xl">
                {landing.swap.titlePrefix}
                <span className="text-night-accent">{landing.swap.titleHighlight}</span>
              </h2>
            </div>
            <ul className="flex flex-col gap-6">
              {swaps.map(({ icon: Icon, title, description, note }) => (
                <li
                  key={title}
                  className="grid grid-cols-1 items-center justify-items-center gap-6 rounded-3xl bg-night-foreground/5 p-6 ring-1 ring-night-foreground/10 sm:p-8 md:grid-cols-[16rem_auto_1fr] md:justify-items-start"
                >
                  <div className="flex justify-center md:w-full">{note}</div>
                  <ArrowRight aria-hidden="true" className="size-10 rotate-90 text-night-accent md:rotate-0" />
                  <div className="flex max-w-md flex-col items-center gap-3 text-center md:items-start md:text-left">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-night-foreground/10 text-night-accent">
                      <Icon className="size-5" />
                    </span>
                    <h3 className="font-heading text-2xl leading-tight font-bold sm:text-3xl">{title}</h3>
                    <p className="text-night-muted">{description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="flex w-full max-w-6xl flex-col gap-10 px-4 py-20 sm:py-28">
          <h2 className="text-center font-heading text-3xl font-bold tracking-tight text-balance sm:text-5xl">
            {landing.moreTitle}
          </h2>
          <ul className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            {magnets.map(({ icon: Icon, title, description, pin, tile, tilt }) => (
              <li
                key={title}
                className={cn(
                  "relative flex flex-col gap-3 rounded-3xl bg-card p-6 pt-8 ring-1 ring-foreground/10 transition-transform duration-200 motion-safe:hover:rotate-0",
                  tilt,
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute -top-3 left-1/2 size-7 -translate-x-1/2 rounded-full shadow-md ring-2 ring-note-ink/15 ring-inset",
                    pin,
                  )}
                />
                <span className={cn("flex size-10 items-center justify-center rounded-xl", tile)}>
                  <Icon className="size-5" />
                </span>
                <h3 className="font-heading text-xl leading-tight font-bold">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex w-full max-w-5xl flex-col gap-8 px-4 pb-20 sm:pb-28">
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
              {landing.howItWorks.title}
            </h2>
            <p className="max-w-md text-muted-foreground">{landing.howItWorks.subtitle}</p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {howItWorksSteps.map(({ icon: Icon, title, description }, index) => (
              <div key={title} className="flex flex-col items-center gap-3 text-center">
                <span className="relative flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <Icon className="size-6" />
                  <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                </span>
                <h3 className="font-heading text-base font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The closing call to action, as the sticky note you'd leave
            yourself. Paper in both themes, like the notes on the door. */}
        <section className="w-full px-4 pb-24">
          <div className="relative mx-auto flex w-full max-w-xl -rotate-1 flex-col items-center gap-4 bg-note-yellow px-6 pt-14 pb-12 text-center text-note-ink shadow-md sm:px-12">
            <span aria-hidden="true" className="absolute -top-3 left-1/2 h-7 w-28 -translate-x-1/2 -rotate-2 bg-note-paper/60" />
            <p className={cn(handwriting.className, "text-3xl font-bold")}>{landing.ctaEyebrow}</p>
            <h2 className="font-heading text-4xl leading-none font-extrabold tracking-tight text-balance sm:text-5xl">
              {landing.ctaTitle}
            </h2>
            <p className="max-w-md">{landing.ctaDescription}</p>
            <Button size="lg" className={cn(ctaClass, "mt-2")} render={<Link href="/signup" />}>
              <Sparkles className="size-4" />
              {landing.ctaButton}
            </Button>
          </div>
        </section>
      </main>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
