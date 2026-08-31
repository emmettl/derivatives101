export interface InspectorRow {
  label: string;
  value: string;
  color?: string;
}

export interface InspectorPoint {
  y: number;
  color: string;
}

export interface InspectorResult {
  title: string;
  rows: InspectorRow[];
  points?: InspectorPoint[];
}

export interface HorizontalInspectorConfig {
  width: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  minimum: number;
  maximum: number;
  plotMinimum?: number;
  plotMaximum?: number;
  step: number;
  value: number;
  label: string;
  inspect: (value: number) => InspectorResult;
  onSelect: (value: number) => void;
  onInspect?: (value: number) => void;
  onHide?: () => void;
}

export interface PlaneInspectorConfig {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  xMinimum: number;
  xMaximum: number;
  yMinimum: number;
  yMaximum: number;
  xStep: number;
  yStep: number;
  xValue: number;
  yValue: number;
  label: string;
  inspect: (x: number, y: number) => InspectorResult;
  onSelect: (x: number, y: number) => void;
}

export interface InspectorController {
  refresh: () => void;
  show: (value: number, pinned?: boolean, showTooltip?: boolean) => void;
  hide: () => void;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function snap(value: number, minimum: number, maximum: number, step: number): number {
  const bounded = clamp(value, minimum, maximum);
  if (!step) return bounded;
  return clamp(minimum + Math.round((bounded - minimum) / step) * step, minimum, maximum);
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function tooltipFor(svg: SVGElement): HTMLElement {
  const parent = svg.parentElement;
  if (!parent) throw new Error("Interactive SVG needs a parent element");
  parent.classList.add("interactive-chart-host");
  if (!parent.querySelector(":scope > .svg-chart-hint")) {
    const hint = document.createElement("span");
    hint.className = "svg-chart-hint";
    hint.textContent = "Hover to inspect · click or drag to select";
    parent.append(hint);
  }
  let tooltip = parent.querySelector<HTMLElement>(":scope > .svg-chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "svg-chart-tooltip";
    tooltip.hidden = true;
    tooltip.setAttribute("role", "status");
    tooltip.setAttribute("aria-live", "polite");
    parent.append(tooltip);
  }
  return tooltip;
}

function renderTooltip(
  tooltip: HTMLElement,
  result: InspectorResult,
  horizontalPercent: number,
): void {
  tooltip.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = result.title;
  tooltip.append(title);
  result.rows.forEach((row) => {
    const line = document.createElement("span");
    const label = document.createElement("i");
    const value = document.createElement("b");
    label.textContent = row.label;
    value.textContent = row.value;
    if (row.color) line.style.color = row.color;
    line.append(label, value);
    tooltip.append(line);
  });
  tooltip.style.left = `${clamp(horizontalPercent, 7, 78)}%`;
  tooltip.hidden = false;
}

function hideOverlay(svg: SVGElement): void {
  svg.querySelector<SVGGElement>("[data-svg-inspector]")?.remove();
  const tooltip = svg.parentElement?.querySelector<HTMLElement>(":scope > .svg-chart-tooltip");
  if (tooltip) tooltip.hidden = true;
}

export function attachHorizontalInspector(
  svg: SVGSVGElement,
  getConfig: () => HorizontalInspectorConfig | null,
): InspectorController {
  const tooltip = tooltipFor(svg);
  let dragging = false;
  let isPinned = false;
  let shownValue: number | null = null;

  const normalise = (value: number) => {
    const config = getConfig();
    return config ? snap(value, config.minimum, config.maximum, config.step) : value;
  };
  const draw = (rawValue: number, pin = false, notify = false, showTooltip = true) => {
    const config = getConfig();
    if (!config) return;
    const value = normalise(rawValue);
    const plotMinimum = config.plotMinimum ?? config.minimum;
    const plotMaximum = config.plotMaximum ?? config.maximum;
    shownValue = value;
    if (pin) isPinned = true;
    svg.querySelector<SVGGElement>("[data-svg-inspector]")?.remove();
    const group = svgElement("g", { "data-svg-inspector": "true", class: "svg-inspector" });
    const x =
      config.left +
      ((value - plotMinimum) / (plotMaximum - plotMinimum)) *
        (config.width - config.left - config.right);
    group.append(
      svgElement("line", {
        x1: x,
        x2: x,
        y1: config.top,
        y2: config.bottom,
        class: "svg-inspector-line",
      }),
    );
    const result = config.inspect(value);
    result.points?.forEach((point) =>
      group.append(
        svgElement("circle", {
          cx: x,
          cy: point.y,
          r: 5,
          fill: point.color,
          class: "svg-inspector-point",
        }),
      ),
    );
    svg.append(group);
    if (showTooltip) renderTooltip(tooltip, result, (x / config.width) * 100);
    svg.setAttribute("aria-valuenow", value.toFixed(4));
    svg.setAttribute("aria-valuetext", result.title);
    if (notify) config.onInspect?.(value);
  };
  const valueFromPointer = (event: PointerEvent) => {
    const config = getConfig();
    if (!config) return 0;
    const bounds = svg.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * config.width;
    const proportion = (x - config.left) / (config.width - config.left - config.right);
    const plotMinimum = config.plotMinimum ?? config.minimum;
    const plotMaximum = config.plotMaximum ?? config.maximum;
    return normalise(plotMinimum + clamp(proportion, 0, 1) * (plotMaximum - plotMinimum));
  };
  const select = (value: number) => {
    const config = getConfig();
    if (!config) return;
    const selected = normalise(value);
    config.onSelect(selected);
    draw(selected, true, true);
  };

  svg.classList.add("svg-interactive");
  svg.tabIndex = 0;
  svg.setAttribute("role", "slider");
  svg.addEventListener("pointerdown", (event) => {
    dragging = true;
    isPinned = true;
    svg.setPointerCapture(event.pointerId);
    select(valueFromPointer(event));
  });
  svg.addEventListener("pointermove", (event) => {
    const value = valueFromPointer(event);
    if (dragging) select(value);
    else if (!isPinned) draw(value, false, true);
  });
  svg.addEventListener("pointerup", (event) => {
    dragging = false;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  });
  svg.addEventListener("pointercancel", () => {
    dragging = false;
    if (!isPinned) {
      hideOverlay(svg);
      getConfig()?.onHide?.();
    }
  });
  svg.addEventListener("pointerleave", () => {
    if (!dragging && !isPinned && document.activeElement !== svg) {
      hideOverlay(svg);
      getConfig()?.onHide?.();
    }
  });
  svg.addEventListener("focus", () => {
    const config = getConfig();
    if (config) draw(shownValue ?? config.value);
  });
  svg.addEventListener("blur", () => {
    if (!isPinned) {
      hideOverlay(svg);
      getConfig()?.onHide?.();
    }
  });
  svg.addEventListener("keydown", (event) => {
    const config = getConfig();
    if (!config) return;
    let next = shownValue ?? config.value;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= config.step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += config.step;
    else if (event.key === "PageDown") next -= config.step * 5;
    else if (event.key === "PageUp") next += config.step * 5;
    else if (event.key === "Home") next = config.minimum;
    else if (event.key === "End") next = config.maximum;
    else if (event.key === "Escape") {
      isPinned = false;
      hideOverlay(svg);
      config.onHide?.();
      return;
    } else return;
    event.preventDefault();
    select(next);
  });

  return {
    refresh() {
      const config = getConfig();
      if (!config) return;
      svg.setAttribute("aria-label", config.label);
      svg.setAttribute("aria-valuemin", String(config.minimum));
      svg.setAttribute("aria-valuemax", String(config.maximum));
      svg.setAttribute("aria-valuenow", String(config.value));
      if (isPinned) draw(config.value, true);
    },
    show(value, pin = false, showTooltip = true) {
      draw(value, pin, false, showTooltip);
    },
    hide() {
      isPinned = false;
      hideOverlay(svg);
    },
  };
}

export function attachPlaneInspector(
  svg: SVGSVGElement,
  getConfig: () => PlaneInspectorConfig | null,
): { refresh: () => void; hide: () => void } {
  const tooltip = tooltipFor(svg);
  let dragging = false;
  let isPinned = false;
  let shown: [number, number] | null = null;

  const normalise = (x: number, y: number): [number, number] => {
    const config = getConfig();
    return config
      ? [
          snap(x, config.xMinimum, config.xMaximum, config.xStep),
          snap(y, config.yMinimum, config.yMaximum, config.yStep),
        ]
      : [x, y];
  };
  const draw = (rawX: number, rawY: number, pin = false) => {
    const config = getConfig();
    if (!config) return;
    const [xValue, yValue] = normalise(rawX, rawY);
    shown = [xValue, yValue];
    if (pin) isPinned = true;
    svg.querySelector<SVGGElement>("[data-svg-inspector]")?.remove();
    const x =
      config.left +
      ((xValue - config.xMinimum) / (config.xMaximum - config.xMinimum)) *
        (config.width - config.left - config.right);
    const y =
      config.top +
      ((config.yMaximum - yValue) / (config.yMaximum - config.yMinimum)) *
        (config.height - config.top - config.bottom);
    const group = svgElement("g", { "data-svg-inspector": "true", class: "svg-inspector" });
    group.append(
      svgElement("line", {
        x1: x,
        x2: x,
        y1: config.top,
        y2: config.height - config.bottom,
        class: "svg-inspector-line",
      }),
      svgElement("line", {
        x1: config.left,
        x2: config.width - config.right,
        y1: y,
        y2: y,
        class: "svg-inspector-line",
      }),
      svgElement("circle", {
        cx: x,
        cy: y,
        r: 6,
        class: "svg-inspector-point plane",
      }),
    );
    svg.append(group);
    const result = config.inspect(xValue, yValue);
    renderTooltip(tooltip, result, (x / config.width) * 100);
    svg.setAttribute("aria-valuetext", result.title);
  };
  const valuesFromPointer = (event: PointerEvent): [number, number] => {
    const config = getConfig();
    if (!config) return [0, 0];
    const bounds = svg.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * config.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * config.height;
    const xProportion = clamp(
      (x - config.left) / (config.width - config.left - config.right),
      0,
      1,
    );
    const yProportion = clamp(
      (y - config.top) / (config.height - config.top - config.bottom),
      0,
      1,
    );
    return normalise(
      config.xMinimum + xProportion * (config.xMaximum - config.xMinimum),
      config.yMaximum - yProportion * (config.yMaximum - config.yMinimum),
    );
  };
  const select = (x: number, y: number) => {
    const config = getConfig();
    if (!config) return;
    const [xValue, yValue] = normalise(x, y);
    config.onSelect(xValue, yValue);
    draw(xValue, yValue, true);
  };

  svg.classList.add("svg-interactive");
  svg.tabIndex = 0;
  svg.setAttribute("role", "application");
  svg.addEventListener("pointerdown", (event) => {
    dragging = true;
    isPinned = true;
    svg.setPointerCapture(event.pointerId);
    select(...valuesFromPointer(event));
  });
  svg.addEventListener("pointermove", (event) => {
    const values = valuesFromPointer(event);
    if (dragging) select(...values);
    else if (!isPinned) draw(...values);
  });
  svg.addEventListener("pointerup", (event) => {
    dragging = false;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  });
  svg.addEventListener("pointerleave", () => {
    if (!dragging && !isPinned && document.activeElement !== svg) hideOverlay(svg);
  });
  svg.addEventListener("keydown", (event) => {
    const config = getConfig();
    if (!config) return;
    let [x, y] = shown ?? [config.xValue, config.yValue];
    if (event.key === "ArrowLeft") x -= config.xStep;
    else if (event.key === "ArrowRight") x += config.xStep;
    else if (event.key === "ArrowDown") y -= config.yStep;
    else if (event.key === "ArrowUp") y += config.yStep;
    else if (event.key === "Escape") {
      isPinned = false;
      hideOverlay(svg);
      return;
    } else return;
    event.preventDefault();
    select(x, y);
  });

  return {
    refresh() {
      const config = getConfig();
      if (!config) return;
      svg.setAttribute("aria-label", config.label);
      if (isPinned) draw(config.xValue, config.yValue, true);
    },
    hide() {
      isPinned = false;
      hideOverlay(svg);
    },
  };
}
