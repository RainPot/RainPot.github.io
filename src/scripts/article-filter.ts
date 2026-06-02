export function normalizeFilterText(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesArticleQuery(text: string, query: string): boolean {
  const target = normalizeFilterText(text);
  const terms = normalizeFilterText(query).split(/\s+/).filter(Boolean);
  return terms.every((term) => target.includes(term));
}

export function initArticleFilter(root: ParentNode = document) {
  const input = root.querySelector<HTMLInputElement>("[data-article-filter]");
  const cards = [...root.querySelectorAll<HTMLElement>("[data-filter-card]")];
  const count = root.querySelector<HTMLElement>("[data-filter-count]");
  const empty = root.querySelector<HTMLElement>("[data-filter-empty]");

  if (!input || cards.length === 0) {
    return;
  }

  const update = () => {
    let visible = 0;

    for (const card of cards) {
      const matched = matchesArticleQuery(card.dataset.filterText ?? "", input.value);
      card.classList.toggle("is-filtered", !matched);
      card.setAttribute("aria-hidden", String(!matched));
      visible += matched ? 1 : 0;
    }

    if (count) count.textContent = `${visible}/${cards.length}`;
    if (empty) empty.hidden = visible > 0;
  };

  input.addEventListener("input", update);
  update();
}

if (typeof document !== "undefined") {
  initArticleFilter();
}
