# RainPot 2026 Blog

Astro + Markdown 的静态 Blog。Node 只用于本地开发和构建，最终部署产物是 `dist/` 里的静态文件。

## Setup

```bash
npm install --registry=https://mirrors.cloud.tencent.com/npm/
npm run dev
```

## Add a Post

在 `src/content/blog/` 里新增 Markdown：

```md
---
title: "文章标题"
description: "一句话摘要"
date: 2026-04-25
tags: ["AI Agent", "Engineering"]
draft: false
featured: false
readingTime: 8
---

正文内容。
```

`draft: true` 的文章不会出现在首页和归档。

## Build

```bash
npm test -- --run
npm run build
```

## GitHub Pages

仓库内包含 `.github/workflows/pages.yml`。上传到 GitHub 后，在仓库 Settings -> Pages 中选择 **Source: GitHub Actions**。推送到 `main` 或 `master` 后，Actions 会安装依赖、运行测试、构建 Astro，并发布 `dist/`。
