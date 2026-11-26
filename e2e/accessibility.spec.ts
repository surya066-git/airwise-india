import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
});

async function scanPage(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();
  expect(results.violations.map(({ id, impact, description, nodes }) => ({
    id,
    impact,
    description,
    elements: nodes.map(({ target, failureSummary }) => ({ target, failureSummary }))
  }))).toEqual([]);
}

async function openMobileNavigationIfNeeded(page: Page) {
  if ((page.viewportSize()?.width ?? 1024) <= 820) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
}

test("dashboard meets automated WCAG 2.2 AA checks", async ({ page }) => {
  await page.goto("/");
  await scanPage(page);
});

test("location dialog meets automated WCAG 2.2 AA checks", async ({ page }) => {
  await page.goto("/");
  await openMobileNavigationIfNeeded(page);
  await page.getByRole("button", { name: "Choose an area" }).first().click();
  await expect(page.getByRole("dialog", { name: "Choose your area" })).toBeVisible();
  await scanPage(page);
});

test("preferences dialog meets automated WCAG 2.2 AA checks", async ({ page }) => {
  await page.goto("/");
  await openMobileNavigationIfNeeded(page);
  await page.getByRole("button", { name: "Personalize" }).first().click();
  await expect(page.getByRole("dialog", { name: "Make the advice fit" })).toBeVisible();
  await scanPage(page);
});
