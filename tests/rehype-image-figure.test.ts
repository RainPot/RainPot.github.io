import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createMarkdownProcessor } from "@astrojs/markdown-remark";
import rehypeImageFigure, { getLoneImage, getWrittenCaption, wrapImageParagraphs } from "../src/lib/rehype-image-figure";

const text = (value: string) => ({ type: "text", value });
const element = (tagName: string, children: any[] = [], properties: Record<string, unknown> = {}) => ({
  type: "element",
  tagName,
  properties,
  children
});
const paragraph = (...children: any[]) => element("p", children);
const image = (alt: string) => element("img", [], { src: "/a.png", alt });
const root = (...children: any[]) => ({ type: "root", children });

const figures = (tree: any) => tree.children.filter((node: any) => node.tagName === "figure");
const captionOf = (figure: any) => figure.children[1].children.map((node: any) => node.value ?? "").join("");

describe("markdown image captions", () => {
  it("turns a lone image paragraph into a figure captioned by its alt text", () => {
    const tree = wrapImageParagraphs(root(paragraph(image("VeriGUI 闭环框架"))));

    expect(tree.children).toHaveLength(1);
    expect(figures(tree)[0]).toEqual(
      element("figure", [image("VeriGUI 闭环框架"), element("figcaption", [text("VeriGUI 闭环框架")], { className: ["post-figure__caption"] })], {
        className: ["post-figure"]
      })
    );
  });

  it("ignores the whitespace markdown leaves around the image", () => {
    expect(getLoneImage(paragraph(text("\n"), image("流程图"), text("\n")))).not.toBeNull();
  });

  it("leaves mixed paragraphs alone so the original layout survives", () => {
    expect(getLoneImage(paragraph(image("流程图"), text("附注")))).toBeNull();
    expect(getLoneImage(paragraph(text("只是一段话")))).toBeNull();
  });

  it("leaves an image without alt text alone, since there is no caption to show", () => {
    const tree = wrapImageParagraphs(root(paragraph(image(""))));

    expect(figures(tree)).toHaveLength(0);
    expect(tree.children[0].tagName).toBe("p");
  });

  it("rewrites images nested in the tree without touching their siblings", () => {
    const heading = element("h2", [text("方法")]);
    const tree = wrapImageParagraphs(root(heading, element("div", [paragraph(image("架构图"))])));

    expect(tree.children[0]).toBe(heading);
    expect((tree.children[1] as any).children[0].tagName).toBe("figure");
  });
});

describe("captions the author already wrote", () => {
  const written = paragraph(element("em", [text("图 1：架构设计闭环。")]));

  it("recognises a paragraph that is nothing but emphasis", () => {
    expect(getWrittenCaption(written)).toEqual([text("图 1：架构设计闭环。")]);
    expect(getWrittenCaption(paragraph(text("图 1 对比了两种行为模式。")))).toBeNull();
    expect(getWrittenCaption(paragraph(element("em", [text("强调")]), text("后面还有正文")))).toBeNull();
  });

  it("uses it as the caption instead of the alt text, and drops the duplicate paragraph", () => {
    const tree = wrapImageParagraphs(root(paragraph(image("架构设计闭环")), text("\n"), written));

    expect(figures(tree)).toHaveLength(1);
    expect(captionOf(figures(tree)[0])).toBe("图 1：架构设计闭环。");
    expect(tree.children.some((node: any) => node.tagName === "p")).toBe(false);
  });

  it("keeps a following prose paragraph in the body", () => {
    const prose = paragraph(text("图 1 对比了两种行为模式。"));
    const tree = wrapImageParagraphs(root(paragraph(image("行为模式对比")), prose));

    expect(captionOf(figures(tree)[0])).toBe("行为模式对比");
    expect(tree.children[1]).toBe(prose);
  });

  it("captions an image that has no alt text at all", () => {
    const tree = wrapImageParagraphs(root(paragraph(image("")), written));

    expect(captionOf(figures(tree)[0])).toBe("图 1：架构设计闭环。");
  });
});

describe("markdown image caption wiring", () => {
  // 手搭的 hast 树和真实管线产出的未必一致，这里过一遍 Astro 自己的 markdown 处理器
  it("captions images the same way in the real markdown pipeline", async () => {
    const processor = await createMarkdownProcessor({ rehypePlugins: [rehypeImageFigure] });

    const alt = await processor.render("![架构设计闭环](/a.png)\n");
    const authored = await processor.render("![架构设计闭环](/a.png)\n\n*图 1：说明文字。*\n");
    const prose = await processor.render("![架构设计闭环](/a.png)\n\n图 1 对比了两种行为模式。\n");

    expect(alt.code.trim()).toBe(
      '<figure class="post-figure"><img src="/a.png" alt="架构设计闭环"><figcaption class="post-figure__caption">架构设计闭环</figcaption></figure>'
    );
    expect(authored.code).toContain('<figcaption class="post-figure__caption">图 1：说明文字。</figcaption>');
    expect(authored.code).not.toContain("<p>");
    expect(prose.code).toContain("<p>图 1 对比了两种行为模式。</p>");
  });

  it("runs the figure plugin in the markdown pipeline", () => {
    const config = readFileSync("astro.config.mjs", "utf8");

    expect(config).toContain('import rehypeImageFigure from "./src/lib/rehype-image-figure"');
    expect(config).toContain("rehypePlugins: [\n      rehypeImageFigure,");
  });

  it("styles the caption under the figure", () => {
    expect(readFileSync("src/styles/global.css", "utf8")).toContain(".markdown-content .post-figure__caption {");
  });
});
