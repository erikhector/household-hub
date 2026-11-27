# Squirrel Wrapped: design

Date: 2026-11-27. Status: approved by the owner, built. Shipped behaviour
is documented in REQUIREMENTS.md, "Squirrel Wrapped".

## Intent

Around New Year, give a household a warm, shareable look back at what it
got done together in Squirrel: the lists, the meals, the pantry, the
tasks, the calendar. It should feel like the app's helpful-housemate voice
in story form, and nudge people to keep using the features that made the
year easier.

## Goals

- A page at `/dashboard/wrapped` that tells the year as a full-screen story
  of up to nine cards, stepped by tap, swipe, arrow keys and visible
  Next/Back buttons, with progress segments and a close button.
- Works one-handed at 412 px (DESIGN.md M1–M10), in English and Swedish,
  with reduced motion respected.
- Only honest numbers: each card says exactly what the data can support.
- A closing "your household was a … squirrel" persona, picked
  deterministically, with a Share button (Web Share API where it fits,
  copy-to-clipboard otherwise).
- Reachable all year from the More menu (and the desktop sidebar footer);
  a light Home card points at it from 1 December to 15 January.
- A friendly "check back later" state for a household with too little
  activity.

## Non-goals

- **No per-person scoring.** `HouseholdTask` keeps only its latest
  completion, so "who did most" can't be counted honestly, and ranking
  household members against each other isn't what a shared household app
  is for. Every number is the household's.
- **Money stays neutral.** One card says how many transactions were
  tracked. No amounts, no "you saved", no celebration, and money never
  feeds the activity total, the thin-data threshold or the persona
  (DESIGN.md: budget surfaces stay calm; the mascot never appears on money).
- No schema change, no stored snapshot, no new service, no AI, no new
  dependency, no image generation or new image assets, nothing stored in
  the browser.
- Personal budgets are private to their owner and are not included.

## Approach

- `src/lib/wrapped/wrapped-season.ts`: pure `wrappedYear` and
  `isWrappedSeason` on the viewer's clock (the `time_zone` cookie).
- `src/lib/wrapped/load.ts` (server-only): seven parallel, column-minimal
  queries, each scoped to the `requireHousehold()` household and the
  year, sample data excluded.
- `src/lib/wrapped/wrapped-calc.ts` (pure): rows plus year, zone and
  "now" in; stats and an ordered card list (or "thin") out. All rules are
  unit-tested.
- `src/app/dashboard/wrapped/page.tsx` (Server Component) passes plain
  stats and `dict.wrapped` to `src/components/wrapped/wrapped-story.tsx`.

## Decisions made while building

- **Year**: the local calendar year to date, except January, which shows
  the year that just ended (a review of a few January days is no review).
- **Thin threshold**: fewer than 10 counted things, or activity on fewer
  than 3 distinct days. One busy afternoon of imports isn't a year.
- **Shopping**: an item counts as bought when ticked (`checkedOffAt`) or,
  without a tick, put away / registered from a receipt (`putAwayAt`).
  "Most bought" groups names case- and space-insensitively and needs at
  least two purchases; ties break alphabetically so row order never
  matters.
- **Meals**: "planned meals cooked" (`MealPlanEntry.consumedAt`); the
  most cooked recipe is grouped by recipe id so two same-named recipes
  stay apart.
- **Pantry**: restocks are stock-journal increases (`restocked`, `trip`).
  The journal is capped at 50 events per item, so the card says "at
  least". Items used before expiry aren't derivable, so there's no such
  card.
- **Tasks**: "different tasks ticked off", with a note that each counts
  once however often it came round.
- **Calendar**: occurrences up to today, repeats expanded, so a weekly
  activity counts each week on the calendar card. They aren't activity,
  though: a weekly event made in an earlier year lands on every week
  untouched, so occurrences never feed the activity total, active days,
  busiest month or thin threshold.
- **Busiest month**: from every counted thing on its local day (calendar
  occurrences excluded); a put-away trip isn't counted twice (it's
  already an item bought). The card shows the month and the number of
  active days, not a total, so no figure overclaims.
- **Persona**: weighted scores (tasks + events dated this year ×2, meals
  ×4, items + lists ×3, hand restocks ×2), ties broken Planner, Chef,
  Forager, Stockpiler. Nothing scores twice or for free: a put-away trip
  is already items bought, and a repeat counts once, in the year it's
  dated, not per occurrence.
- **Tall cards**: centred while they fit, scrolled from their own top
  once they don't (`justify-center-safe`), so a phone in landscape or
  200% text never hides a card's top (M9).
- **Share text**: the persona and up to three counts; never the household
  name (it may be a family name) or money.
- **Navigation**: More menu and sidebar footer next to What's new, with
  Lucide's `Nut` (an acorn) rather than a new asset. The mascot raster
  (`MascotMark`) heads the intro, persona and thin cards only.
- **Gestures**: a touch starting within 24 px of a screen edge is ignored
  so the OS back swipe keeps working (M7); every gesture has a button.
