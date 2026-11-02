import type { RecipeTag } from "@/lib/recipe-tags";

export type Localized<T> = { en: T; sv: T };

export type CatalogIngredient = {
  name: Localized<string>;
  quantity: number;
  unit: string;
  note?: Localized<string>;
};

export type CatalogRecipe = {
  id: string;
  name: Localized<string>;
  servings: number;
  ingredients: CatalogIngredient[];
  instructions: Localized<string>;
  tags: RecipeTag[];
};

// The first FEATURED_COUNT catalog entries are the curated, varied featured
// set. It lives here, not in data.ts, so ranking code can know the number
// without importing the whole catalog.
export const FEATURED_COUNT = 12;
