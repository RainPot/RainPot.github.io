# Markdown Viewer Navigation Design

## Goal

Improve the blog article reading page with a Markdown-derived table of contents and a compact scroll-state header.

## Requirements

- Generate an article table of contents from Markdown headings.
- Table of contents links jump to the generated heading anchors.
- Do not render a table of contents when the article has no useful headings.
- When the page scrolls down, switch the top header to a compact style.
- In compact state, keep the brand anchored visually at the upper left and shrink it.
- In compact state, show the four primary navigation destinations as icon links: Home, Articles, About, and GitHub.
- Each compact icon has a hover tooltip and clicks directly to its destination.

## Architecture

Astro already returns rendered content and heading metadata from `render(post)`, so the article page should pass that heading metadata into `BlogPostLayout`. A small helper in `src/lib/blog.ts` will normalize headings into table-of-contents entries and filter out the page-level title. `BlogPostLayout.astro` will render the table of contents and keep the article content in the existing slot.

`Header.astro` will render both full labels and compact icons for each navigation link. A small inline script will toggle a body class after a scroll threshold so CSS can transition the header, brand, and navigation.

## Testing

Unit tests will cover the table-of-contents helper:

- It keeps valid Markdown headings with depth, slug, and text.
- It skips the top-level article title heading.
- It skips existing Markdown headings named `目录`, `TOC`, or `Table of Contents`.
- It returns an empty list when no useful headings exist.

Build verification will confirm Astro accepts the updated layout props, rendered headings, and inline script.
