import { expect, test, type Page } from "@playwright/test";

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("a lifecycle lab grades a prediction against its own simulation", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/reverse-convertible-lab.html");
  await expect(page.locator("#simulation-status")).toContainText(/current/i, { timeout: 20_000 });
  const card = page.locator("#predict");
  await expect(card.locator(".predict-now strong")).not.toHaveText("—");

  const reveal = card.getByRole("button", { name: "Apply and reveal" });
  await expect(reveal).toBeDisabled();
  await card.getByRole("button", { name: "It goes up" }).click();
  await reveal.click();
  await expect(card.locator(".predict-feedback")).toContainText("went from", { timeout: 20_000 });
  await expect(card.locator(".predict-choices button.correct")).toHaveCount(1);
  await expect(page.locator("#control-barrier")).toHaveValue("80");

  await card.getByRole("button", { name: "Put it back" }).click();
  await expect(page.locator("#control-barrier")).toHaveValue("65");
  await card.getByRole("button", { name: "Next prediction" }).click();
  await expect(card.locator(".predict-question")).toContainText("double volatility");
  expect(errors).toEqual([]);
});

test("a closed-form lab reveals immediately and remembers the outcome", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/option-lab.html");
  const card = page.locator("#predict");
  await card.getByRole("button", { name: "The price rises by half or more" }).click();
  await card.getByRole("button", { name: "Apply and reveal" }).click();
  await expect(card.locator(".predict-feedback")).toContainText("Right.", { timeout: 20_000 });
  await expect(page.locator("#vol")).toHaveValue("50");

  await page.reload();
  await expect(page.locator("#predict .predict-remembered")).toContainText("earlier visit");
  expect(errors).toEqual([]);
});
