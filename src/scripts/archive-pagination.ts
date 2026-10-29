import type { TransitionBeforePreparationEvent, TransitionBeforeSwapEvent } from "astro:transitions/client";

function getArchivePage(target: URL, base: URL): number | null {
  if (target.origin !== base.origin) return null;
  if (target.pathname === base.pathname) return 1;
  if (!target.pathname.startsWith(base.pathname)) return null;
  const match = /^page\/([1-9]\d*)\/$/.exec(target.pathname.slice(base.pathname.length));
  return match ? Number(match[1]) : null;
}

if (typeof document !== "undefined") {
  const localPages = new WeakSet<Document>();

  document.addEventListener("astro:before-preparation", (rawEvent) => {
    const event = rawEvent as TransitionBeforePreparationEvent;
    const main = document.querySelector("main");
    const pagination = main?.querySelector<HTMLElement>("[data-filter-pagination]");
    if (!main || !pagination?.dataset.archiveBase || event.formData) return;

    const base = new URL(pagination.dataset.archiveBase, event.from);
    const page = getArchivePage(event.to, base);
    const pageSize = Number(pagination.dataset.pageSize);
    const totalPages = Math.ceil(main.querySelectorAll("[data-filter-card]").length / pageSize);
    if (page === null || page > totalPages || event.to.search !== event.from.search) return;

    // 每页已经携带完整搜索数据，列表内翻页只换正文，避免再次下载数 MB HTML。
    // 仍由 ClientRouter 处理历史记录、滚动和导航取消，保持文章返回列表的行为一致。
    event.loader = async () => {
      const title = page === 1 ? "文章列表 - RainPot" : `文章列表 第 ${page} 页 - RainPot`;
      const nextDocument = document.implementation.createHTMLDocument(title);
      const nextMain = main.cloneNode(true) as HTMLElement;
      const nextPagination = nextMain.querySelector<HTMLElement>("[data-filter-pagination]")!;
      nextPagination.dataset.currentPage = String(page);
      nextPagination.hidden = false;
      nextPagination.replaceChildren();

      const addLink = (label: string, targetPage: number) => {
        const link = nextDocument.createElement("a");
        link.className = "button ghost";
        link.dataset.astroPrefetch = "false";
        link.href = targetPage === 1 ? base.pathname : `${base.pathname}page/${targetPage}/`;
        link.textContent = label;
        nextPagination.append(link);
      };

      if (page > 1) addLink("上一页", page - 1);
      const status = nextDocument.createElement("span");
      status.textContent = `第 ${page} / ${totalPages} 页`;
      nextPagination.append(status);
      if (page < totalPages) addLink("下一页", page + 1);

      // 搜索有独立的结果页；返回普通列表时按目标 URL 恢复页码。
      const input = nextMain.querySelector<HTMLInputElement>("[data-article-filter]");
      if (input) input.value = "";
      nextDocument.body.append(nextMain);
      localPages.add(nextDocument);
      event.newDocument = nextDocument;
    };
  });

  document.addEventListener("astro:before-swap", (rawEvent) => {
    const event = rawEvent as TransitionBeforeSwapEvent;
    if (!localPages.delete(event.newDocument)) return;

    event.swap = () => {
      document.querySelector("main")!.replaceWith(event.newDocument.querySelector("main")!);
      document.title = event.newDocument.title;
      // 常规导航会随旧 body 移除播报节点，本地翻页也只保留本次播报。
      document.querySelectorAll(".astro-route-announcer").forEach((node) => node.remove());
    };
  });
}
