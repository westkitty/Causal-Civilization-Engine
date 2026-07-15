import { test, expect, type Page } from "@playwright/test";

// Real-browser acceptance suite. Drives the actual application (Vite dev server
// + the real ES-module simulation Worker + Three.js WebGL renderer). Not a
// mocked substitute.

interface Diag {
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  canvasWidth: number;
  canvasHeight: number;
  webglContext: boolean;
  kinds: Record<string, number>;
  activeOverlay: string;
  terrainDistinctColors: number;
}

interface PoliticsSnapshot {
  year: number;
  mapCells: number;
  governments: Record<string, { capitalId: string }>;
  activeSettlementIds: string[];
  politicalControl: Record<string, number[]>;
  stateHash: string;
  politicalFoundingEventIds: string[];
}

const serious: RegExp[] = [
  /Warning: ReactDOM/i,
];

function attachErrorCollectors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  return { consoleErrors, pageErrors };
}

// Wait for the initial 400-year baseline Worker simulation to finish: the
// "Recompiling Causal History..." overlay disappears and the canvas mounts.
async function waitForBaseline(page: Page) {
  await expect(page.locator("h1")).toContainText("CAUSAL CIVILIZATION ENGINE");
  await expect(page.locator("text=Recompiling Causal History")).toBeHidden({ timeout: 150_000 });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 150_000 });
  // Allow a few animation frames so renderer.info is populated.
  await page.waitForTimeout(500);
}

async function diag(page: Page): Promise<Diag> {
  return page.evaluate(() => (window as unknown as { __cceDiag: () => Diag }).__cceDiag());
}

async function politicsAt(
  page: Page,
  year: number,
  branchId: "main" | "suppress_bridge_branch" = "main"
): Promise<PoliticsSnapshot> {
  return page.evaluate(({ y, branch }) => (
    window as unknown as {
      __cce: { politicsAt: (year: number, branchId: string) => PoliticsSnapshot }
    }
  ).__cce.politicsAt(y, branch), { y: year, branch: branchId });
}

async function setYear(page: Page, year: number) {
  const slider = page.getByLabel("Timeline year");
  await slider.fill(String(year));
  await expect(page.locator("text=Year " + year).first()).toBeVisible();
  await page.waitForTimeout(300); // scene rebuild + frames
}

test("baseline renders real WebGL content and supports core interactions", async ({ page }) => {
  const errs = attachErrorCollectors(page);
  await page.goto("/");
  await waitForBaseline(page);

  // 1. Canvas exists with nonzero dimensions.
  const box = await page.locator("canvas").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);

  // 2. WebGL initialized and actively drawing at Year 0.
  const d0 = await diag(page);
  expect(d0.webglContext).toBe(true);
  expect(d0.canvasWidth).toBeGreaterThan(0);
  expect(d0.drawCalls).toBeGreaterThan(0);
  expect(d0.triangles).toBeGreaterThan(0);
  expect(d0.kinds.terrain ?? 0).toBeGreaterThan(0);
  expect(d0.kinds.river ?? 0).toBeGreaterThan(0);
  expect(d0.kinds.settlement ?? 0).toBeGreaterThan(0);

  // 3. Scrub forward: roads and the bridge appear by Year 20.
  await setYear(page, 20);
  const d20 = await diag(page);
  expect(d20.kinds.road ?? 0).toBeGreaterThan(0);
  expect(d20.kinds.bridge ?? 0).toBeGreaterThan(0);

  // 4. Camera controls respond: dragging changes the rendered image.
  const before = await page.locator("canvas").screenshot();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 160, box!.y + box!.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.locator("canvas").screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);

  // 5. Resize updates the renderer viewport.
  const wBefore = (await diag(page)).canvasWidth;
  await page.setViewportSize({ width: 800, height: 700 });
  await page.waitForTimeout(400);
  const wAfter = (await diag(page)).canvasWidth;
  expect(wAfter).not.toBe(wBefore);

  // 6. Overlays change state.
  const political = page.getByRole("button", { name: /Political/ });
  await political.click();
  await expect(political).toHaveClass(/cyan-400/);

  // 7. Play advances time; pause stops it.
  await setYear(page, 0);
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(1200);
  const yearText = await page.locator("text=/^Year \\d+$/").first().textContent();
  const playedYear = Number((yearText || "Year 0").replace("Year ", ""));
  expect(playedYear).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(300);
  const pausedText = await page.locator("text=/^Year \\d+$/").first().textContent();
  const pausedYear = Number((pausedText || "Year 0").replace("Year ", ""));
  await page.waitForTimeout(700);
  const stillText = await page.locator("text=/^Year \\d+$/").first().textContent();
  expect(Number((stillText || "Year 0").replace("Year ", ""))).toBe(pausedYear);

  // 8. Inspector opens for a real settlement and resolves ledger-backed causes.
  const sid = await page.evaluate(() =>
    (window as unknown as { __cce: { firstSettlementId: () => string | null } }).__cce.firstSettlementId());
  expect(sid).toBeTruthy();
  await page.evaluate((id) =>
    (window as unknown as { __cce: { selectEntity: (i: string) => void } }).__cce.selectEntity(id), sid);
  await expect(page.locator("text=Settlement Node")).toBeVisible();
  await page.getByRole("button", { name: /Why is this here/ }).click();
  await expect(page.locator("text=Ledger-Backed Causal Ancestry")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // 9. No serious console or page errors.
  expect(errs.pageErrors, errs.pageErrors.join("\n")).toEqual([]);
  const seriousConsole = errs.consoleErrors.filter((e) => serious.some((r) => r.test(e)));
  expect(seriousConsole, seriousConsole.join("\n")).toEqual([]);
});

test("counterfactual suppression produces a diverged branch and comparison view", async ({ page }) => {
  const errs = attachErrorCollectors(page);
  await page.goto("/");
  await waitForBaseline(page);

  // Scrub to a year where the bridge exists so the Suppress control is offered.
  await setYear(page, 30);
  const suppress = page.getByRole("button", { name: /Suppress Bridge Construction/ });
  await expect(suppress).toBeVisible();

  // Capture the target bridge id, then trigger the counterfactual.
  const bridgeId = await page.evaluate(() =>
    (window as unknown as { __cce: { activeBridgeId: () => string | null } }).__cce.activeBridgeId());
  expect(bridgeId).toBeTruthy();

  await suppress.click();

  // Worker progress is visible while the branch resimulates.
  await expect(page.locator("text=Recompiling Causal History")).toBeVisible();
  const progressValues = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const t = await page.locator("text=/Progress: \\d+%/").textContent().catch(() => null);
    if (t) progressValues.add(t);
    if (await page.locator("text=Recompiling Causal History").isHidden().catch(() => false)) break;
    await page.waitForTimeout(1000);
  }
  // The branch resimulation (~390 years) runs far slower on 2-core CI runners:
  // the main thread holds the ~800 MB baseline cache while the Worker builds a
  // second one and structured-clones 400 states back across the boundary.
  await expect(page.locator("text=Recompiling Causal History")).toBeHidden({ timeout: 360_000 });
  expect(progressValues.size).toBeGreaterThan(1); // progress actually changed

  // Branch tag updated; split-screen comparison active.
  await expect(page.locator("text=suppress_bridge_branch").first()).toBeVisible();
  const split = page.getByRole("button", { name: "Split Screen" });
  await expect(split).toHaveClass(/indigo-400/);

  // Comparison divider changes the scissor boundary without error.
  const divider = page.getByLabel("Comparison divider");
  await expect(divider).toBeVisible();
  const beforeSplit = await page.locator("canvas").screenshot();
  await divider.fill("25");
  await page.waitForTimeout(400);
  const afterSplit = await page.locator("canvas").screenshot();
  expect(Buffer.compare(beforeSplit, afterSplit)).not.toBe(0);

  // Inspecting the suppressed bridge shows the divergence.
  await page.evaluate((id) =>
    (window as unknown as { __cce: { selectEntity: (i: string) => void } }).__cce.selectEntity(id), bridgeId);
  await expect(page.locator("text=Infrastructure Link")).toBeVisible();
  await expect(page.getByText("SUPPRESSED", { exact: true })).toBeVisible();

  expect(errs.pageErrors, errs.pageErrors.join("\n")).toEqual([]);
});

test("politics initializes, renders real control data, and survives branch resimulation", async ({ page }) => {
  const errs = attachErrorCollectors(page);
  await page.goto("/");
  await waitForBaseline(page);

  const p0 = await politicsAt(page, 0);
  const govIds = Object.keys(p0.governments).sort();
  expect(govIds.length).toBeGreaterThan(0);
  for (const govId of govIds) {
    expect(p0.activeSettlementIds).toContain(p0.governments[govId].capitalId);
    const control = p0.politicalControl[govId];
    expect(control).toHaveLength(p0.mapCells);
    expect(control.every(Number.isFinite)).toBe(true);
  }
  expect(govIds.some(govId => new Set(p0.politicalControl[govId]).size > 1)).toBe(true);
  expect(govIds.some(govId => p0.politicalControl[govId].some(value => value > 15))).toBe(true);
  expect(p0.politicalFoundingEventIds).toEqual(["est_gov_a_0", "est_gov_b_0"]);

  const political = page.getByRole("button", { name: /Political/ });
  await political.click();
  await expect(political).toHaveClass(/cyan-400/);
  await page.waitForTimeout(300);
  const politicalRender = await diag(page);
  expect(politicalRender.activeOverlay).toBe("politics");
  expect(politicalRender.terrainDistinctColors).toBeGreaterThan(1);

  await setYear(page, 50);
  const p50 = await politicsAt(page, 50);
  expect(Object.keys(p50.governments).sort()).toEqual(govIds);
  expect(Object.keys(p50.politicalControl).sort()).toEqual(govIds);

  const baselinePrefix = await politicsAt(page, 9);
  await setYear(page, 30);
  const suppress = page.getByRole("button", { name: /Suppress Bridge Construction/ });
  await expect(suppress).toBeVisible();
  await suppress.click();
  await expect(page.locator("text=Recompiling Causal History")).toBeHidden({ timeout: 360_000 });
  await expect(page.locator("text=suppress_bridge_branch").first()).toBeVisible();

  const branchPrefix = await politicsAt(page, 9, "suppress_bridge_branch");
  expect(branchPrefix.stateHash).toBe(baselinePrefix.stateHash);
  expect(branchPrefix.governments).toEqual(baselinePrefix.governments);
  expect(branchPrefix.politicalControl).toEqual(baselinePrefix.politicalControl);
  expect(branchPrefix.politicalFoundingEventIds).toEqual(["est_gov_a_0", "est_gov_b_0"]);

  const branchAt10 = await politicsAt(page, 10, "suppress_bridge_branch");
  expect(Object.keys(branchAt10.governments).sort()).toEqual(govIds);
  expect(Object.keys(branchAt10.politicalControl).sort()).toEqual(govIds);

  expect(errs.pageErrors, errs.pageErrors.join("\n")).toEqual([]);
  expect(errs.consoleErrors, errs.consoleErrors.join("\n")).toEqual([]);
});

test("captures real-browser performance measurements", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("CAUSAL CIVILIZATION ENGINE");
  const shellMs = Date.now() - t0;
  await expect(page.locator("canvas")).toBeVisible({ timeout: 150_000 });
  const canvasMs = Date.now() - t0;
  await expect(page.locator("text=Recompiling Causal History")).toBeHidden({ timeout: 150_000 });
  const simMs = Date.now() - t0;
  await page.waitForTimeout(800);

  // Frame timing over a ~2s stable interval.
  const frame = await page.evaluate(() => new Promise<{ fps: number; avgFrameMs: number; worstFrameMs: number }>((resolve) => {
    let frames = 0;
    const start = performance.now();
    let last = start;
    const times: number[] = [];
    function tick(now: number) {
      frames++;
      times.push(now - last);
      last = now;
      if (now - start < 2000) {
        requestAnimationFrame(tick);
      } else {
        const dur = now - start;
        times.sort((a, b) => a - b);
        resolve({
          fps: frames / (dur / 1000),
          avgFrameMs: times.reduce((s, x) => s + x, 0) / times.length,
          worstFrameMs: times[times.length - 1],
        });
      }
    }
    requestAnimationFrame(tick);
  }));

  const d = await diag(page);
  const heap = await page.evaluate(() => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize : null;
  });

  // Bounded repeated-operation memory check (scrub 30 times).
  const heapBefore = await page.evaluate(() => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize : 0;
  });
  const slider = page.getByLabel("Timeline year");
  for (let y = 0; y <= 120; y += 4) await slider.fill(String(y));
  await page.waitForTimeout(500);
  const heapAfter = await page.evaluate(() => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize : 0;
  });

  const perf = {
    shellRenderMs: shellMs,
    canvasVisibleMs: canvasMs,
    simCompletionMs: simMs,
    fps: Math.round(frame.fps),
    avgFrameMs: Number(frame.avgFrameMs.toFixed(2)),
    worstFrameMs: Number(frame.worstFrameMs.toFixed(2)),
    drawCalls: d.drawCalls,
    triangles: d.triangles,
    lines: d.lines,
    points: d.points,
    canvas: `${d.canvasWidth}x${d.canvasHeight}`,
    jsHeapMB: heap ? Number((heap / 1048576).toFixed(1)) : null,
    heapAfter30ScrubsMB: Number((heapAfter / 1048576).toFixed(1)),
    heapDeltaMB: Number(((heapAfter - heapBefore) / 1048576).toFixed(1)),
  };
  console.log("PERF_JSON:" + JSON.stringify(perf));

  expect(frame.fps).toBeGreaterThan(0);
  expect(d.triangles).toBeGreaterThan(0);
});

test("rapid seed change ends in a consistent, non-crashing state", async ({ page }) => {
  const errs = attachErrorCollectors(page);
  await page.goto("/");
  await waitForBaseline(page);

  // Change the seed twice in quick succession; the stale-response guard must
  // ensure only the latest run commits and the app remains consistent.
  const seedInput = page.locator('input[type="text"]');
  await seedInput.fill("seed-alpha");
  await page.waitForTimeout(200);
  await seedInput.fill("seed-omega");
  await waitForBaseline(page);

  await expect(seedInput).toHaveValue("seed-omega");
  await expect(page.locator("text=Year 0").first()).toBeVisible();
  const d = await diag(page);
  expect(d.webglContext).toBe(true);
  expect(d.drawCalls).toBeGreaterThan(0);
  expect(errs.pageErrors, errs.pageErrors.join("\n")).toEqual([]);
});
