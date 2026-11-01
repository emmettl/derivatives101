import { expect, test } from "@playwright/test";

const status = "#mc-status";

test("falls back to the CPU without WebGPU and converges on the one-stock closed form", async ({
  page,
}) => {
  await page.goto("/gpu-monte-carlo.html");
  await expect(page.locator("#backend-banner")).toHaveAttribute("data-backend", /gpu|cpu/);
  const backend = await page.locator("#backend-banner").getAttribute("data-backend");
  test.skip(backend !== "cpu", "This browser exposes a WebGPU adapter");
  await expect(page.locator("#race-run")).toBeDisabled();

  await page.locator('[data-assets="1"]').click();
  await expect(page.locator(status)).toContainText(/current/i, { timeout: 30_000 });
  const put = Number(await page.locator("#stat-put").textContent());
  const reference = Number(await page.locator("#stat-ref").textContent());
  const halfWidth = Number(
    (await page.locator("#stat-put-ci").textContent())?.match(/± ([\d.]+)/)?.[1],
  );
  expect(Math.abs(put - reference)).toBeLessThan(2 * halfWidth);
});
