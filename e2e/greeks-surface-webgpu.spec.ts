import { expect, test } from "@playwright/test";

// SwiftShader supplies a software WebGPU adapter in headless Chromium when this flag is set.
test.use({ launchOptions: { args: ["--enable-unsafe-webgpu"] } });

test("the WGSL shader draws the surface, barrier and slice", async ({ page }) => {
  await page.goto("/greeks-surface.html");
  await expect(page.locator("#backend-banner")).not.toHaveAttribute("data-renderer", "pending");
  // Headless canvases cannot present WebGPU frames, so draw offscreen and read the pixels back.
  const result = await page.evaluate(async (base) => {
    // Vite serves the source modules, so the test drives the page's own renderer.
    const { WebGpuRenderer } = (await import(
      `${base}/renderer.ts`
    )) as typeof import("../src/greeks-surface/renderer");
    const { buildGrid, DEFAULT_PARAMS } = (await import(
      `${base}/engine.ts`
    )) as typeof import("../src/greeks-surface/engine");
    const { buildMesh, DEFAULT_CAMERA } = (await import(
      `${base}/mesh.ts`
    )) as typeof import("../src/greeks-surface/mesh");
    const renderer = await WebGpuRenderer.create(null);
    if (!renderer) return null;
    const grid = buildGrid(DEFAULT_PARAMS, "desk", { spots: 121, times: 41 });
    const mesh = buildMesh(grid, { metric: "gamma", compressed: true, tenor: 1 });
    renderer.draw(
      {
        grid,
        values: grid.gamma,
        mesh,
        version: 1,
        camera: DEFAULT_CAMERA,
        barrier: 70,
        strike: 100,
        slice: 0.5,
        markerSpot: 100,
        markerTime: 0.5,
      },
      480,
      300,
      1,
    );
    const { data } = await renderer.readPixels();
    let drawn = 0;
    let barrierRed = 0;
    let sliceAmber = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
      if (r < 235 || g < 235 || b < 235) drawn += 1;
      if (r > 150 && g < 90 && b < 90) barrierRed += 1;
      if (r > 200 && g > 130 && g < 190 && b < 100) sliceAmber += 1;
    }
    return { drawn, barrierRed, sliceAmber, lost: renderer.lost };
  }, "/src/greeks-surface");
  test.skip(result === null, "No WebGPU adapter in this environment");
  expect(result?.lost).toBe(false);
  expect(result?.drawn).toBeGreaterThan(10_000);
  expect(result?.barrierRed).toBeGreaterThan(30);
  expect(result?.sliceAmber).toBeGreaterThan(30);
});
