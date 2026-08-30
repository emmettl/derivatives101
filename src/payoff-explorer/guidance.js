import { $ } from "./core";
import { activateTab, panelIds } from "./navigation.js";

/* ---------- guided teaching, deep links and sharing ---------- */
const TEACHING_MOVES = {
  blocks: {
    title: "Reveal the option trade",
    moves: [
      {
        name: "Turn income into downside",
        pick: ["#bk-type", "sp"],
        set: { "bk-k": 100, "bk-p": 10 },
        result:
          "The 10-point premium is the most the seller can earn. Below 90, every further point down in the share is a point of loss.",
      },
      {
        name: "Rebuild a reverse convertible",
        pick: ["#bk-type", "rc"],
        set: { "bk-k": 100, "bk-p": 10 },
        result:
          "Bond plus short put produces the familiar shape: capped income above the strike, equity-like loss below it.",
      },
    ],
  },
  acc: {
    title: "Expose the path dependency",
    moves: [
      {
        name: "See gearing take over",
        set: { "ac-k": 88, "ac-b": 103, "ac-g": 3, "ac-n": 180, "ac-v": 35 },
        result:
          "The position grows fastest precisely when the market is below the strike. The low purchase price is paired with an expanding obligation.",
      },
      {
        name: "Apply a volatility shock",
        set: { "ac-k": 88, "ac-b": 103, "ac-g": 2, "ac-n": 220, "ac-v": 65 },
        result:
          "Higher volatility creates more knock-outs, but it also fattens the severe-loss tail. A shorter average life is not the same thing as lower risk.",
      },
    ],
  },
  rc: {
    title: "Challenge the headline yield",
    moves: [
      {
        name: "Make the barrier daily",
        pick: ["#rc-obs", "am"],
        set: { "rc-b": 60, "rc-v": 30, "rc-c": 10 },
        result:
          "Nothing changed in the 60% headline barrier, but daily observation creates hundreds of chances to breach it.",
      },
      {
        name: "Stress volatility",
        pick: ["#rc-obs", "am"],
        set: { "rc-b": 60, "rc-v": 55, "rc-c": 10, "rc-t": 3 },
        result:
          "The coupon stays fixed while the loss probability and left tail move sharply. Yield is the compensation; volatility is the risk driver.",
      },
    ],
  },
  fcn: {
    title: "Break the diversification intuition",
    moves: [
      {
        name: "Build the diversification trap",
        set: { "fc-n": 5, "fc-r": 20, "fc-v": 40, "fc-c": 12 },
        result:
          "With five less-correlated names there are more independent ways to produce a bad worst performer—even though the basket sounds diversified.",
      },
      {
        name: "Compare one name",
        set: { "fc-n": 1, "fc-r": 90, "fc-v": 40, "fc-c": 12 },
        result:
          "A single name removes the worst-of selection effect. Compare the loss probability with the five-name setup at the same coupon.",
      },
    ],
  },
  disc: {
    title: "Separate certain from conditional",
    moves: [
      {
        name: "Show the certain cushion",
        pick: ["#dc-type", "plain"],
        set: { "dc-c": 95, "dc-p": 84, "dc-v": 25 },
        result:
          "The 16-point purchase discount is real and unconditional. In exchange, the investor gives up every point above the 95 cap.",
      },
      {
        name: "Make protection conditional",
        pick: ["#dc-type", "barrier"],
        set: { "dc-c": 100, "dc-p": 88, "dc-b": 65, "dc-v": 40 },
        result:
          "The barrier can create a much more attractive payoff—until it is breached. Then the large cushion disappears exactly in the bad markets.",
      },
    ],
  },
  bonus: {
    title: "Find the source of the bonus",
    moves: [
      {
        name: "Remove the dividend budget",
        set: { "bn-q": 0, "bn-l": 120, "bn-b": 70, "bn-t": 24 },
        result:
          "With no dividends to give up, there is no natural option budget. A generous bonus must then come from somewhere else: a tighter barrier, longer tenor or embedded cost.",
      },
      {
        name: "Change observation only",
        pick: ["#bn-obs", "eu"],
        set: { "bn-q": 3, "bn-l": 120, "bn-b": 70, "bn-v": 25 },
        result:
          "Maturity-only observation sharply reduces breach probability without changing the headline level. Barrier convention is an economic term, not fine print.",
      },
    ],
  },
  cpn: {
    title: "Rebuild the product budget",
    moves: [
      {
        name: "Return to zero rates",
        pick: ["#cp-cap", "no"],
        set: { "cp-r": 0, "cp-t": 5, "cp-pr": 100, "cp-f": 2 },
        result:
          "The bond floor consumes all 100 before fees, leaving a negative option budget. Full protection plus upside is not merely expensive here—it is unbuildable.",
      },
      {
        name: "Let rates fund the upside",
        pick: ["#cp-cap", "yes"],
        set: { "cp-r": 430, "cp-t": 5, "cp-pr": 100, "cp-f": 2, "cp-v": 18 },
        result:
          "Higher rates discount the floor, freeing budget for options. Capping the upside makes the option cheaper and lifts participation.",
      },
    ],
  },
  mini: {
    title: "Make leverage and carry visible",
    moves: [
      {
        name: "Hold a flat market",
        pick: ["#mf-dir", "long"],
        set: { "mf-f": 90, "mf-s": 33, "mf-r": 300, "mf-fs": 300, "mf-d": 360, "mf-v": 30 },
        result:
          "Spot stays at 100, but the financing level climbs toward it. The certificate loses value and the stop-loss gets closer without the market falling.",
      },
      {
        name: "Start with a thin buffer",
        pick: ["#mf-dir", "long"],
        set: { "mf-f": 95, "mf-s": 20, "mf-r": 300, "mf-fs": 300, "mf-d": 180, "mf-v": 40 },
        result:
          "A smaller upfront price creates more leverage, but leaves very little room to the stop-loss. The same volatility now produces far more total-loss outcomes.",
      },
    ],
  },
};

function applyTeachingMove(move, host) {
  if (move.pick) {
    const choice = document.querySelector(move.pick[0] + ' button[data-v="' + move.pick[1] + '"]');
    if (choice) choice.click();
  }
  Object.entries(move.set || {}).forEach(([id, value]) => {
    const input = $(id);
    if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  host.querySelector(".coach-result").textContent = move.result;
}

panelIds.forEach((id, index) => {
  const panel = $("p-" + id),
    config = TEACHING_MOVES[id];
  const coach = document.createElement("aside");
  coach.className = "coach";
  coach.setAttribute("aria-label", "Guided teaching moves");
  coach.innerHTML =
    '<div><p class="coach-kick">Try this</p><h2>' +
    config.title +
    '</h2></div><div class="coach-moves"></div><p class="coach-result" aria-live="polite"></p>';
  config.moves.forEach((move) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "coach-move";
    button.innerHTML = "<strong>" + move.name + "</strong>Apply this scenario";
    button.addEventListener("click", () => applyTeachingMove(move, coach));
    coach.querySelector(".coach-moves").appendChild(button);
  });
  panel.querySelector(".lede").insertAdjacentElement("afterend", coach);

  const trail = document.createElement("div");
  trail.className = "panel-nav";
  const previous = document.createElement("button"),
    next = document.createElement("button");
  previous.type = next.type = "button";
  previous.textContent = index === 0 ? "← Course home" : "← Previous structure";
  next.textContent = index === panelIds.length - 1 ? "Course home →" : "Next structure →";
  previous.onclick = () => (index === 0 ? location.assign("./") : activateTab(panelIds[index - 1]));
  next.onclick = () =>
    index === panelIds.length - 1 ? location.assign("./") : activateTab(panelIds[index + 1]);
  const count = document.createElement("span");
  count.className = "panel-count";
  count.textContent = index + 1 + " / " + panelIds.length;
  trail.append(previous, count, next);
  panel.appendChild(trail);
});

document
  .querySelectorAll('input[type="range"]')
  .forEach((input) => (input.dataset.default = input.value));
document.querySelectorAll(".seg").forEach((group) => {
  const active = group.querySelector("button.on");
  if (active) group.dataset.default = active.dataset.v;
});

function currentPanel() {
  return document.querySelector(".panel.on");
}
function setupUrl() {
  const url = new URL(location.href),
    panel = currentPanel();
  url.search = "";
  panel
    .querySelectorAll('input[type="range"]')
    .forEach((input) => url.searchParams.set(input.id, input.value));
  panel.querySelectorAll(".seg").forEach((group) => {
    const active = group.querySelector("button.on");
    if (group.id && active) url.searchParams.set("s_" + group.id, active.dataset.v);
  });
  url.hash = panel.id.replace("p-", "");
  return url.href;
}

async function copySetup() {
  const button = $("share-setup"),
    value = setupUrl();
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
  button.textContent = "Link copied";
  button.classList.add("copied");
  setTimeout(() => {
    button.textContent = "Copy setup link";
    button.classList.remove("copied");
  }, 1800);
}

function restoreSetup() {
  const params = new URLSearchParams(location.search),
    panel = currentPanel();
  panel.querySelectorAll(".seg").forEach((group) => {
    const value = params.get("s_" + group.id);
    const choice = value && group.querySelector('button[data-v="' + CSS.escape(value) + '"]');
    if (choice) choice.click();
  });
  panel.querySelectorAll('input[type="range"]').forEach((input) => {
    if (!params.has(input.id)) return;
    const value = Number(params.get(input.id));
    if (Number.isFinite(value) && value >= Number(input.min) && value <= Number(input.max)) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

$("share-setup").addEventListener("click", copySetup);
$("reset-setup").addEventListener("click", () => {
  const panel = currentPanel();
  panel.querySelectorAll(".seg").forEach((group) => {
    const choice = group.querySelector(
      'button[data-v="' + CSS.escape(group.dataset.default || "") + '"]',
    );
    if (choice) choice.click();
  });
  panel.querySelectorAll('input[type="range"]').forEach((input) => {
    input.value = input.dataset.default;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const result = panel.querySelector(".coach-result");
  if (result) result.textContent = "";
  history.replaceState(null, "", "#" + panel.id.replace("p-", ""));
});

window.addEventListener("hashchange", () => activateTab(location.hash.slice(1), false));
activateTab(location.hash.slice(1), false);
restoreSetup();
