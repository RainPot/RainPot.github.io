import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectNavigationStyles } from "../scripts/check-navigation-assets.mjs";

describe("列表进入文章的关键样式", () => {
  it("接受列表和文章已经共享的样式", () => {
    const output = createArtifacts('<link href="/_astro/shared.css" rel="stylesheet">');
    try {
      expect(inspectNavigationStyles(output)).toEqual({ checkedArticles: 1, extraStyles: [] });
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  it("找出会让文章跳转额外等待的样式", () => {
    const output = createArtifacts('<link rel="stylesheet" href="/_astro/shared.css"><link rel="stylesheet" href="/_astro/article.css">');
    try {
      expect(inspectNavigationStyles(output)).toEqual({
        checkedArticles: 1,
        extraStyles: [{ slug: "article", styles: ["/_astro/article.css"] }]
      });
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  it("同一篇文章出现多次时只检查一次", () => {
    const output = createArtifacts('<link rel="stylesheet" href="/_astro/shared.css">', true);
    try {
      expect(inspectNavigationStyles(output).checkedArticles).toBe(1);
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});

function createArtifacts(articleStyles: string, duplicate = false) {
  const output = mkdtempSync(join(tmpdir(), "rainpot-nav-assets-"));
  mkdirSync(join(output, "blog/article"), { recursive: true });
  const card = '<a data-filter-card data-filter-key="article" href="/blog/article/">文章</a>';
  writeFileSync(join(output, "blog/index.html"), `<html><head><link rel="stylesheet" href="/_astro/shared.css"></head><body>${card}${duplicate ? card : ""}</body></html>`);
  writeFileSync(join(output, "blog/article/index.html"), `<html><head>${articleStyles}</head><body>文章正文</body></html>`);
  return output;
}
