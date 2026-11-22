import { expect, test, type Page } from "@playwright/test";

async function mockUnavailableSources(page: Page) {
  await page.route("**/api/aqi**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      location: { label: null, latitude: null, longitude: null },
      official: {
        status: "unavailable",
        source: "CPCB / data.gov.in",
        requestedCity: null,
        city: null,
        station: null,
        state: null,
        distanceMeters: null,
        aqi: null,
        category: null,
        interpretation: null,
        updatedAt: null,
        pollutants: [],
        message: "No explicit valid AQI was returned for this location. AIRWISE has not calculated one."
      },
      supplementary: {
        status: "not_configured",
        source: "OpenAQ",
        station: null,
        distanceMeters: null,
        updatedAt: null,
        measurements: [],
        message: "Choose a location with coordinates to search nearby sensors."
      },
      fetchedAt: new Date().toISOString()
    })
  }));
}

test("unavailable-data visual review at the configured viewport", async ({ page }, testInfo) => {
  await mockUnavailableSources(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Make informed decisions about the air you breathe." })).toBeVisible();
  await expect(page.locator(".aqi-number")).toHaveText("—");
  await expect(page.getByText("No verified index", { exact: true })).toBeVisible();
  await expect(page.getByText("Choose another area")).toBeVisible();
  await expect(page.getByText("Morning · outdoor plans")).toBeVisible();
  await expect(page.getByText("Commute · lower emissions")).toBeVisible();
  await expect(page.getByText("Evening · activity planning")).toBeVisible();
  await expect(page.getByText("Workday and at home")).toBeVisible();
  const pageText = await page.locator("main").innerText();
  expect(pageText.indexOf("Morning · outdoor plans")).toBeLessThan(pageText.indexOf("Commute · lower emissions"));
  expect(pageText.indexOf("Commute · lower emissions")).toBeLessThan(pageText.indexOf("Workday and at home"));
  expect(pageText.indexOf("Workday and at home")).toBeLessThan(pageText.indexOf("Evening · activity planning"));
  await page.screenshot({ path: testInfo.outputPath("dashboard-first-fold.png") });
  await page.screenshot({ path: testInfo.outputPath("dashboard-unavailable.png"), fullPage: true });
});
