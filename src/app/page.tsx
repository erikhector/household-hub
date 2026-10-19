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
  Users,
  UserPlus,
  ClipboardList,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LegalFooter } from "@/components/legal-footer";
import { BrandBadge } from "@/components/brand/brand-badge";
import { PhonePreview } from "@/components/landing/phone-preview";
import { getDictionary } from "@/lib/i18n/get-dictionary";

export default async function Home() {
  const dict = await getDictionary();

  // UX-58: six cards, so the grid fills evenly at two and three columns.
  // The icon tiles take the chart tokens (the same hues the raw oklch values
  // here used to copy) so they follow the theme like every other colour.
  const features = [
    { icon: Package, ...dict.landing.features.pantry, color: "text-chart-1 bg-chart-1/15" },
    { icon: ShoppingCart, ...dict.landing.features.shoppingLists, color: "text-primary bg-primary/15" },
    { icon: ChefHat, ...dict.landing.features.meals, color: "text-chart-2 bg-chart-2/15" },
    { icon: ListChecks, ...dict.landing.features.tasks, color: "text-chart-5 bg-chart-5/15" },
    { icon: ScanBarcode, ...dict.landing.features.scanning, color: "text-chart-4 bg-chart-4/15" },
    { icon: Wallet, ...dict.landing.features.budget, color: "text-chart-3 bg-chart-3/15" },
  ];

  const howItWorksSteps = [
    { icon: UserPlus, ...dict.landing.howItWorks.steps.setup },
    { icon: ClipboardList, ...dict.landing.howItWorks.steps.stock },
    { icon: CalendarDays, ...dict.landing.howItWorks.steps.plan },
    { icon: Share2, ...dict.landing.howItWorks.steps.share },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-6 [@media(max-height:500px)]:py-3">
        <div className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
          <BrandBadge />
          {dict.auth.brand}
        </div>
        <Button variant="ghost" render={<Link href="/login" />}>
          <LogIn className="size-4" />
          {dict.landing.logIn}
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center px-4">
        {/* UX-58: the product leads. The phone-framed shopping list sits
            beside the pitch from `lg` and right under the buttons on a phone,
            where the tighter top padding keeps it in the first screen.
            UX-28: in landscape on a phone (≈ 400 px tall) the generous hero
            padding pushed "Get started" below the fold, so tighten it there. */}
        <section className="flex w-full max-w-5xl flex-col items-center gap-6 pt-6 pb-16 sm:gap-10 sm:py-20 lg:flex-row lg:justify-between [@media(max-height:500px)]:py-6">
          <div className="flex max-w-2xl flex-col items-center gap-4 text-center sm:gap-6 lg:items-start lg:text-left [@media(max-height:500px)]:gap-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              {dict.landing.heroBadge}
            </span>
            <h1 className="font-heading text-4xl leading-tight font-extrabold tracking-tight text-balance sm:text-5xl">
              {dict.landing.heroPrefix}
              <span className="text-primary">{dict.landing.heroHighlight}</span>
              {dict.landing.heroSuffix}
            </h1>
            <p className="max-w-md text-balance text-muted-foreground sm:text-lg">
              {dict.landing.heroDescription}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-auto max-sm:h-auto pointer-coarse:h-auto max-w-full min-h-9 max-sm:min-h-11 pointer-coarse:min-h-11 py-2 text-base whitespace-normal" render={<Link href="/signup" />}>
                <Sparkles className="size-4" />
                {dict.landing.getStarted}
                <ArrowRight className="size-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-auto max-sm:h-auto pointer-coarse:h-auto max-w-full min-h-9 max-sm:min-h-11 pointer-coarse:min-h-11 py-2 text-base whitespace-normal"
                render={<Link href="/login" />}
              >
                <LogIn className="size-4" />
                {dict.landing.logIn}
              </Button>
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="size-4" />
              {dict.landing.freeNote}
            </p>
          </div>
          <PhonePreview dict={dict.landing.preview} />
        </section>

        <section className="grid w-full max-w-5xl grid-cols-1 gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description, color }) => (
            <Card key={title} className="transition-transform hover:-translate-y-1">
              <CardHeader>
                <span
                  className={`mb-1 flex size-10 items-center justify-center rounded-xl ${color}`}
                >
                  <Icon className="size-5" />
                </span>
                <CardTitle className="text-lg">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{description}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="flex w-full max-w-5xl flex-col gap-8 pb-20 sm:pb-28">
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
              {dict.landing.howItWorks.title}
            </h2>
            <p className="max-w-md text-muted-foreground">{dict.landing.howItWorks.subtitle}</p>
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

        <section className="flex w-full max-w-2xl flex-col items-center gap-5 rounded-3xl bg-primary/10 px-6 py-12 text-center mb-20">
          <h2 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            {dict.landing.ctaTitle}
          </h2>
          <p className="max-w-md text-muted-foreground">{dict.landing.ctaDescription}</p>
          <Button size="lg" className="h-auto max-sm:h-auto pointer-coarse:h-auto max-w-full min-h-9 max-sm:min-h-11 pointer-coarse:min-h-11 py-2 text-base whitespace-normal" render={<Link href="/signup" />}>
            <Sparkles className="size-4" />
            {dict.landing.ctaButton}
          </Button>
        </section>
      </main>
      <LegalFooter dict={dict.legal} />
    </div>
  );
}
