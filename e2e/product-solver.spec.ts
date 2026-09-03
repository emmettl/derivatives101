import { expect, test, type Page } from "@playwright/test";

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("the market solver prices an autocall and recovers its barrier from the seeded target", async ({
  page,
}) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/product-solver.html");
  await expect(page.locator("#headline-value")).toHaveText(/^\d+\.\d{2}%$/);
  await expect(page.locator("#snapshot-body tr")).toHaveCount(4);

  await page.getByRole("button", { name: "Solve automatically" }).click();
  await expect(page.locator("#status-pill")).toContainText(/Solved in \d+ steps/, {
    timeout: 30_000,
  });
  const solved = Number((await page.locator("#solved-value").textContent())?.replace("%", ""));
  expect(Math.abs(solved - 60)).toBeLessThan(3);
  await expect(page.locator("body")).not.toContainText("NaN");
  expect(errors).toEqual([]);
});

test("changing underlying switches immediately and reprices behind a busy state", async ({
  page,
}) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/product-solver.html");
  const chart = page.locator("#solver-chart");
  await expect(chart).toHaveAttribute("data-calculation-source", "worker");
  await expect(chart).toHaveAttribute("data-model-underlying", "SX5E");

  await page.locator("#underlying").selectOption("SPX");

  await expect(page.locator("#snapshot-heading")).toContainText("S&P 500");
  await expect(page.locator("#valuation-strip")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#valuation-busy")).toBeVisible();
  await expect(page.locator("#status-pill")).toHaveText("Calculating…");

  await expect(chart).toHaveAttribute("data-model-underlying", "SPX", { timeout: 20_000 });
  await expect(page.locator("#valuation-strip")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#valuation-busy")).toBeHidden();
  await expect(page.locator("#headline-value")).toHaveText(/^\d+\.\d{2}%$/);
  await expect(page.locator("#status-pill")).toHaveText("Ready to solve");
  expect(errors).toEqual([]);
});

test("switching to the protected note solves for a cap and reports unreachable targets", async ({
  page,
}) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/product-solver.html");
  await page.getByRole("button", { name: "Protected" }).click();
  await expect(page.locator("#headline-label")).toHaveText("Participation");
  await page.locator("#solve-target").selectOption("cap");
  await expect(page.locator("#cap-enabled")).toBeChecked();
  await page.locator("#target-value").fill("999");
  await expect(page.locator("#action-note")).toContainText("Reachable participation");
  await page.locator("#target-value").fill("120");
  await page.getByRole("button", { name: "Solve automatically" }).click();
  await expect(page.locator("#status-pill")).toContainText(/Solved in \d+ steps/, {
    timeout: 30_000,
  });
  await expect(page.locator("#iteration-body tr")).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test("both solver pages stay inside a phone-width viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["product-solver.html", "solver-lab.html"]) {
    await page.goto(`/${path}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
