import Link from "next/link";
import {
  Sparkles,
  Package,
  ShoppingCart,
  CalendarDays,
  Wallet,
  LogIn,
  ArrowRight,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const features = [
  {
    icon: Package,
    title: "Pantry that watches itself",
    description:
      "Log what's in the cupboard once. We'll flag anything running low before you're stuck without it.",
    color: "text-[oklch(0.75_0.19_340)] bg-[oklch(0.75_0.19_340/0.15)]",
  },
  {
    icon: ShoppingCart,
    title: "Shopping lists that build themselves",
    description:
      "Low-stock items hop onto the list automatically, so nobody forgets the milk again.",
    color: "text-primary bg-primary/15",
  },
  {
    icon: CalendarDays,
    title: "Meals, planned not panicked",
    description: "Line up the week's meals against what's already in the pantry.",
    color: "text-[oklch(0.78_0.15_70)] bg-[oklch(0.78_0.15_70/0.15)]",
  },
  {
    icon: Wallet,
    title: "Budget without the spreadsheet",
    description: "Track household spending and see where the grocery money actually goes.",
    color: "text-[oklch(0.72_0.14_180)] bg-[oklch(0.72_0.14_180/0.15)]",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-6">
        <div className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="size-4" />
          </span>
          Household Hub
        </div>
        <Button variant="ghost" render={<Link href="/login" />}>
          <LogIn className="size-4" />
          Log in
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center px-4">
        <section className="flex max-w-2xl flex-col items-center gap-6 py-16 text-center sm:py-24">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" />
            One home for your whole household
          </span>
          <h1 className="font-heading text-4xl leading-tight font-extrabold tracking-tight text-balance sm:text-5xl">
            Run your household like a{" "}
            <span className="text-primary">dream team</span>, not a scramble
          </h1>
          <p className="max-w-md text-balance text-muted-foreground sm:text-lg">
            Track what&apos;s in the pantry, auto-generate shopping lists, plan meals,
            and keep the budget honest &mdash; all in one playful place, shared with
            everyone at home.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="text-base" render={<Link href="/signup" />}>
              <Sparkles className="size-4" />
              Get started free
              <ArrowRight className="size-4" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="text-base"
              render={<Link href="/login" />}
            >
              <LogIn className="size-4" />
              Log in
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-4" />
            Free for the whole household &mdash; invite everyone, no extra seats
          </p>
        </section>

        <section className="grid w-full max-w-5xl grid-cols-1 gap-4 pb-20 sm:grid-cols-2 sm:pb-28">
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

        <section className="flex w-full max-w-2xl flex-col items-center gap-5 rounded-3xl bg-primary/10 px-6 py-12 text-center mb-20">
          <h2 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            Ready to get your household in order?
          </h2>
          <p className="max-w-md text-muted-foreground">
            Setting up takes less than a minute &mdash; no credit card, no chores.
          </p>
          <Button size="lg" className="text-base" render={<Link href="/signup" />}>
            <Sparkles className="size-4" />
            Create your household
          </Button>
        </section>
      </main>
    </div>
  );
}
