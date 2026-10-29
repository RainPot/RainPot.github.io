import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

function readStyles(html) {
  // 只解析文章 head，正文再长也不会增加资源检查的开销。
  const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0] ?? html;
  const dom = new JSDOM(head);
  const styles = [...dom.window.document.querySelectorAll('link[rel="stylesheet"]')]
    .map(link => link.getAttribute("href"));
  dom.window.close();
  return styles;
}

export function inspectNavigationStyles(outputDir) {
  const listHTML = readFileSync(join(outputDir, "blog/index.html"), "utf8");
  const listStyles = new Set(readStyles(listHTML));
  const dom = new JSDOM(listHTML);
  const slugs = [...new Set([...dom.window.document.querySelectorAll("[data-filter-card][data-filter-key]")]
    .map(card => card.getAttribute("data-filter-key")))];
  dom.window.close();
  const extraStyles = [];

  for (const slug of slugs) {
    const html = readFileSync(join(outputDir, "blog", slug, "index.html"), "utf8");
    const styles = readStyles(html).filter(href => !listStyles.has(href));
    if (styles.length > 0) extraStyles.push({ slug, styles });
  }
  return { checkedArticles: slugs.length, extraStyles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectNavigationStyles(resolve(process.argv[2] ?? "dist"));
  for (const { slug, styles } of result.extraStyles) {
    console.error(`文章 ${slug} 仍需新增关键样式：${styles.join(", ")}`);
  }
  console.log(`已检查 ${result.checkedArticles} 篇文章，${result.extraStyles.length} 篇需要新增关键样式。`);
  if (result.extraStyles.length > 0) process.exitCode = 1;
}
