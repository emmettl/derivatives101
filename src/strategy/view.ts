import { MAX_LEGS, catalogue, marketControls, presets, rules } from "./config";
import { drawChart } from "./chart";
import type { MarketControl, OptionLeg, RiskMeasures, ScenarioRow, StrategyMetrics, StrategyState, ViewHandlers } from "./types";

const legColors = ["leg-0", "leg-1", "leg-2", "leg-3"];

function byId<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing strategy lab element #${id}`);
  return element as unknown as T;
}

function esc(value: unknown): string {
  return String(value).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character] ?? character);
}

function signed(value: number, decimals: number): string {
  if (Math.abs(value) < 0.5 * 10 ** -decimals) return (0).toFixed(decimals);
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}`;
}

function controlMarkup(control: MarketControl, state: StrategyState): string {
  return `<label class="range-control" for="strategy-${control.key}"><span>${esc(control.label)} <output id="strategy-${control.key}-out"></output></span><input id="strategy-${control.key}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${state[control.key]}"></label>`;
}

export function createMarketControls(state: StrategyState, onInput: (key: MarketControl["key"], value: number) => void): void {
  byId("market-controls").innerHTML = `<div class="control-block"><span class="control-title">Pricing inputs</span>${marketControls.slice(0, 5).map(control => controlMarkup(control, state)).join("")}</div><div class="control-block"><span class="control-title">Path &amp; outcome</span>${marketControls.slice(5).map(control => controlMarkup(control, state)).join("")}<p class="control-help">The observed low and high record barrier touches before expiry. The selected terminal level is added to that path history.</p></div>`;
  marketControls.forEach(control => byId<HTMLInputElement>(`strategy-${control.key}`).addEventListener("input", event => onInput(control.key, Number((event.currentTarget as HTMLInputElement).value))));
}

function syncMarketControls(state: StrategyState): void {
  const observedLow = byId<HTMLInputElement>("strategy-observedLow");
  observedLow.min = String(state.spot * 0.4);
  observedLow.max = String(state.spot);
  const observedHigh = byId<HTMLInputElement>("strategy-observedHigh");
  observedHigh.min = String(state.spot);
  observedHigh.max = String(state.spot * 1.6);
  const terminal = byId<HTMLInputElement>("strategy-terminal");
  terminal.min = String(state.spot * 0.4);
  terminal.max = String(state.spot * 1.6);
  marketControls.forEach(control => {
    byId<HTMLInputElement>(`strategy-${control.key}`).value = String(state[control.key]);
    byId<HTMLOutputElement>(`strategy-${control.key}-out`).textContent = control.format(state[control.key]);
  });
}

function renderPresets(state: StrategyState, onSelect: (id: string) => void): void {
  const host = byId("strategy-presets");
  host.innerHTML = Object.values(presets).map(preset => `<button type="button" data-preset="${preset.id}" class="${state.presetId === preset.id ? "on" : ""}" aria-pressed="${state.presetId === preset.id}">${esc(preset.name)}</button>`).join("");
  host.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach(button => button.addEventListener("click", () => onSelect(button.dataset.preset!)));
}

function renderLegs(state: StrategyState, onChange: ViewHandlers["onLegChange"]): void {
  const host = byId("leg-builder");
  host.innerHTML = state.legs.map((item, index) => `<article class="leg-card ${item.enabled ? "" : "disabled"}" data-leg="${index}"><header><span>Leg ${index + 1}</span><label><input type="checkbox" data-field="enabled" ${item.enabled ? "checked" : ""}> Active</label></header><div class="leg-fields"><label class="leg-field"><span>Position</span><select data-field="side"><option value="long"${item.side === "long" ? " selected" : ""}>Long</option><option value="short"${item.side === "short" ? " selected" : ""}>Short</option></select></label><label class="leg-field"><span>Option</span><select data-field="type"><option value="call"${item.type === "call" ? " selected" : ""}>Call</option><option value="put"${item.type === "put" ? " selected" : ""}>Put</option></select></label><label class="leg-field"><span>Quantity</span><input type="number" min="0.5" max="3" step="0.5" value="${item.quantity}" data-field="quantity"></label><label class="leg-field"><span>Strike</span><input type="number" min="20" max="220" step="1" value="${item.strike.toFixed(0)}" data-field="strike"></label><label class="leg-field wide"><span>Barrier style</span><select data-field="barrierType"><option value="none"${item.barrierType === "none" ? " selected" : ""}>Vanilla · no barrier</option><option value="down-in"${item.barrierType === "down-in" ? " selected" : ""}>Down-and-in</option><option value="down-out"${item.barrierType === "down-out" ? " selected" : ""}>Down-and-out</option><option value="up-in"${item.barrierType === "up-in" ? " selected" : ""}>Up-and-in</option><option value="up-out"${item.barrierType === "up-out" ? " selected" : ""}>Up-and-out</option></select></label><label class="leg-field wide barrier-field ${item.barrierType === "none" ? "hidden" : ""}"><span>Barrier level</span><input type="number" min="20" max="220" step="1" value="${item.barrier.toFixed(0)}" data-field="barrier"></label></div></article>`).join("");
  host.querySelectorAll<HTMLElement>("[data-leg]").forEach(card => card.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach(input => input.addEventListener("change", () => {
    const field = input.dataset.field as keyof OptionLeg;
    const numeric = field === "quantity" || field === "strike" || field === "barrier";
    const value = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : numeric ? Number(input.value) : input.value;
    onChange(Number(card.dataset.leg), field, value as OptionLeg[keyof OptionLeg]);
  })));
}

function renderSummary(state: StrategyState, metrics: StrategyMetrics): string {
  const preset = state.presetId in presets ? presets[state.presetId as keyof typeof presets] : undefined;
  const active = state.legs.filter(item => item.enabled);
  const title = preset?.name ?? "Custom multi-leg strategy";
  byId("strategy-name").textContent = title;
  byId("strategy-summary").textContent = preset?.description ?? `${active.length} active leg${active.length === 1 ? "" : "s"}; the combined payoff, premium and risk update directly from the recipe below.`;
  byId("leg-count").textContent = `${active.length} of ${MAX_LEGS} legs active`;
  const debit = metrics.netPremium;
  const stats = [[`${debit >= 0 ? "Debit " : "Credit "}${Math.abs(debit).toFixed(2)}`, "Net premium", "Long premium minus short premium"], [metrics.breakEvens.length ? metrics.breakEvens.map(value => value.toFixed(1)).join(" / ") : "None in range", "Break-even level(s)", "Across 40%–160% of initial spot"], [metrics.minimumPnl.toFixed(2), "Lowest P/L shown", "Within the displayed range"], [metrics.maximumPnl.toFixed(2), "Highest P/L shown", "Within the displayed range"]];
  byId("strategy-stats").innerHTML = stats.map(item => `<div><span>${esc(item[1])}</span><strong>${esc(item[0])}</strong><p>${esc(item[2])}</p></div>`).join("");
  byId("strategy-legend").innerHTML = `<span><i class="total"></i>Combined strategy</span>${state.legs.map((item, index) => item.enabled ? `<span><i class="${legColors[index]}"></i>Leg ${index + 1}: ${item.side} ${item.quantity} ${item.type}</span>` : "").join("")}`;
  const barrierEvents = metrics.selected.legs.map((result, index) => state.legs[index].enabled && state.legs[index].barrierType !== "none" ? `Leg ${index + 1} ${result.hit ? "touched" : "did not touch"} its ${state.legs[index].barrierType} barrier and is ${result.active ? "active" : "inactive"}` : "").filter(Boolean);
  byId("selected-outcome").textContent = `At expiry ${state.terminal.toFixed(0)}, the strategy payoff before premium is ${metrics.selected.payoff.toFixed(2)} and profit/loss after premium is ${metrics.selected.pnl.toFixed(2)}.${barrierEvents.length ? ` ${barrierEvents.join("; ")}.` : ""}`;
  return title;
}

function renderRisk(risk: RiskMeasures, scenarios: ScenarioRow[]): void {
  const stats = [[risk.value.toFixed(2), "Model value", "Signed value of every active leg"], [signed(risk.delta, 3), "Delta", "Value change for a 1-point spot rise"], [signed(risk.gamma, 3), "Gamma", "How delta bends as spot changes"], [signed(risk.vega, 2), "Vega", "Approximate change for +1 vol point"]];
  byId("strategy-risk-stats").innerHTML = stats.map(item => `<div><span>${esc(item[1])}</span><strong>${esc(item[0])}</strong><p>${esc(item[2])}</p></div>`).join("");
  const deltaText = Math.abs(risk.delta) < 0.05 ? "roughly direction-neutral here" : risk.delta > 0 ? "benefits initially from a small spot rise" : "benefits initially from a small spot fall";
  const gammaText = Math.abs(risk.gamma) < 0.005 ? "has little local curvature" : risk.gamma > 0 ? "is locally convex" : "is locally concave";
  const vegaText = Math.abs(risk.vega) < 0.05 ? "has little local volatility sensitivity" : risk.vega > 0 ? "benefits from higher implied volatility" : "benefits from lower implied volatility";
  byId("strategy-risk-note").textContent = `At the selected inputs the package is ${deltaText}, ${gammaText}, and ${vegaText}. With spot and volatility unchanged, the model value changes by ${signed(risk.theta30, 2)} over the next 30 days.`;
  const volatilityMoves = scenarios[0]?.cells.map(cell => cell.volatilityMove) ?? [];
  byId("strategy-scenarios").innerHTML = `<thead><tr><th>Immediate spot shock</th>${volatilityMoves.map(move => `<th>${move === 0 ? "Vol unchanged" : `${move > 0 ? "+" : "−"}${Math.abs(move * 100).toFixed(0)} vol points`}</th>`).join("")}</tr></thead><tbody>${scenarios.map(row => `<tr><th>${row.spotMove === 0 ? "Spot unchanged" : `Spot ${row.spotMove > 0 ? "+" : "−"}${Math.abs(row.spotMove * 100).toFixed(0)}%`}</th>${row.cells.map(cell => `<td class="scenario-cell ${cell.pnl > 0.005 ? "positive" : cell.pnl < -0.005 ? "negative" : "neutral"}${row.spotMove === 0 && cell.volatilityMove === 0 ? " current" : ""}"><strong>${signed(cell.pnl, 2)}</strong><span>mark ${cell.value.toFixed(2)}</span></td>`).join("")}</tr>`).join("")}</tbody>`;
}

function renderAnatomy(state: StrategyState, metrics: StrategyMetrics): void {
  const activeResults = metrics.selected.legs.map((result, index) => ({ result, item: state.legs[index], index })).filter(entry => entry.item.enabled);
  const maximum = Math.max(1, ...activeResults.map(entry => Math.abs(entry.result.pnl)));
  byId("contribution-bars").innerHTML = activeResults.map(entry => {
    const width = Math.abs(entry.result.pnl) / maximum * 50;
    return `<div class="contribution-row"><span>Leg ${entry.index + 1} · ${esc(entry.item.side)} ${esc(entry.item.type)}</span><div class="contribution-track"><i class="contribution-bar ${entry.result.pnl >= 0 ? "positive" : "negative"}" style="width:${width.toFixed(2)}%"></i></div><strong>${signed(entry.result.pnl, 2)}</strong></div>`;
  }).join("") || `<p class="barrier-note">Activate at least one leg to see its contribution.</p>`;
  byId("leg-ledger").innerHTML = state.legs.map((item, index) => {
    const result = metrics.selected.legs[index];
    if (!item.enabled) return `<tr class="inactive"><td>Leg ${index + 1}</td><td>Inactive</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>Not evaluated</td></tr>`;
    const pricing = result.pricing!;
    const contract = `${item.side === "long" ? "Long" : "Short"} ${item.quantity} ${item.type}`;
    const barrier = item.barrierType === "none" ? "Vanilla" : `${item.barrierType} @ ${item.barrier.toFixed(0)}`;
    const stateText = item.barrierType === "none" ? "Always active" : `${result.hit ? "Touched" : "Not touched"} · ${result.active ? "active" : "inactive"}`;
    return `<tr><td>Leg ${index + 1}</td><td>${esc(contract)}</td><td>${item.strike.toFixed(2)}</td><td>${esc(barrier)}</td><td>${signed(result.signedQuantity * pricing.premium, 2)}</td><td>${signed(result.signedQuantity * result.payoff, 2)}</td><td class="${result.pnl >= 0 ? "event-positive" : "event-negative"}">${signed(result.pnl, 2)}</td><td>${esc(stateText)}</td></tr>`;
  }).join("");
  const activeCount = state.legs.filter(item => item.enabled).length;
  byId("leg-totals").innerHTML = `<tr><th colspan="4">Strategy total</th><td>${metrics.netPremium.toFixed(2)}</td><td>${metrics.selected.payoff.toFixed(2)}</td><td>${signed(metrics.selected.pnl, 2)}</td><td>${activeCount} active leg${activeCount === 1 ? "" : "s"}</td></tr>`;
}

function renderBarrierStates(state: StrategyState, metrics: StrategyMetrics): void {
  const minimum = state.spot * 0.4, maximum = state.spot * 1.6;
  const position = (value: number) => Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100));
  const pathLow = Math.min(state.observedLow, state.terminal, state.spot), pathHigh = Math.max(state.observedHigh, state.terminal, state.spot);
  byId("barrier-states").innerHTML = state.legs.map((item, index) => {
    const result = metrics.selected.legs[index];
    if (!item.enabled) return `<article class="barrier-state inactive"><span>Leg ${index + 1}</span><strong>Inactive leg</strong><p>No contract or barrier event is evaluated.</p></article>`;
    if (item.barrierType === "none") return `<article class="barrier-state active"><span>Leg ${index + 1}</span><strong>Vanilla ${esc(item.type)}</strong><p>No barrier state. The option is active at expiry and depends only on strike and terminal spot.</p><div class="barrier-track"><i class="barrier-range" style="left:${position(pathLow)}%;width:${Math.max(1, position(pathHigh) - position(pathLow))}%"></i><i class="barrier-terminal" style="left:${position(state.terminal)}%"></i></div><div class="barrier-labels"><span>${minimum.toFixed(0)}</span><span>Path ${pathLow.toFixed(0)}–${pathHigh.toFixed(0)}</span><span>${maximum.toFixed(0)}</span></div></article>`;
    const probability = result.pricing!.hitProbability;
    return `<article class="barrier-state ${result.active ? "active" : "inactive"}"><span>Leg ${index + 1} · ${esc(item.barrierType)}</span><strong>${result.hit ? "Barrier touched" : "Barrier untouched"} · ${result.active ? "active" : "inactive"}</strong><p>Illustrative touch probability at inception: ${(probability * 100).toFixed(1)}%. Selected path range: ${pathLow.toFixed(0)}–${pathHigh.toFixed(0)}.</p><div class="barrier-track"><i class="barrier-range" style="left:${position(pathLow)}%;width:${Math.max(1, position(pathHigh) - position(pathLow))}%"></i><i class="barrier-marker" style="left:${position(item.barrier)}%"></i><i class="barrier-terminal" style="left:${position(state.terminal)}%"></i></div><div class="barrier-labels"><span>${minimum.toFixed(0)}</span><span>Barrier ${item.barrier.toFixed(0)}</span><span>${maximum.toFixed(0)}</span></div></article>`;
  }).join("");
  const barrierCount = state.legs.filter(item => item.enabled && item.barrierType !== "none").length;
  byId("barrier-note").textContent = barrierCount ? "The displayed premium and before-expiry risk scale vanilla value by an estimated touch or survival probability. That is intentionally transparent and fast, but it is not a barrier-option valuation formula." : "All active legs are vanilla, so the observed path range does not change their expiry payoff.";
}

function renderReferenceTables(state: StrategyState): void {
  byId("strategy-catalogue").innerHTML = catalogue.map(row => `<tr class="${state.presetId === row[0] ? "selected-row" : ""}"><td>${esc(row[1])}</td><td>${esc(row[2])}</td><td>${esc(row[3])}</td><td>${esc(row[4])}</td></tr>`).join("");
  byId("strategy-rules").innerHTML = rules.map(row => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`).join("");
}

export function render(state: StrategyState, metrics: StrategyMetrics, risk: RiskMeasures, scenarios: ScenarioRow[], handlers: ViewHandlers): void {
  renderPresets(state, handlers.onPreset);
  syncMarketControls(state);
  renderLegs(state, handlers.onLegChange);
  const title = renderSummary(state, metrics);
  drawChart(state, metrics, title);
  renderRisk(risk, scenarios);
  renderAnatomy(state, metrics);
  renderBarrierStates(state, metrics);
  renderReferenceTables(state);
}
