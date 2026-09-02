import { expect, test, type Page } from "@playwright/test";

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

const labs = [
  ["reverse-convertible-lab.html", "#simulation-status"],
  ["coupon-memory-lab.html", "#simulation-status"],
  ["lock-in-lab.html", "#simulation-status"],
  ["basket-lab.html", "#basket-simulation-status"],
  ["koda-kodd-lab.html", "#koda-simulation-status"],
  ["participation-lab.html", "#participation-simulation-status"],
] as const;

test("lifecycle labs compare downside skew with the flat-vol baseline", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  for (const [path, statusSelector] of labs) {
    await page.goto(`/${path}`);
    const status = page.locator(statusSelector);
    await expect(status).toContainText(/current/i, { timeout: 15_000 });
    const toggle = page.getByRole("button", { name: "Downside skew" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(status).toContainText(/downside local.vol/i, { timeout: 15_000 });
    await expect(status).toContainText("versus flat");
  }
  expect(errors).toEqual([]);
});
