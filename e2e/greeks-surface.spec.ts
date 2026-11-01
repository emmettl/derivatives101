import { expect, test } from "@playwright/test";

const number = async (page: import("@playwright/test").Page, selector: string) =>
  Number(await page.locator(selector).textContent());

test("draws the surface and reads off Greeks that react to the barrier", async ({ page }) => {
  await page.goto("/greeks-surface.html");
  const banner = page.locator("#backend-banner");
  await expect(banner).toHaveAttribute("data-renderer", /webgpu|webgl|canvas/);
  await expect(page.locator("#stat-value")).not.toHaveText("–");

  // Investor's book at issue: the fair coupon puts the note at par.
  await page.locator('[data-view="note"]').click();
  await page.locator("#gs-spot").fill("100");
  await page.locator("#gs-days").fill("252");
  await expect(page.locator("#stat-value")).toHaveText("100.00");
  expect(await number(page, "#stat-vega")).toBeLessThan(0);

  // Three days out, just above a continuous barrier, the issuer's gamma towers over its value at issue.
  await page.locator('[data-tour="gamma"]').click();
  await expect(page.locator("#gs-days-out")).toHaveText("3 trading days");
  expect(await number(page, "#stat-gamma")).toBeGreaterThan(1);
  expect(await number(page, "#stat-delta")).toBeLessThan(-5);

  // An at-maturity barrier makes gamma change sign across the barrier.
  await page.locator('[data-observation="maturity"]').click();
  await page.locator("#gs-spot").fill("72");
  expect(await number(page, "#stat-gamma")).toBeGreaterThan(0);
  await page.locator("#gs-spot").fill("68");
  expect(await number(page, "#stat-gamma")).toBeLessThan(0);
  await expect(page.locator("#readout-point")).toContainText("checked only at the final fixing");
});

test("falls back to a flat heat map with axis labels", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/greeks-surface.html?renderer=canvas");
  await expect(page.locator("#backend-banner")).toHaveAttribute("data-renderer", "canvas");
  await expect(page.locator("#camera-actions")).toBeHidden();
  await expect(page.locator("#surface-labels")).toContainText("Maturity");
  await expect(page.locator("#surface-labels")).toContainText("100%");
  const canvas = page.locator("#surface-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("No canvas");
  // Clicking the map moves the readout.
  await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.5 } });
  await expect(page.locator("#gs-spot-out")).not.toHaveText("100.0%");
  expect(errors).toEqual([]);
});

test("draws with WebGL when asked to", async ({ page }) => {
  await page.goto("/greeks-surface.html?renderer=webgl");
  const renderer = await page.locator("#backend-banner").getAttribute("data-renderer");
  test.skip(renderer !== "webgl", "No WebGL 2 in this environment");
  await expect(page.locator("#surface-labels")).toContainText("Spot, % of initial");
  // Rotating with the keyboard redraws without errors and moves the labels.
  const before = await page.locator("#surface-labels .axis").first().boundingBox();
  await page.locator("#surface-canvas").focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForTimeout(200);
  const after = await page.locator("#surface-labels .axis").first().boundingBox();
  expect(after?.x).not.toBe(before?.x);
});
