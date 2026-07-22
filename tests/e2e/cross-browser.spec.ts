import { expect, test } from "@playwright/test";

test("loads the causal workbench without page errors", async ({ page, browserName }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CAUSAL CIVILIZATION ENGINE" })).toBeVisible();
  await expect(page.getByLabel("Simulation seed")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();

  // Chromium owns the expensive real-Worker/WebGL acceptance suite. This focused
  // test establishes that Firefox and WebKit can parse, mount, and operate the
  // semantic shell without engine-specific startup failures.
  if (browserName !== "chromium") {
    await page.getByLabel("Simulation seed").fill(`cross-browser-${browserName}`);
    await expect(page.getByText("Editing replaces the active baseline run.")).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});
