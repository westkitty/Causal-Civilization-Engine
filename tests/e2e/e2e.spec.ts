import { test, expect } from "@playwright/test";

test.describe("Causal Civilization Engine E2E Acceptance Test Suite", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the local server
    await page.goto("http://localhost:5173/");
  });

  test("should render the visual layout and mount the 3D WebGL Canvas", async ({ page }) => {
    // Verify Page Header
    await expect(page.locator("h1")).toContainText("CAUSAL CIVILIZATION ENGINE");

    // Verify Three.js WebGL canvas is mounted and visible
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();

    // Verify default simulation timeline state
    await expect(page.locator("span", { hasText: "main" })).toBeVisible();
    await expect(page.locator("span", { hasText: "Year 0" })).toBeVisible();
  });

  test("should support timeline play/pause playback controls", async ({ page }) => {
    // Locate and click Play button
    const playButton = page.getByRole("button", { name: /Play/i });
    await expect(playButton).toBeVisible();
    await playButton.click();

    // Wait for the timeline to scrub forward a few years
    await page.waitForTimeout(1000);

    // Verify year advanced
    const yearIndicator = page.locator("span", { hasText: /Year [1-9]/i });
    await expect(yearIndicator).toBeVisible();

    // Pause the simulation
    const pauseButton = page.getByRole("button", { name: /Pause/i });
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();
  });

  test("should permit suppressing bridge and comparison swipe split rendering", async ({ page }) => {
    // Play simulation until Year 10 (when the bridge construction occurs and suppression button is visible)
    const playButton = page.getByRole("button", { name: /Play/i });
    await playButton.click();

    // Wait until Year 10 or higher
    await page.waitForFunction(() => {
      const el = document.querySelector("body");
      return el && el.innerHTML.includes("Suppress Bridge Construction");
    }, { timeout: 15000 });

    // Pause
    const pauseButton = page.getByRole("button", { name: /Pause/i });
    await pauseButton.click();

    // Click on "Suppress Bridge Construction"
    const suppressButton = page.getByRole("button", { name: /Suppress Bridge Construction/i });
    await suppressButton.click();

    // Verify timeline branches tag has updated
    await expect(page.locator("span", { hasText: "suppress_bridge_branch" })).toBeVisible();

    // Verify comparison controls split view options (Swipe/Ghost/Heat overlays)
    await expect(page.locator("button", { hasText: "Swipe" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Ghost" })).toBeVisible();
  });
});
