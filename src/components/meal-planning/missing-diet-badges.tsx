import { Badge } from "@/components/ui/badge";
import { format } from "@/lib/i18n/format";
import { missingRequiredTags, type RecipeTag } from "@/lib/recipe-tags";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

// GAP-71: one "Not nut-free" badge per required tag the recipe lacks. The
// missing tag is named in the text (never colour alone), and it is only a
// warning: it sits beside the entry and never blocks or hides it. Renders
// nothing when the household requires nothing or the recipe fits.
export function MissingDietBadges({
  dict,
  recipeTags,
  requiredTags,
}: {
  dict: Dictionary["mealPlanning"];
  recipeTags: readonly RecipeTag[];
  requiredTags: readonly RecipeTag[];
}) {
  const missing = missingRequiredTags(recipeTags, requiredTags);
  if (missing.length === 0) return null;
  return (
    <>
      {missing.map((tag) => (
        <Badge key={tag} variant="outline" className="shrink-0">
          {format(dict.notTagBadge, { tag: dict.recipeTags[tag].toLowerCase() })}
        </Badge>
      ))}
    </>
  );
}
