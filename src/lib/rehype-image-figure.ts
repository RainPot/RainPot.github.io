// 正文里「整段就是一张图」的段落转成 figure，图注显示在图片下方；
// 预览层因此可以只放图片，不用再压一层说明文字
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const isBlankText = (node: HastNode): boolean =>
  node.type === "text" && typeof node.value === "string" && node.value.trim() === "";

const getParagraphContent = (node: HastNode): HastNode[] | null => {
  if (node.type !== "element" || node.tagName !== "p") {
    return null;
  }

  return (node.children ?? []).filter((child) => !isBlankText(child));
};

// 图文混排的段落不动它：拆开会改变原来的排版
export function getLoneImage(node: HastNode): HastNode | null {
  const content = getParagraphContent(node);
  const image = content?.[0];

  if (content?.length !== 1 || !image || image.type !== "element" || image.tagName !== "img") {
    return null;
  }

  return image;
}

// 不少文章已经在图下手写了 *图 N：……*，这种整段斜体就是作者写的图注，
// 直接收进 figure，免得和 alt 生成的图注重复一遍
export function getWrittenCaption(node: HastNode | undefined): HastNode[] | null {
  const content = node ? getParagraphContent(node) : null;
  const emphasis = content?.[0];

  if (content?.length !== 1 || !emphasis || emphasis.type !== "element" || emphasis.tagName !== "em") {
    return null;
  }

  return emphasis.children ?? [];
}

const getAltCaption = (image: HastNode): HastNode[] | null => {
  const alt = image.properties?.alt;
  const value = typeof alt === "string" ? alt.trim() : "";

  return value === "" ? null : [{ type: "text", value }];
};

const buildFigure = (image: HastNode, caption: HastNode[]): HastNode => ({
  type: "element",
  tagName: "figure",
  properties: { className: ["post-figure"] },
  children: [
    image,
    {
      type: "element",
      tagName: "figcaption",
      properties: { className: ["post-figure__caption"] },
      children: caption
    }
  ]
});

// 下一个有内容的兄弟节点，跳过 markdown 在标签之间留下的换行
const findNextElement = (nodes: HastNode[], from: number): { node: HastNode; index: number } | null => {
  for (let index = from; index < nodes.length; index += 1) {
    const node = nodes[index]!;

    if (!isBlankText(node)) {
      return { node, index };
    }
  }

  return null;
};

export function wrapImageParagraphs<T extends HastNode>(tree: T): T {
  const walk = (parent: HastNode) => {
    if (!parent.children) {
      return;
    }

    const rewritten: HastNode[] = [];

    for (let index = 0; index < parent.children.length; index += 1) {
      const child = parent.children[index]!;
      const image = getLoneImage(child);
      const sibling = image ? findNextElement(parent.children, index + 1) : null;
      const written = sibling ? getWrittenCaption(sibling.node) : null;
      const caption = image ? (written ?? getAltCaption(image)) : null;

      if (image && caption) {
        rewritten.push(buildFigure(image, caption));

        // 手写的说明段落已经变成图注，原位置不再保留一份
        if (written && sibling) {
          index = sibling.index;
        }

        continue;
      }

      walk(child);
      rewritten.push(child);
    }

    parent.children = rewritten;
  };

  walk(tree);
  return tree;
}

export default function rehypeImageFigure() {
  return (tree: HastNode) => {
    wrapImageParagraphs(tree);
  };
}
