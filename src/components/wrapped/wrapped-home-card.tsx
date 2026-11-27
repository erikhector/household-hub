import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MascotMark } from "@/components/brand/mascot-empty-state";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// Home's pointer to Squirrel Wrapped, shown only around the turn of the year
// (isWrappedSeason: 1 December to 15 January). A quiet card with a link, not
// a button: Home has no primary action (it hands off to the feature pages).
// The page itself is in the More menu all year.
export function WrappedHomeCard({
  year,
  dict,
}: {
  year: number;
  dict: Dictionary["wrapped"]["homeCard"];
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        {/* Decorative: the heading beside it says what the card is. */}
        <MascotMark alt="" className="size-12 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="font-heading text-base font-semibold text-foreground">{format(dict.title, { year })}</h2>
          <p className="text-sm text-muted-foreground">{dict.body}</p>
          <Link
            href="/dashboard/wrapped"
            className="touch-target inline-flex items-center gap-1 self-start rounded-md text-sm font-medium text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {dict.open}
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
