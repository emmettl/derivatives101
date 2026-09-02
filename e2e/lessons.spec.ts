import { expect, test, type Page } from "@playwright/test";

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("course lessons are web-first and keep PDF companions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start with foundations" })).toHaveAttribute(
    "href",
    "lesson-00-foundations.html",
  );
  await expect(page.getByRole("link", { name: "Read online" })).toHaveCount(6);
  await expect(page.getByRole("link", { name: "PDF ↓" })).toHaveCount(5);
});

test("lesson chart responds to the shared engine and quiz gives feedback", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/lesson-00-foundations.html");

  const premium = page.locator("#stat-1");
  const before = await premium.textContent();
  await page.locator("#foundation-volatility").fill("55");
  await expect(premium).not.toHaveText(before ?? "");
  await expect(page.locator("#lesson-chart .chart-line")).toHaveCount(1);

  await page
    .getByRole("button", { name: "An obligation to absorb downside below the strike" })
    .click();
  await expect(page.locator(".quiz-feedback")).toContainText("Correct");
  expect(errors).toEqual([]);
});

test("every web lesson renders an engine-driven chart without runtime errors", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  const lessons = [
    "lesson-00-foundations.html",
    "lesson-01-koda-kodd.html",
    "lesson-02-reverse-convertibles.html",
    "lesson-03-fcn-eln.html",
    "lesson-04-discount-bonus.html",
    "lesson-05-protection-leverage.html",
  ];
  for (const lesson of lessons) {
    await page.goto(`/${lesson}`);
    await expect(page.locator("#lesson-chart .chart-line")).not.toHaveCount(0);
    await expect(page.locator("#stat-1")).not.toHaveText("–");
    await expect(page.getByRole("link", { name: /PDF/ })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("glossary filters definitions and remains usable on mobile", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/glossary.html");
  await page.locator("#glossary-search").fill("volatility");
  await expect(page.locator(".glossary-entry:visible")).toHaveCount(3);
  await expect(page.locator("#glossary-count")).toHaveText("3 terms");
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  expect(errors).toEqual([]);
});
