import { readdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Visits every page of the site, nudges its first controls and checks that
 * nothing throws, nothing renders NaN and the layout stays inside the
 * viewport. New pages are covered automatically because the list is read
 * from the repository root.
 */
const pages = readdirSync(process.cwd())
  .filter((name) => name.endsWith(".html"))
  .sort();

const FORBIDDEN_TEXT = /\bNaN\b|\bInfinity\b|\bundefined\b/;

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const statuses = page.locator('[id$="simulation-status"], #mc-status');
  const count = await statuses.count();
  for (let index = 0; index < count; index += 1) {
    await expect(statuses.nth(index)).toContainText(/current/i, { timeout: 20_000 });
  }
  await page.waitForTimeout(400);
}

async function nudgeControls(page: Page): Promise<number> {
  let nudged = 0;
  const ranges = page.locator('input[type="range"]:visible:enabled');
  const rangeCount = Math.min(await ranges.count(), 3);
  for (let index = 0; index < rangeCount; index += 1) {
    const range = ranges.nth(index);
    const { min, max, step, value } = await range.evaluate((element) => {
      const input = element as HTMLInputElement;
      return {
        min: Number(input.min || 0),
        max: Number(input.max || 100),
        step: Number(input.step || 1),
        value: Number(input.value),
      };
    });
    const span = max - min;
    let next = value + Math.max(step, span / 5);
    if (next > max) next = value - Math.max(step, span / 5);
    next = Math.round(next / step) * step;
    if (next < min || next > max || next === value) continue;
    await range.fill(String(Number(next.toFixed(6))));
    nudged += 1;
  }
  const selects = page.locator("select:visible:enabled");
  const selectCount = Math.min(await selects.count(), 2);
  for (let index = 0; index < selectCount; index += 1) {
    const select = selects.nth(index);
    const options = await select.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: (node as HTMLOptionElement).value,
        disabled: (node as HTMLOptionElement).disabled,
      })),
    );
    const current = await select.inputValue();
    const alternative = options.find((option) => !option.disabled && option.value !== current);
    if (!alternative) continue;
    await select.selectOption(alternative.value);
    nudged += 1;
  }
  return nudged;
}

async function expectHealthy(page: Page, name: string): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text, `${name} renders a broken number`).not.toMatch(FORBIDDEN_TEXT);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${name} scrolls horizontally`).toBeLessThanOrEqual(0);
}

for (const name of pages) {
  test(`${name} loads, reacts to its controls and stays healthy`, async ({ page }) => {
    const errors = monitorRuntimeErrors(page);
    await page.goto(`/${name}`);
    await settle(page);
    await expectHealthy(page, name);

    await nudgeControls(page);
    await settle(page);
    await expectHealthy(page, name);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await expectHealthy(page, `${name} at phone width`);
    expect(errors, `${name} logged runtime errors`).toEqual([]);
  });
}
