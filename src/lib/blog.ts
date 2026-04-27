export type BlogPostLike = {
  slug: string;
  body?: string;
  data: {
    title: string;
    date: Date;
    draft?: boolean;
    featured?: boolean;
    tags?: string[];
    description?: string;
    readingTime?: number;
  };
};

export type MarkdownHeading = {
  depth: number;
  slug: string;
  text: string;
};

export type TableOfContentsItem = MarkdownHeading;

export function sortPosts<T extends BlogPostLike>(posts: readonly T[]): T[] {
  return [...posts].sort((left, right) => {
    return right.data.date.getTime() - left.data.date.getTime();
  });
}

export function getPublishedPosts<T extends BlogPostLike>(posts: readonly T[]): T[] {
  return sortPosts(posts).filter((post) => !post.data.draft);
}

export function estimateReadingMinutes(text: string, wordsPerMinute = 240): number {
  const cjkCharacters = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = text
    .replace(/[\u4e00-\u9fff]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const estimatedWords = latinWords + Math.ceil(cjkCharacters / 2);

  return Math.max(1, Math.ceil(estimatedWords / wordsPerMinute));
}

export function getPostSlug(post: { id?: string; slug?: string }): string {
  return (post.slug ?? post.id ?? "").replace(/\.mdx?$/, "");
}

export function getTableOfContents(headings: readonly MarkdownHeading[] = []): TableOfContentsItem[] {
  return headings
    .filter((heading) => {
      const text = heading.text.trim();
      const normalizedText = text.toLowerCase();

      return (
        heading.depth > 1 &&
        heading.slug.trim() &&
        text &&
        normalizedText !== "目录" &&
        normalizedText !== "toc" &&
        normalizedText !== "table of contents"
      );
    })
    .map((heading) => ({
      depth: heading.depth,
      slug: heading.slug,
      text: heading.text
    }));
}
