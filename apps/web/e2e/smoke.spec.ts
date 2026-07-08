import { expect, test } from "@playwright/test";

/**
 * The SPEC §5 step 8 smoke test: load app → draw rect → recolor → add
 * routing → toggle perform → toggle back → export JSON → assert the file
 * parses to a valid scene graph.
 */
test("draw, recolor, route, perform, export", async ({ page }) => {
  await page.goto("/");
  // fresh scene every run
  await page.evaluate(() => localStorage.removeItem("palmos:scene"));
  await page.reload();
  await expect(page.getByRole("button", { name: "perform" })).toBeVisible();
  // konva mounts via dynamic import — wait for its stage canvas
  await expect(page.locator("main canvas").first()).toBeVisible();
  await page.waitForTimeout(500); // initial viewport fit

  // --- draw a rect on the artboard (canvas center area) ---
  await page.keyboard.press("r");
  await page.mouse.move(600, 300);
  await page.mouse.down();
  await page.mouse.move(760, 450, { steps: 5 });
  await page.mouse.up();

  // the layer row appears in the panel, selected
  const row = page.getByText("rect 1", { exact: true });
  await expect(row).toBeVisible();

  // --- recolor via the inspector fill hex field ---
  const fillInput = page.locator('input[placeholder="none"]').first();
  await fillInput.fill("#ff5c1f");
  await fillInput.press("Enter");
  await expect(fillInput).toHaveValue("#ff5c1f");

  // --- add an audio routing in the motion tab ---
  await page.getByRole("button", { name: "motion" }).click();
  await page.getByRole("button", { name: "+ add motion" }).click();
  await expect(page.getByText("1 routing")).toBeVisible();

  // --- toggle perform (pixi mounts fullscreen) and back ---
  await page.getByRole("button", { name: "perform" }).click();
  await expect(page.getByRole("button", { name: "← edit (esc)" })).toBeVisible();
  await expect(page.locator("canvas").last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "motion", exact: true }),
  ).toBeVisible();

  // --- export JSON and validate the downloaded graph ---
  await page.getByRole("button", { name: "export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "json", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const scene = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

  expect(scene.version).toBe(2);
  expect(Array.isArray(scene.layers)).toBe(true);
  expect(scene.layers).toHaveLength(1);
  expect(scene.layers[0].type).toBe("path");
  expect(scene.layers[0].fill).toBe("#ff5c1f");
  expect(scene.routings).toHaveLength(1);
  expect(scene.routings[0].layerId).toBe(scene.layers[0].id);
});
