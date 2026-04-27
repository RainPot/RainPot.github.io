import { describe, expect, it } from "vitest";
import { estimateReadingMinutes, getPublishedPosts, getTableOfContents, sortPosts } from "../src/lib/blog";

const posts = [
  {
    slug: "older",
    data: {
      title: "Older",
      date: new Date("2024-07-17"),
      draft: false,
      featured: false,
      tags: ["AI"]
    }
  },
  {
    slug: "draft-latest",
    data: {
      title: "Draft Latest",
      date: new Date("2026-04-25"),
      draft: true,
      featured: true,
      tags: ["Draft"]
    }
  },
  {
    slug: "newer",
    data: {
      title: "Newer",
      date: new Date("2025-01-07"),
      draft: false,
      featured: true,
      tags: ["Agent"]
    }
  }
];

describe("blog helpers", () => {
  it("sorts posts newest first without mutating input", () => {
    const sorted = sortPosts(posts);

    expect(sorted.map((post) => post.slug)).toEqual(["draft-latest", "newer", "older"]);
    expect(posts.map((post) => post.slug)).toEqual(["older", "draft-latest", "newer"]);
  });

  it("filters draft posts from published listings", () => {
    const published = getPublishedPosts(posts);

    expect(published.map((post) => post.slug)).toEqual(["newer", "older"]);
  });

  it("estimates reading time with a minimum of one minute", () => {
    expect(estimateReadingMinutes("短文")).toBe(1);
    expect(estimateReadingMinutes("word ".repeat(620))).toBe(3);
  });

  it("builds a table of contents from markdown headings", () => {
    const headings = [
      { depth: 1, slug: "article-title", text: "Article Title" },
      { depth: 2, slug: "setup", text: "Setup" },
      { depth: 3, slug: "install", text: "Install" },
      { depth: 4, slug: "details", text: "Details" }
    ];

    expect(getTableOfContents(headings)).toEqual([
      { depth: 2, slug: "setup", text: "Setup" },
      { depth: 3, slug: "install", text: "Install" },
      { depth: 4, slug: "details", text: "Details" }
    ]);
  });

  it("ignores empty and top-level headings in the table of contents", () => {
    const headings = [
      { depth: 1, slug: "title", text: "Title" },
      { depth: 2, slug: "", text: "Missing slug" },
      { depth: 3, slug: "missing-text", text: "" }
    ];

    expect(getTableOfContents(headings)).toEqual([]);
  });

  it("ignores existing markdown table-of-contents headings", () => {
    const headings = [
      { depth: 2, slug: "目录", text: "目录" },
      { depth: 2, slug: "overview", text: "Overview" },
      { depth: 2, slug: "toc", text: "TOC" },
      { depth: 2, slug: "details", text: "Details" }
    ];

    expect(getTableOfContents(headings)).toEqual([
      { depth: 2, slug: "overview", text: "Overview" },
      { depth: 2, slug: "details", text: "Details" }
    ]);
  });
});
