export interface ChartSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Chooses the SVG coordinate space for a chart from the width it is actually laid out at.
 *
 * Wide layouts keep the base size, so the drawing simply scales down as before. Once the
 * container is narrower than the base width, the coordinate space matches CSS pixels so
 * labels and strokes stay legible on phones, and the height shrinks in proportion but never
 * below `minimumHeightShare` of the base height.
 *
 * A chart that is not laid out (for example inside a collapsed section) reports the base
 * size; callers should redraw once it becomes visible.
 */
export function responsiveChartSize(
  svg: SVGSVGElement,
  base: ChartSize,
  minimumHeightShare = 0.62,
): ChartSize {
  const measured = svg.clientWidth || svg.parentElement?.clientWidth || 0;
  if (measured <= 0 || measured >= base.width) return base;
  const width = Math.round(Math.max(280, measured));
  const share = Math.max(minimumHeightShare, Math.min(1, width / base.width));
  return { width, height: Math.round(base.height * share) };
}

/**
 * Applies a coordinate space to an SVG. The `width` and `height` attributes give the
 * element an intrinsic aspect ratio, which keeps `height: auto` reliable in Safari.
 */
export function applyChartSize(svg: SVGSVGElement, size: ChartSize): void {
  svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
  svg.setAttribute("width", String(size.width));
  svg.setAttribute("height", String(size.height));
}

/** Runs `redraw` once per animation frame after the window is resized. */
export function onResize(redraw: () => void): void {
  let frame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(redraw);
  });
}
