# Markdown Viewer Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Markdown-derived table of contents and compact scroll-state navigation to the blog article viewer.

**Architecture:** Use Astro content `render(post)` heading metadata instead of reparsing Markdown. Normalize heading data in `src/lib/blog.ts`, pass it into `BlogPostLayout.astro`, and use CSS plus a small scroll listener for the compact header state.

**Tech Stack:** Astro 6, TypeScript, Vitest, CSS.

---

### Task 1: Table Of Contents Data

**Files:**
- Modify: `src/lib/blog.ts`
- Modify: `tests/blog.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for a `getTableOfContents()` helper that filters headings and preserves `depth`, `slug`, and `text`.

- [ ] **Step 2: Run the focused tests**

Run: `npm test -- tests/blog.test.ts`

Expected: fail because `getTableOfContents` is not exported yet.

- [ ] **Step 3: Implement helper**

Add `MarkdownHeading` and `TableOfContentsItem` types, then implement `getTableOfContents(headings)` by keeping headings with `depth > 1`, a non-empty `slug`, and non-empty `text`.

- [ ] **Step 4: Run focused tests again**

Run: `npm test -- tests/blog.test.ts`

Expected: pass.

### Task 2: Article Layout

**Files:**
- Modify: `src/pages/blog/[slug].astro`
- Modify: `src/layouts/BlogPostLayout.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Pass Astro headings**

Change `src/pages/blog/[slug].astro` to destructure `{ Content, headings }` from `render(post)` and pass `headings` into `BlogPostLayout`.

- [ ] **Step 2: Render table of contents**

Change `BlogPostLayout.astro` to call `getTableOfContents(headings)`, render a `nav.article-toc` when entries exist, and keep the existing article card content unchanged.

- [ ] **Step 3: Style article page**

Add responsive CSS for `.post-layout`, `.article-toc`, and `.toc-link` so the table of contents is sticky on desktop and becomes a lightweight block on smaller screens.

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: pass.

### Task 3: Compact Header

**Files:**
- Modify: `src/components/Header.astro`
- Modify: `src/styles/global.css`

- [ ] **Step 1: Render icon navigation**

Add `icon` values to the existing nav model and render icon spans plus tooltip spans inside each link.

- [ ] **Step 2: Toggle scroll state**

Add an inline script that toggles `body.header-condensed` once `window.scrollY` passes a small threshold.

- [ ] **Step 3: Style expanded and compact states**

Add CSS transitions for the header, brand text, brand mark, nav labels, icon visibility, and tooltips.

- [ ] **Step 4: Verify full project**

Run: `npm test` and `npm run build`.

Expected: both pass.
