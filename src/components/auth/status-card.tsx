import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BrandBadge } from "@/components/brand/brand-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// UX-28: the one card every token-link page (join, share, reset password,
// verify email, unsubscribe) shows for a status: brand mark, a tinted icon,
// a title, then the message and the way out as children. Before this each
// page laid out its invalid-link state differently (some had an icon, some
// no logo, one no title). Presentational only, so it renders from both
// Server and Client Components.
export function StatusCard({
  brand,
  icon: Icon,
  tone,
  title,
  children,
}: {
  brand: string;
  icon: LucideIcon;
  tone: "error" | "success" | "neutral";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Link
        href="/"
        className="flex min-h-11 items-center gap-2 font-heading text-lg font-bold tracking-tight"
      >
        <BrandBadge />
        {brand}
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Icon
            aria-hidden="true"
            className={cn(
              "mx-auto mb-1 size-10",
              tone === "error" && "text-destructive",
              tone === "success" && "text-success",
              tone === "neutral" && "text-muted-foreground",
            )}
          />
          <CardTitle as="h1" className="text-xl break-words">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 text-center">{children}</CardContent>
      </Card>
    </>
  );
}

// The recovery link under a status message. Inline in running text it would
// be exempt from M3, but it stands alone, so it gets a 44 px target.
export function StatusCardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
    >
      {children}
    </Link>
  );
}
