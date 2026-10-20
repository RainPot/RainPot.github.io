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

## 访问统计

使用 [soxft/busuanzi](https://github.com/soxft/busuanzi) 的公开服务，接口为其当前官方脚本所用的 `https://bsz.iirose.cn/api`。全站和文章的浏览次数、访客数在首次打开及 Astro 站内导航后更新，访客身份按服务约定保存在浏览器本地存储中。

2026-10-20 因 `cdn.busuanzi.cc/api.php` 返回 HTTP 524 迁移统计服务，数据从迁移后重新累计，未导入旧服务的历史计数。请求超过 8 秒或服务返回异常时显示“暂不可用”，避免一直停留在“加载中...”；不自动重试，以免重复增加浏览量。
