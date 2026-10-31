import { expect, test } from "@playwright/test";
import { dismissCookieNotice, expectNoHorizontalOverflow } from "./ui";

// Phone pass (Oct 2026), P1: the open budget tab lives in `?tab=` and the
// month links carry it, so paging months from Transactions stays on
// Transactions instead of bouncing to Overview. Same shell on both budget
// pages, so both are checked.
test.beforeEach(async ({ context, baseURL }) => {
  await dismissCookieNotice(context, baseURL!);
});

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

for (const path of ["/dashboard/budget", "/dashboard/personal-budget"]) {
  test(`${path}: the open tab survives a month change`, async ({ page }) => {
    const now = new Date();
    const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    await page.goto(path);
    const main = page.getByRole("main");
    const transactions = main.getByRole("tab", { name: "Activity" });
    // On the current month there's nowhere to go back to.
    await expect(main.getByRole("link", { name: "This month" })).toHaveCount(0);

    await transactions.click();
    await expect(page).toHaveURL(/[?&]tab=transactions/);
    // The tab is a history.replaceState, which moves the URL at once but
    // reaches useSearchParams (and so MonthNavigator's hrefs) in a React
    // transition. Clicking the link before that render follows the old,
    // tab-less href, so wait for the links to carry the tab first.
    await expect(transactions).toHaveAttribute("aria-selected", "true");
    await expect(main.getByRole("link", { name: "Previous month" })).toHaveAttribute("href", /[?&]tab=transactions/);

    await main.getByRole("link", { name: "Previous month" }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]month=${prevKey}`));
    await expect(page).toHaveURL(/[?&]tab=transactions/);
    await expect(transactions).toHaveAttribute("aria-selected", "true");

    // A reload lands on the same tab and month.
    await page.reload();
    await expect(transactions).toHaveAttribute("aria-selected", "true");
    await expectNoHorizontalOverflow(page);

    // Back to the current month, still on Transactions.
    await main.getByRole("link", { name: "This month" }).click();
    await expect(page).not.toHaveURL(/[?&]month=/);
    await expect(page).toHaveURL(/[?&]tab=transactions/);
    await expect(transactions).toHaveAttribute("aria-selected", "true");
    await expect(main.getByRole("link", { name: "This month" })).toHaveCount(0);
  });
}
