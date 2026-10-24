// UX-136: the opt-in "sample data" for a new household. A brand-new
// household opens on an empty overview, which says little about what the app
// is for; one tap seeds a small made-up home so every card has something in
// it, and one tap takes it all away again.
//
// Every seeded row carries the same non-null `sample` batch id (a nullable
// column on the seeded models, see prisma/schema.prisma), and everything a
// person makes has it null. "Clear sample data" therefore deletes by that
// column alone and can never touch a row someone added.
//
// This file is the pure part (no Prisma, no I/O): it turns the dictionary's
// sample copy into the rows to insert, so the content is unit-testable and
// the actions in src/lib/actions/sample-data.ts stay thin.

import { randomUUID } from "crypto";
import { addDays, getWeekStart } from "@/app/dashboard/meal-planning/date-utils";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export type SampleContent = Dictionary["dashboard"]["sampleData"]["content"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight, as the `@db.Date` due-date column and the planner expect. */
function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function buildSampleData(content: SampleContent, now: Date, batch: string = randomUUID()) {
  const sample = batch;
  // Ids are made here (not by the database) so the recipes' ingredients can
  // point at the pantry rows, and the whole seed goes in as one transaction.
  const id = {
    pasta: randomUUID(),
    rice: randomUUID(),
    tomatoes: randomUUID(),
    milk: randomUUID(),
    eggs: randomUUID(),
    coffee: randomUUID(),
    tomatoPasta: randomUUID(),
    pancakes: randomUUID(),
    friedRice: randomUUID(),
  };

  // One of each stock state, so the overview's cards (low, out, expiring) all
  // have a row to show: pasta is running low, milk is out, eggs expire soon.
  const inventory = [
    { id: id.pasta, name: content.itemPasta, category: content.categoryPantry, quantity: 0.5, unit: "kg", lowStockThreshold: 1 },
    { id: id.rice, name: content.itemRice, category: content.categoryPantry, quantity: 2, unit: "kg", lowStockThreshold: 1 },
    { id: id.tomatoes, name: content.itemTomatoes, category: content.categoryPantry, quantity: 4, unit: "pcs", lowStockThreshold: 2 },
    { id: id.milk, name: content.itemMilk, category: content.categoryDairy, quantity: 0, unit: "l", lowStockThreshold: 1 },
    {
      id: id.eggs,
      name: content.itemEggs,
      category: content.categoryDairy,
      quantity: 6,
      unit: "pcs",
      lowStockThreshold: 4,
      expiresAt: utcMidnight(new Date(now.getTime() + 2 * DAY_MS)),
    },
    { id: id.coffee, name: content.itemCoffee, category: content.categoryPantry, quantity: 1, unit: "pcs", lowStockThreshold: 1 },
  ].map((row) => ({ ...row, sample }));

  const list = {
    name: content.listName,
    sample,
    items: [
      { name: content.itemMilk, inventoryItemId: id.milk, quantity: 2, unit: "l" },
      { name: content.itemPasta, inventoryItemId: id.pasta, quantity: 1, unit: "kg" },
      { name: content.itemBread, quantity: 1, unit: "pcs" },
    ].map((row) => ({ ...row, sample })),
  };

  const recipes = [
    {
      id: id.tomatoPasta,
      name: content.recipeTomatoPasta,
      instructions: content.recipeTomatoPastaSteps,
      servings: 4,
      ingredients: [
        { name: content.itemPasta, inventoryItemId: id.pasta, quantity: 0.4, unit: "kg" },
        { name: content.itemTomatoes, inventoryItemId: id.tomatoes, quantity: 2, unit: "pcs" },
      ],
    },
    {
      id: id.pancakes,
      name: content.recipePancakes,
      instructions: content.recipePancakesSteps,
      servings: 4,
      ingredients: [
        { name: content.itemMilk, inventoryItemId: id.milk, quantity: 0.5, unit: "l" },
        { name: content.itemEggs, inventoryItemId: id.eggs, quantity: 3, unit: "pcs" },
      ],
    },
    {
      id: id.friedRice,
      name: content.recipeFriedRice,
      instructions: content.recipeFriedRiceSteps,
      servings: 2,
      ingredients: [
        { name: content.itemRice, inventoryItemId: id.rice, quantity: 0.3, unit: "kg" },
        { name: content.itemEggs, inventoryItemId: id.eggs, quantity: 2, unit: "pcs" },
      ],
    },
  ].map((recipe) => ({ ...recipe, sample }));

  // Four dinners in a row that all fall in one planner week: from today when
  // there are four days left in this week (Mon to Thu), otherwise from next
  // Monday, so the week never splits across two meal plans.
  const today = utcMidnight(now);
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  const firstDay = sinceMonday <= 3 ? today : addDays(getWeekStart(today), 7);
  const weekStartDate = getWeekStart(firstDay);
  const dinners = [
    { recipeId: id.tomatoPasta, portions: 4 },
    { recipeId: id.pancakes, portions: 4 },
    { recipeId: id.friedRice, portions: 2 },
    { freeformName: content.mealLeftovers, portions: 2 },
  ].map((entry, i) => ({ ...entry, date: addDays(firstDay, i), mealType: "DINNER" as const, sample }));

  const tasks = [
    { title: content.taskRecycling, recurrenceIntervalDays: 7, recurrenceAnchorAt: now },
    { title: content.taskPlants, recurrenceIntervalDays: 3, recurrenceAnchorAt: now },
    { title: content.taskDentist, dueDate: utcMidnight(new Date(now.getTime() + 5 * DAY_MS)) },
  ].map((task) => ({ ...task, sample }));

  return { sample, inventory, list, recipes, weekStartDate, dinners, tasks };
}
