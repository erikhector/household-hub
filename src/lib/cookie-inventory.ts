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

// localStorage key behind a remembered choice (UX-106: the Tasks page's
// "Mine / Everyone" filter). Same drift guard; the only key
// useLocalPreference (src/components/shared/use-local-preference.ts) accepts.
export const TASKS_FILTER_STORAGE_KEY = "tasks.filter";

export type PreferenceStorageKey = typeof TASKS_FILTER_STORAGE_KEY;

// UX-36: the service worker's Cache Storage bucket holding the shopping list
// page you last opened, so it still opens in a dead zone. Declared here for
// the drift guard; src/lib/service-worker.js (which can't import) repeats the
// name and src/lib/shopping/offline-cache.ts clears it on logout.
export const SHOPPING_LIST_CACHE_NAME = "squirrel-shopping-list-v1";

// UX-36: the shopping list's offline tick queue (src/lib/shopping/
// offline-tick-queue.ts). Not a preference: it is the ticks the user made
// with no signal, waiting for the connection so they can be saved. Removed
// as each one syncs, and on logout.
export const SHOPPING_TICK_QUEUE_STORAGE_KEY = "shopping.offlineTicks";

export type StorageKind = "cookie" | "localStorage" | "cache";
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
  // Swedish copies, shown on /privacy when the visitor's language is Swedish.
  purposeSv: string;
  durationSv: string;
};

export const STORAGE_INVENTORY: readonly StorageEntry[] = [
  {
    // Auth.js (src/lib/auth.ts). Production (HTTPS) adds a `__Secure-` prefix.
    name: "authjs.session-token",
    kind: "cookie",
    category: "necessary",
    purpose: "Keeps you signed in.",
    purposeSv: "Håller dig inloggad.",
    duration: "Until it expires or you log out",
    durationSv: "Tills den går ut eller du loggar ut",
  },
  {
    // Production (HTTPS) uses a `__Host-` prefix.
    name: "authjs.csrf-token",
    kind: "cookie",
    category: "necessary",
    purpose: "Protects the login form against cross-site request forgery.",
    purposeSv: "Skyddar inloggningsformuläret mot förfalskade förfrågningar från andra webbplatser (CSRF).",
    duration: "Session",
    durationSv: "Under sessionen",
  },
  {
    name: "authjs.callback-url",
    kind: "cookie",
    category: "necessary",
    purpose: "Returns you to the page you were trying to reach after logging in.",
    purposeSv: "För dig tillbaka till sidan du försökte nå efter att du har loggat in.",
    duration: "Session",
    durationSv: "Under sessionen",
  },
  {
    name: "active_household",
    kind: "cookie",
    category: "necessary",
    purpose: "Remembers which of your households you last had active.",
    purposeSv: "Minns vilket av dina hushåll du senast hade aktivt.",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    name: "locale",
    kind: "cookie",
    category: "preference",
    purpose: "Remembers your chosen language (English or Swedish).",
    purposeSv: "Minns ditt valda språk (engelska eller svenska).",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    name: "time_zone",
    kind: "cookie",
    category: "necessary",
    purpose: "Remembers your time zone so a repeating task reopens at your midnight, not the server's.",
    purposeSv: "Minns din tidszon så att en återkommande uppgift öppnas igen vid din midnatt, inte serverns.",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    name: "sidebar_expanded",
    kind: "cookie",
    category: "preference",
    purpose: "Remembers whether you collapsed the desktop sidebar.",
    purposeSv: "Minns om du fällde ihop sidofältet på datorn.",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    name: "email_verification_dismissed",
    kind: "cookie",
    category: "preference",
    purpose: "Hides the “verify your email” banner after you dismiss it.",
    purposeSv: "Döljer bannern ”verifiera din e-postadress” när du har stängt den.",
    duration: "Session",
    durationSv: "Under sessionen",
  },
  {
    name: COOKIE_NOTICE_COOKIE,
    kind: "cookie",
    category: "preference",
    purpose: "Remembers that you have seen the cookie notice.",
    purposeSv: "Minns att du har sett cookie-meddelandet.",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    name: "last_seen_release",
    kind: "cookie",
    category: "preference",
    purpose: "Remembers the latest update you've seen under “What's new”, so the new-update dot goes away.",
    purposeSv: "Minns den senaste uppdateringen du har sett under ”Nyheter”, så att pricken för ny uppdatering försvinner.",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    // Suffixed with the household's id at set time (household_step_skipped_<id>) —
    // see src/lib/actions/household.ts.
    name: "household_step_skipped_",
    kind: "cookie",
    category: "preference",
    purpose:
      "Remembers that you dismissed the “invite your household” getting-started step for a given household.",
    purposeSv: "Minns att du har avfärdat steget ”bjud in ditt hushåll” i kom-igång-listan för ett visst hushåll.",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    // Suffixed with the household's id at set time (getting_started_dismissed_<id>) —
    // see dismissGettingStartedAction in src/lib/actions/household.ts.
    name: "getting_started_dismissed_",
    kind: "cookie",
    category: "preference",
    purpose: "Remembers that you hid the “Get set up” card on the overview for a given household.",
    purposeSv: "Minns att du har dolt kortet ”Kom igång” på översikten för ett visst hushåll.",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    // Suffixed with the household's id at set time (getting_started_done_<id>) —
    // see markGettingStartedCelebratedAction in src/lib/actions/household.ts.
    name: "getting_started_done_",
    kind: "cookie",
    category: "preference",
    purpose:
      "Remembers that you have seen the “You're all set” message after finishing the setup steps, for a given household.",
    purposeSv: "Minns att du har sett meddelandet ”Nu är allt klart” efter att ha slutfört kom-igång-stegen, för ett visst hushåll.",
    duration: "1 year",
    durationSv: "1 år",
  },
  {
    name: "theme",
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers your chosen colour theme (light, dark or system).",
    purposeSv: "Minns ditt valda färgtema (ljust, mörkt eller systemets).",
    duration: "Until you clear site data",
    durationSv: "Tills du rensar webbplatsdata",
  },
  {
    name: USE_IT_UP_DISMISSED_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: 'Remembers which "use it up" recipe suggestions you\'ve dismissed on the Recipes tab.',
    purposeSv: "Minns vilka ”använd upp”-receptförslag du har avfärdat under fliken Recept.",
    duration: "Until you clear site data",
    durationSv: "Tills du rensar webbplatsdata",
  },
  {
    name: NUTRITION_RECAP_DISMISSED_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers that you've dismissed the weekly nutrition recap for a given week on the Planner tab.",
    purposeSv: "Minns att du har avfärdat veckans näringssammanfattning för en viss vecka under fliken Planering.",
    duration: "Until you clear site data",
    durationSv: "Tills du rensar webbplatsdata",
  },
  {
    name: VARIETY_RECAP_DISMISSED_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers that you've dismissed the recipe variety recap for a given count on the Planner tab.",
    purposeSv: "Minns att du har avfärdat sammanfattningen av receptvariationen för ett visst antal under fliken Planering.",
    duration: "Until you clear site data",
    durationSv: "Tills du rensar webbplatsdata",
  },
  {
    name: TASKS_RECAP_DISMISSED_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers that you've dismissed the weekly task recap for a given week on the Tasks tab.",
    purposeSv: "Minns att du har avfärdat veckans uppgiftssammanfattning för en viss vecka under fliken Uppgifter.",
    duration: "Until you clear site data",
    durationSv: "Tills du rensar webbplatsdata",
  },
  {
    name: SHOPPING_TICK_QUEUE_STORAGE_KEY,
    kind: "localStorage",
    category: "necessary",
    purpose:
      "Holds the items you ticked on the shopping list while offline, until you are back online and they can be saved.",
    purposeSv: "Håller de varor du bockade av i inköpslistan utan uppkoppling, tills du är online igen och de kan sparas.",
    duration: "Until they sync, or you log out",
    durationSv: "Tills de har synkats, eller du loggar ut",
  },
  {
    name: SHOPPING_LIST_CACHE_NAME,
    kind: "cache",
    category: "necessary",
    purpose:
      "Keeps a copy of the shopping list you last opened on this device so it still opens when you have no signal. Nothing else is kept offline.",
    purposeSv: "Sparar en kopia av inköpslistan du senast öppnade på den här enheten så att den går att öppna utan täckning. Inget annat sparas offline.",
    duration: "Until you log out or clear site data",
    durationSv: "Tills du loggar ut eller rensar webbplatsdata",
  },
  {
    name: TASKS_FILTER_STORAGE_KEY,
    kind: "localStorage",
    category: "preference",
    purpose: "Remembers whether the Tasks tab shows only your tasks or everyone's.",
    purposeSv: "Minns om fliken Uppgifter bara visar dina uppgifter eller allas.",
    duration: "Until you clear site data",
    durationSv: "Tills du rensar webbplatsdata",
  },
];
