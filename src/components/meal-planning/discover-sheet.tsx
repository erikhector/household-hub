"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, type DialogHandle } from "@/components/ui/dialog";
import { SearchInput } from "@/components/ui/search-input";
import { ChipScroller } from "@/components/meal-planning/chip-scroller";
import { DiscoverPreview } from "@/components/meal-planning/discover-preview";
import { searchRecipeCatalogAction, suggestRecipeIdeasAction } from "@/app/dashboard/meal-planning/discover-actions";
import { format, plural } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import type { Locale } from "@/lib/i18n/locales";
import type { CatalogResult } from "@/lib/recipe-catalog/rank";
import type { FileRecipe } from "@/lib/recipe-import/parse-file";
import { RECIPE_TAGS, type RecipeTag } from "@/lib/recipe-tags";
import { cn } from "@/lib/utils";

type MealPlanningDict = Dictionary["mealPlanning"];

// Typing waits this long after the last key before it asks the server, so a
// word typed quickly is one search, not one per letter.
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Recipe discovery: the built-in catalog, ranked by what the household has
 * in its pantry, with a search box, the diet tag chips and a preview of each
 * recipe. Saving goes through the recipe form (the parent opens it with the
 * pick as `initialRecipe`), so nothing is stored until the user has reviewed
 * it there. The sheet closes as it hands over.
 *
 * `initialResults` is the server's answer for no search and no tags, ranked
 * when the page rendered, so the sheet opens with its list already there.
 * Every other answer comes from searchRecipeCatalogAction.
 */
export function DiscoverSheet({
  dict,
  locale,
  handle,
  initialResults,
  aiAvailable,
  onSave,
  onAddToPlan,
}: {
  dict: MealPlanningDict;
  locale: Locale;
  handle: DialogHandle;
  initialResults: CatalogResult[];
  // An AI key is configured, so "Ask for ideas" is offered. Without one the
  // button is not rendered at all (the action also refuses).
  aiAvailable: boolean;
  onSave: (recipe: FileRecipe) => void;
  onAddToPlan: (recipe: FileRecipe) => void;
}) {
  const t = dict.discover;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<RecipeTag[]>([]);
  // null: no search and no tags, so the list is `initialResults` (which the
  // page refreshes after a save, so a just-saved recipe drops out of it).
  const [results, setResults] = useState<CatalogResult[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [previewing, setPreviewing] = useState<CatalogResult | null>(null);
  // AI ideas are held in memory only: nothing is stored until the user saves
  // one through the recipe form, and closing the sheet drops them.
  const [ideas, setIdeas] = useState<FileRecipe[]>([]);
  const [previewingIdea, setPreviewingIdea] = useState<FileRecipe | null>(null);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [ideasPending, startIdeasTransition] = useTransition();
  const ideasRequestId = useRef(0);
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const listTitleRef = useRef<HTMLHeadingElement>(null);
  const previewTitleRef = useRef<HTMLHeadingElement>(null);
  // Switching views removes the control that had focus (the row, or the
  // preview's Back), so focus moves to the new view's title, where a screen
  // reader announces it, rather than falling back to the page.
  const wasPreviewing = useRef(false);
  useEffect(() => {
    const now = previewing !== null || previewingIdea !== null;
    if (now === wasPreviewing.current) return;
    wasPreviewing.current = now;
    (now ? previewTitleRef : listTitleRef).current?.focus();
  }, [previewing, previewingIdea]);
  // Review Focus 4: every search gets a number, and only the latest one's
  // answer is shown. Next runs a page's Server Actions one after another, so
  // an earlier, slower query would otherwise land last and replace the list
  // for what the user typed after it.
  const requestId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(debounce.current), []);

  const browsing = query.trim() === "" && tags.length === 0;
  const shown = results ?? initialResults;
  // Browsing with nothing in the pantry that any recipe uses, the server
  // falls back to the curated featured set (rank.ts). Calling that "Good
  // with what you have" would contradict every row, so it gets its own name.
  const featured = browsing && shown.length > 0 && shown.every((result) => result.haveCount === 0);

  function search(nextQuery: string, nextTags: RecipeTag[], delay: number) {
    clearTimeout(debounce.current);
    const id = ++requestId.current;
    if (nextQuery.trim() === "" && nextTags.length === 0) {
      // Back to browsing: the page's own list, no round trip.
      setResults(null);
      setFailed(false);
      return;
    }
    const run = () =>
      startTransition(async () => {
        // M8: a dropped connection rejects the action call rather than
        // answering with an error. Uncaught, that would reach the dashboard
        // error boundary and take the sheet with it, so it shows the same
        // inline "couldn't load" + Retry and keeps the previous rows.
        let answer: Awaited<ReturnType<typeof searchRecipeCatalogAction>>;
        try {
          answer = await searchRecipeCatalogAction({ query: nextQuery, tags: nextTags });
        } catch {
          if (id === requestId.current) setFailed(true);
          return;
        }
        if (id !== requestId.current) return;
        if (answer.results) {
          setFailed(false);
          setResults(answer.results);
        } else {
          setFailed(true);
        }
      });
    if (delay > 0) debounce.current = setTimeout(run, delay);
    else run();
  }

  // Ideas use the tags selected right now; the search box doesn't apply (the
  // model works from the pantry, not a query).
  const askForIdeas = () => {
    const id = ++ideasRequestId.current;
    setIdeasError(null);
    startIdeasTransition(async () => {
      // M8: offline or a dropped connection rejects instead of answering;
      // show the inline failure rather than losing the sheet to the error
      // boundary (same as the recipe form's photo import).
      let answer: Awaited<ReturnType<typeof suggestRecipeIdeasAction>>;
      try {
        answer = await suggestRecipeIdeasAction({ tags });
      } catch {
        if (id === ideasRequestId.current) setIdeasError(t.ideasFailed);
        return;
      }
      if (id !== ideasRequestId.current) return;
      if (answer.ideas) {
        setIdeas(answer.ideas);
      } else {
        setIdeasError(answer.error ?? t.ideasFailed);
      }
    });
  };

  const changeQuery = (value: string) => {
    setQuery(value);
    search(value, tags, SEARCH_DEBOUNCE_MS);
  };
  // A chip is one deliberate tap, so it searches straight away.
  const toggleTag = (tag: RecipeTag) => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : RECIPE_TAGS.filter((t) => t === tag || tags.includes(t));
    setTags(next);
    search(query, next, 0);
  };

  // Each open starts fresh: the browse list, no search, no preview.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Closing drops the ideas and ignores an answer still on its way.
    ideasRequestId.current++;
    setIdeas([]);
    setIdeasError(null);
    setPreviewingIdea(null);
    if (next) {
      clearTimeout(debounce.current);
      requestId.current++;
      setQuery("");
      setTags([]);
      setResults(null);
      setFailed(false);
      setPreviewing(null);
      wasPreviewing.current = false;
    }
  };

  // The sheet closes as the recipe form opens over the page (the parent
  // owns that form), the same hand-off a recipe's own sheet does for Edit.
  // Like closing, it drops the AI ideas and ignores an answer still on its
  // way, so reopening doesn't show ideas from before the hand-off.
  const handOff = (action: (recipe: FileRecipe) => void) => (recipe: FileRecipe) => {
    setOpen(false);
    ideasRequestId.current++;
    setIdeas([]);
    setIdeasError(null);
    setPreviewingIdea(null);
    action(recipe);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} handle={handle}>
      <DialogContent
        // Full height on a phone from the first frame, so the sheet doesn't
        // grow and shrink as a search narrows the list; a steady height on
        // desktop for the same reason.
        className="max-sm:h-[85dvh] sm:h-[min(40rem,85dvh)] sm:max-w-md"
        initialFocus={previewing || previewingIdea ? previewTitleRef : searchRef}
      >
        {previewing || previewingIdea ? (
          <DiscoverPreview
            key={previewing ? previewing.id : `idea:${ideas.indexOf(previewingIdea!)}`}
            dict={dict}
            locale={locale}
            result={previewing ?? undefined}
            idea={previewingIdea ?? undefined}
            titleRef={previewTitleRef}
            onBack={() => {
              setPreviewing(null);
              setPreviewingIdea(null);
            }}
            onSave={handOff(onSave)}
            onAddToPlan={handOff(onAddToPlan)}
          />
        ) : (
          <>
            <DialogHeader>
              {/* The preview header's row height (its Back button's), so the
                  title sits level with the close button in both views. */}
              <div className="flex min-h-7 items-center max-sm:min-h-11 pointer-coarse:min-h-11">
                <DialogTitle ref={listTitleRef} tabIndex={-1} className="min-w-0 break-words outline-none">
                  {t.title}
                </DialogTitle>
              </div>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <SearchInput
                ref={searchRef}
                value={query}
                onValueChange={changeQuery}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchLabel}
                clearLabel={dict.clearSearch}
                autoComplete="off"
                enterKeyHint="search"
              />
              {/* -mx-4 + px-4: the chip row scrolls edge to edge of the sheet
                  while its first and last chips line up with the field. */}
              <ChipScroller
                label={t.tagsLabel}
                prevLabel={t.scrollPrev}
                nextLabel={t.scrollNext}
                className="-mx-4 [&>[role=list]]:scroll-px-4 [&>[role=list]]:px-4"
              >
                {RECIPE_TAGS.map((tag) => {
                  const pressed = tags.includes(tag);
                  return (
                    <div key={tag} role="listitem" className="flex shrink-0 snap-start">
                      <button
                        type="button"
                        aria-pressed={pressed}
                        onClick={() => toggleTag(tag)}
                        className={cn(
                          // Same chip as the recipe form's tag picker, 44 px on
                          // a phone or touch screen (M3).
                          "inline-flex min-h-8 items-center rounded-full border px-4 text-sm whitespace-nowrap outline-none transition-[color,border-color,background-color,scale] focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] max-sm:min-h-11 pointer-coarse:min-h-11",
                          pressed
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-input text-muted-foreground hover:border-primary/50",
                        )}
                      >
                        {dict.recipeTags[tag]}
                      </button>
                    </div>
                  );
                })}
              </ChipScroller>
              {aiAvailable && (
                <div className="flex flex-col items-start gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={ideasPending}
                    aria-busy={ideasPending}
                    onClick={askForIdeas}
                  >
                    <Sparkles className="size-4" aria-hidden="true" />
                    {ideasPending ? t.ideasLoading : t.askForIdeas}
                  </Button>
                  {ideasError && !ideasPending && (
                    <p role="alert" className="text-sm text-destructive">
                      {ideasError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {ideas.length > 0 && (
              <section className="flex min-w-0 flex-col gap-2" aria-labelledby="discover-ideas-title">
                <h3 id="discover-ideas-title" className="font-heading text-base font-semibold">
                  {t.ideasHeading}
                </h3>
                <ul aria-labelledby="discover-ideas-title" className="flex flex-col divide-y rounded-md border">
                  {ideas.map((idea, index) => (
                    <li key={index}>
                      <IdeaRow dict={dict} idea={idea} onOpen={() => setPreviewingIdea(idea)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="flex min-w-0 flex-col gap-2" aria-labelledby="discover-list-title">
              <h3 id="discover-list-title" className="font-heading text-base font-semibold">
                {featured ? t.featured : browsing ? t.goodWithWhatYouHave : t.results}
              </h3>
              {failed && !isPending && (
                <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-dashed p-4 text-sm">
                  <p>{t.errorLoad}</p>
                  <Button type="button" variant="outline" onClick={() => search(query, tags, 0)}>
                    {t.retry}
                  </Button>
                </div>
              )}
              {shown.length === 0 && !failed ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t.empty}
                </p>
              ) : (
                // While a search is out the previous rows stay, dimmed and
                // marked busy, rather than a spinner that makes the list jump.
                <ul
                  aria-labelledby="discover-list-title"
                  aria-busy={isPending}
                  className={cn(
                    "flex flex-col divide-y rounded-md border transition-opacity duration-(--motion-duration-base)",
                    isPending && "opacity-60",
                  )}
                >
                  {shown.map((result) => (
                    <li key={result.id}>
                      <DiscoverRow dict={dict} result={result} onOpen={() => setPreviewing(result)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DiscoverRow({
  dict,
  result,
  onOpen,
}: {
  dict: MealPlanningDict;
  result: CatalogResult;
  onOpen: () => void;
}) {
  const t = dict.discover;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-[background-color,scale] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 font-medium break-words">{result.name}</span>
        {/* "You have 0 of 6" says nothing a row without the line doesn't. */}
        {result.haveCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {format(plural(result.haveCount, t.haveCount), { count: result.haveCount, total: result.totalCount })}
          </span>
        )}
        {result.expiringMatches.length > 0 && (
          <span className="text-sm break-words text-muted-foreground">
            {format(t.usesExpiring, { items: result.expiringMatches.join(", ") })}
          </span>
        )}
        {result.tags.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {result.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {dict.recipeTags[tag]}
              </Badge>
            ))}
          </span>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function IdeaRow({ dict, idea, onOpen }: { dict: MealPlanningDict; idea: FileRecipe; onOpen: () => void }) {
  const t = dict.discover;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-[background-color,scale] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 font-medium break-words">{idea.name}</span>
        <span className="flex flex-wrap gap-1">
          <Badge variant="outline">{t.aiIdeaBadge}</Badge>
          {idea.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {dict.recipeTags[tag]}
            </Badge>
          ))}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
