# Persome Personal Model 源码拆解博客执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not dispatch subagents for this plan.

**Goal:** 基于 `Intuition-Lab/personal-model@fb3986d` 写成一篇证据充分、图文可读的中文源码拆解文章，并通过 RainPotBlog 的 `main` 分支发布。

**Architecture:** 文章不按目录罗列功能，而是沿“活动采集 → 状态形成 → 几何模型 → `HUMAN.md`/MCP”数据流展开。三张 draw.io 图分别承担 Runtime 总览、模型证据链和访问边界，正文使用短代码或 prompt 片段证明关键判断，再用独立章节说明降级、隐私和适用边界。

**Tech Stack:** Python 3.12、Persome 0.3.2、draw.io、Astro 6、Markdown、Vitest、GitHub Pages。

## Global Constraints

- 源码事实固定到 `Intuition-Lab/personal-model@fb3986d`，包版本固定为 `0.3.2`。
- 真实屏幕数据和 `~/.persome` 不进入验证过程；只使用仓库的合成 demo、测试和公开源码。
- 文章核心判断必须能回到源码、配置、测试或运行结果，README 只用于解释公开契约。
- 图表使用 draw.io，保留 `.drawio` 和 `.drawio.png`，在约 760px 正文宽度下完成目检。
- 文章明确说明 macOS 13+、Alpha、可选 LLM egress、degraded、MCP 个人数据访问和导出匿名化边界。
- 所有代码注释和 Git commit message 使用中文；不覆盖用户已有改动，不强推远端。

---

### Task 1: 固定源码证据与运行结果

**Files:**
- Read: `/Users/zhangyu421/Documents/project/learning/repos/personal-model/AGENTS.md`
- Read: `/Users/zhangyu421/Documents/project/learning/repos/personal-model/ARCHITECTURE.md`
- Read: `/Users/zhangyu421/Documents/project/learning/repos/personal-model/MODEL_FORMAT.md`
- Read: `/Users/zhangyu421/Documents/project/learning/repos/personal-model/SECURITY_PRIVACY.md`
- Read: `/Users/zhangyu421/Documents/project/learning/repos/personal-model/src/persome/`
- Test: `/Users/zhangyu421/Documents/project/learning/repos/personal-model/tests/`

**Interfaces:**
- Consumes: Git commit `fb3986d`、Persome CLI、仓库自带 synthetic fixtures。
- Produces: 入口、触发器、核心动作、数据流、prompt、provenance、复用路径和边界八类可引用证据。

- [ ] **Step 1: 重新确认源码版本和工作区**

Run:

```bash
git status --short --branch
git rev-parse HEAD
uv run persome --version
```

Expected: 工作区干净，HEAD 为 `fb3986d...`，版本输出对应 `0.3.2`。

- [ ] **Step 2: 沿真实执行链检索入口和状态转换**

Run:

```bash
rg -n "ModelBuildCoordinator|memory_delta|delta_end|five|300|HUMAN.md|resolve_evidence|degraded|Root" src tests docs
```

Expected: 能定位 daemon/scheduler、session reducer、delta apply、model build、snapshot/HUMAN.md 和 MCP 证据解析实现及测试。

- [ ] **Step 3: 阅读命中的实现并提取短证据**

每条证据保留文件名、函数名、条件和 3–12 行原文；优先使用条件判断、stage 顺序、schema 字段、prompt 约束和保护逻辑。文章中不复制整段函数。

- [ ] **Step 4: 运行合成 demo 相关测试和关键离线测试**

Run:

```bash
PERSOME_LLM_MOCK=1 uv run pytest tests/test_sample_demo.py tests/test_runtime_model_e2e.py tests/test_human_md.py tests/test_mcp_tools.py tests/test_root_synthesis.py -q
```

Expected: 所选测试全部通过；如有平台跳过，文章只引用实际执行到的断言。

- [ ] **Step 5: 验证合成 demo 的公开命令**

Run:

```bash
uv run python scripts/sample_demo.py --help
```

Expected: 命令包含默认 synthetic demo 和 `--showcase` 入口，不需要真实数据或 macOS 权限。

### Task 2: 绘制并验收三张机制图

**Files:**
- Create: `public/images/persome-personal-model/drawio/persome-runtime-overview.drawio`
- Create: `public/images/persome-personal-model/drawio/persome-evidence-geometry.drawio`
- Create: `public/images/persome-personal-model/drawio/persome-access-boundary.drawio`
- Create: `public/images/persome-personal-model/persome-runtime-overview.drawio.png`
- Create: `public/images/persome-personal-model/persome-evidence-geometry.drawio.png`
- Create: `public/images/persome-personal-model/persome-access-boundary.drawio.png`

**Interfaces:**
- Consumes: Task 1 的执行链、数据结构和安全边界证据。
- Produces: 可编辑的图源和能在博客正文直接引用的 PNG。

- [ ] **Step 1: 检查 draw.io 运行时和样式预设**

Run:

```bash
drawio --version
```

Expected: 返回可用版本；如果不可用，按 drawio skill 的 macOS app 路径和浏览器回退处理。

- [ ] **Step 2: 生成 Runtime 总览图**

使用自上而下四段布局：输入源、确定性状态形成、语义建模、消费面。主节点标签固定为“AX / 本地 OCR / 可信导入”“采集缓冲”“分钟时间线”“确定性会话”“五分钟 reducer”“Point / Line”“Face / Volume / Root”“Snapshot / HUMAN.md / MCP”。

- [ ] **Step 3: 生成模型证据链图**

使用自下而上聚合布局，固定展示 Point、Line、Face、Volume、Root；右侧单独放 receipt 回查通道，并区分 `sources`、`context`、`history`，避免把邻近上下文画成直接证据。

- [ ] **Step 4: 生成访问与隐私边界图**

以“本机 Runtime”容器为中心，容器内放 `~/.persome`、stdio MCP、loopback HTTP、viewer；容器外放可信 Agent 与可选 LLM provider。只有配置语义建模后才画出网箭头，computer-use 用明确的“不提供”标签表示。

- [ ] **Step 5: 结构校验并导出预览**

Run for each source:

```bash
for persome_diagram in persome-runtime-overview persome-evidence-geometry persome-access-boundary; do
  python3 /Users/zhangyu421/.codex/skills/drawio-skill/scripts/validate.py "public/images/persome-personal-model/drawio/${persome_diagram}.drawio"
  drawio -x -f png --width 2000 -o "public/images/persome-personal-model/${persome_diagram}.png" "public/images/persome-personal-model/drawio/${persome_diagram}.drawio"
done
```

Expected: 无 dangling edge、重复 ID 或明显重叠；三张预览均非空且尺寸不超过视觉检查限制。

- [ ] **Step 6: 视觉检查并最终导出**

在源尺寸和约 760px 宽度分别目检。确认文字完整、字号可读、箭头不穿字、暗色文字有足够对比、画布边缘不裁切后执行：

```bash
for persome_diagram in persome-runtime-overview persome-evidence-geometry persome-access-boundary; do
  drawio -x -f png -e -s 2 -o "public/images/persome-personal-model/${persome_diagram}.drawio.png" "public/images/persome-personal-model/drawio/${persome_diagram}.drawio"
  python3 /Users/zhangyu421/.codex/skills/drawio-skill/scripts/repair_png.py "public/images/persome-personal-model/${persome_diagram}.drawio.png"
done
```

Expected: 最终 PNG 可被严格解码器打开，并保留可编辑 XML。

### Task 3: 写作与人味化复核

**Files:**
- Create: `src/content/blog/2026-07-17-persome-personal-model-repo-breakdown.md`
- Read: `src/content.config.ts`
- Read: `src/content/blog/2026-06-29-deepagents-framework-breakdown.md`

**Interfaces:**
- Consumes: Task 1 的证据与 Task 2 的图片 URL。
- Produces: 符合 Astro collection schema 的公开中文文章。

- [ ] **Step 1: 写入 frontmatter 和结论段**

Frontmatter 使用日期 `2026-07-17`、`draft: false`、`featured: true`，标签覆盖 `AI Agent`、`Personal Model`、`MCP`、`Agent Memory`、`源码拆解`，阅读时长根据最终正文估算。

- [ ] **Step 2: 按执行链写正文**

正文依次覆盖最小 demo、总览、状态形成、证据几何、model build、`HUMAN.md`、MCP、安全边界、工程取舍、局限和源码索引。每个关键机制使用“判断 → 图或短证据 → 解释 → 边界”的顺序。

- [ ] **Step 3: 校验引用准确性**

Run:

```bash
rg -n "fb3986d|0\.3\.2|Point|Line|Face|Volume|Root|HUMAN\.md|resolve_evidence|PERSOME_ROOT" src/content/blog/2026-07-17-persome-personal-model-repo-breakdown.md
```

Expected: 版本、术语、函数、配置和路径拼写与源码一致。

- [ ] **Step 4: 按 readable-human-tech-writing 复核**

删除抽象堆词、宣传式夸大、整齐排比、重复导读和强行升华；保留 macOS、Alpha、provider、degraded、证据语义和匿名化限制。不得新增作者经历、性能数字或源码无法支持的因果关系。

### Task 4: 构建和页面视觉验收

**Files:**
- Test: `tests/blog.test.ts`
- Test: `scripts/check-rainpot-blog-images.py`
- Generated: `dist/blog/2026-07-17-persome-personal-model-repo-breakdown/index.html`

**Interfaces:**
- Consumes: 完整文章与三张最终图片。
- Produces: 测试通过、无图片路径风险且页面可读的静态站点产物。

- [ ] **Step 1: 检查 Markdown 图片引用**

Run:

```bash
python3 scripts/check-rainpot-blog-images.py
```

Expected: 新文章三张图片均存在，没有绝对文件系统路径或缺失资源。

- [ ] **Step 2: 运行测试和生产构建**

Run:

```bash
npm test -- --run
npm run build
```

Expected: Vitest 全部通过，Astro 构建成功并生成文章页面。

- [ ] **Step 3: 浏览器验收桌面页面**

Run:

```bash
npm run preview -- --host 127.0.0.1 --port 4321
```

打开 `http://127.0.0.1:4321/blog/2026-07-17-persome-personal-model-repo-breakdown/`，检查标题、目录、代码块、三张图片、图注和正文；确认每张图片 `naturalWidth > 0`，并逐图截图目检。

- [ ] **Step 4: 浏览器验收窄视口**

在约 390px 视口检查标题换行、代码块滚动、图片缩放、目录和正文横向溢出。发现问题后修复并重新执行 Task 4。

### Task 5: 变更审计、提交和发布

**Files:**
- Commit: `docs/superpowers/specs/2026-07-17-personal-model-repo-blog-design.md`
- Commit: `docs/superpowers/plans/2026-07-17-personal-model-repo-blog.md`
- Commit: `src/content/blog/2026-07-17-persome-personal-model-repo-breakdown.md`
- Commit: `public/images/persome-personal-model/`

**Interfaces:**
- Consumes: Task 1–4 的已验证产物。
- Produces: `origin/main` 上可触发 GitHub Pages 发布的文章提交。

- [ ] **Step 1: 审计工作区和远端分支**

Run:

```bash
git status --short --branch
git diff --check
git fetch origin main
git rev-list --left-right --count origin/main...main
```

Expected: 变更只包含本任务文件，diff 无空白错误，本地没有落后远端。

- [ ] **Step 2: 提交文章与图片**

Run:

```bash
git add src/content/blog/2026-07-17-persome-personal-model-repo-breakdown.md public/images/persome-personal-model
git commit -m "docs: 发布 Persome Personal Model 源码拆解"
```

Expected: 提交只包含计划、文章和对应图片；设计文档保留在前置提交中。

- [ ] **Step 3: 推送当前主分支**

Run:

```bash
git push origin main
```

Expected: push fast-forward 成功，远端 `main` 指向本地最新提交并触发 Pages workflow。

- [ ] **Step 4: 发布后核对**

检查 push 输出和远端 commit；如果 GitHub Pages 已完成部署，再打开公开文章 URL 验证 200 与图片加载。若 workflow 尚在运行，明确报告已推送和待部署状态，不把“已推送”误写成“站点已上线”。
