// Pure content builder for the weekly household digest email (GAP-27). Kept
// free of Prisma/Resend/"server-only" imports — same convention as
// safe-to-spend-calc.ts and the meal/task recap calcs — so every "what goes
// in the email, and does it go out at all" decision is unit-testable with
// plain fixtures. The Prisma loading and the send/idempotency bookkeeping
// live in src/lib/weekly-digest.ts.
//
// Two steps, deliberately separate:
//   1. summarizeWeeklyDigest: runs the *same* calculators the in-app recaps
//      use (computeMealVarietyRecap, computeWeeklyTaskRecap, getExpiryStatus,
//      and the household budget's SafeToSpend result) over one household's
//      data and keeps only the sections that have something to say. Returns
//      null when nothing does, which is the "don't send an empty email"
//      signal. Locale-independent, so it runs once per household.
//   2. renderWeeklyDigest: turns a summary into subject/HTML/text in one
//      recipient's locale. Runs once per recipient.

import { computeMealVarietyRecap, type MealVarietyEntry } from "@/app/dashboard/meal-planning/meal-variety-calc";
import { computeWeeklyTaskRecap, type WeeklyRecapTask } from "@/app/dashboard/tasks/weekly-recap-calc";
import { escapeHtml } from "@/lib/escape-html";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import type { SafeToSpendResult, SafeToSpendStatus } from "@/lib/safe-to-spend-calc";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/locales";
import { format, plural } from "@/lib/i18n/format";

// The in-app variety recap looks back 30 days; a *weekly* email reports on
// the week it covers, otherwise the same dinners would be re-announced in
// four consecutive digests.
export const DIGEST_MEAL_WINDOW_DAYS = 7;

// A long list turns a glanceable email into a wall of text. Anything past
// this is summarized as "…and N more" and the CTA points at the app for the
// full picture.
export const DIGEST_MAX_LIST_ITEMS = 10;

export type DigestInventoryItem = {
  name: string;
  expiresAt: Date | null;
  expiresAtEstimated: boolean;
};

export type WeeklyDigestInput = {
  now: Date;
  mealEntries: MealVarietyEntry[];
  /** Completed tasks, ideally ordered by completedAt ascending (see
   * computeWeeklyTaskRecap's doc comment). */
  completedTasks: WeeklyRecapTask[];
  /** HouseholdMember id → display name, for crediting task completers. */
  memberNames: Map<string, string>;
  /** In-stock items with an expiry date — the loader pre-filters to roughly
   * the right window, the classification itself happens here. */
  inventoryItems: DigestInventoryItem[];
  /** This month's household SafeToSpend result, or null when the household
   * hasn't set up a budget at all. */
  budget: Pick<SafeToSpendResult, "safeToSpend" | "status" | "breakdown" | "expectedRecurring"> | null;
};

export type DigestExpiringItem = { name: string; estimated: boolean };

export type WeeklyDigestSummary = {
  meals: { distinctRecipeCount: number } | null;
  tasks: { groups: { memberName: string | null; titles: string[] }[] } | null;
  expiring: { expired: DigestExpiringItem[]; soon: DigestExpiringItem[] } | null;
  budget: { safeToSpend: number; status: SafeToSpendStatus } | null;
};

/**
 * Builds the locale-independent digest for one household, or null when
 * every section would be empty (the caller then sends nothing at all).
 */
export function summarizeWeeklyDigest(input: WeeklyDigestInput): WeeklyDigestSummary | null {
  const { now } = input;

  const { distinctRecipeCount } = computeMealVarietyRecap({
    entries: input.mealEntries,
    now,
    windowDays: DIGEST_MEAL_WINDOW_DAYS,
  });
  const meals = distinctRecipeCount > 0 ? { distinctRecipeCount } : null;

  // Same grouping (and the same no-counts, no-ranking guardrail) as the
  // Tasks page's weekly recap — a name followed by what they did.
  const groups = computeWeeklyTaskRecap({ tasks: input.completedTasks, now }).map((g) => ({
    memberName: g.completedByMemberId ? (input.memberNames.get(g.completedByMemberId) ?? null) : null,
    titles: g.titles,
  }));
  const tasks = groups.length > 0 ? { groups } : null;

  // getExpiryStatus is the inventory table's own badge logic, so "expiring
  // soon" in the email means exactly what the badge and the bell mean.
  const expired: DigestExpiringItem[] = [];
  const soon: DigestExpiringItem[] = [];
  for (const item of input.inventoryItems) {
    const status = getExpiryStatus(item.expiresAt, now.getTime());
    if (status === "expired") expired.push({ name: item.name, estimated: item.expiresAtEstimated });
    else if (status === "soon") soon.push({ name: item.name, estimated: item.expiresAtEstimated });
  }
  const expiring = expired.length > 0 || soon.length > 0 ? { expired, soon } : null;

  // A budget with nothing logged this month and nothing due would headline
  // "0.00, you're in good shape" — technically true, says nothing. Only
  // include it once there's some money movement (or a due bill) to report.
  let budget: WeeklyDigestSummary["budget"] = null;
  if (input.budget) {
    const { breakdown, expectedRecurring } = input.budget;
    const hasActivity =
      breakdown.income !== 0 ||
      breakdown.expense !== 0 ||
      breakdown.savings !== 0 ||
      expectedRecurring.length > 0;
    if (hasActivity) budget = { safeToSpend: input.budget.safeToSpend, status: input.budget.status };
  }

  if (!meals && !tasks && !expiring && !budget) return null;
  return { meals, tasks, expiring, budget };
}

// Mirrors src/lib/email.ts's BRAND_COLOR (manifest.ts's theme_color as hex —
// email clients don't do oklch()). Duplicated rather than imported because
// email.ts is "server-only" and this module is kept importable from tests
// without stubbing that out.
const BRAND_COLOR = "#a855f7";

export type RenderedDigest = { subject: string; html: string; text: string };

/**
 * Renders a summary in one recipient's locale. Every piece of user-entered
 * text (household name, member names, task titles, item names) goes through
 * escapeHtml in the HTML part; URLs are app-built but escaped too since
 * they land inside attributes.
 */
export function renderWeeklyDigest({
  summary,
  dict,
  locale,
  householdName,
  appUrl,
  unsubscribeUrl,
  logoUrl,
}: {
  summary: WeeklyDigestSummary;
  dict: Dictionary;
  locale: Locale;
  householdName: string;
  appUrl: string;
  unsubscribeUrl: string;
  logoUrl?: string;
}): RenderedDigest {
  const d = dict.email.weeklyDigest;
  const subject = format(d.subject, { householdName });
  const heading = format(d.heading, { householdName });
  const dashboardUrl = `${appUrl}/dashboard`;
  const profileUrl = `${appUrl}/dashboard/profile`;

  type Section = { title: string; html: string; text: string };
  const sections: Section[] = [];

  const listHtml = (items: string[], total: number) => {
    const shown = items.slice(0, DIGEST_MAX_LIST_ITEMS);
    const rows = shown.map((i) => `<li style="margin:0 0 4px;">${escapeHtml(i)}</li>`);
    if (total > shown.length) {
      const more = total - shown.length;
      rows.push(`<li style="margin:0 0 4px;color:#71717a;">${escapeHtml(format(plural(more, d.moreItems), { count: more }))}</li>`);
    }
    return `<ul style="margin:4px 0 0;padding-left:20px;">${rows.join("")}</ul>`;
  };
  const listText = (items: string[], total: number) => {
    const shown = items.slice(0, DIGEST_MAX_LIST_ITEMS);
    const rows = shown.map((i) => `- ${i}`);
    if (total > shown.length) {
      const more = total - shown.length;
      rows.push(`- ${format(plural(more, d.moreItems), { count: more })}`);
    }
    return rows.join("\n");
  };

  if (summary.meals) {
    const line = format(plural(summary.meals.distinctRecipeCount, d.mealsBody), {
      count: summary.meals.distinctRecipeCount,
    });
    sections.push({ title: d.mealsTitle, html: `<p style="margin:0;">${escapeHtml(line)}</p>`, text: line });
  }

  if (summary.tasks) {
    const htmlParts: string[] = [];
    const textParts: string[] = [];
    for (const group of summary.tasks.groups) {
      const name = group.memberName ?? d.tasksSomeone;
      htmlParts.push(
        `<p style="margin:0 0 2px;font-weight:600;">${escapeHtml(name)}</p>${listHtml(group.titles, group.titles.length)}`,
      );
      textParts.push(`${name}:\n${listText(group.titles, group.titles.length)}`);
    }
    sections.push({ title: d.tasksTitle, html: htmlParts.join('<div style="height:8px;"></div>'), text: textParts.join("\n\n") });
  }

  if (summary.expiring) {
    const label = (item: DigestExpiringItem) => (item.estimated ? `${item.name} ${d.estimatedSuffix}` : item.name);
    const htmlParts: string[] = [];
    const textParts: string[] = [];
    for (const [groupLabel, items] of [
      [d.expiredLabel, summary.expiring.expired],
      [d.soonLabel, summary.expiring.soon],
    ] as const) {
      if (items.length === 0) continue;
      const labels = items.map(label);
      htmlParts.push(
        `<p style="margin:0 0 2px;font-weight:600;">${escapeHtml(groupLabel)}</p>${listHtml(labels, labels.length)}`,
      );
      textParts.push(`${groupLabel}:\n${listText(labels, labels.length)}`);
    }
    sections.push({ title: d.expiringTitle, html: htmlParts.join('<div style="height:8px;"></div>'), text: textParts.join("\n\n") });
  }

  if (summary.budget) {
    // Same two-decimal, currency-less formatting as the SafeToSpend card
    // (src/components/budget/safe-to-spend.tsx), so the email's number
    // reads exactly like the one on the Budget page.
    const amount = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      summary.budget.safeToSpend,
    );
    const statusLine = {
      healthy: dict.budget.safeToSpend.summaryHealthy,
      tight: dict.budget.safeToSpend.summaryTight,
      over: dict.budget.safeToSpend.summaryOver,
    }[summary.budget.status];
    const line = format(d.budgetBody, { amount });
    sections.push({
      title: d.budgetTitle,
      html: `<p style="margin:0 0 4px;">${escapeHtml(line)}</p><p style="margin:0;color:#71717a;">${escapeHtml(statusLine)}</p>`,
      text: `${line}\n${statusLine}`,
    });
  }

  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="48" height="48" alt="" style="display:block;margin:0 auto 8px;border-radius:12px;" />`
    : "";
  const sectionsHtml = sections
    .map(
      (s) => `
          <div style="margin:0 0 20px;">
            <h2 style="font-size:16px;line-height:1.4;margin:0 0 6px;color:#18181b;">${escapeHtml(s.title)}</h2>
            <div style="font-size:15px;line-height:1.6;color:#3f3f46;">${s.html}</div>
          </div>`,
    )
    .join("");

  // Layout matches src/lib/email.ts's renderEmailHtml chrome (card, logo,
  // pill CTA) so the digest looks like the rest of the app's mail.
  const html = `
    <div style="background-color:#f4f4f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e4e7;">
        <div style="padding:32px 32px 0;text-align:center;">
          ${logo}
          <div style="font-size:18px;font-weight:700;color:#18181b;">Squirrel</div>
        </div>
        <div style="padding:24px 32px 32px;">
          <h1 style="font-size:20px;line-height:1.3;margin:0 0 8px;color:#18181b;">${escapeHtml(heading)}</h1>
          <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0 0 24px;">${escapeHtml(d.intro)}</p>
          ${sectionsHtml}
          <div style="text-align:center;margin:8px 0 24px;">
            <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:9999px;">${escapeHtml(d.cta)}</a>
          </div>
          <p style="font-size:12px;line-height:1.5;color:#a1a1aa;margin:16px 0 0;">
            ${escapeHtml(d.footer)}
            <a href="${escapeHtml(unsubscribeUrl)}" style="color:${BRAND_COLOR};">${escapeHtml(d.unsubscribe)}</a>
            ·
            <a href="${escapeHtml(profileUrl)}" style="color:${BRAND_COLOR};">${escapeHtml(d.manage)}</a>
          </p>
        </div>
      </div>
    </div>
  `;

  const text = [
    heading,
    d.intro,
    ...sections.map((s) => `${s.title}\n${s.text}`),
    `${d.cta}: ${dashboardUrl}`,
    `${d.footer}\n${d.unsubscribe}: ${unsubscribeUrl}\n${d.manage}: ${profileUrl}`,
  ].join("\n\n");

  return { subject, html, text };
}
