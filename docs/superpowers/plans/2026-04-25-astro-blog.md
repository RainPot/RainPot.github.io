# Astro Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build RainPot2026Blog as a deployable Astro Markdown blog with a cosmic code visual theme and pointer-reactive background.

**Architecture:** Astro generates static pages from Markdown content collections. Shared layouts/components own the visual shell, while a small browser script owns the canvas starfield interaction. GitHub Actions builds `dist/` and deploys it to GitHub Pages.

**Tech Stack:** Astro, TypeScript, Markdown content collections, Vitest for helper tests, GitHub Pages Actions.

---

### Task 1: Project Tooling and Blog Helpers

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/lib/blog.ts`
- Create: `tests/blog.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/blog.test.ts` with tests for article sorting, draft filtering, and reading-time estimation.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run`
Expected: FAIL because dependencies or `src/lib/blog.ts` are not implemented yet.

- [ ] **Step 3: Add project config and helper implementation**

Add Astro/Vitest configuration and implement `sortPosts`, `getPublishedPosts`, and `estimateReadingMinutes`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --run`
Expected: PASS.

### Task 2: Content Model and Markdown Articles

**Files:**
- Create: `src/content.config.ts`
- Create: `src/content/blog/auitestagent.md`
- Create: `src/content/blog/mobile-agent.md`
- Create: `src/content/blog/frida-hook.md`
- Create: `src/content/blog/openclaw-ai-agent.md`

- [ ] **Step 1: Define content schema**

Create a Blog collection schema with title, description, date, tags, draft, featured, and readingTime fields.

- [ ] **Step 2: Add initial Markdown posts**

Add three existing-topic posts and one OpenClaw placeholder draft. Keep OpenClaw as the latest slot but with placeholder copy only.

- [ ] **Step 3: Verify content compiles**

Run: `npm run build`
Expected: Astro content schema passes.

### Task 3: Astro Pages, Layouts, and Visual System

**Files:**
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/layouts/BlogPostLayout.astro`
- Create: `src/components/Header.astro`
- Create: `src/components/CosmicBackground.astro`
- Create: `src/components/ArticleCard.astro`
- Create: `src/pages/index.astro`
- Create: `src/pages/blog/index.astro`
- Create: `src/pages/blog/[slug].astro`
- Create: `src/pages/about.astro`
- Create: `src/styles/global.css`
- Create: `public/scripts/cosmos.js`

- [ ] **Step 1: Build shared shell and components**

Create layouts/components matching the cosmic code direction: sticky header, hero, terminal panel, article cards, lab grid, and readable post layout.

- [ ] **Step 2: Add pointer-reactive canvas background**

Create `public/scripts/cosmos.js` and load it from the base layout.

- [ ] **Step 3: Build static routes**

Create home, article list, article detail, and about routes.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS and `dist/` contains static pages.

### Task 4: Deployment and Cleanup

**Files:**
- Modify: `.github/workflows/pages.yml`
- Modify: `.gitignore`
- Modify: `README.md`
- Delete: root static prototype files that conflict with Astro (`index.html`, `assets/app.js`, `assets/styles.css`)

- [ ] **Step 1: Update Pages workflow**

Make GitHub Actions install dependencies, run tests, build Astro, and upload `dist/`.

- [ ] **Step 2: Update docs**

Document `npm install`, `npm run dev`, `npm run build`, and Markdown article creation.

- [ ] **Step 3: Remove obsolete static prototype**

Delete the temporary root HTML/CSS/JS prototype so Astro is the single source of truth.

- [ ] **Step 4: Final verification**

Run: `npm test -- --run` and `npm run build`.
Expected: both pass.
