import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ids = ["busuanzi_site_pv", "busuanzi_site_uv", "busuanzi_page_pv", "busuanzi_page_uv"];
const counts = { site_pv: 120, site_uv: 42, page_pv: 8, page_uv: 3 };

function response(data = counts, identity?: string) {
  return new Response(JSON.stringify({ success: true, message: "ok", data }), {
    headers: identity ? { "Set-Bsz-Identity": identity } : {}
  });
}

describe("访问统计加载", () => {
  let elements: Map<string, { textContent: string; title: string }>;
  let page: EventTarget;
  let storage: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let loadVisitorStats: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    elements = new Map(ids.map((id) => [id, { textContent: "加载中...", title: "" }]));
    page = Object.assign(new EventTarget(), {
      getElementById: (id: string) => elements.get(id) ?? null
    });
    storage = new Map();
    fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("document", page);
    vi.stubGlobal("location", new URL("https://rainpot.github.io/blog/first/"));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    });
    vi.stubGlobal("fetch", fetchMock);
    ({ loadVisitorStats } = await import("../src/scripts/visitor-stats"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const texts = () => ids.map((id) => elements.get(id)?.textContent);

  it("从新服务读取全站和文章的真实计数，并沿用访客身份", async () => {
    storage.set("bsz-id", "existing-identity");
    fetchMock.mockResolvedValue(response(counts, "updated-identity"));

    await loadVisitorStats();

    expect(texts()).toEqual(["120", "42", "8", "3"]);
    expect(fetchMock).toHaveBeenCalledWith("https://bsz.iirose.cn/api", expect.objectContaining({
      method: "POST",
      headers: {
        "x-bsz-referer": "https://rainpot.github.io/blog/first/",
        Authorization: "Bearer existing-identity"
      }
    }));
    expect(storage.get("bsz-id")).toBe("updated-identity");
  });

  it("将零次访问作为有效计数显示", async () => {
    fetchMock.mockResolvedValue(response({ site_pv: 0, site_uv: 0, page_pv: 0, page_uv: 0 }));
    await loadVisitorStats();
    expect(texts()).toEqual(["0", "0", "0", "0"]);
  });

  it.each([
    ["HTTP 524 空响应", () => new Response("", { status: 524 })],
    ["无效 JSON", () => new Response("<html>Bad Gateway</html>")],
    ["服务拒绝统计", () => new Response(JSON.stringify({ success: false, data: counts }))],
    ["缺失计数", () => new Response(JSON.stringify({ success: true, data: {} }))],
    ["无效计数", () => new Response(JSON.stringify({
      success: true, data: { site_pv: -1, site_uv: null, page_pv: "<b>8</b>", page_uv: 1.5 }
    }))]
  ])("%s 时结束加载并显示暂不可用", async (_name, makeResponse) => {
    fetchMock.mockResolvedValue(makeResponse());
    await loadVisitorStats();
    expect(texts()).toEqual(["暂不可用", "暂不可用", "暂不可用", "暂不可用"]);
  });

  it("网络失败时不伪造计数，也不自动重试产生额外浏览量", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await loadVisitorStats();
    expect(texts()).toEqual(["暂不可用", "暂不可用", "暂不可用", "暂不可用"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("请求超时后取消连接并结束加载", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const pending = loadVisitorStats();
    await vi.advanceTimersByTimeAsync(8000);
    await pending;
    expect(texts()).toEqual(["暂不可用", "暂不可用", "暂不可用", "暂不可用"]);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("首次加载和每次 Astro 站内导航都更新当前页面计数", async () => {
    page.dispatchEvent(new Event("astro:page-load"));
    await vi.waitFor(() => expect(texts()).toEqual(["120", "42", "8", "3"]));

    vi.stubGlobal("location", new URL("https://rainpot.github.io/blog/second/"));
    elements = new Map(ids.map((id) => [id, { textContent: "加载中...", title: "" }]));
    fetchMock.mockResolvedValue(response({ site_pv: 121, site_uv: 42, page_pv: 2, page_uv: 1 }));
    page.dispatchEvent(new Event("astro:page-load"));

    await vi.waitFor(() => expect(texts()).toEqual(["121", "42", "2", "1"]));
    expect(fetchMock.mock.calls[1][1].headers["x-bsz-referer"])
      .toBe("https://rainpot.github.io/blog/second/");
  });

  it("旧页面的迟到响应不会覆盖新页面或访客身份", async () => {
    let finishFirst!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishFirst = resolve; }));
    const first = loadVisitorStats();
    fetchMock.mockResolvedValue(response({ site_pv: 121, site_uv: 42, page_pv: 2, page_uv: 1 }, "new-identity"));

    await loadVisitorStats();
    finishFirst(response(counts, "old-identity"));
    await first;

    expect(texts()).toEqual(["121", "42", "2", "1"]);
    expect(storage.get("bsz-id")).toBe("new-identity");
  });

  it("页面替换前取消请求，迟到响应不更新已离开的页面", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const pending = loadVisitorStats();
    page.dispatchEvent(new Event("astro:before-swap"));
    finish(response());
    await pending;

    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(texts()).toEqual(["加载中...", "加载中...", "加载中...", "加载中..."]);
  });

  it("浏览器禁止本地存储时仍然显示服务返回的计数", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new DOMException("Denied", "SecurityError"); },
      setItem: () => { throw new DOMException("Denied", "SecurityError"); }
    });
    fetchMock.mockResolvedValue(response(counts, "identity"));
    await loadVisitorStats();
    expect(texts()).toEqual(["120", "42", "8", "3"]);
  });
});
