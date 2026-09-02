const search = document.getElementById("glossary-search") as HTMLInputElement | null;
const count = document.getElementById("glossary-count");
const entries = [...document.querySelectorAll<HTMLElement>(".glossary-entry")];

function filterGlossary(): void {
  if (!search || !count) return;
  const query = search.value.trim().toLocaleLowerCase();
  let visible = 0;
  entries.forEach((entry) => {
    const matches = !query || (entry.textContent ?? "").toLocaleLowerCase().includes(query);
    entry.hidden = !matches;
    if (matches) visible += 1;
  });
  count.textContent = `${visible} ${visible === 1 ? "term" : "terms"}`;
}

search?.addEventListener("input", filterGlossary);
filterGlossary();
