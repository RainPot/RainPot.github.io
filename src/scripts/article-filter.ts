// 搜索框按字段分别打分：标题 > 标签/slug > 摘要 > 正文。
// 只做过滤会让「标题正好叫这个」的文章淹没在几十篇正文提过一嘴的文章里，
// 所以命中之后还要按相关度重排，同分时保持原有的时间倒序。
export type ArticleFilterFields = {
  title: string;
  meta: string;
  summary: string;
  body: string;
};

const FIELD_SCORES = { title: 120, meta: 50, summary: 20, body: 5 } as const;
const TITLE_PREFIX_BONUS = 40;
const TITLE_PHRASE_BONUS = 80;
const META_PHRASE_BONUS = 30;
// 正文重复出现说明这篇确实在讲它，但加成要压在摘要命中之下
const BODY_REPEAT_BONUS_CAP = 10;

export function normalizeFilterText(value: string): string {
  return value.trim().toLowerCase();
}

export function splitFilterTerms(query: string): string[] {
  return normalizeFilterText(query).split(/\s+/).filter(Boolean);
}

export function matchesArticleQuery(text: string, query: string): boolean {
  const target = normalizeFilterText(text);
  return splitFilterTerms(query).every((term) => target.includes(term));
}

export function scoreArticleFields(fields: Partial<ArticleFilterFields>, query: string): number {
  const terms = splitFilterTerms(query);
  if (terms.length === 0) return 0;

  const title = normalizeFilterText(fields.title ?? "");
  const meta = normalizeFilterText(fields.meta ?? "");
  const summary = normalizeFilterText(fields.summary ?? "");
  const body = normalizeFilterText(fields.body ?? "");
  let score = 0;

  for (const term of terms) {
    const titleIndex = title.indexOf(term);
    const inMeta = meta.includes(term);
    const inSummary = summary.includes(term);
    const bodyHits = countOccurrences(body, term, BODY_REPEAT_BONUS_CAP + 1);

    // 每个词都得在某个字段里出现，保持 grep 的 AND 语义
    if (titleIndex < 0 && !inMeta && !inSummary && bodyHits === 0) return 0;

    if (titleIndex >= 0) score += FIELD_SCORES.title + (titleIndex === 0 ? TITLE_PREFIX_BONUS : 0);
    if (inMeta) score += FIELD_SCORES.meta;
    if (inSummary) score += FIELD_SCORES.summary;
    if (bodyHits > 0) score += FIELD_SCORES.body + Math.min(bodyHits - 1, BODY_REPEAT_BONUS_CAP);
  }

  // 多个词连着出现在标题里，基本可以断定用户就是在找这一篇
  if (terms.length > 1) {
    const phrase = normalizeFilterText(query);
    if (title.includes(phrase)) score += TITLE_PHRASE_BONUS;
    if (meta.includes(phrase)) score += META_PHRASE_BONUS;
  }

  return score;
}

export function rankArticleFields(entries: readonly Partial<ArticleFilterFields>[], query: string): number[] {
  return entries
    .map((fields, index) => ({ index, score: scoreArticleFields(fields, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.index);
}

export function getArticleFilterPage(
  entries: readonly Partial<ArticleFilterFields>[],
  query: string,
  page: number,
  pageSize: number
) {
  const matchedIndexes = rankArticleFields(entries, query);
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

function countOccurrences(text: string, term: string, limit: number): number {
  if (!term) return 0;

  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0 && count < limit) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function readCardFields(card: HTMLElement): ArticleFilterFields {
  const data = card.dataset;

  // 老结构只有一个 data-filter-text，退化成整段正文匹配，至少不丢结果
  if (data.filterTitle === undefined && data.filterText !== undefined) {
    return { title: "", meta: "", summary: "", body: data.filterText };
  }

  return {
    title: data.filterTitle ?? "",
    meta: data.filterMeta ?? "",
    summary: data.filterSummary ?? "",
    body: data.filterBody ?? ""
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

  const entries = cards.map(readCardFields);
  const pageSize = Math.max(1, Number(pagination?.dataset.pageSize) || cards.length);
  // The page number rendered by the server, derived from the URL (e.g. /blog/page/2/).
  const serverPage = Math.max(1, Number(pagination?.dataset.currentPage) || 1);
  // Snapshot the server-rendered pagination (real <a> links). Restoring it keeps each
  // page on its own URL so the browser back button returns to the correct page.
  const serverPaginationHTML = pagination ? pagination.innerHTML : "";
  let currentPage = serverPage;

  const showServerPage = () => {
    const start = (serverPage - 1) * pageSize;

    cards.forEach((card, index) => {
      const visible = index >= start && index < start + pageSize;
      card.classList.toggle("is-filtered", false);
      card.classList.toggle("is-page-hidden", !visible);
      card.setAttribute("aria-hidden", String(!visible));
      // 交还给文档流顺序，也就是原本的时间倒序
      card.style.order = "";
    });

    if (count) count.textContent = `${cards.length}/${cards.length}`;
    if (empty) empty.hidden = true;
    if (pagination) {
      pagination.hidden = false;
      pagination.innerHTML = serverPaginationHTML;
    }
  };

  const update = (resetPage = false) => {
    // Without an active query, defer to the server's URL-based pagination so that
    // opening an article and navigating back restores the same page.
    if (normalizeFilterText(input.value) === "") {
      currentPage = serverPage;
      showServerPage();
      return;
    }

    if (resetPage) currentPage = 1;

    const state = getArticleFilterPage(entries, input.value, currentPage, pageSize);
    const ranks = new Map(state.matchedIndexes.map((cardIndex, rank) => [cardIndex, rank]));
    const pageIndexes = new Set(state.pageIndexes);
    currentPage = state.currentPage;

    cards.forEach((card, index) => {
      const rank = ranks.get(index);
      const visible = pageIndexes.has(index);
      card.classList.toggle("is-filtered", rank === undefined);
      card.classList.toggle("is-page-hidden", rank !== undefined && !visible);
      card.setAttribute("aria-hidden", String(!visible));
      // grid item 的 order 决定视觉顺序，相关度高的排在前面
      card.style.order = rank === undefined ? "" : String(rank);
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
