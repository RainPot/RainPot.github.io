export function normalizeFilterText(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesArticleQuery(text: string, query: string): boolean {
  const target = normalizeFilterText(text);
  const terms = normalizeFilterText(query).split(/\s+/).filter(Boolean);
  return terms.every((term) => target.includes(term));
}

export function getArticleFilterPage(texts: readonly string[], query: string, page: number, pageSize: number) {
  const matchedIndexes = texts
    .map((text, index) => ({ index, matched: matchesArticleQuery(text, query) }))
    .filter((item) => item.matched)
    .map((item) => item.index);
  const totalPages = Math.max(1, Math.ceil(matchedIndexes.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    currentPage,
    matchedIndexes,
    pageIndexes: matchedIndexes.slice(start, start + pageSize),
    totalPages
  };
}

export function initArticleFilter(root: ParentNode = document) {
  const input = root.querySelector<HTMLInputElement>("[data-article-filter]");
  const cards = [...root.querySelectorAll<HTMLElement>("[data-filter-card]")];
  const count = root.querySelector<HTMLElement>("[data-filter-count]");
  const empty = root.querySelector<HTMLElement>("[data-filter-empty]");
  const pagination = root.querySelector<HTMLElement>("[data-filter-pagination]");

  if (!input || cards.length === 0) {
    return;
  }

  const texts = cards.map((card) => card.dataset.filterText ?? "");
  const pageSize = Math.max(1, Number(pagination?.dataset.pageSize) || cards.length);
  let currentPage = Math.max(1, Number(pagination?.dataset.currentPage) || 1);

  const update = (resetPage = false) => {
    if (resetPage) currentPage = 1;

    const state = getArticleFilterPage(texts, input.value, currentPage, pageSize);
    const matchedIndexes = new Set(state.matchedIndexes);
    const pageIndexes = new Set(state.pageIndexes);
    currentPage = state.currentPage;

    cards.forEach((card, index) => {
      const matched = matchedIndexes.has(index);
      const visible = pageIndexes.has(index);
      card.classList.toggle("is-filtered", !matched);
      card.classList.toggle("is-page-hidden", matched && !visible);
      card.setAttribute("aria-hidden", String(!visible));
    });

    if (count) count.textContent = `${state.matchedIndexes.length}/${cards.length}`;
    if (empty) empty.hidden = state.matchedIndexes.length > 0;
    renderPagination(state.totalPages);
  };

  const renderPagination = (totalPages: number) => {
    if (!pagination) return;

    pagination.hidden = totalPages <= 1;
    if (totalPages <= 1) {
      pagination.innerHTML = "";
      return;
    }

    pagination.innerHTML = [
      currentPage > 1 ? `<button class="button ghost" type="button" data-filter-page="${currentPage - 1}">上一页</button>` : "",
      `<span>第 ${currentPage} / ${totalPages} 页</span>`,
      currentPage < totalPages ? `<button class="button ghost" type="button" data-filter-page="${currentPage + 1}">下一页</button>` : ""
    ].join("");

    pagination.querySelectorAll<HTMLButtonElement>("[data-filter-page]").forEach((button) => {
      button.addEventListener("click", () => {
        currentPage = Number(button.dataset.filterPage) || 1;
        update();
      });
    });
  };

  input.addEventListener("input", () => update(true));
  update();
}

if (typeof document !== "undefined") {
  initArticleFilter();
}
