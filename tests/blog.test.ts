import { describe, expect, it } from "vitest";
import { estimateReadingMinutes, getPublishedPosts, getTableOfContents, sortPosts } from "../src/lib/blog";
import { getArticleFilterPage, initArticleFilter, matchesArticleQuery, normalizeFilterText } from "../src/scripts/article-filter";

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

  it("matches article filters by multiple lowercase terms", () => {
    expect(normalizeFilterText("  AI Agent  ")).toBe("ai agent");
    expect(matchesArticleQuery("Frontend AI Agent Notes", "ai frontend")).toBe(true);
    expect(matchesArticleQuery("Frontend AI Agent Notes", "backend")).toBe(false);
  });

  it("builds filter pages from all article texts", () => {
    const state = getArticleFilterPage(["Agent one", "Tensorboard", "Agent two"], "agent", 2, 1);

    expect(state).toEqual({
      currentPage: 2,
      matchedIndexes: [0, 2],
      pageIndexes: [2],
      totalPages: 2
    });
  });

  it("filters article cards and updates count text", () => {
    let listener = () => {};
    const input = {
      value: "",
      addEventListener: (_event: string, handler: () => void) => {
        listener = handler;
      }
    };
    const cards = [
      createFilterCard("AI Agent frontend note"),
      createFilterCard("Tensorboard training")
    ];
    const count = { textContent: "" };
    const empty = { hidden: true };
    const root = {
      querySelector: (selector: string) => {
        if (selector === "[data-article-filter]") return input;
        if (selector === "[data-filter-count]") return count;
        if (selector === "[data-filter-empty]") return empty;
        return null;
      },
      querySelectorAll: () => cards
    };

    initArticleFilter(root as unknown as ParentNode);
    input.value = "agent";
    listener();

    expect(cards[0].filtered).toBe(false);
    expect(cards[1].filtered).toBe(true);
    expect(count.textContent).toBe("1/2");
    expect(empty.hidden).toBe(true);
  });

  it("hides pagination when filtered results fit on one page", () => {
    let listener = () => {};
    const input = {
      value: "agent",
      addEventListener: (_event: string, handler: () => void) => {
        listener = handler;
      }
    };
    const cards = [
      createFilterCard("AI Agent frontend note"),
      createFilterCard("Tensorboard training")
    ];
    const pagination = {
      dataset: { pageSize: "20", currentPage: "1" },
      hidden: false,
      innerHTML: "<button>下一页</button>",
      querySelectorAll: () => []
    };
    const root = {
      querySelector: (selector: string) => {
        if (selector === "[data-article-filter]") return input;
        if (selector === "[data-filter-pagination]") return pagination;
        return null;
      },
      querySelectorAll: () => cards
    };

    initArticleFilter(root as unknown as ParentNode);
    listener();

    expect(pagination.hidden).toBe(true);
    expect(pagination.innerHTML).toBe("");
  });

  it("changes filtered result pages from pagination buttons", () => {
    const input = {
      value: "agent",
      addEventListener() {}
    };
    const cards = [
      createFilterCard("Agent one"),
      createFilterCard("Agent two")
    ];
    const pagination = createPagination("1");
    const root = {
      querySelector: (selector: string) => {
        if (selector === "[data-article-filter]") return input;
        if (selector === "[data-filter-pagination]") return pagination;
        return null;
      },
      querySelectorAll: () => cards
    };

    initArticleFilter(root as unknown as ParentNode);
    pagination.buttons.at(-1)?.click();

    expect(cards[0].pageHidden).toBe(true);
    expect(cards[1].pageHidden).toBe(false);
    expect(pagination.innerHTML).toContain("第 2 / 2 页");
  });
});

function createFilterCard(filterText: string) {
  const card = {
    filtered: false,
    pageHidden: false,
    dataset: { filterText },
    classList: {
      toggle(className: string, enabled: boolean) {
        if (className === "is-filtered") card.filtered = enabled;
        if (className === "is-page-hidden") card.pageHidden = enabled;
      }
    },
    setAttribute() {}
  };
  return card;
}

function createPagination(pageSize: string) {
  const pagination = {
    buttons: [] as Array<{ dataset: { filterPage: string }; click: () => void; addEventListener: (_event: string, handler: () => void) => void }>,
    dataset: { pageSize, currentPage: "1" },
    hidden: false,
    value: "",
    get innerHTML() {
      return this.value;
    },
    set innerHTML(value: string) {
      this.value = value;
      this.buttons = [...value.matchAll(/data-filter-page="(\d+)"/g)].map((match) => {
        let listener = () => {};
        return {
          dataset: { filterPage: match[1] },
          click: () => listener(),
          addEventListener: (_event: string, handler: () => void) => {
            listener = handler;
          }
        };
      });
    },
    querySelectorAll() {
      return this.buttons;
    }
  };

  return pagination;
}
