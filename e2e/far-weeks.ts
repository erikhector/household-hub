// MAINT-117: the one place a spec gets a random far-off meal-plan day.
//
// Specs that plan meals years ahead (so nothing else is in their week) used
// to pick a random offset from today: plan-leftovers 1-14 years, cook-soon
// 8-16 and 26-27, meal-planner-bulk 6-63, cook-mode 2031 plus up to 300
// weeks, and so on. Those ranges overlapped each other and the weeks other
// specs hand-pick (ux-19's 2031-06-02, planner-add-missing's empty
// 2031-03-03, week-picks' 2032 weeks, …), and they slid later every day. A
// worker's household is shared by every spec that worker runs, so a dinner
// plan-leftovers left in ux-19's week made ux-19 time out waiting for "Add
// first dinner". Same family as MAINT-79 and MAINT-115.
//
// So each spec now owns a band of weeks no other spec can reach:
//
// - Bands are absolute, not counted from today, so they never drift onto a
//   fixed week as the calendar moves.
// - They start in 2036. The hand-picked weeks under `e2e/` all sit in the
//   2019 and 2030-2034 range or at 2199 (grep `e2e/` for the year before
//   adding one, and keep new ones out of 2036-2093). The offsets that must
//   stay near today (meal-prep, meal-plan-search, ux-185) reach about two
//   years ahead, so they stay clear of 2036 too.
// - Each spec's band is its own, so two specs never share a week. Within a
//   band the week is still random, as before, which keeps the desktop and
//   mobile runs (and --repeat-each runs) of one spec apart.
//
// Adding a spec that needs a far-off week: add its name to FAR_WEEK_SPECS.
// That appends a band after the last one, so no existing band moves.

const DAY_MS = 24 * 60 * 60 * 1000;

const FAR_WEEK_SPECS = [
  "plan-leftovers",
  "recipe-last-cooked",
  "recipe-planned-dates",
  "cook-soon",
  "recipe-sheet-plan",
  "meal-planner-bulk",
  "meal-planner-rows",
  "cook-mode",
  "required-diet",
  "recipe-discover",
] as const;

type FarWeekSpec = (typeof FAR_WEEK_SPECS)[number];

// Monday 7 January 2036.
const FIRST_MONDAY = Date.UTC(2036, 0, 7);
// About 5¾ years each, so all ten bands end in 2093.
const BAND_WEEKS = 300;
// The picked week is at least this many weeks before the band's end, so a
// spec can plan a day or two after it (plan-leftovers' base + 2,
// recipe-planned-dates' first + 9) and stay inside its own band.
const HEADROOM_WEEKS = 2;

/**
 * A random day (UTC midnight) in `spec`'s own band of weeks. `weekday`
 * picks the day of the week (0 = Monday … 6 = Sunday); without it the day
 * is random too.
 */
export function farDay(spec: FarWeekSpec, weekday = Math.floor(Math.random() * 7)): Date {
  const band = FAR_WEEK_SPECS.indexOf(spec);
  const week = band * BAND_WEEKS + Math.floor(Math.random() * (BAND_WEEKS - HEADROOM_WEEKS));
  return new Date(FIRST_MONDAY + (week * 7 + weekday) * DAY_MS);
}
