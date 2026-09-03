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
