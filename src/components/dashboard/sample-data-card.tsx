// UX-136: the overview's opt-in sample-data card. Server-rendered and
// stateless: a household with nothing in it is offered "Try with sample
// data", and one that has the sample is shown the way out. The offer is a plain
// form posting a Server Action with PendingSubmitButton (DESIGN.md M5); the
// clear sits behind a confirm dialog in its own small Client Component.
// Outline, never solid: it is an aside, and the page keeps one primary.

import { FlaskConical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PendingSubmitButton } from "@/components/dashboard/pending-submit-button";
import { ClearSampleDataButton } from "@/components/dashboard/clear-sample-data-button";
import { seedSampleDataAction } from "@/lib/actions/sample-data";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function SampleDataCard({
  mode,
  dict,
}: {
  mode: "offer" | "clear";
  dict: Dictionary["dashboard"]["sampleData"];
}) {
  const offer = mode === "offer";
  return (
    <Card className={offer ? undefined : "border-dashed"}>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span
          className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary sm:flex"
          aria-hidden
        >
          <FlaskConical className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-base font-semibold">{offer ? dict.tryTitle : dict.clearTitle}</h2>
          <p className="text-sm text-muted-foreground">{offer ? dict.tryBody : dict.clearBody}</p>
        </div>
        {offer ? (
          <form action={seedSampleDataAction} className="shrink-0">
            <PendingSubmitButton variant="outline" className="w-full sm:w-auto">
              {dict.tryButton}
            </PendingSubmitButton>
          </form>
        ) : (
          <div className="shrink-0">
            <ClearSampleDataButton dict={dict} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
