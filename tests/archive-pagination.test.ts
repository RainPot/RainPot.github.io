import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;

beforeEach(() => vi.resetModules());
afterEach(() => {
  dom?.window.close();
  vi.unstubAllGlobals();
});

describe("文章列表翻页", () => {
  it("离线时复用已有文章翻到下一页，并保留页面外壳", async () => {
    const doc = await openArchive();
    const background = doc.querySelector("canvas");
    const cursor = doc.querySelector("#cursor-container");
    const navigation = prepare(doc, "/blog/page/2/");

    await navigation.loader();

    // 准备阶段不能提前改变当前页，避免被取消的导航留下错误页码。
    expect(visibleTitles(doc)).toEqual(["Agent one", "Agent two"]);
    swap(doc, navigation);

    expect(visibleTitles(doc)).toEqual(["Agent three", "Agent four"]);
    expect(doc.title).toBe("文章列表 第 2 页 - RainPot");
    expect(doc.querySelector("[data-filter-pagination]")?.textContent).toContain("第 2 / 3 页");
    expect(pageLinks(doc)).toEqual(["/blog/", "/blog/page/3/"]);
    expect(doc.querySelector("canvas")).toBe(background);
    expect(doc.querySelector("#cursor-container")).toBe(cursor);
  });

  it("从深页直接进入后支持后退到第一页及前进到末页", async () => {
    const doc = await openArchive(3);

    for (const [target, titles] of [
      ["/blog/page/2/", ["Agent three", "Agent four"]],
      ["/blog/", ["Agent one", "Agent two"]],
      ["/blog/page/3/", ["Agent five"]]
    ] as const) {
      const navigation = prepare(doc, target, "traverse");
      await navigation.loader();
      swap(doc, navigation);
      expect(visibleTitles(doc)).toEqual(titles);
    }

    expect(pageLinks(doc)).toEqual(["/blog/page/2/"]);
  });

  it("本地翻页后仍可搜索翻页，清空搜索恢复当前地址对应的页", async () => {
    const doc = await openArchive();
    const navigation = prepare(doc, "/blog/page/2/");
    await navigation.loader();
    swap(doc, navigation);
    const input = doc.querySelector<HTMLInputElement>("[data-article-filter]")!;

    input.value = "agent";
    input.dispatchEvent(new dom.window.Event("input"));
    expect(visibleTitles(doc)).toEqual(["Agent one", "Agent two"]);
    doc.querySelector<HTMLButtonElement>('[data-filter-page="2"]')!.click();
    expect(visibleTitles(doc)).toEqual(["Agent three", "Agent four"]);

    input.value = "";
    input.dispatchEvent(new dom.window.Event("input"));
    expect(visibleTitles(doc)).toEqual(["Agent three", "Agent four"]);
    expect(pageLinks(doc)).toEqual(["/blog/", "/blog/page/3/"]);
  });

  it("兼容部署在子路径下的列表链接", async () => {
    const doc = await openArchive(1, "/notes/blog/");
    const navigation = prepare(doc, "/notes/blog/page/2/");
    await navigation.loader();
    swap(doc, navigation);

    expect(visibleTitles(doc)).toEqual(["Agent three", "Agent four"]);
    expect(pageLinks(doc)).toEqual(["/notes/blog/", "/notes/blog/page/3/"]);
  });

  it.each([
    "/blog/agent-one/",
    "/blog/page/0/",
    "/blog/page/4/",
    "https://other.example/blog/page/2/"
  ])("其他页面及无效页码继续使用原有导航：%s", async (target) => {
    const doc = await openArchive();
    const navigation = prepare(doc, target);

    await expect(navigation.loader()).rejects.toThrow("离线，无法下载下一页 HTML");
    expect(visibleTitles(doc)).toEqual(["Agent one", "Agent two"]);
  });
});

async function openArchive(page = 1, base = "/blog/") {
  const title = page === 1 ? "文章列表 - RainPot" : `文章列表 第 ${page} 页 - RainPot`;
  dom = new JSDOM(`<!doctype html><html><head><title>${title}</title></head><body>
    <div id="cursor-container"></div><canvas></canvas><header>RainPot</header>
    <main id="main-content">
      <input type="search" data-article-filter>
      <b data-filter-count></b><p data-filter-empty hidden></p>
      <section>${["one", "two", "three", "four", "five"].map((name) =>
        `<a data-filter-card data-filter-title="Agent ${name}">Agent ${name}</a>`
      ).join("")}</section>
      <nav data-filter-pagination data-archive-base="${base}" data-page-size="2" data-current-page="${page}">
        ${page > 1 ? `<a href="${page === 2 ? base : `${base}page/${page - 1}/`}" data-astro-prefetch="false">上一页</a>` : ""}
        <span>第 ${page} / 3 页</span>
        ${page < 3 ? `<a href="${base}page/${page + 1}/" data-astro-prefetch="false">下一页</a>` : ""}
      </nav>
    </main><footer>页脚</footer>
  </body></html>`, { url: `https://rainpot.example${base}${page === 1 ? "" : `page/${page}/`}` });
  const doc = dom.window.document;
  vi.stubGlobal("document", doc);
  await import("../src/scripts/article-filter");
  doc.dispatchEvent(new dom.window.Event("astro:page-load"));
  return doc;
}

function prepare(doc: Document, target: string, navigationType = "push") {
  const navigation = Object.assign(new dom.window.Event("astro:before-preparation", { cancelable: true }), {
    from: new URL(doc.URL),
    to: new URL(target, doc.URL),
    navigationType,
    signal: new AbortController().signal,
    newDocument: doc,
    loader: async () => { throw new Error("离线，无法下载下一页 HTML"); }
  });
  doc.dispatchEvent(navigation);
  return navigation;
}

function swap(doc: Document, navigation: ReturnType<typeof prepare>) {
  const event = Object.assign(new dom.window.Event("astro:before-swap"), {
    newDocument: navigation.newDocument,
    swap: () => { throw new Error("本地翻页不能替换整份文档"); }
  });
  doc.dispatchEvent(event);
  event.swap();
  dom.reconfigure({ url: navigation.to.href });
  doc.dispatchEvent(new dom.window.Event("astro:page-load"));
}

function visibleTitles(doc: Document) {
  return [...doc.querySelectorAll("[data-filter-card]:not(.is-page-hidden):not(.is-filtered)")]
    .map((card) => card.textContent);
}

function pageLinks(doc: Document) {
  return [...doc.querySelectorAll("[data-filter-pagination] a")].map((link) => link.getAttribute("href"));
}
