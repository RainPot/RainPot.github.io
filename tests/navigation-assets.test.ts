import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

describe("列表进入文章的关键样式", () => {
  it("文章 HTML 就绪后不再等待一份列表没有的关键样式", () => {
    const output = realpathSync(mkdtempSync(join(tmpdir(), "rainpot-nav-assets-")));
    try {
      // 构建真实页面到独立目录，检查浏览器实际收到的资源，而不是检查 import 文本。
      execFileSync(process.execPath, [resolve("node_modules/astro/bin/astro.mjs"), "build", "--outDir", output], {
        cwd: process.cwd(),
        env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", CI: "true", BASE_PATH: "/" },
        timeout: 45000,
        stdio: "pipe"
      });
      const list = new JSDOM(readFileSync(join(output, "blog/index.html"), "utf8")).window.document;
      const href = list.querySelector("a[data-filter-card]")!.getAttribute("href")!;
      const articlePath = decodeURIComponent(new URL(href, "https://rainpot.example").pathname).replace(/^\/+/, "");
      const article = new JSDOM(readFileSync(join(output, articlePath, "index.html"), "utf8")).window.document;
      const styles = (doc: Document) => [...doc.querySelectorAll('head link[rel="stylesheet"]')]
        .map(link => link.getAttribute("href"));
      const listStyles = new Set(styles(list));

      expect(styles(article).filter(href => !listStyles.has(href))).toEqual([]);
      expect(article.querySelector(".markdown-content")?.textContent?.trim().length).toBeGreaterThan(0);
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  }, 60000);
});
