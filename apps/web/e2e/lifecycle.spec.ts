import { expect, test } from "@playwright/test";

/**
 * Resource-lifecycle checks (SPEC2 §12.5 / §13), scripted rather than
 * manual: WebGL context-loss recovery, and heap stability across a
 * mode-switching stress loop (a live set runs 30–90 min — orphaned GPU
 * memory must not accumulate).
 */

test("recovers from a forced WebGL context loss without reload", async ({ page }) => {
  const fatal: string[] = [];
  page.on("pageerror", (e) => fatal.push(e.message));

  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("palmos:scene"));
  await page.reload();
  await page.waitForFunction(() => "__palmos" in window);

  await page.getByRole("button", { name: "perform" }).click();
  await expect(page.getByRole("button", { name: "← edit (esc)" })).toBeVisible();
  await page.waitForTimeout(500);

  // force loss then restore on the live WebGL canvas
  await page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    for (const c of canvases) {
      const gl = c.getContext("webgl2");
      if (gl) {
        const ext = gl.getExtension("WEBGL_lose_context");
        (window as unknown as { __lose: unknown }).__lose = ext;
        (ext as { loseContext(): void }).loseContext();
        break;
      }
    }
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    (window as unknown as { __lose: { restoreContext(): void } }).__lose.restoreContext();
  });
  await page.waitForTimeout(800);

  // app is still responsive: can return to edit and the shell works
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "properties" })).toBeVisible();
  expect(fatal).toEqual([]);
});

test("heap stays bounded across a 8x mode-switch stress loop", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("palmos:scene"));
  await page.reload();
  await page.waitForFunction(() => "__palmos" in window);

  type Hooks = {
    loadStressScene(n: number): void;
    setMode(m: "edit" | "perform"): void;
    heapMB(): number | null;
  };

  const baseline = await page.evaluate(() => {
    const h = (window as unknown as { __palmos: Hooks }).__palmos;
    h.loadStressScene(40);
    return h.heapMB();
  });

  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const h = (window as unknown as { __palmos: Hooks }).__palmos;
      h.loadStressScene(40);
      h.setMode("perform");
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as unknown as { __palmos: Hooks }).__palmos.setMode("edit"));
    await page.waitForTimeout(100);
  }

  const finalHeap = await page.evaluate(
    () => (window as unknown as { __palmos: Hooks }).__palmos.heapMB(),
  );

  if (baseline === null || finalHeap === null) {
    test.skip(true, "performance.memory unavailable");
    return;
  }
  // an unbounded GPU/texture leak balloons into hundreds of MB / GBs over
  // repeated mode switches; a healthy app stays within a modest envelope
  expect(finalHeap).toBeLessThan(baseline + 250);
});
