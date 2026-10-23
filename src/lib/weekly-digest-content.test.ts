// Tests the pure weekly digest content builder (GAP-27): which sections make
// it into the email, when the whole digest is empty (and so never sent), and
// that the rendered HTML escapes every piece of user-entered text.
import { describe, expect, it } from "vitest";
import {
  DIGEST_MAX_LIST_ITEMS,
  renderWeeklyDigest,
  summarizeWeeklyDigest,
  type WeeklyDigestInput,
  type WeeklyDigestSummary,
} from "@/lib/weekly-digest-content";
import { getDictionaryForLocale } from "@/lib/i18n/dictionaries";

const DAY = 24 * 60 * 60 * 1000;
// Sunday 2026-09-27 16:00 UTC — when the cron runs. The Monday-start week
// it falls in began 2026-09-21.
const NOW = new Date("2026-09-27T16:00:00.000Z");

function emptyInput(overrides: Partial<WeeklyDigestInput> = {}): WeeklyDigestInput {
  return {
    now: NOW,
    mealEntries: [],
    completedTasks: [],
    memberNames: new Map(),
    inventoryItems: [],
    budget: null,
    ...overrides,
  };
}

const zeroBreakdown = { income: 0, dueIncome: 0, expense: 0, savings: 0, owedFromEarlier: 0, duePayments: 0, dueSavings: 0, stillBudgeted: 0 };

describe("summarizeWeeklyDigest", () => {
  it("returns null when every section would be empty", () => {
    expect(summarizeWeeklyDigest(emptyInput())).toBeNull();
  });

  it("returns null for a budget with no activity this month", () => {
    const summary = summarizeWeeklyDigest(
      emptyInput({
        budget: { safeToSpend: 0, status: "healthy", breakdown: zeroBreakdown, expectedRecurring: [] },
      }),
    );
    expect(summary).toBeNull();
  });

  describe("meals", () => {
    it("counts distinct recipes over the last 7 days only", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({
          mealEntries: [
            { date: new Date(NOW.getTime() - 1 * DAY), recipeId: "r1" },
            { date: new Date(NOW.getTime() - 2 * DAY), recipeId: "r1" },
            { date: new Date(NOW.getTime() - 3 * DAY), recipeId: "r2" },
            // Freeform entries have no recipe identity to count.
            { date: new Date(NOW.getTime() - 3 * DAY), recipeId: null },
            // Outside the 7-day window (the in-app recap's 30 days would count it).
            { date: new Date(NOW.getTime() - 10 * DAY), recipeId: "r3" },
            // Planned for later in the future — not "on the menu" yet.
            { date: new Date(NOW.getTime() + 1 * DAY), recipeId: "r4" },
          ],
        }),
      );
      expect(summary?.meals).toEqual({ distinctRecipeCount: 2 });
      expect(summary?.tasks).toBeNull();
      expect(summary?.expiring).toBeNull();
      expect(summary?.budget).toBeNull();
    });

    it("leaves the section out when only freeform meals were planned", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({ mealEntries: [{ date: new Date(NOW.getTime() - DAY), recipeId: null }] }),
      );
      expect(summary).toBeNull();
    });
  });

  describe("tasks", () => {
    it("groups this week's completed tasks by completer, resolving names", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({
          memberNames: new Map([
            ["m1", "Alex"],
            ["m2", "Sam"],
          ]),
          completedTasks: [
            { title: "Vacuum", completedAt: new Date("2026-09-22T10:00:00Z"), completedByMemberId: "m1" },
            { title: "Dishes", completedAt: new Date("2026-09-23T10:00:00Z"), completedByMemberId: "m2" },
            { title: "Laundry", completedAt: new Date("2026-09-24T10:00:00Z"), completedByMemberId: "m1" },
            { title: "Plants", completedAt: new Date("2026-09-25T10:00:00Z"), completedByMemberId: null },
            // Last week — not part of this digest.
            { title: "Old", completedAt: new Date("2026-09-20T10:00:00Z"), completedByMemberId: "m1" },
          ],
        }),
      );
      expect(summary?.tasks?.groups).toEqual([
        { memberName: "Alex", titles: ["Vacuum", "Laundry"] },
        { memberName: "Sam", titles: ["Dishes"] },
        { memberName: null, titles: ["Plants"] },
      ]);
    });

    it("treats a completer who's since left (unknown member id) as unattributed", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({
          completedTasks: [
            { title: "Vacuum", completedAt: new Date("2026-09-22T10:00:00Z"), completedByMemberId: "gone" },
          ],
        }),
      );
      expect(summary?.tasks?.groups).toEqual([{ memberName: null, titles: ["Vacuum"] }]);
    });

    it("leaves the section out in a quiet week", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({
          completedTasks: [{ title: "Old", completedAt: new Date("2026-09-14T10:00:00Z"), completedByMemberId: "m1" }],
        }),
      );
      expect(summary).toBeNull();
    });
  });

  describe("expiring items", () => {
    it("splits expired and soon-to-expire items using the inventory badge's thresholds", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({
          inventoryItems: [
            { name: "Milk", expiresAt: new Date(NOW.getTime() - DAY), expiresAtEstimated: false },
            { name: "Bread", expiresAt: new Date(NOW.getTime() + 2 * DAY), expiresAtEstimated: true },
            // Beyond EXPIRY_WARNING_DAYS (3) — not "soon" yet.
            { name: "Cheese", expiresAt: new Date(NOW.getTime() + 5 * DAY), expiresAtEstimated: false },
            { name: "Rice", expiresAt: null, expiresAtEstimated: false },
          ],
        }),
      );
      expect(summary?.expiring).toEqual({
        expired: [{ name: "Milk", estimated: false }],
        soon: [{ name: "Bread", estimated: true }],
      });
    });

    it("leaves the section out when nothing is close to its date", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({
          inventoryItems: [{ name: "Cheese", expiresAt: new Date(NOW.getTime() + 5 * DAY), expiresAtEstimated: false }],
        }),
      );
      expect(summary).toBeNull();
    });
  });

  describe("budget", () => {
    it("includes the headline once there is any money movement this month", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({
          budget: {
            safeToSpend: 1234.5,
            status: "tight",
            breakdown: { ...zeroBreakdown, expense: 10 },
            expectedRecurring: [],
          },
        }),
      );
      expect(summary?.budget).toEqual({ safeToSpend: 1234.5, status: "tight" });
    });

    it("includes it when only a recurring bill is due", () => {
      const summary = summarizeWeeklyDigest(
        emptyInput({
          budget: {
            safeToSpend: -500,
            status: "over",
            breakdown: { ...zeroBreakdown, duePayments: 500 },
            expectedRecurring: [{ categoryId: "t1", categoryName: "Rent", amount: 500 }],
          },
        }),
      );
      expect(summary?.budget).toEqual({ safeToSpend: -500, status: "over" });
    });
  });
});

function fullSummary(overrides: Partial<WeeklyDigestSummary> = {}): WeeklyDigestSummary {
  return {
    meals: { distinctRecipeCount: 3 },
    tasks: { groups: [{ memberName: "Alex", titles: ["Vacuum"] }] },
    expiring: { expired: [{ name: "Milk", estimated: false }], soon: [{ name: "Bread", estimated: true }] },
    budget: { safeToSpend: 1234.5, status: "healthy" },
    ...overrides,
  };
}

function render(summary: WeeklyDigestSummary, locale: "en" | "sv" = "en", householdName = "The Smiths") {
  return renderWeeklyDigest({
    summary,
    dict: getDictionaryForLocale(locale),
    locale,
    householdName,
    appUrl: "https://app.example.com",
    unsubscribeUrl: "https://app.example.com/api/digest/unsubscribe/user-1.sig",
  });
}

describe("renderWeeklyDigest", () => {
  it("renders every section present, in English, with the unsubscribe link", () => {
    const { subject, html, text } = render(fullSummary());

    expect(subject).toBe("Your week at The Smiths");
    for (const part of [html, text]) {
      expect(part).toContain("3 different recipes were on the menu");
      expect(part).toContain("Alex");
      expect(part).toContain("Vacuum");
      expect(part).toContain("Milk");
      expect(part).toContain("Bread (estimated)");
      expect(part).toContain("1,234.50");
      expect(part).toContain("https://app.example.com/api/digest/unsubscribe/user-1.sig");
      expect(part).toContain("https://app.example.com/dashboard/profile");
    }
    expect(html).toContain("You&#39;re in good shape");
  });

  it("uses the singular form for one recipe", () => {
    const { text } = render(fullSummary({ meals: { distinctRecipeCount: 1 } }));
    expect(text).toContain("1 different recipe was on the menu");
  });

  it("renders in Swedish with Swedish number formatting", () => {
    const { subject, text } = render(fullSummary(), "sv");
    expect(subject).toBe("Din vecka i The Smiths");
    expect(text).toContain("Klart den här veckan");
    expect(text).toContain("Bread (uppskattat)");
    // sv-SE groups thousands with a (narrow) no-break space and uses a
    // decimal comma.
    expect(text).toMatch(/1\s234,50/);
  });

  it("omits sections that aren't in the summary", () => {
    const { html, text } = render(fullSummary({ meals: null, budget: null, expiring: null }));
    expect(text).not.toContain("Meals");
    expect(text).not.toContain("Household budget");
    expect(text).not.toContain("Use it up");
    expect(html).toContain("Done this week");
  });

  it("only shows the expiry sub-groups that have items", () => {
    const { text } = render(fullSummary({ expiring: { expired: [], soon: [{ name: "Bread", estimated: false }] } }));
    expect(text).not.toContain("Past its date");
    expect(text).toContain("Expiring in the next few days");
  });

  it("credits unattributed tasks to 'Someone'", () => {
    const { text } = render(fullSummary({ tasks: { groups: [{ memberName: null, titles: ["Plants"] }] } }));
    expect(text).toContain("Someone:\n- Plants");
  });

  it("caps long lists and summarizes the rest", () => {
    const titles = Array.from({ length: DIGEST_MAX_LIST_ITEMS + 3 }, (_, i) => `Task ${i + 1}`);
    const { html, text } = render(fullSummary({ tasks: { groups: [{ memberName: "Alex", titles }] } }));
    expect(text).toContain(`Task ${DIGEST_MAX_LIST_ITEMS}`);
    expect(text).not.toContain(`Task ${DIGEST_MAX_LIST_ITEMS + 1}`);
    expect(text).toContain("…and 3 more");
    expect(html).toContain("…and 3 more");
  });

  it("escapes every piece of user-entered text in the HTML", () => {
    const evil = `<script>alert("x")</script>`;
    const { html, subject } = render(
      fullSummary({
        tasks: { groups: [{ memberName: `<b>${evil}</b>`, titles: [evil] }] },
        expiring: { expired: [{ name: `<img src=x onerror=alert(1)>`, estimated: false }], soon: [] },
      }),
      "en",
      `Evil & <i>Co</i>`,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>Co</i>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("Evil &amp; &lt;i&gt;Co&lt;/i&gt;");
    // The subject is a plain-text header, not HTML — left as typed.
    expect(subject).toBe("Your week at Evil & <i>Co</i>");
  });

  it("escapes attribute-breaking characters in URLs", () => {
    const { html } = renderWeeklyDigest({
      summary: fullSummary(),
      dict: getDictionaryForLocale("en"),
      locale: "en",
      householdName: "Home",
      appUrl: "https://app.example.com",
      unsubscribeUrl: `https://app.example.com/x"onmouseover="alert(1)`,
      logoUrl: `https://app.example.com/icon.png"x`,
    });
    expect(html).not.toContain(`x"onmouseover`);
    expect(html).toContain("x&quot;onmouseover=&quot;alert(1)");
    expect(html).toContain("icon.png&quot;x");
  });
});
