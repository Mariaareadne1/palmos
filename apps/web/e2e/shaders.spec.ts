import { expect, test } from "@playwright/test";

/**
 * GLSL compile/link test for every registered shader (SPEC2 §13): load a
 * scene carrying every GPU layer-effect + every post-fx, enter perform so
 * each filter renders (and thus links) against a real WebGL2 context, and
 * assert no shader init/precision errors reach the console. This is the
 * check that caught the real uInputSize precision-mismatch link bug.
 */
test("every registered shader compiles and links without error", async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (/Could not initialize shader|Precisions of uniform|Failed to compile|shader/i.test(t) && msg.type() === "error") {
      shaderErrors.push(t);
    }
  });
  page.on("pageerror", (err) => shaderErrors.push(err.message));

  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("palmos:scene"));
  await page.reload();
  await expect(page.getByRole("button", { name: "perform" })).toBeVisible();

  // wait for the dev test hook to install, then build the all-effects scene
  await page.waitForFunction(() => "__palmos" in window);
  await page.evaluate(() => {
    (window as unknown as { __palmos: { loadAllEffectsScene(): void } }).__palmos.loadAllEffectsScene();
  });

  // enter perform → forces every layer-effect + post-fx filter to render/link
  await page.getByRole("button", { name: "perform" }).click();
  await expect(page.getByRole("button", { name: "← edit (esc)" })).toBeVisible();
  await page.waitForTimeout(1500); // let a few frames render every filter

  expect(shaderErrors, `shader errors:\n${shaderErrors.join("\n")}`).toEqual([]);
});
