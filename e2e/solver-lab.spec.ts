import { expect, test, type Page } from "@playwright/test";

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("the solver recovers a down barrier from a closed-form target premium", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/solver-lab.html");
  await page.getByRole("button", { name: "Barrier" }).click();
  await page.getByRole("button", { name: "Put" }).click();
  await page.locator("#target").fill("4.75");

  await page.getByRole("button", { name: "Solve automatically" }).click();
  await expect(page.locator("#status-pill")).toContainText(/Solved in \d+ steps/, {
    timeout: 30_000,
  });
  const solved = Number(await page.locator("#solved-value").textContent());
  expect(solved).toBeGreaterThan(69);
  expect(solved).toBeLessThan(72);
  await expect(page.locator("body")).not.toContainText("NaN");
  expect(errors).toEqual([]);
});

test("the structured-product hub links the solver lab", async ({ page }) => {
  await page.goto("/structured-products.html");
  await expect(page.getByRole("link", { name: /Watch a solver work/ })).toHaveAttribute(
    "href",
    "solver-lab.html",
  );
});

test("the solver lab fits a phone viewport and keeps its actions reachable", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/solver-lab.html");

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  const chart = await page.locator("#solver-chart").boundingBox();
  expect(chart).not.toBeNull();
  expect(chart!.x + chart!.width).toBeLessThanOrEqual(390);
  expect(chart!.height).toBeGreaterThan(200);
  await expect(page.locator("#solver-chart")).toHaveAttribute("viewBox", /^0 0 3\d\d \d+$/);

  const inputs = page.getByRole("button", { name: "Edit inputs" });
  await expect(inputs).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#target")).toBeHidden();
  await expect(page.getByRole("button", { name: "Take one step" })).toBeInViewport();
  await inputs.click();
  await expect(page.locator("#target")).toBeVisible();

  await page.getByRole("button", { name: "Take one step" }).click();
  await expect(page.locator("#status-pill")).toContainText("Step 1 of");
  expect(errors).toEqual([]);
});
