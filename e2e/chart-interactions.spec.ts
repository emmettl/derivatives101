import { expect, test, type Page } from "@playwright/test";

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function expectCurrentSimulation(page: Page, selector: string): Promise<void> {
  await expect(page.locator(selector)).toContainText(/current/i, { timeout: 15_000 });
}

test("a new down barrier receives a valid default and never renders NaN", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/options-a-la-carte.html");
  const firstLeg = page.locator('[data-leg="0"]');
  await firstLeg.locator('select[data-field="barrierType"]').selectOption("down-in");

  await expect(firstLeg.locator('input[data-field="barrier"]')).toHaveValue("75");
  await expect(page.locator("body")).not.toContainText("NaN");
  await expectCurrentSimulation(page, "#strategy-simulation-status");
  expect(errors).toEqual([]);
});

test("Option Lab headline values expose keyboard-accessible explanations", async ({ page }) => {
  await page.goto("/option-lab.html");

  await expect(page.locator(".price-strip .help-trigger")).toHaveCount(7);
  const deltaHelp = page.locator("#delta-help");
  await expect(deltaHelp).toBeHidden();
  await page.getByRole("button", { name: "Explain delta" }).focus();
  await expect(deltaHelp).toBeVisible();
  await expect(deltaHelp.getByRole("link", { name: "Delta in the glossary" })).toHaveAttribute(
    "href",
    "glossary.html#delta",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Explain time value" }).focus();
  const mobileHelp = await page.locator("#time-value-help").boundingBox();
  expect(mobileHelp).not.toBeNull();
  expect(mobileHelp!.x).toBeGreaterThanOrEqual(0);
  expect(mobileHelp!.x + mobileHelp!.width).toBeLessThanOrEqual(390);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("strategy payoff and Monte Carlo charts support keyboard inspection and resampling", async ({
  page,
}) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/options-a-la-carte.html");

  const payoffChart = page.locator("#strategy-chart");
  await payoffChart.press("End");
  await expect(page.locator("#strategy-chart-tooltip")).toBeVisible();
  await expect(page.locator("#selected-outcome")).toContainText("At expiry");

  await expectCurrentSimulation(page, "#strategy-simulation-status");
  const simulationChart = page.locator("#strategy-simulation-chart");
  await simulationChart.press("End");
  await expect(simulationChart.locator(".simulation-bin.selected")).toHaveCount(1);
  await expect(simulationChart.locator("xpath=..").locator(".svg-chart-tooltip")).toContainText(
    "Share",
  );

  await page.getByRole("button", { name: "Resample paths" }).click();
  await expect(page.locator("#strategy-simulation-status")).toContainText(/Sample 2 · current/i, {
    timeout: 15_000,
  });
  await expect(simulationChart.locator(".simulation-bin.selected")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("the specification trace keeps chart selection synchronized with its ledger", async ({
  page,
}) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/specification-capstone.html");

  const chart = page.locator("#spec-path-chart");
  await chart.press("End");
  const selectedRow = page.locator("#trace-ledger tr.selected-observation");
  await expect(selectedRow).toHaveCount(1);
  await expect(selectedRow).toContainText("Final");
  await expect(chart.locator("xpath=..").locator(".svg-chart-tooltip")).toContainText(
    "Not evaluated",
  );
  expect(errors).toEqual([]);
});

test("structured-product paths and distributions expose their selected observations", async ({
  page,
}) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/reverse-convertible-lab.html");
  await expectCurrentSimulation(page, "#simulation-status");

  await page.locator("#path-chart").press("End");
  await expect(page.locator("#ledger-body tr.selected-observation")).toHaveCount(1);

  const histogram = page.locator("#histogram");
  await histogram.press("End");
  const tooltip = histogram.locator("xpath=..").locator(".svg-chart-tooltip");
  await expect(tooltip).toContainText("Paths");
  await expect(tooltip).toContainText("Share");
  expect(errors).toEqual([]);
});

test("Option Lab terminal-bin selection survives Monte Carlo resampling", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/option-lab.html");
  await expectCurrentSimulation(page, "#mc-status");

  const paths = page.locator("#paths");
  await paths.press("End");
  await expect(page.locator("#terminal-readout")).toBeVisible();
  await expect(page.locator("#terminal-readout")).toContainText("Option payoff");
  await expect(paths).toHaveAttribute("aria-valuetext", /Terminal spot/);

  await page.getByRole("button", { name: "Resample paths" }).click();
  await expect(page.locator("#mc-status")).toContainText(/Sample 2 · current/i, {
    timeout: 15_000,
  });
  await expect(page.locator("#terminal-readout")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Payoff Explorer simulation histograms support direct bin inspection", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/payoff-explorer.html#rc");

  const histogram = page.locator("#rc-hist");
  await expect(histogram.locator(".interactive-histogram-bar")).toHaveCount(38);
  await histogram.press("End");
  const tooltip = histogram.locator("xpath=..").locator(".svg-chart-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Share");
  expect(errors).toEqual([]);
});

test("solver chart distinguishes the tested range from the retained bounds", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/solver-lab.html");

  await expect(page.locator("#solver-chart .candidate-dot")).toHaveCount(0);
  await page.getByRole("button", { name: "Take one step" }).click();
  const chart = page.locator("#solver-chart");
  const bracket = chart.locator(".bracket-zone");
  const tested = chart.locator(".tested-zone");
  const candidate = chart.locator(".candidate-dot");
  await expect(bracket).toHaveCount(1);
  await expect(tested).toHaveCount(1);
  await expect(candidate).toHaveCount(1);
  await expect(chart.locator(".bracket-boundary")).toHaveCount(2);
  await expect(chart.locator(".bracket-line")).toHaveCount(0);

  const [bracketX, bracketWidth, testedX, testedWidth, candidateX] = await Promise.all([
    bracket.getAttribute("x"),
    bracket.getAttribute("width"),
    tested.getAttribute("x"),
    tested.getAttribute("width"),
    candidate.getAttribute("cx"),
  ]);
  await expect(tested).toHaveAttribute("data-lower", "20");
  await expect(tested).toHaveAttribute("data-upper", "250");
  await expect(bracket).toHaveAttribute("data-lower", "20");
  await expect(bracket).toHaveAttribute("data-upper", "135");
  expect(Number(candidateX)).toBeCloseTo(Number(testedX) + Number(testedWidth) / 2, 6);
  expect(Number(candidateX)).toBeCloseTo(Number(bracketX) + Number(bracketWidth), 6);

  await page.getByRole("button", { name: "Take one step" }).click();
  await expect(bracket).toHaveAttribute("data-lower", "77.5");
  await expect(bracket).toHaveAttribute("data-upper", "135");
  await expect(tested).toHaveAttribute("data-lower", "20");
  await expect(tested).toHaveAttribute("data-upper", "135");
  expect(errors).toEqual([]);
});

test("solver can apply and download the dated market snapshot", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.route("**/market-data/latest.json", (route) => route.abort());
  await page.goto("/solver-lab.html");

  const underlying = page.locator("#market-underlying");
  await expect(underlying).toBeEnabled();
  await expect(underlying.locator("option")).toHaveCount(3);
  const response = await page.request.get("/market-data/latest.json");
  expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  expect(snapshot.schemaVersion).toBe(1);

  await page.getByRole("button", { name: "Apply snapshot" }).click();
  await expect(page.locator("#market-status")).toContainText("inputs applied");
  await expect(page.locator("#spot-out")).not.toHaveText("100.00");
  await expect(page.locator("#vol-out")).toHaveText(
    `${(snapshot.instruments[0].realisedVolatility60 * 100).toFixed(1)}%`,
  );
  await expect(page.locator("#download-market")).toHaveAttribute("download", "");
  expect(errors).toEqual([]);
});

test("solver prices rapid input changes in a worker and keeps only the latest result", async ({
  page,
}) => {
  const errors = monitorRuntimeErrors(page);
  await page.goto("/solver-lab.html");

  const chart = page.locator("#solver-chart");
  await expect(chart).toHaveAttribute("data-calculation-source", "worker");
  const spot = page.locator("#spot");
  await spot.fill("85");
  await spot.fill("125");
  await spot.fill("105");

  await expect(page.locator("#spot-out")).toHaveText("105.00");
  await expect(chart).toHaveAttribute("data-model-spot", "105");
  await expect(page.locator("#status-pill")).toHaveText("Ready to solve");
  expect(errors).toEqual([]);
});

test("simulation inspectors remain inside a narrow viewport", async ({ page }) => {
  const errors = monitorRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/option-lab.html");
  await expectCurrentSimulation(page, "#mc-status");
  await page.locator("#paths").press("End");
  const optionReadout = page.locator("#terminal-readout");
  await expect(optionReadout).toBeVisible();
  const optionBox = await optionReadout.boundingBox();
  expect(optionBox).not.toBeNull();
  expect(optionBox!.x).toBeGreaterThanOrEqual(0);
  expect(optionBox!.x + optionBox!.width).toBeLessThanOrEqual(390);

  await page.goto("/options-a-la-carte.html");
  await expectCurrentSimulation(page, "#strategy-simulation-status");
  const simulationChart = page.locator("#strategy-simulation-chart");
  await simulationChart.press("End");
  const strategyTooltip = simulationChart.locator("xpath=..").locator(".svg-chart-tooltip");
  await expect(strategyTooltip).toBeVisible();
  const strategyBox = await strategyTooltip.boundingBox();
  expect(strategyBox).not.toBeNull();
  expect(strategyBox!.x).toBeGreaterThanOrEqual(0);
  expect(strategyBox!.x + strategyBox!.width).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test("narrow viewports collapse the input panels so the first chart sits near the top", async ({
  page,
}) => {
  const errors = monitorRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/option-lab.html");
  const surface = await page.locator("#surface").boundingBox();
  expect(surface).not.toBeNull();
  expect(surface!.y).toBeLessThan(1000);
  await expect(page.locator("#controls-summary")).toContainText("Call · spot 100");
  await expect(page.locator("#spot")).toBeHidden();
  await page.getByRole("button", { name: "Edit inputs" }).click();
  await expect(page.locator("#spot")).toBeVisible();
  await page.getByRole("button", { name: "Hide inputs" }).click();
  await expect(page.locator("#spot")).toBeHidden();

  await page.goto("/options-a-la-carte.html");
  const payoff = page.locator("#strategy-chart");
  const payoffBox = await payoff.boundingBox();
  expect(payoffBox).not.toBeNull();
  expect(payoffBox!.y).toBeLessThan(1400);
  expect(payoffBox!.x + payoffBox!.width).toBeLessThanOrEqual(390);
  await expect(payoff).toHaveAttribute("viewBox", /^0 0 3\d\d \d+$/);
  await expect(page.locator("#leg-builder")).toBeHidden();
  await page.getByRole("button", { name: "Edit legs" }).click();
  await expect(page.locator('[data-leg="0"]')).toBeVisible();
  await expectCurrentSimulation(page, "#strategy-simulation-status");
  await expect(page.locator("#strategy-simulation-chart")).toHaveAttribute(
    "viewBox",
    /^0 0 3\d\d 5\d\d$/,
  );
  expect(errors).toEqual([]);
});
