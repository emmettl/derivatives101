import { expect, test } from "@playwright/test";

test("Payoff Explorer paints before loading only the active product model", async ({ page }) => {
  let releaseModel = () => {};
  const modelGate = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  const panelRequests: string[] = [];

  page.on("request", (request) => {
    if (request.url().includes("/src/payoff-explorer/panels/")) panelRequests.push(request.url());
  });
  await page.route("**/src/payoff-explorer/panels/building-blocks.js", async (route) => {
    await modelGate;
    await route.continue();
  });

  try {
    const activeModelRequest = page.waitForRequest((request) =>
      request.url().includes("/src/payoff-explorer/panels/building-blocks.js"),
    );
    await page.goto("/payoff-explorer.html", { waitUntil: "domcontentloaded" });

    await expect(page.locator("html")).toHaveAttribute("data-payoff-shell-ready", "true");
    await expect(page.getByRole("heading", { name: "Payoff Explorer" })).toBeVisible();
    await expect(page.locator("#p-blocks")).toBeVisible();

    await activeModelRequest;
    await expect(page.locator("#p-blocks")).toHaveAttribute("aria-busy", "true");
    expect(panelRequests.some((url) => url.includes("building-blocks.js"))).toBe(true);
    expect(panelRequests.some((url) => !url.includes("building-blocks.js"))).toBe(false);
  } finally {
    releaseModel();
  }

  await expect(page.locator("#p-blocks")).toHaveAttribute("data-model-ready", "true");
  await expect(page.locator("#bk-svg path").first()).toBeAttached();
});

test("every path-simulated certificate tab renders its outcome distribution", async ({ page }) => {
  await page.goto("/payoff-explorer.html");

  for (const [panel, prefix] of [
    ["disc", "dc"],
    ["bonus", "bn"],
    ["mini", "mf"],
  ]) {
    await page.locator(`#tabs [data-t="${panel}"]`).click();
    await expect(page.locator(`#p-${panel}`)).toHaveAttribute("data-model-ready", "true");
    await expect(page.locator(`#${prefix}-hist .interactive-histogram-bar`)).not.toHaveCount(0);
  }
});
