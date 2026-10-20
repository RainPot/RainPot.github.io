const metrics = ["site_pv", "site_uv", "page_pv", "page_uv"] as const;
const apiUrl = "https://bsz.iirose.cn/api";
let activeRequest: AbortController | null = null;

export async function loadVisitorStats(): Promise<void> {
  activeRequest?.abort();

  const targets = metrics.flatMap((metric) => {
    const element = document.getElementById(`busuanzi_${metric}`);
    return element ? [{ metric, element }] : [];
  });
  if (targets.length === 0) {
    activeRequest = null;
    return;
  }

  const controller = new AbortController();
  activeRequest = controller;
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  for (const { element } of targets) {
    element.textContent = "加载中...";
    element.title = "";
  }

  try {
    const headers: Record<string, string> = { "x-bsz-referer": location.href };
    try {
      const identity = localStorage.getItem("bsz-id");
      if (identity) headers.Authorization = `Bearer ${identity}`;
    } catch {
      // 隐私模式可能禁用存储，此时仍允许服务按 IP 和浏览器识别访客。
    }

    const response = await fetch(apiUrl, { method: "POST", headers, signal: controller.signal });
    if (!response.ok) throw new Error(`统计服务返回 HTTP ${response.status}`);

    const result: { success?: boolean; data?: Record<string, unknown> } | null = await response.json();
    if (activeRequest !== controller || controller.signal.aborted) return;
    if (result?.success !== true || !result.data) throw new Error("统计服务未返回数据");

    const data = result.data;
    if (metrics.some((metric) => typeof data[metric] !== "number" ||
      !Number.isSafeInteger(data[metric]) || (data[metric] as number) < 0)) {
      throw new Error("统计服务返回无效计数");
    }

    for (const { metric, element } of targets) {
      element.textContent = String(data[metric]);
    }

    try {
      const identity = response.headers.get("Set-Bsz-Identity");
      if (identity) localStorage.setItem("bsz-id", identity);
    } catch {
      // 存储不可用不能影响已经获取到的统计展示。
    }
  } catch {
    if (activeRequest !== controller) return;
    for (const { element } of targets) {
      element.textContent = "暂不可用";
      element.title = "统计暂时无法加载，请稍后刷新";
    }
  } finally {
    clearTimeout(timeoutId);
    if (activeRequest === controller) activeRequest = null;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("astro:before-swap", () => {
    // SPA 切页后旧请求不能覆盖新页面，也不能写回过期的访客身份。
    activeRequest?.abort();
    activeRequest = null;
  });
  document.addEventListener("astro:page-load", () => { void loadVisitorStats(); });
}
