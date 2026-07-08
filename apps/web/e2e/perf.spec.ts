import { expect, test } from "@playwright/test";

/**
 * Frame-budget check (SPEC2 §13.2): 60fps in perform mode with 40 layers
 * and several GPU effects means ≤16.6ms of render WORK per frame. We
 * measure work time (not rAF cadence) so the result is independent of the
 * automation tab's background rAF throttling.
 */
test("perform-mode frame work stays within the 60fps budget", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("palmos:scene"));
  await page.reload();
  await page.waitForFunction(() => "__palmos" in window);

  await page.evaluate(() => {
    (window as unknown as { __palmos: { loadStressScene(n: number): void } }).__palmos.loadStressScene(40);
  });
  await page.getByRole("button", { name: "perform" }).click();
  await expect(page.getByRole("button", { name: "← edit (esc)" })).toBeVisible();

  // let the EMA settle over a few hundred frames of work
  await page.waitForTimeout(2500);
  const frameMs = await page.evaluate(
    () => (window as unknown as { __palmosFrameMs?: number }).__palmosFrameMs ?? -1,
  );

  expect(frameMs).toBeGreaterThan(0); // the loop ran
  // 16.6ms = 60fps; allow headroom for CI GPUs. A blown budget (e.g. a
  // per-frame leak or unshared gaussian) would be many ×16ms.
  expect(frameMs).toBeLessThan(16.6);
});
