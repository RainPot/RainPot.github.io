import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import rehypeImageFigure from "./src/lib/rehype-image-figure";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://rainpot.github.io",
  base: process.env.BASE_PATH ?? "/",
  output: "static",
  integrations: [react()],
  markdown: {
    remarkPlugins: [remarkMath],
    // 构建期直接渲染成静态 HTML，前端不加载 KaTeX 运行时；
    // 保留 MathML 分支供屏幕阅读器识别，公式写错时降级为原文而不是中断构建
    rehypePlugins: [
      rehypeImageFigure,
      [rehypeKatex, { output: "htmlAndMathml", throwOnError: false, strict: false }]
    ]
  },
  vite: {
    optimizeDeps: {
      include: ["react", "react-dom/client"]
    }
  }
});
