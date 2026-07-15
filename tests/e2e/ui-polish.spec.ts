import { expect, test, type Page } from "@playwright/test";

interface UiTestSeam {
  selectEntity: (id: string | null) => void;
  firstSettlementId: () => string | null;
  firstRouteId: () => string | null;
  firstGovernmentId: () => string | null;
  activeBridgeId: () => string | null;
  showSimulationError: (message: string) => void;
  clearSimulationError: () => void;
}

function collectErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  return { consoleErrors, pageErrors };
}

async function selectFromSeam(page: Page, key: "firstSettlementId" | "firstRouteId" | "firstGovernmentId" | "activeBridgeId") {
  const id = await page.evaluate((method) => {
    const seam = (window as unknown as { __cce: UiTestSeam }).__cce;
    return seam[method]();
  }, key);
  expect(id).toBeTruthy();
  await page.evaluate((entityId) => (window as unknown as { __cce: UiTestSeam }).__cce.selectEntity(entityId), id);
  return id!;
}

test("polished shell remains legible, responsive, accessible, and branch-aware", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Causal Civilization Engine/i })).toBeVisible();
  const loader = page.locator(".loader-card");
  await expect(loader).toContainText("Building baseline history");
  await expect(loader.getByRole("progressbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeDisabled();

  // Loading stays readable while the viewport changes.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(loader).toBeVisible();
  const loadingOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(loadingOverflow).toBe(0);
  expect((await page.locator(".map-stage").boundingBox())!.height).toBeGreaterThan(180);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(loader).toBeHidden({ timeout: 180_000 });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Select a map entity")).toBeVisible();

  // The shell bands do not overlap and every visible button meets the target gate.
  const geometry = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON();
    return { header: box(".app-header"), workspace: box(".workspace"), timeline: box(".timeline") };
  });
  expect(geometry.header.bottom).toBeLessThanOrEqual(geometry.workspace.top + 1);
  expect(geometry.workspace.bottom).toBeLessThanOrEqual(geometry.timeline.top + 1);
  const undersizedButtons = await page.evaluate(() => [...document.querySelectorAll("button")]
    .filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.width < 43 || box.height < 43);
    })
    .map((element) => ({ name: element.getAttribute("aria-label") || element.textContent, box: element.getBoundingClientRect().toJSON() })));
  expect(undersizedButtons).toEqual([]);

  // Overlay state is named, pressed, and paired with real rendered political data.
  const political = page.getByRole("button", { name: "Political", exact: true });
  await political.click();
  await expect(political).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "politics map legend" })).toContainText("Neutral / contested");
  await page.waitForTimeout(300);
  const politicalDiag = await page.evaluate(() => (window as unknown as { __cceDiag: () => { activeOverlay: string; terrainDistinctColors: number } }).__cceDiag());
  expect(politicalDiag.activeOverlay).toBe("politics");
  expect(politicalDiag.terrainDistinctColors).toBeGreaterThan(1);

  // Settlement, road, government, missing, and empty Inspector states all resolve.
  await selectFromSeam(page, "firstSettlementId");
  await expect(page.getByRole("complementary", { name: /Crossroads|Settlement/i })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Select a map entity")).toBeVisible();

  await page.getByLabel("Timeline year").fill("30");
  await selectFromSeam(page, "firstRouteId");
  await expect(page.getByText("Transport route")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await selectFromSeam(page, "firstGovernmentId");
  await expect(page.getByText("Government", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await page.evaluate(() => (window as unknown as { __cce: UiTestSeam }).__cce.selectEntity("missing_entity_with_a_very_long_identifier_for_wrapping"));
  await expect(page.getByText(/unavailable at Year/)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Native range keyboard behavior and focus presentation remain visible.
  const timeline = page.getByLabel("Timeline year");
  await timeline.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Year 31", { exact: true })).toBeVisible();
  const play = page.getByRole("button", { name: "Play" });
  await play.focus();
  const focusStyle = await play.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });
  expect(focusStyle.style).not.toBe("none");
  expect(parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(2);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const transitionDuration = await play.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transitionDuration).toMatch(/0\.000001s|0s/);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Narrow layout keeps the map and controls operable without page overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.getByRole("button", { name: "Map controls" }).click();
  await expect(page.getByRole("button", { name: "Moisture" })).toBeVisible();
  await page.getByRole("button", { name: "Map controls" }).click();
  expect((await page.locator(".map-stage").boundingBox())!.height).toBeGreaterThan(180);

  // Branch action explains its insertion year, blocks repeats, stays responsive,
  // and returns explicit map-side comparison labels when ready.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("Timeline year").fill("30");
  const suppress = page.getByRole("button", { name: /Suppress Bridge Construction/ });
  await expect(page.getByText("Counterfactual at Year 10")).toBeVisible();
  await suppress.click();
  await expect(page.getByRole("button", { name: "Recomputing branch" })).toBeDisabled();
  await expect(loader).toContainText("Recompiling Causal History");

  const moisture = page.getByRole("button", { name: "Moisture" });
  await moisture.click();
  await expect(moisture).toHaveAttribute("aria-pressed", "true");
  await expect(loader).toBeHidden({ timeout: 360_000 });

  await expect(page.getByText("Counterfactual ready.")).toBeVisible();
  await expect(page.getByText("Baseline · main")).toBeVisible();
  await expect(page.getByText("Counterfactual · bridge suppressed")).toBeVisible();
  const divider = page.getByLabel("Comparison divider");
  await divider.fill("5");
  await expect(divider).toHaveValue("5");
  await divider.fill("95");
  await expect(divider).toHaveValue("95");

  await selectFromSeam(page, "activeBridgeId");
  await expect(page.getByText("SUPPRESSED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Baseline only" }).click();
  await expect(page.getByText("Baseline · main")).toBeHidden();

  // Error recovery is specific and dismissible; this is a DEV-only visual seam.
  await page.evaluate(() => (window as unknown as { __cce: UiTestSeam }).__cce.showSimulationError("Worker returned an invalid payload. Retry the baseline."));
  await expect(page.getByRole("alert")).toContainText("Retry the baseline");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("alert")).toBeHidden();

  expect(errors.pageErrors, errors.pageErrors.join("\n")).toEqual([]);
  expect(errors.consoleErrors, errors.consoleErrors.join("\n")).toEqual([]);
});
