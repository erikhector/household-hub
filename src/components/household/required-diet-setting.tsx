"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setRequiredTagsAction } from "@/lib/actions/household";
import { RECIPE_TAGS, type RecipeTag } from "@/lib/recipe-tags";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { cn } from "@/lib/utils";

// GAP-71's household "must be" diet: the same toggle chips the recipe form
// uses (RECIPE_TAGS order, aria-pressed). A click action like AutoAddSetting:
// every toggle saves the whole set, the chips flip at once via useOptimistic
// and snap back by themselves if the save fails. Any member may edit it.
export function RequiredDietSetting({
  tags,
  dict,
  tagLabels,
}: {
  tags: RecipeTag[];
  dict: Dictionary["household"]["requiredDiet"];
  tagLabels: Dictionary["mealPlanning"]["recipeTags"];
}) {
  const [isPending, startTransition] = useTransition();
  const [optimisticTags, setOptimisticTags] = useOptimistic(tags);

  function toggle(tag: RecipeTag) {
    const next = optimisticTags.includes(tag)
      ? optimisticTags.filter((t) => t !== tag)
      : RECIPE_TAGS.filter((t) => t === tag || optimisticTags.includes(t));
    startTransition(async () => {
      setOptimisticTags(next);
      const result = await setRequiredTagsAction(next);
      if (result.error) toast.error(result.error);
      else toast.success(dict.savedToast);
    });
  }

  return (
    <div className="list-bleed flex flex-col gap-3 rounded-md border p-4">
      <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
      <p className="text-sm text-muted-foreground">{dict.description}</p>
      <div role="group" aria-label={dict.groupLabel} className="flex flex-wrap gap-2">
        {RECIPE_TAGS.map((tag) => {
          const isSelected = optimisticTags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={isSelected}
              disabled={isPending}
              onClick={() => toggle(tag)}
              className={cn(
                "rounded-full border px-4 py-1 text-sm transition-colors max-sm:min-h-11 pointer-coarse:min-h-11",
                isSelected
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-input text-muted-foreground hover:border-primary/50",
              )}
            >
              {tagLabels[tag]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
