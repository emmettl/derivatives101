import { activateTab, panelIds } from "./navigation.js";
import { restoreSetup } from "./guidance.js";

const panelModules = {
  blocks: () => import("./panels/building-blocks.js"),
  acc: () => import("./panels/accumulator.js"),
  rc: () => import("./panels/reverse-convertible.js"),
  fcn: () => import("./panels/worst-of-fcn.js"),
  disc: () => import("./panels/discount-certificate.js"),
  bonus: () => import("./panels/bonus-certificate.js"),
  cpn: () => import("./panels/capital-protected.js"),
  mini: () => import("./panels/mini-future.js"),
};

const loadedPanels = new Set();
const loadingPanels = new Map();

async function loadPanel(id) {
  if (loadedPanels.has(id)) return;
  if (loadingPanels.has(id)) return loadingPanels.get(id);

  const panel = document.getElementById("p-" + id);
  panel?.setAttribute("aria-busy", "true");
  const loading = panelModules[id]()
    .then(() => {
      loadedPanels.add(id);
      panel?.removeAttribute("aria-busy");
      panel?.setAttribute("data-model-ready", "true");
    })
    .finally(() => loadingPanels.delete(id));
  loadingPanels.set(id, loading);
  return loading;
}

const requestedPanel = location.hash.slice(1);
const initialPanel = panelIds.includes(requestedPanel) ? requestedPanel : panelIds[0];
activateTab(initialPanel, false);
document.documentElement.setAttribute("data-payoff-shell-ready", "true");

window.addEventListener("payoff-explorer:activate", (event) => {
  void loadPanel(event.detail.id);
});

// Give the browser a paint before loading the active model. Previously every
// product ran its simulation during module evaluation, delaying even the page heading.
requestAnimationFrame(() =>
  requestAnimationFrame(() => void loadPanel(initialPanel).then(restoreSetup)),
);
