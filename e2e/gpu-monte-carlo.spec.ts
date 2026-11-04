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

test("prices lock-in and autocall against the plain note on the same paths", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/gpu-monte-carlo.html");
  await expect(page.locator("#backend-banner")).not.toHaveAttribute("data-backend", "pending");
  await page.locator('[data-autocall="flat"]').click();
  await page.locator('[data-lock="on"]').click();
  await expect(page.locator(status)).toContainText(/current/i, { timeout: 60_000 });
  await expect(page.locator("#features-panel")).toHaveAttribute("data-active", "true");
  const rows = page.locator("#features-table tr");
  await expect(rows).toHaveCount(4);
  const coupon = rows.first().locator("td");
  const plain = Number((await coupon.nth(0).textContent())?.replace("%", ""));
  const featured = Number((await coupon.nth(1).textContent())?.replace("%", ""));
  expect(featured).toBeGreaterThan(plain);
  await expect(page.locator("#features-legend")).toContainText("Called at 3 months");
  await expect(page.locator("#features-legend")).toContainText("Locked in");
  await expect(page.locator("#paths-chart .mc-path.called").first()).toBeVisible();
  await expect(page.locator("#paths-chart .mc-lock")).toHaveCount(1);
});
