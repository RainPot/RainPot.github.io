import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;

beforeEach(() => vi.resetModules());
afterEach(() => {
  dom?.window.close();
  vi.unstubAllGlobals();
});

describe("按需加载文章全文搜索", () => {
  it("普通浏览和空搜索不下载全文", async () => {
    const fetchIndex = vi.fn();
    vi.stubGlobal("fetch", fetchIndex);
    const doc = await openArchive();

    search(doc, "");

    expect(fetchIndex).not.toHaveBeenCalled();
    expect(visibleTitles(doc)).toEqual(["Needle Agent", "其他笔记", "另一篇"]);
  });

  it("先给出标题匹配，全文下载后补充正文命中的文章", async () => {
    const response = deferred<Response>();
    const fetchIndex = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchIndex);
    const doc = await openArchive();

    search(doc, "needle");

    expect(fetchIndex).toHaveBeenCalledOnce();
    expect(visibleTitles(doc)).toEqual(["Needle Agent"]);
    expect(doc.querySelector("[data-filter-status]")?.textContent).toContain("搜索全文");

    response.resolve(Response.json({ first: "正文", second: "提到 needle 的正文", third: "其他内容" }));
    await vi.waitFor(() => expect(visibleTitles(doc)).toEqual(["Needle Agent", "其他笔记"]));
    expect(doc.querySelector<HTMLElement>("[data-filter-status]")?.hidden).toBe(true);
  });

  it("下载期间快速改词或清空时使用最新输入", async () => {
    const response = deferred<Response>();
    const fetchIndex = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchIndex);
    const doc = await openArchive();

    search(doc, "needle");
    search(doc, "later");
    expect(fetchIndex).toHaveBeenCalledOnce();
    response.resolve(Response.json({ first: "正文", second: "needle", third: "later" }));

    await vi.waitFor(() => expect(visibleTitles(doc)).toEqual(["另一篇"]));
    search(doc, "");
    expect(visibleTitles(doc)).toEqual(["Needle Agent", "其他笔记", "另一篇"]);
  });

  it("列表重新初始化时复用已经下载的全文", async () => {
    const fetchIndex = vi.fn(async () => Response.json({ first: "", second: "needle", third: "" }));
    vi.stubGlobal("fetch", fetchIndex);
    const doc = await openArchive();
    search(doc, "needle");
    await vi.waitFor(() => expect(visibleTitles(doc)).toHaveLength(2));

    doc.body.innerHTML = archiveHTML;
    doc.dispatchEvent(new dom.window.Event("astro:page-load"));
    search(doc, "needle");

    await vi.waitFor(() => expect(visibleTitles(doc)).toHaveLength(2));
    expect(fetchIndex).toHaveBeenCalledOnce();
  });

  it("清空后重新输入时恢复加载提示，并继续复用正在下载的全文", async () => {
    const response = deferred<Response>();
    const fetchIndex = vi.fn(() => response.promise);
    vi.stubGlobal("fetch", fetchIndex);
    const doc = await openArchive();
    search(doc, "needle");
    search(doc, "");
    expect(doc.querySelector<HTMLElement>("[data-filter-status]")?.hidden).toBe(true);

    search(doc, "later");
    expect(doc.querySelector<HTMLElement>("[data-filter-status]")?.hidden).toBe(false);
    expect(fetchIndex).toHaveBeenCalledOnce();
    response.resolve(Response.json({ first: "", second: "", third: "later" }));
    await vi.waitFor(() => expect(visibleTitles(doc)).toEqual(["另一篇"]));
  });

  it("全文加载失败后保留标题结果，并允许下一次搜索重试", async () => {
    const fetchIndex = vi.fn()
      .mockResolvedValueOnce(new Response("暂不可用", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ first: "", second: "needle", third: "" }));
    vi.stubGlobal("fetch", fetchIndex);
    const doc = await openArchive();
    search(doc, "needle");

    await vi.waitFor(() => expect(doc.querySelector("[data-filter-status]")?.textContent).toContain("全文搜索暂不可用"));
    expect(visibleTitles(doc)).toEqual(["Needle Agent"]);

    search(doc, "needle");
    await vi.waitFor(() => expect(visibleTitles(doc)).toHaveLength(2));
    expect(fetchIndex).toHaveBeenCalledTimes(2);
  });
});

const archiveHTML = `<main>
  <input data-article-filter data-search-index="/blog/search-index.json">
  <b data-filter-count></b><p data-filter-empty hidden></p><p data-filter-status hidden role="status"></p>
  <a data-filter-card data-filter-key="first" data-filter-title="Needle Agent">Needle Agent</a>
  <a data-filter-card data-filter-key="second" data-filter-title="其他笔记">其他笔记</a>
  <a data-filter-card data-filter-key="third" data-filter-title="另一篇">另一篇</a>
</main>`;

async function openArchive() {
  dom = new JSDOM(archiveHTML, { url: "https://rainpot.example/blog/" });
  vi.stubGlobal("document", dom.window.document);
  await import("../src/scripts/article-filter");
  dom.window.document.dispatchEvent(new dom.window.Event("astro:page-load"));
  return dom.window.document;
}

function search(doc: Document, value: string) {
  const input = doc.querySelector<HTMLInputElement>("[data-article-filter]")!;
  input.value = value;
  input.dispatchEvent(new dom.window.Event("input"));
}

function visibleTitles(doc: Document) {
  return [...doc.querySelectorAll("[data-filter-card]:not(.is-page-hidden):not(.is-filtered)")]
    .map(card => card.textContent);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
