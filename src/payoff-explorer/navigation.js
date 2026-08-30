/* ---------- tabs ---------- */
const tabButtons = [...document.querySelectorAll("#tabs button")];
export const panelIds = tabButtons.map((b) => b.dataset.t);
export function activateTab(id, updateUrl = true) {
  const selected = tabButtons.find((b) => b.dataset.t === id) || tabButtons[0];
  tabButtons.forEach((b) => {
    const on = b === selected;
    b.classList.toggle("on", on);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(on));
    b.setAttribute("tabindex", on ? "0" : "-1");
  });
  document.querySelectorAll(".panel").forEach((p) => {
    const on = p.id === "p-" + selected.dataset.t;
    p.classList.toggle("on", on);
    p.setAttribute("role", "tabpanel");
    p.hidden = !on;
  });
  const position = panelIds.indexOf(selected.dataset.t) + 1;
  const label = selected.textContent.replace(/^\d+\s·\s/, "");
  const status = document.getElementById("utility-status");
  if (status)
    status.textContent = "Structure " + position + " of " + panelIds.length + " · " + label;
  if (updateUrl) history.replaceState(null, "", "#" + selected.dataset.t);
  selected.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}
tabButtons.forEach((b) => (b.onclick = () => activateTab(b.dataset.t)));
document.getElementById("tabs").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const current = panelIds.indexOf(
    (tabButtons.find((b) => b.classList.contains("on")) || tabButtons[0]).dataset.t,
  );
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? panelIds.length - 1
        : (current + (e.key === "ArrowRight" ? 1 : -1) + panelIds.length) % panelIds.length;
  activateTab(panelIds[next]);
  tabButtons[next].focus();
});
