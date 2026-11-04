import { expect, test } from "@playwright/test";

// SwiftShader supplies a software WebGPU adapter in headless Chromium when this flag is set.
test.use({ launchOptions: { args: ["--enable-unsafe-webgpu"] } });

const status = "#mc-status";

test("prices on the GPU and agrees with the CPU path by path", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/gpu-monte-carlo.html");
  await expect(page.locator("#backend-banner")).not.toHaveAttribute("data-backend", "pending");
  const backend = await page.locator("#backend-banner").getAttribute("data-backend");
  test.skip(backend !== "gpu", "No WebGPU adapter in this environment");

  await page.selectOption("#mc-target", "262144");
  await expect(page.locator(status)).toContainText(/current.*GPU/i, { timeout: 60_000 });
  await page.locator("#race-run").click();
  const race = page.locator("#race-status");
  await expect(race).toContainText("faster", { timeout: 60_000 });
  const [, gpuPut, cpuPut] =
    (await race.textContent())?.match(/GPU ([\d.]+) in single.*CPU ([\d.]+) in double/) ?? [];
  expect(Math.abs(Number(gpuPut) - Number(cpuPut))).toBeLessThan(0.01);
});

test("GPU and CPU agree on lock-in and autocall", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/gpu-monte-carlo.html");
  await expect(page.locator("#backend-banner")).not.toHaveAttribute("data-backend", "pending");
  const backend = await page.locator("#backend-banner").getAttribute("data-backend");
  test.skip(backend !== "gpu", "No WebGPU adapter in this environment");

  await page.selectOption("#mc-target", "262144");
  await page.locator('[data-lock="on"]').click();
  await page.locator('[data-autocall="stepdown"]').click();
  await expect(page.locator(status)).toContainText(/current.*GPU/i, { timeout: 60_000 });
  await page.locator("#race-run").click();
  const race = page.locator("#race-status");
  await expect(race).toContainText("faster", { timeout: 60_000 });
  const [, gpuPut, cpuPut] =
    (await race.textContent())?.match(/GPU ([\d.]+) in single.*CPU ([\d.]+) in double/) ?? [];
  expect(Math.abs(Number(gpuPut) - Number(cpuPut))).toBeLessThan(0.01);
});
