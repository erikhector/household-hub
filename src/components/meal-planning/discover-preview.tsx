"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { ArrowLeft, BookmarkPlus, CalendarPlus, Check, Circle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUnitLabel } from "@/components/units-provider";
import { getCatalogRecipeAction } from "@/app/dashboard/meal-planning/discover-actions";
import { formatCookQuantity, splitSteps } from "@/lib/cook-mode-calc";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import type { CatalogResult } from "@/lib/recipe-catalog/rank";
import type { FileRecipe } from "@/lib/recipe-import/parse-file";

type MealPlanningDict = Dictionary["mealPlanning"];

// `haves` is null for an AI idea: it isn't matched against the pantry, so
// there is nothing to mark.
type Loaded = { recipe: FileRecipe; haves: boolean[] | null };

// One catalog recipe, opened from a Discover row: what it needs, which of
// that the pantry already covers, and the steps, with Save and Add to plan.
// It sits inside the Discover sheet's own popup (a view, not a second
// dialog), so Back returns to the list with its search and filters intact.
// The row's result is shown at once (name, servings, tags) while the full
// recipe loads, so the header doesn't jump when it arrives.
//
// An AI idea (`idea`) has no catalog id to load: it renders straight from the
// in-memory recipe the action returned, with no Have it / Missing markers and
// no "You have N of M" line, and the same Save / Add to plan actions.
export function DiscoverPreview({
  dict,
  locale,
  result,
  idea,
  titleRef,
  onBack,
  onSave,
  onAddToPlan,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  result?: CatalogResult;
  idea?: FileRecipe;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onSave: (recipe: FileRecipe) => void;
  onAddToPlan: (recipe: FileRecipe) => void;
}) {
  const t = dict.discover;
  const unitLabel = useUnitLabel();
  const [loaded, setLoaded] = useState<Loaded | null>(idea ? { recipe: idea, haves: null } : null);
  const [failed, setFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  // A slow answer for a recipe the user has already backed out of (or a
  // retry that overtook an earlier try) is dropped: only the latest counts.
  const requestId = useRef(0);
  // The latest onBack, read when an answer lands, so a parent re-render
  // (a new arrow function) doesn't refetch the recipe.
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  const resultId = result?.id;
  const load = useCallback(() => {
    if (resultId === undefined) return;
    const id = ++requestId.current;
    startTransition(async () => {
      // Offline or a dropped connection rejects the call itself (M8). Left
      // uncaught it would reach the dashboard error boundary and take the
      // whole sheet with it, so it shows the inline failure with Retry
      // instead, as the search and the ideas call in discover-sheet.tsx do.
      let answer: Awaited<ReturnType<typeof getCatalogRecipeAction>>;
      try {
        answer = await getCatalogRecipeAction(resultId);
      } catch {
        if (id === requestId.current) setFailed(true);
        return;
      }
      if (id !== requestId.current) return;
      if (answer.recipe && answer.haves) {
        setFailed(false);
        setLoaded({ recipe: answer.recipe, haves: answer.haves });
        return;
      }
      // Gone from the catalog (a deploy removed it since the list loaded):
      // nothing to retry, so say so and go back to the list.
      if (answer.notFound) {
        toast.error(answer.error ?? t.errorNotFound);
        onBackRef.current();
        return;
      }
      setFailed(true);
    });
  }, [resultId, t.errorNotFound]);

  useEffect(() => {
    load();
    const requests = requestId;
    return () => {
      // Unmounted (Back, or the sheet closed): ignore whatever comes back.
      requests.current++;
    };
  }, [load]);

  const servings = loaded?.recipe.servings ?? result?.servings ?? 1;
  const tags = idea?.tags ?? result?.tags ?? [];
  const steps = loaded ? splitSteps(loaded.recipe.instructions) : [];

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t.back} onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <DialogTitle ref={titleRef} tabIndex={-1} className="min-w-0 break-words outline-none">
            {loaded?.recipe.name ?? result?.name}
          </DialogTitle>
        </div>
        <DialogDescription>
          {format(plural(servings, dict.servingsCount), { count: servings })}
          {/* Same rule as the list rows: "You have 0 of N" is noise. */}
          {result && result.haveCount > 0 && (
            <>
              {" · "}
              {format(plural(result.haveCount, t.haveCount), { count: result.haveCount, total: result.totalCount })}
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      {(idea || tags.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {idea && <Badge variant="outline">{t.aiIdeaBadge}</Badge>}
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {dict.recipeTags[tag]}
            </Badge>
          ))}
        </div>
      )}

      {failed && !isPending ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-dashed p-4 text-sm">
          <p>{t.errorLoad}</p>
          <Button type="button" variant="outline" onClick={load}>
            {t.retry}
          </Button>
        </div>
      ) : !loaded ? (
        // Loading: placeholder lines the size of the ingredient list, so
        // the sheet keeps its shape (M8: no jump when the recipe arrives).
        <div aria-busy="true" className="flex animate-pulse flex-col gap-2 motion-reduce:animate-none">
          {Array.from({ length: Math.min(Math.max(result?.totalCount ?? 3, 3), 8) }).map((_, i) => (
            <div key={i} aria-hidden="true" className="h-5 rounded bg-muted" />
          ))}
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-1" aria-labelledby="discover-ingredients">
            <h3 id="discover-ingredients" className="font-medium">
              {dict.ingredientsLabel}
            </h3>
            {/* Have it / Missing by icon AND word (DESIGN.md: never colour
                alone), the word in its own column so a long name wraps
                beside it instead of pushing it off the row. */}
            <ul className="flex flex-col divide-y">
              {loaded.recipe.ingredients.map((ingredient, index) => {
                const markers = loaded.haves !== null;
                const have = loaded.haves?.[index] ?? false;
                return (
                  <li key={index} className="flex items-start gap-2 py-1.5">
                    {markers &&
                      (have ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      ) : (
                        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ))}
                    <span className="min-w-0 flex-1 break-words">
                      <span className="text-muted-foreground tabular-nums">
                        {formatCookQuantity(ingredient.quantity, 1, locale)}
                        {ingredient.unit ? ` ${unitLabel(ingredient.unit, ingredient.quantity)}` : ""}
                      </span>{" "}
                      {ingredient.name}
                      {ingredient.note && <span className="text-muted-foreground"> ({ingredient.note})</span>}
                    </span>
                    {markers && (
                      <span className={have ? "shrink-0 text-success" : "shrink-0 text-muted-foreground"}>
                        {have ? t.haveIt : t.missing}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          {steps.length > 0 && (
            <section className="flex flex-col gap-1" aria-labelledby="discover-steps">
              <h3 id="discover-steps" className="font-medium">
                {dict.instructionsLabel}
              </h3>
              <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
                {steps.map((step, index) => (
                  <li key={index} className="break-words">
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      {/* M2: the sheet's actions stick to its bottom on a phone, so a long
          ingredient list scrolls under them. Save is the one primary: it's
          what the preview is for; Add to plan saves first too (the plan
          can only hold saved recipes), then asks for the day. */}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={!loaded}
          onClick={() => loaded && onAddToPlan(loaded.recipe)}
        >
          <CalendarPlus className="size-4" />
          {t.addToPlan}
        </Button>
        <Button type="button" disabled={!loaded} onClick={() => loaded && onSave(loaded.recipe)}>
          <BookmarkPlus className="size-4" />
          {t.save}
        </Button>
      </DialogFooter>
    </>
  );
}
