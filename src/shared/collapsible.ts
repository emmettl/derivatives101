/**
 * Mobile-only collapsible sections.
 *
 * Any element carrying `data-collapsible` becomes collapsible while the page uses its
 * stacked (narrow) layout. The attribute value picks the initial narrow-layout state:
 * "collapsed" starts closed, anything else starts open. Inside the section, children marked
 * `data-collapsible-keep` (the head, plus anything that must stay reachable) remain visible
 * while everything else is hidden by `collapsible.css`; a `.section-toggle` button flips
 * the state and a `.section-summary` element is shown only while the section is closed.
 *
 * Wide layouts always expand every section and hide the toggles, so desktop pages are
 * unaffected.
 */
export function initCollapsibleSections(stackedQuery: string): void {
  const stacked = window.matchMedia(stackedQuery);
  const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-collapsible]"));

  const setCollapsed = (section: HTMLElement, collapsed: boolean, notify: boolean): void => {
    section.classList.toggle("is-collapsed", collapsed);
    const toggle = section.querySelector<HTMLButtonElement>(".section-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(!collapsed));
      const label = collapsed ? toggle.dataset.showLabel : toggle.dataset.hideLabel;
      if (label) toggle.textContent = label;
    }
    if (notify)
      section.dispatchEvent(
        new CustomEvent("collapsible-toggle", { bubbles: true, detail: { collapsed } }),
      );
  };

  const applyLayout = (): void => {
    sections.forEach((section) => {
      section.classList.toggle("is-collapsible", stacked.matches);
      setCollapsed(section, stacked.matches && section.dataset.collapsible === "collapsed", false);
    });
  };

  sections.forEach((section) => {
    section
      .querySelector<HTMLButtonElement>(".section-toggle")
      ?.addEventListener("click", () =>
        setCollapsed(section, !section.classList.contains("is-collapsed"), true),
      );
  });
  applyLayout();
  stacked.addEventListener("change", applyLayout);
}
