import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BLOG_DIR = "src/content/blog";

// 去掉围栏代码块与行内代码：这两处的 $ 不会被 remark-math 解析
function stripCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function readPosts(): { name: string; body: string }[] {
  return readdirSync(BLOG_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({ name, body: stripCode(readFileSync(join(BLOG_DIR, name), "utf8")) }));
}

describe("blog markdown math safety", () => {
  // 开启单美元行内公式后，正文里的美元金额会被两两配对成公式，渲染出乱码。
  // 金额必须写成 \$1,234，这条断言拦住的是自动发文流程里最容易漏掉的那一步。
  it("escapes currency amounts so they are not parsed as inline math", () => {
    const offenders = readPosts().flatMap(({ name, body }) => {
      const matches = body.match(/(?<!\\)\$\d/g) ?? [];
      return matches.length > 0 ? [`${name} (${matches.length} 处)`] : [];
    });

    expect(offenders).toEqual([]);
  });

  // 未配对的 $ 会把后面整段正文吞进公式里，直到遇到下一个 $
  it("keeps inline math delimiters balanced in every post", () => {
    const offenders = readPosts().flatMap(({ name, body }) => {
      const withoutDisplay = body.replace(/\$\$[\s\S]*?\$\$/g, "");
      const count = (withoutDisplay.match(/(?<!\\)\$/g) ?? []).length;
      return count % 2 === 0 ? [] : [`${name} (${count} 个未配对的 $)`];
    });

    expect(offenders).toEqual([]);
  });
});
