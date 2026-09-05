# Cost analyzer — progress

Task: Wave 2, Task 6 (Cost analyzer) from `AGENT_TASKS.md`. Builds a
section/tab on the existing Budget page surfacing `PriceHistory` trends.

## Checklist

- [x] Read `AGENTS.md`, `REQUIREMENTS.md`, `AGENT_TASKS.md` (ground rules +
      Task 6), `src/app/dashboard/budget/actions.ts`, `page.tsx`.
- [x] `npm install` (worktree had no `node_modules` yet).
- [x] Pick charting approach — see "Decisions" below.
- [x] Create `feature/cost-analyzer` branch.
- [x] Query + aggregate `PriceHistory` in `page.tsx` (monthly totals, per-item
      trend, scoped via `requireHousehold()`).
- [x] `src/components/budget/cost-analyzer.tsx` — monthly spending chart
      (bar) + per-item price trend (sparkline) sections.
- [x] `src/components/budget/budget-tabs.tsx` — client tab switch
      (Overview / Cost analyzer), mirroring `MealPlanningView`'s pill-button
      tab pattern; Server-Component sections passed in as props/children.
- [x] Wire into `src/app/dashboard/budget/page.tsx`.
- [x] i18n keys in `en.ts` + `sv.ts` (real Swedish translations, not
      copy-pasted English) — `budget.tabOverview`/`tabCostAnalyzer` (mirrors
      `mealPlanning.tabPlanner`/`tabRecipes`) + nested `budget.costAnalyzer.*`.
- [x] `REQUIREMENTS.md`: new subsection under "Budgeting", move
      "Cost-analyzer UI" out of "Not yet built".
- [x] `npx tsc --noEmit -p tsconfig.json` — zero errors.
- [x] `npx eslint src` — zero errors/warnings.
- [x] `npm run build` — succeeds.
- [x] `npm test` — all 34 existing tests still pass (no test touches this
      feature; cost analyzer is out of scope for the existing test suite per
      AGENT_TASKS.md, same as the rest of budgeting).
- [x] Final commit on `feature/cost-analyzer`.

## Done

All steps complete. Final commit: see `git log` on `feature/cost-analyzer`
(this file's own commit is the last one).

## Decisions

- **Charting approach**: no charting library is installed
  (`recharts`/`chart.js`/etc. absent from `package.json`), and the task says
  not to pull in a heavy dependency without checking first. Building
  hand-rolled inline SVG charts (a simple bar chart for monthly spend, a
  simple line/sparkline for per-item price trends) styled purely with the
  existing `fill-chart-*`/`stroke-chart-*`/`text-chart-*` Tailwind utilities
  (Tailwind v4 auto-generates these from the `--color-chart-1..5` tokens
  already mapped in `globals.css`'s `@theme inline` block) — zero new
  dependencies, themes automatically, matches the existing
  `PeriodSummary`/proportional-bar pattern already on the budget page.
- **Aggregation location**: like `PeriodSummary`, all aggregation happens in
  `page.tsx`'s Server Component; `CostAnalyzer` itself stays a plain
  presentational (non-"use client") component, same convention as
  `PeriodSummary`.
- **"Enough history to be meaningful" threshold**: an item needs at least 3
  `PriceHistory` points to show a trend line (documented in
  `REQUIREMENTS.md`).
- **Tab wiring**: a new `BudgetTabs` client component (mirrors
  `MealPlanningView`'s pill-button tab switch) takes the already-rendered
  Overview section and the new Cost analyzer section as props (Server
  Components passed as props/children to a Client Component — confirmed
  supported per `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`).
