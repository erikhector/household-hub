// Single source of truth for everything Squirrel stores on a visitor's device
// (cookies + localStorage). Rendered by the privacy policy's "Cookies and
// local storage" section (src/app/privacy/page.tsx), and cross-checked
// against the *_COOKIE constants in src/ by cookie-inventory.test.ts so a
// newly added cookie can't ship without being listed here.
//
// Pure data — safe to import from Server Components, Client Components and
// tests alike.
//
// Every entry below is either strictly necessary for a feature the user
// asked for, or a preference the user set themselves; none is used for
// analytics or advertising, so no consent gate is needed (ePrivacy Art. 5(3)
// exemptions). If you add a cookie that doesn't fit that description —
// analytics, marketing, or anything third-party — the informational
// CookieNotice is no longer enough: it needs a real consent flow, and that
// consent has to gate the new cookie before it is ever set.

export const COOKIE_NOTICE_COOKIE = "cookie_notice_ack";
export const COOKIE_NOTICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// localStorage keys behind "dismissed" UI (recaps, suggestion chips). Declared
// as *_STORAGE_KEY constants so cookie-inventory.test.ts's drift guard sees
// them, and they are the only keys useDismissedLocalStorage
// (src/components/shared/use-dismissed-local-storage.ts) accepts, so a
// dismissal can't be persisted under a key the privacy page doesn't list.
export const USE_IT_UP_DISMISSED_STORAGE_KEY = "mealPlanning.useItUpDismissed";
export const NUTRITION_RECAP_DISMISSED_STORAGE_KEY = "mealPlanning.nutritionRecapDismissedWeek";
export const VARIETY_RECAP_DISMISSED_STORAGE_KEY = "mealPlanning.varietyRecapDismissedCount";
export const TASKS_RECAP_DISMISSED_STORAGE_KEY = "tasks.weeklyRecap.dismissedWeek";

export type DismissedStorageKey =
  | typeof USE_IT_UP_DISMISSED_STORAGE_KEY
  | typeof NUTRITION_RECAP_DISMISSED_STORAGE_KEY
  | typeof VARIETY_RECAP_DISMISSED_STORAGE_KEY
  | typeof TASKS_RECAP_DISMISSED_STORAGE_KEY;

export type StorageKind = "cookie" | "localStorage";
export type StorageCategory = "necessary" | "preference";

export type StorageEntry = {
  /**
   * Exact name, or the un-prefixed name for entries with a production
   * prefix (Auth.js's `__Secure-`/`__Host-`) or a per-id prefix (a cookie
   * suffixed with e.g. a household id at set time).
   */
  name: string;
  kind: StorageKind;
  category: StorageCategory;
  purpose: string;
  duration: string;
};

export const STORAGE_INVENTORY: readonly StorageEntry[] = [
  {
    // Auth.js (src/lib/auth.ts). Production (HTTPS) adds a `__Secure-` prefix.
    name: "authjs.session-token",
    kind: "cookie",
    category: "necessary",
    purpose: "Keeps you signed in.",
    duration: "Until it expires or you log out",
  },
  {
    // Production (HTTPS) uses a `__Host-` prefix.
    name: "authjs.csrf-token",
    kind: "cookie",
    category: "necessary",
    purpose: "Protects the login form against cross-site request forgery.",
    duration: "Session",
  },
  {
    name: "authjs.callback-url",
    kind: "cookie",
    category: "necessary",
    purpose: "Returns you to the page you were trying to reach after logging in.",
    duration: "Session",
  },
  {
    name: "active_household",
    kind: "cookie",
    category: "necessary",
    purpose: "Remembers which of your households you last had active.",
    duration: "1 year",
  },
  {
    name: "locale",
    kind: "cookie",
    category: "preference",
    purpose: "Remembers your chosen language (English or Swedish).",
    duration: "1 year",
  },
  {
    name: "time_zone",
    kind: "cookie",
    category: "necessary",
    purpose: "Remembers your time zone so a repeating task reopens at your midnight, not the server's.",
    duration: "1 year",
  },
  {
    name: "sidebar_expanded",
    kind: "cookie",
    category: "preference",
    purpose: "Remembers whether you collapsed the desktop sidebar.",
    duration: "1 year",
  },
  {
    name: "email_verification_dismissed",
    kind: "cookie",
    category: "preference",
    purpose: "Hides the “verify your email” banner after you dismiss it.",
    duration: "Session",
  },
  {
    name: COOKIE_NOTICE_COOKIE,
    kind: "cookie",
    category: "preference",
    purpose: "Remembers that you have seen the cookie notice.",
    duration: "1 year",
  },
  {
    name: "last_seen_release",
    kind: "cookie",
    category: "preference",
    purpose: "Remembers the latest update you've seen under “What's new”, so the new-update dot goes away.",
    duration: "1 year",
  },
  {
    // Suffixed with the household's id at set time (household_step_skipped_<id>) —
    // see src/lib/actions/household.ts.
    name: "household_step_skipped_",
    kind: "cookie",
    category: "preference",
    purpose:
      "Remembers that you dismissed the “invite your household” getting-started step for a given household.",
    duration: "1 year",
  },
  {
    // Suffixed with the household's id at set time (getting_started_dismissed_<id>) —
    // see dismissGettingStartedAction in src/lib/actions/household.ts.
    name: "getting_started_dismissed_",
    kind: "cookie",
    category: "preference",
    purpose: "Remembers that you hid the “Get set up” card on the overview for a given household.",
    duration: "1 year",
  },
  {
    name: "theme",
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers your chosen colour theme (light, dark or system).",
    duration: "Until you clear site data",
  },
  {
    name: USE_IT_UP_DISMISSED_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: 'Remembers which "use it up" recipe suggestions you\'ve dismissed on the Recipes tab.',
    duration: "Until you clear site data",
  },
  {
    name: NUTRITION_RECAP_DISMISSED_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers that you've dismissed the weekly nutrition recap for a given week on the Planner tab.",
    duration: "Until you clear site data",
  },
  {
    name: VARIETY_RECAP_DISMISSED_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers that you've dismissed the recipe variety recap for a given count on the Planner tab.",
    duration: "Until you clear site data",
  },
  {
    name: TASKS_RECAP_DISMISSED_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers that you've dismissed the weekly task recap for a given week on the Tasks tab.",
    duration: "Until you clear site data",
  },
];
