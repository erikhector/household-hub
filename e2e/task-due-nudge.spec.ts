import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_HOUSEHOLD, E2E_MEMBER, E2E_MEMBER_SV, E2E_USER, E2E_USER_SV, STORAGE_STATE, STORAGE_STATE_SV } from "./seed";
import { E2E_WORKER } from "./seed-data";
import { dismissCookieNotice, expectHydrated, expectNoHorizontalOverflow } from "./ui";

// GAP-74: the opt-in "tasks due today" nudge. The member turns it on from the
// Notifications section of the profile (default off), the scheduled sync then
// files one household entry for the open tasks due today or overdue, and it
// shows up in the notification centre linking to Tasks. The sync runs through
// /api/cron/sync-notifications, authenticated with the CRON_SECRET
// playwright.config.ts gives the server. "Today" is the household's local
// date, taken from its members' push subscriptions; the seeded members have
// none, so here it falls back to the UTC date.
const CRON_SECRET = process.env.CRON_SECRET || "e2e-cron-secret";

const words = {
  en: {
    user: E2E_USER,
    member: E2E_MEMBER,
    toggle: "Remind me each morning about my tasks due today",
    toast: "You'll get a morning task reminder",
    entry: (title: string) => new RegExp(`Tasks due today:.*${title}`),
    store: STORAGE_STATE,
  },
  sv: {
    user: E2E_USER_SV,
    member: E2E_MEMBER_SV,
    toggle: "Påminn mig varje morgon om mina sysslor som ska göras idag",
    toast: "Du får en syssloppåminnelse på morgonen",
    entry: (title: string) => new RegExp(`Sysslor att göra idag:.*${title}`),
    store: STORAGE_STATE_SV,
  },
} as const;

for (const locale of ["en", "sv"] as const) {
  test.describe(locale, () => {
    test.use({ storageState: words[locale].store });
    const w = words[locale];

    test.beforeEach(async ({ context, baseURL }) => {
      await dismissCookieNotice(context, baseURL!);
    });

    test("turning on the morning task reminder files one entry linking to Tasks", async ({ page, request }) => {
      const title = `Nudge task ${locale} ${Math.random().toString(36).slice(2, 8)}`;
      const taskId = `e2e-task-due-w${E2E_WORKER}-${locale}`;
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      const runCron = async () => {
        const response = await request.get("/api/cron/sync-notifications", {
          headers: { authorization: `Bearer ${CRON_SECRET}` },
        });
        expect(response.status()).toBe(200);
      };
      const countEntries = async () =>
        (
          await client.query(`SELECT 1 FROM "Notification" WHERE "householdId" = $1 AND kind = 'TASK_DUE'`, [
            E2E_HOUSEHOLD.id,
          ])
        ).rowCount;
      const reset = async () => {
        await client.query(`DELETE FROM "Notification" WHERE "householdId" = $1 AND kind = 'TASK_DUE'`, [
          E2E_HOUSEHOLD.id,
        ]);
        await client.query(`DELETE FROM "HouseholdTask" WHERE "householdId" = $1 AND id = $2`, [
          E2E_HOUSEHOLD.id,
          taskId,
        ]);
        await client.query(`UPDATE "User" SET "taskDueNudge" = false WHERE email = $1`, [w.user.email]);
      };

      try {
        await reset();
        // Due today (the UTC date, the sync's fallback zone), assigned to this member.
        await client.query(
          `INSERT INTO "HouseholdTask" (id, "householdId", title, "dueDate", "assignedToMemberId", "createdAt")
           VALUES ($1, $2, $3, (now() AT TIME ZONE 'UTC')::date, $4, now())`,
          [taskId, E2E_HOUSEHOLD.id, title, w.member],
        );

        // Off by default: nothing is filed for a household nobody opted in for.
        await runCron();
        expect(await countEntries()).toBe(0);

        await page.goto("/dashboard/profile");
        const toggle = page.getByRole("checkbox", { name: w.toggle });
        await expectHydrated(toggle);
        await expect(toggle).not.toBeChecked();
        await toggle.check();
        await expect(page.getByText(w.toast).first()).toBeVisible();

        await page.reload();
        await expect(page.getByRole("checkbox", { name: w.toggle })).toBeChecked();

        await runCron();
        // A second run the same day adds nothing.
        await runCron();
        expect(await countEntries()).toBe(1);

        await page.goto("/dashboard/notifications");
        const entry = page.getByRole("main").getByRole("link", { name: w.entry(title) });
        await expect(entry).toHaveCount(1);
        await expect(entry).toHaveAttribute("href", "/dashboard/tasks");
        await expectNoHorizontalOverflow(page);
      } finally {
        await reset();
        await client.end();
      }
    });
  });
}
