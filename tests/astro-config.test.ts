import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("astro react integration config", () => {
  it("prebundles react-dom client entry for browser hydration", () => {
    const config = readFileSync("astro.config.mjs", "utf8");

    expect(config).toContain('integrations: [react()]');
    expect(config).toContain('optimizeDeps: {');
    expect(config).toContain('include: ["react", "react-dom/client"]');
  });
});

describe("markdown math config", () => {
  const config = readFileSync("astro.config.mjs", "utf8");

  it("wires remark-math and rehype-katex into the markdown pipeline", () => {
    expect(config).toContain('import remarkMath from "remark-math"');
    expect(config).toContain('import rehypeKatex from "rehype-katex"');
    expect(config).toContain("remarkPlugins: [remarkMath]");
    expect(config).toContain("[rehypeKatex,");
  });

  it("renders math at build time instead of failing the build on a bad formula", () => {
    expect(config).toContain('output: "htmlAndMathml"');
    expect(config).toContain("throwOnError: false");
  });

  it("ships katex stylesheet only on the blog post layout", () => {
    const layout = readFileSync("src/layouts/BlogPostLayout.astro", "utf8");
    const base = readFileSync("src/layouts/BaseLayout.astro", "utf8");

    expect(layout).toContain('import "katex/dist/katex.min.css"');
    expect(base).not.toContain("katex");
  });
});
