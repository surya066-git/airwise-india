import { expect, test, type Page } from "@playwright/test";

const timestamp = new Date(Date.now() - 35 * 60_000).toISOString();
const staleTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString();

function airResponse(options: { officialStatus?: "live" | "stale" | "unavailable" | "unverified"; withAqi?: boolean; openAqStatus?: "live" | "stale" } = {}) {
  const officialStatus = options.officialStatus ?? "live";
  const withAqi = options.withAqi ?? officialStatus === "live";
  const openAqStatus = options.openAqStatus ?? "live";
  return {
    location: { label: "Pune", latitude: 18.5204, longitude: 73.8567 },
    official: {
      status: officialStatus,
      source: "CPCB / data.gov.in",
      requestedCity: "Pune",
      city: "Pune",
      station: "Pune Central Test Monitor",
      state: "Maharashtra",
      distanceMeters: 1200,
      aqi: withAqi ? 82 : null,
      category: withAqi ? "Satisfactory" : null,
      interpretation: withAqi ? "Official source reading for this test." : null,
      updatedAt: timestamp,
      pollutants: [{ parameter: "PM2.5", value: 24.6, unit: "µg/m³", measuredAt: timestamp, freshness: "live" }],
      message: withAqi ? "Verified test response." : "No explicit valid AQI was returned; AIRWISE has not calculated one."
    },
    supplementary: {
      status: openAqStatus,
      source: "OpenAQ",
      station: "Pune OpenAQ Test Monitor",
      distanceMeters: 1800,
      updatedAt: openAqStatus === "stale" ? staleTimestamp : timestamp,
      measurements: [{
        parameter: "PM2.5", value: 31.2, unit: "µg/m³",
        measuredAt: openAqStatus === "stale" ? staleTimestamp : timestamp,
        freshness: openAqStatus === "stale" ? "stale" : "live"
      }],
      message: "Raw OpenAQ test measurement; not official CPCB AQI."
    },
    fetchedAt: new Date().toISOString()
  };
}

async function mockAir(page: Page, payload = airResponse()) {
  await page.route("**/api/aqi**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload)
  }));
}

async function openMobileMenuIfNeeded(page: Page) {
  if ((page.viewportSize()?.width ?? 1024) <= 820) {
    const toggle = page.getByRole("button", { name: "Open navigation" });
    if (await toggle.isVisible()) await toggle.click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await mockAir(page);
});

test("homepage loads with accessible dashboard navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Make informed decisions about the air you breathe." })).toBeVisible();
  await openMobileMenuIfNeeded(page);
  const navigationName = (page.viewportSize()?.width ?? 1024) <= 820 ? "Mobile navigation" : "Main navigation";
  await expect(page.getByRole("navigation", { name: navigationName })).toBeVisible();
  await expect(page.getByRole("button", { name: "Personalize" })).toBeVisible();
  await expect(page.getByText("General guidance", { exact: true }).first()).toBeVisible();
});

test("dashboard stays within the viewport and keeps body copy readable", async ({ page }) => {
  await page.goto("/");
  const measurements = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    bodyFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize)
  }));
  expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewportWidth);
  expect(measurements.bodyFontSize).toBeGreaterThanOrEqual(16);
});

test("mobile navigation opens, follows a section, and closes accessibly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole("link", { name: "Your plan" }).click();
  await expect(page).toHaveURL(/#recommendations$/);
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
});

test("preference dialog traps keyboard focus and restores it on close", async ({ page }) => {
  await page.goto("/");
  await openMobileMenuIfNeeded(page);
  const personalize = page.getByRole("button", { name: "Personalize" });
  await personalize.click();
  const dialog = page.getByRole("dialog", { name: "Make the advice fit" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close preferences" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Skip for now" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(personalize).toBeFocused();
});

test("dashboard navigation reaches recommendations", async ({ page }) => {
  await page.goto("/");
  await openMobileMenuIfNeeded(page);
  const navigationName = (page.viewportSize()?.width ?? 1024) <= 820 ? "Mobile navigation" : "Main navigation";
  await page.getByRole("navigation", { name: navigationName }).getByRole("link", { name: "Your plan" }).click();
  await expect(page).toHaveURL(/#recommendations$/);
  await expect(page.locator("#recommendations")).toBeInViewport();
});

test("location search selects a city and requests that city", async ({ page }) => {
  await page.goto("/");
  await openMobileMenuIfNeeded(page);
  const cityRequest = page.waitForRequest((request) =>
    request.url().includes("/api/aqi?") && new URL(request.url()).searchParams.get("city") === "Hyderabad");
  await page.getByRole("button", { name: /Choose an area/ }).click();
  await page.getByLabel("City or town").fill("Hyderabad");
  await page.getByRole("button", { name: "Use this location" }).click();
  await cityRequest;
  await expect(page.locator("#aqi-title")).toHaveText("Hyderabad");
});

test("available official AQI and pollutant values retain attribution", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".aqi-number")).toHaveText("82");
  await expect(page.locator(".aqi-card").getByText("Live reading")).toBeVisible();
  await expect(page.getByText("Pune Central Test Monitor")).toBeVisible();
  await expect(page.getByText("CPCB via data.gov.in")).toBeVisible();
  await expect(page.locator(".pollutant-card").filter({ hasText: "PM2.5" }).getByText("24.6")).toBeVisible();
});

test("unavailable official AQI stays blank and explains missing verification", async ({ page }) => {
  await mockAir(page, airResponse({ officialStatus: "unavailable", withAqi: false }));
  await page.goto("/");
  await expect(page.locator(".aqi-number")).toHaveText("—");
  await expect(page.getByText("No verified index")).toBeVisible();
  await expect(page.locator(".aqi-summary p")).toContainText("has not calculated one");
});

test("stale OpenAQ measurements show historical status, timestamp, and age", async ({ page }) => {
  await mockAir(page, airResponse({ officialStatus: "unavailable", withAqi: false, openAqStatus: "stale" }));
  await page.goto("/");
  await expect(page.getByText("Stale reading")).toBeVisible();
  await expect(page.getByText(/Stale historical/)).toBeVisible();
  await expect(page.getByText(/days ago/)).toBeVisible();
  await expect(page.getByText("OpenAQ values are supplementary sensor observations. They are not official CPCB AQI.")).toBeVisible();
});

test("assistant response is shown after a successful mocked request", async ({ page }) => {
  await page.route("**/api/assistant", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ answer: "Try transit for a trip that fits your route." })
  }));
  await page.goto("/");
  await page.getByLabel("Ask AIRWISE INDIA").fill("How can I make my commute lower emission?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("Try transit for a trip that fits your route.")).toBeVisible();
});

test("assistant labels AI recommendations and selected profile evidence", async ({ page }) => {
  await page.route("**/api/assistant", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      answer: "Choose a shared option when it fits.",
      responseMode: "ai_generated",
      provider: "Cloudflare Workers AI",
      advice: {
        summary: "Choose a shared option when it fits.",
        recommendations: [{
          action: "Consider a shared trip",
          reason: "You selected public transit, so a shared trip that fits the route reflects your commute preference.",
          intendedProfile: "Public transit commuters",
          expectedBenefit: "Keeps trip planning practical.",
          practicalSteps: ["Check transit or ride-sharing options for the route."],
          environmentalImpact: null,
          basis: ["general_guidance"],
          guidanceType: "personalized",
          personalizedBy: ["commute"],
          conditionalOn: []
        }],
        uncertainty: "Current pollution conditions are unverified."
      }
    })
  }));
  await page.addInitScript(() => {
    localStorage.setItem("airwise-profile", JSON.stringify({
      ageGroup: "Prefer not to say", occupation: "Resident", commute: "Public transit",
      outdoorActivity: "Sometimes", children: false, olderAdults: false
    }));
  });
  await page.goto("/");
  await page.getByLabel("Ask AIRWISE INDIA").fill("How can I make my commute lower emission?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("AI-generated recommendations · Cloudflare Workers AI", { exact: true })).toBeVisible();
  const assistantConversation = page.getByRole("log", { name: "Assistant conversation" });
  await expect(assistantConversation.getByText("Personalized advice", { exact: true })).toBeVisible();
  await expect(assistantConversation.getByText("Supported by selected: commute type", { exact: true })).toBeVisible();
  await expect(assistantConversation.getByText("Consider a shared trip", { exact: true })).toBeVisible();
});

test("assistant labels an unconfirmed circumstance as conditional", async ({ page }) => {
  await page.route("**/api/assistant", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      answer: "Here is a conditional suggestion.",
      responseMode: "ai_generated",
      provider: "Gemini",
      advice: {
        summary: "Use this suggestion only if it fits your household.",
        recommendations: [{
          action: "If your household includes children, keep an indoor option available",
          reason: "This is conditional and does not assume children are in your household.",
          intendedProfile: "Households that include children, if applicable",
          expectedBenefit: "Keeps an alternative available when it is relevant.",
          practicalSteps: ["Check local official information before outdoor plans."],
          environmentalImpact: null,
          basis: ["general_guidance"],
          guidanceType: "conditional",
          personalizedBy: [],
          conditionalOn: ["children"]
        }],
        uncertainty: "Current local conditions may be unavailable."
      }
    })
  }));
  await page.goto("/");
  await page.getByLabel("Ask AIRWISE INDIA").fill("How can a household plan?" );
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("Conditional suggestion", { exact: true })).toBeVisible();
  await expect(page.getByText("Condition, if applicable: children in household", { exact: true })).toBeVisible();
  await expect(page.getByText("AI-generated recommendations · Gemini", { exact: true })).toBeVisible();
});

test("assistant provider failure returns labeled standard guidance and a safe status", async ({ page }) => {
  await page.route("**/api/assistant", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      answer: "Gemini is unavailable. This standard guidance is rule-based, not AI-generated.",
      responseMode: "standard_guidance",
      provider: "AIRWISE rules",
      providerNotice: "OpenRouter returned HTTP 429, but did not identify the limit source. AIRWISE paused this provider because no reset time was supplied; check provider status before a controlled retry.",
      advice: {
        summary: "Standard AIRWISE guidance, not AI-generated.",
        recommendations: [{
          action: "Try a shared trip when practical",
          reason: "A shared trip can reduce separate vehicle use.",
          intendedProfile: "Residents",
          expectedBenefit: "Keeps trip planning practical.",
          practicalSteps: ["Check transit options for the route."],
          environmentalImpact: null,
          basis: ["general_guidance"],
          guidanceType: "general",
          personalizedBy: [],
          conditionalOn: []
        }],
        uncertainty: "Current pollution conditions are unverified."
      },
      diagnostics: {
        gemini: { httpStatus: 503, providerCode: "service_unavailable" },
        openrouter: { httpStatus: 429, rateLimitClass: "unknown" }
      }
    })
  }));
  await page.goto("/");
  await page.getByLabel("Ask AIRWISE INDIA").fill("How can I make my commute lower emission?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("Standard AIRWISE guidance · rule-based, not AI-generated")).toBeVisible();
  await expect(page.getByText("Provider status: Gemini HTTP 503 (service_unavailable)")).toBeVisible();
  await expect(page.getByText(/OpenRouter returned HTTP 429, but did not identify the limit source/)).toBeVisible();
});

test("Cloudflare failure shows unavailable state, source limitation, and standard guidance without AI attribution", async ({ page }) => {
  await page.route("**/api/assistant", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({
      error: "cloudflare_live_test_failed",
      message: "Cloudflare Workers AI is unavailable. The recommendations below are Standard AIRWISE guidance, not AI-generated.",
      failedProvider: "Cloudflare Workers AI",
      responseMode: "standard_guidance",
      provider: "AIRWISE rules",
      providerNotice: "The model response failed AIRWISE structure and safety checks.",
      upstreamHttpStatus: 200,
      limitationNotice: "No verified CPCB AQI or OpenAQ readings were retrieved. Current local air conditions are unknown.",
      verifiedData: "Official CPCB AQI: unavailable. OpenAQ measurements: unavailable.",
      advice: {
        summary: "Use standard AIRWISE guidance while current readings are unavailable.",
        recommendations: [{
          action: "Compare a shared travel option when practical",
          reason: "No verified current reading is available, so this is general commute guidance.",
          intendedProfile: "Daily commuters",
          expectedBenefit: "Can help reduce separate vehicle trips when a shared option fits.",
          practicalSteps: ["Check transit times before choosing your usual route."],
          environmentalImpact: null,
          basis: ["general_guidance"],
          guidanceType: "general",
          personalizedBy: [],
          conditionalOn: []
        }],
        uncertainty: "Current local air conditions are unknown."
      },
      diagnostics: { cloudflare: {
        httpStatus: 200, diagnosticCategory: "schema_validation_failure", responseIssue: "schema_invalid"
      } }
    })
  }));
  await page.goto("/");
  await page.getByLabel("Ask AIRWISE INDIA").fill("How can I plan my commute?");
  await page.getByRole("button", { name: "Send question" }).click();

  await expect(page.getByRole("status").getByText("AI unavailable · Cloudflare Workers AI")).toBeVisible();
  await expect(page.getByText("Standard AIRWISE guidance · rule-based, not AI-generated")).toBeVisible();
  await expect(page.getByText(/No verified CPCB AQI or OpenAQ readings were retrieved/)).toBeVisible();
  await expect(page.getByText("Compare a shared travel option when practical", { exact: true })).toBeVisible();
  await expect(page.locator(".assistant-response-mode").getByText("Cloudflare Workers AI", { exact: true })).toHaveCount(0);
});

test("responsive controls remain in the viewport without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await openMobileMenuIfNeeded(page);
  const navigationName = (page.viewportSize()?.width ?? 1024) <= 820 ? "Mobile navigation" : "Main navigation";
  await expect(page.getByRole("button", { name: /Choose an area/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: navigationName }).getByRole("link", { name: "Ask AIRWISE" })).toBeVisible();
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
});

test("location and assistant fields have accessible labels", async ({ page }) => {
  await page.goto("/");
  await openMobileMenuIfNeeded(page);
  await page.getByRole("button", { name: /Choose an area/ }).click();
  await expect(page.getByLabel("City or town")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Ask AIRWISE INDIA")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send question" })).toBeDisabled();
});
