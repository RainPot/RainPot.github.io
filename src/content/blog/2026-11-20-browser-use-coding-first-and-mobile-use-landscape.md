---
title: "从 Codex Coding-First Browser Use 到 MobileUse：浏览器自动化的翻转，与手机端大厂进展和行业共识"
description: "结合 Tabbit 复盘、Browser-Use 1.0 重写与 Codex Chrome 扩展的底层运行时拆解，讲透 Coding-First Browser Use 的完整执行流程与六层降级机制；再转向手机端 MobileUse，系统梳理 Apple、Google、华为、三星及国产 OEM 的适配路线、超级 App 博弈进展、六项行业共识，以及对 APP 自动化测试与 Mobile QA 的落地启发。"
date: "2026-11-20"
tags: ["GUI Agent", "Browser Use", "MobileUse", "Codex", "AppFunctions", "App Intents", "Mobile QA"]
draft: false
featured: true
readingTime: 26
---

Tabbit 团队在复盘一年半 Browser Use 研发经历时，讲了一个非常刺痛一线工程师的转折点：他们花了一年多打磨 DOM 压缩、元素标框、截图坐标微调和几十套 Harness 组合，成功率却长期卡在 60% 上下；直到某天深夜用 OpenAI Codex 的 Chrome 扩展往管理后台灌 200 多条配置，Codex 跑通第一条后直接写了一个 `for` 循环，两分钟把剩下 200 多条全量灌完。

紧接着，开源社区最具代表性的项目 `browser-use` 也在 2026 年 11 月发布了 1.0 版本——删掉 13.6 万行代码（占整个代码库的 80%），彻底放弃 0.x 时代的 DOM 序列化器和固定动作菜单，改为让模型在一个持久 Python REPL 里直接写代码操控 Chrome DevTools Protocol（CDP）。官方基准显示，同一批模型换到这套极简 REPL 后，得分最多高出 33 个百分点，成本降到原来的 1/3 到 1/5，速度提升 2 到 3 倍。

这件事把 Richard Sutton 2019 年那篇《The Bitter Lesson》的含金量拉满了：**人类替 Agent 精心设计的“看一眼、点一下、再看一眼”仿生脚手架，在模型编程能力跨过临界点之后，反而成了束缚手脚的墙。**

但故事讲到这里，立刻会冒出两个更硬核的问题：

1. **Codex 用 Coding-First 做 Browser Use，底层到底是怎么跑通的？** 仅仅是让模型写几行 Playwright 吗？真实运行时的进程通信、状态保持、降级策略和安全边界长什么样？
2. **如果 Web 端靠 Coding-First 跑通了，那手机端的 MobileUse 呢？** 为什么这套赢麻了的打法搬到手机上却寸步难行？截至 2026 年底，Google、Apple、华为、三星、荣耀、小米、OPPO、vivo 以及字节豆包这些厂商各自做了哪些动作，行业目前到底形成了什么通识？

下面分两部分把这两件事彻底拆开，最后落回 APP 自动化测试和 Mobile QA 的工程实践。

## 目录

1. Browser Use 的真正翻转：从「仿生 GUI 循环」到「持久 REPL 编程」
2. 逐层拆解 Codex Coding-First Browser Use 的完整流程
3. 为什么 Coding-First 难以直接照搬到手机端：MobileUse 的三堵硬墙
4. 2026 年手机端 MobileUse 全景：大厂适配动作与四大技术路线
5. 绕不开的暗线：超级 App 博弈与「让路但不让权」
6. 截至 2026 年底，MobileUse 沉淀出的六项行业共识与三个未解难题
7. 对 APP 自动化测试与 Mobile QA 的落地启发
8. 参考资料

---

## 1. Browser Use 的真正翻转：从「仿生 GUI 循环」到「持久 REPL 编程」

2024 年底到 2025 年，几乎所有浏览器 Agent（从早期 `browser-use 0.1`、Stagehand 到各家自研桌面助手）都在重复同一套仿生循环：

```text
截取页面 + 压缩 DOM 并标号 -> 喂给模型 -> 模型输出单个 JSON 动作 -> 执行一次点击/输入 -> 重新截图
```

这套思路非常符合人类直觉——人上网确实是看一眼、点一下、再看一眼。但放进大模型里，它有四个绕不开的硬伤：

- **没有控制流**：批量录入 200 条配置、翻页抓取 50 条评论、按条件过滤表格，在纯单步工具协议里必须展开成几百轮 LLM 往返，每轮都要重新消化上万 Token 的页面上下文，慢且贵。
- **没有持久变量**：上一页查到的订单号、价格列表或 DOM 句柄，只能硬塞回对话历史文本里，长程任务很容易记丢或错位。
- **误差按步累乘**：即便单步点击准确率达到 95%，一个 30 步任务的端到端成功率也只剩 $(0.95)^{30} \approx 21.5\%$；更麻烦的是，Canvas 画布、飞书多维表格、复杂虚拟滚动列表往往连稳定的 DOM 选择器都没有。
- **批处理动作容易盲飞**：Google 在 Chromium 内部推 GLIC + APC（Annotated Page Content），Anthropic 实验过 `browser_batch`，都试图在一轮里输出一串动作减少往返。但只要第 2 步因为弹窗或加载延迟失败，第 3 到第 6 步就会基于过时状态盲目乱点，模型在执行中间根本看不到反馈。

Coding-First 翻转的不是“换个工具名字”，而是**把动作介质从“单步静态 JSON”换成了“可编程的持久执行环境”**。网页本身就是运行在浏览器里的程序，DOM、CSS、网络请求和可访问性树天生可被代码读取和操作。当模型拿到一个持久 REPL 后：

- 探索阶段，它先写一小段代码探测页面结构、验证第一条数据怎么填；
- 跑通之后，立刻把验证过的步骤包进 `for` 循环、`try/catch` 和断言检查里，在本地毫秒级跑完剩下的 200 条，只在异常或结束时再把结果交回模型判断。

这也是为什么到 2026 年下半年，从 OpenAI Codex、Tabbit CLI 到重写后的 `browser-use 1.0`，几乎所有头部方案都在“持久代码执行”上殊途同归——分歧只剩下暴露给模型的主接口是 **Playwright + AX Tree**（如 Codex、Tabbit，偏向复用模型训练语料里最熟悉的成熟抽象）还是 **裸 CDP**（如 `browser-use 1.0`，偏向极简零中间层）。

---

## 2. 逐层拆解 Codex Coding-First Browser Use 的完整流程

Tabbit 原文拆解过早期版本的 Codex Chrome 插件，提到它把浏览器操作抽象成四层接口：Playwright 首选、DOM-CUA、视觉 CUA、原始 CDP 兜底。如果进一步剖析 2026 年 11 月最新迭代的 Codex Chrome 插件运行时，会发现 OpenAI 已经把这套架构打磨得远比“给模型挂个 Playwright 工具”更系统。

![Codex Coding-First Browser Use 全链路架构与六层能力栈](/images/browser-use-coding-first-and-mobile-use/codex-browser-use-architecture.drawio.png)

*图 1：Codex Coding-First Browser Use 的端到端通信链路、六层能力降级策略与生产治理基座。[可编辑源文件](/images/browser-use-coding-first-and-mobile-use/codex-browser-use-architecture.drawio)。*

整套流程可以按**运行时链路、单任务执行步骤、六层接口路由、生产级治理**四个切面来看。

### 2.1 五跳通信链路：代码是怎么触达你已登录的 Chrome 的？

Codex 并不是像传统爬虫那样新拉起一个空白无头浏览器，而是直接接管用户正在用的真实 Chrome（复用 Cookie 和登录态）。它的本地调用链一共经过五跳：

1. **Codex 模型 + 持久 `node_repl`**：模型不逐个调用 `click` / `type` 工具，而是向一个常驻 Node.js REPL（MCP 服务）发送一段段可执行的 JavaScript 代码。`const browser`、`const tab` 以及业务中间数组在多轮对话之间始终保留在 REPL 内存里，不必反复重新连接或把中间状态全塞进 Prompt。同时，插件通过 `Stop`、`Interrupt`、`SubagentStop` 三个生命周期钩子绑定 `node_repl.turn_ended`，确保每轮任务结束或被打断时自动清理现场。
2. **动态能力裁剪 SDK（`browser-client.mjs`）**：REPL 初始化时执行 `setupBrowserRuntime()`，向本地浏览器服务拉取当前后端的 `apiManifest` 和禁用成员列表，然后用 JavaScript `Proxy` 动态包出一套统一的对象树 `agent -> browsers -> browser -> tabs -> tab`。这么做的好处非常工程化：同一套 SDK 同时支持四种底层后端——`extension`（Chrome 扩展）、`iab`（应用内浏览器）、`cdp`（直连调试端口）、`mcpapps`，哪个后端不支持某项能力（比如 `iab` 不支持读用户外部历史记录），`Proxy` 会直接在运行期隐藏该属性，避免模型“幻觉调用”不存在的接口。
3. **本地浏览器守护服务（`browser-service.mjs`）**：接收 REPL 发来的 RPC 指令并调度执行。这里藏着两个很实在的性能优化模块：一个是约 3.9 MB 压缩体积的 **`browser-accessibility.wasm`**，专门用来在本地把网页可访问性树转换成紧凑文本并做**增量 Diff**；另一个是 **`zxing_reader.wasm`**，用于本地识别页面里的二维码（常见于登录交接场景）。
4. **Native Messaging Host + Chrome 扩展**：本地服务通过 Chrome Native Messaging 协议（注册主机名 `com.openai.codexextension`）与已安装的 Chrome 扩展双向通信。扩展侧负责挂载 `chrome.debugger`（用于 CDP 与 Playwright 语义执行）、管理 Agent 专属标签组、拦截文件选择器和下载事件，以及处理“用户随时点击停止接管”的中断信号。
5. **真实 Chrome 浏览器**：任务既可以新开临时标签页在后台跑，也可以通过 `browser.user.openTabs()` + `claimTab()` 接管用户已经打开的页面，同时保留用户现有的登录态。

### 2.2 一个真实批量任务在 Codex 里的完整生命周期

以“往管理后台录入 200 条配置并核对”为例，Codex 的实际执行节奏和纯 GUI Agent 完全不同，大致分成五个阶段：

**阶段一：环境引导与会话挂载（Bootstrap & Claim）**

REPL 先初始化 `agent` 句柄，列出可用浏览器并绑定目标 Chrome 实例。如果用户在提示词里直接 `@` 了某个已打开的后台标签页，Codex 不会盲猜 Tab ID，而是先拉取 `browser.user.openTabs()`，严格比对 `(providerTabId, title, url)` 三元组快照后再调用 `claimTab()`。这套“失败即关闭（fail-closed）”的校验就是为了防止浏览器重启后数字 ID 被复用，导致 Agent 误点到用户的网银或邮箱页。

```js
// 1. 持久 REPL 中绑定浏览器与目标标签页（句柄跨轮保留）
const browsers = await agent.browsers.list();
const chrome = await agent.browsers.get(browsers.find(b => b.type === "extension").id);
const tabs = await chrome.user.openTabs();
const target = tabs.find(t => t.url.includes("admin.example.com/config"));
const tab = await chrome.user.claimTab(target);

// 2. 拉取当前页面最便宜的状态观察（AX 增量树）
await tab.ax.write();
```

**阶段二：最小成本探路（便宜观测 + 跑通单条样本）**

Codex 的运行策略明确要求：**每次操作后只取能回答下一个问题的最便宜观察**——需要元素定位真值时拿 AX 文本或 DOM 快照，需要视觉确认时才截 JPEG 图，默认绝不同时拉取两者。更重要的是，`tab.ax.write()` 默认只输出**相对上一帧的增量 Diff**（新增、删除、变化的节点），把单步观测的 Token 消耗压低了一个数量级。

模型先在 1–2 轮内跑通第一条配置的新建、填写和提交，顺手确认表单字段的稳定语义定位器（如 `getByLabel("规则名称")`、`getByRole("button", { name: "保存" })`）以及提交成功后的权威反馈信号（例如成功 Toast 或表格新增行）。

**阶段三：切入 Playwright 批量编程循环（Coding-First 爆发点）**

一旦验证过界面结构稳定且任务高度重复，Codex 就不再逐条调用 `tab.ax.write()` 回传给大模型审批，而是直接利用 REPL 的编程能力写一个完整循环，在单次工具调用里批量灌完剩余条目：

```js
// 3. 在单次 REPL 调用中用 Playwright 语义定位器批量处理剩余配置
const failedItems = [];
for (const item of pendingConfigs) {
  try {
    await tab.playwright.getByRole("button", { name: "新建配置" }).click();
    await tab.playwright.getByLabel("配置键").fill(item.key);
    await tab.playwright.getByLabel("配置值").fill(item.value);
    await tab.playwright.getByRole("button", { name: "确定" }).click();
    await tab.playwright.getByText("保存成功").waitFor({ timeout: 5000 });
  } catch (err) {
    failedItems.push({ key: item.key, error: err.message });
  }
}
// 把异常条目和最终状态一次汇总回模型，而不是每条都问一次大模型
console.log({ total: pendingConfigs.length, failed: failedItems });
await tab.ax.write();
```

这段代码的威力在于三件事同时发生：**Token 消耗从 $O(N)$ 坍缩到 $O(1)$**；**执行速度从“每条等 3–8 秒 LLM 推理”变成“本地毫秒级事件驱动”**；**失败条目能被 `try/catch` 精确收集并定点重试**，不会因为第 87 条偶发网络抖动就把整个任务跑死。

**阶段四：遇阻渐进降级（而不是原地死磕或盲切坐标）**

如果某个字段是前端自研组件（比如 Canvas 表格、没有标准 ARIA 标签的富文本编辑器或复杂 iframe），Codex 的动作指南明确禁止“没点动就无脑重试或立刻盲猜坐标”。它会先检查可见状态是否有遮罩/弹窗阻挡，再沿着 `Tab` 对象的六层接口逐级下沉。

**阶段五：交付验收与现场回收（Proof of Work & Turn Cleanup）**

写操作完成后，Codex 会截一张带上下文的图嵌入回复作为“工作证明（Proof of Work）”，并对结果页调用 `tab.markDeliverable()`（如果是卡在登录/验证码等需要人接手的页面，则调用 `tab.markHandoff()`）。当本轮对话结束触发 `turn_ended` 钩子时，所有未标记的临时查询标签页会自动关闭，被接管的用户标签页则自动释放控制权并保持原样打开。

### 2.3 六层统一 `Tab` 能力栈：Codex 比外界认知的更进一步

对比 Tabbit 文章里拆解的四层接口，2026 年 11 月的 Codex 插件实际上已经演化成了**六层渐进能力栈**，每一层都有清晰的分工和路由条件：

| 层级 | 接口入口 | 核心机制 | 适用场景与定位 |
| --- | --- | --- | --- |
| **L0 · WebMCP** | `tab.capabilities.get("webmcp")` | 读取网页主动声明的结构化工具（`fetchTools()` → `tools.call()`） | 站点已接入 WebMCP 时**最高优先**，彻底跳过 DOM 推测 |
| **L1 · AX 增量 Diff** | `tab.ax`（`write / click / setValue / scroll`） | 本地 WASM 计算无障碍树增量 Diff，按 `element_index` 批处理动作 | **短程与非重复任务首选**，Token 极省、自带动作后等待 |
| **L2 · Playwright API** | `tab.playwright`（`getByRole / locator / evaluate`） | 语义定位器、跨 iframe 定位、集合读取缓存（`CollectionReadCache`）、页面内 JS 求值 | **长程批量循环与 Web 开发测试核心**，稳定且复用训练先验 |
| **L3 · DOM-CUA** | `tab.dom_cua`（`get_visible_dom / click(node_id)`） | 提取精简可见交互 DOM，用 `node_id` 直接交互 | 介于 Playwright 与视觉之间的轻量中间层 |
| **L4 · 视觉坐标 CUA** | `tab.cua` + `tab.screenshot()` | 看 JPEG 截图，按 `(x, y)` 像素坐标点击、拖拽、滚动 | **兜底层**：专治 Canvas、飞书多维表格、Google Sheets 等无 DOM 控件 |
| **L5 · 原始 CDP** | `tab.capabilities.get("cdp")` | Origin 隔离的原始 `send()` 与游标分页 `readEvents()` | 最后一层硬核逃生舱：抓取网络/底层事件或特殊调试操作 |

这里有一个很值得玩味的细节：**L1（AX 增量 Diff）和 L2（Playwright）不是谁取代谁，而是按任务形态动态分流。** 根据插件内置的路由指引，Playwright 定位器写起来更长，只有在“需要跨多步复用稳定选择器、靠循环消掉多次 `tab.ax.write()` 往返”或“测试自己开发的已知结构站点”时才划算；而普通的一次性浏览、短链路点击，用带增量 Diff 的 `tab.ax` 反而更快更省。同时，针对高频高耗时的内容读取，Codex 还专门开了 `tab.content`（一键导出正文、Google 套件文档、YouTube 字幕）和 `pageAssets`（打包页面图片/PDF/SVG）这种快捷通道，避免 Agent 傻傻地一页一页往下滚。

### 2.4 真正拉开工程差距的：四层生产治理基座

很多开源 Demo 也能跑通“Playwright + 循环”，但一放到真实登录浏览器里就事故频发（2025—2026 年浏览器 Agent 的 Indirect Prompt Injection 已经出过多次公开漏洞）。Codex 这套插件里最值得工程团队抄作业的，其实是藏在 `docs/` 里的四块治理设计：

1. **四级风险确认策略（Confirmations）**：把浏览器副作用按风险硬分成四档——**① 强制人工接管**（修改密码、绕过 HTTPS 警告或付费墙）；**② 动作时必确认**（删云端或本地数据、支付/订阅、解 CAPTCHA、改权限、对外发消息、**向第三方表单输入敏感数据**——明确把“往表单里敲敏感信息”定义为对外传输）；**③ 支持首轮预授权**（登录、浏览器权限弹窗、上传文件、同云盘移动文件）；**④ 免确认**（Cookie 弹窗、普通下载）。同时强制区分“用户亲手敲的指令”和“网页/邮件/PDF 里的第三方内容”，后者永远不能自我授权。
2. **凭据不进上下文的 `browserAuth`**：遇到登录墙时，模型不直接看明文密码或 OTP，而是通过 `browserAuth` 提交字段选择器与页面 Origin，由运行时托管凭据句柄注入，并记录完整的提交诊断事件（包括 `origin_changed`、`iframe_origin`、`child_frame_origin` 等拒绝原因），专门防跨源隐藏 iframe 钓鱼。
3. **Origin 隔离的 CDP 与反爬遥测**：原始 CDP 权限被锁死在当前标签页的 Web Origin 内；遇到站点的反爬/CAPTCHA 死循环时，通过 `botDetection.report()` 上报标准化枚举原因（如 `captcha_failed`、`challenge_loop`、`purchase_blocked`），且只记录域名 `hostname` 不记录完整 URL。
4. **回合级状态清理**：前面提到的 `turn_ended` 钩子 + `markDeliverable()` / `markHandoff()`，让 Agent 不会把用户的 Chrome 搞成几十个废弃标签页的垃圾场。

---

## 3. 为什么 Coding-First 难以直接照搬到手机端：MobileUse 的三堵硬墙

看完 Codex 和 `browser-use 1.0` 在 Web 端的顺畅表现，很多人自然会问：**既然“持久 REPL + 代码直控”这么强，手机端 MobileUse 能不能也走 Coding-First？**

学术界确实已经验证过这条思路的潜力。2026 年的一组对比实验显示，直接让 Claude Code 在具备 CLI 通道的环境里跑 AndroidWorld，**零移动端专项后训练就能拿到 71.8 分**，而如果提供理想 CLI 通道（Oracle CLI），AndroidWorld 116 道题里有 103 道（88.8%）根本不需要看图点屏幕就能直接用命令行解完。另一项发表于 COLM 2026 的 ComponentBench 评测也表明，同一个模型（GPT-5 mini），拿到无障碍结构树时准确率高达 **83.1%**，退回到纯像素截图时直接跌到 **48.9%**；iOSWorld 加上可访问性树也能直接暴涨 26 个百分点。

也就是说，**只要手机端能给出结构化观测和可编程执行通道，Coding-First 同样吊打纯视觉点击。** 问题在于，到了真实消费级手机上，这条路正面撞上了三堵 Web 端几乎不存在的硬墙。

![为什么 Browser Use 能 Coding-First，而 MobileUse 撞上三堵结构性硬墙](/images/browser-use-coding-first-and-mobile-use/browser-vs-mobile-paradigm-gap.drawio.png)

*图 2：Browser Use 与 MobileUse 在运行时、观测保真度、系统权限与商业博弈四个维度的结构性差异。[可编辑源文件](/images/browser-use-coding-first-and-mobile-use/browser-vs-mobile-paradigm-gap.drawio)。*

### 第一堵墙：手机端没有统一的“DOM + JS + CDP”可编程运行时

整个 Web 互联网无论前端框架怎么卷，最终都得老老实实渲染进 Chromium/WebKit 的 HTML DOM 里，共享同一套 JavaScript 引擎和 CDP 协议。模型写一句 `getByRole('button')` 或 `evaluate()`，放之四海而皆准。

手机端完全不是这样。你打开一台手机，里面同时运行着 Android 原生 View / Jetpack Compose、iOS UIKit / SwiftUI、鸿蒙 ArkUI、Flutter 自绘引擎、React Native、Unity/Unreal 游戏画布、内嵌 WebView 和微信/支付宝小程序。**跨 App 之间不存在统一的脚本注入接口，也不存在能跨应用共享的“全局 DOM”。** 更现实的是，主流 App 为了包体、性能或反爬，经常省略控件 `content-desc` / `accessibilityIdentifier`，甚至直接自绘 Canvas，导致 Android View Hierarchy 残缺、层级错位、弹窗遮挡成为常态；一旦进入银行、支付或密码页，系统级的 `FLAG_SECURE` 标志位还会直接让截屏变成一片黑屏。

### 第二堵墙：操作系统沙盒把“跨 App 控制权”牢牢锁死

在电脑桌面端，用户自己装个 Chrome 扩展或者开一个本地调试端口，就能把任意第三方 Agent 接到自己的真实浏览器上，不需要微软或苹果点头。

但在手机操作系统上，**跨 App 读屏和注入点击事件属于最高危权限**。
- 在 **iOS** 上，苹果彻底封死了第三方 App 跨应用读取无障碍树或注入触控事件的路子——没有越狱或接电脑跑 WebDriverAgent（WDA），第三方 Agent 在消费级 iPhone 上根本碰不到其他 App 的界面。
- 在 **Android** 上，普通的 `AccessibilityService` 不仅配置繁琐、极易被系统杀后台，还被大量金融和社交 App 直接判定为高危外挂环境；真正好用的系统级事件注入（`INJECT_EVENTS`）和 Android 16 新推的跨应用工具调用权限（`android.permission.EXECUTE_APP_FUNCTIONS`），**全部限定为系统特权，只授予 OS 厂商认可的系统助手**。
- 此外，手机屏幕天然是单前台、小视口、重打断的。电脑浏览器可以在后台 Tab Group 里静默跑 200 次循环不抢你鼠标；手机端如果直接在主屏模拟点击，Agent 干活时你就只能干瞪眼看着手机自己乱跳，微信来条消息或弹个广告就可能把状态机撞翻。

### 第三堵墙：超级 App 的商业围墙与高敏权限冲突

Web 世界有二十多年开放链接和爬虫共存的传统，哪怕头部电商开始反制购物 Agent，大量 SaaS、企业后台和公开站点依然欢迎自动化。

移动互联网的商业根基则是**超级 App 孤岛**。微信、淘宝、美团、抖音、支付宝和各大银行的核心护城河是流量入口、信息流广告、推荐分发和交易链路。当一个外部手机 Agent 替用户绕过首页推荐、直接跨平台比价下单时，超级 App 看到的是两件绝不能容忍的事：**商业上被“管道化”截流，安全上与灰黑产群控外挂几乎无法区分。** 2026 年初国内媒体对 7 款手机智能体做过一次实测，结果很直观：想让 Agent 帮你在手机上“点一杯奶茶”，往往意味着要向它交出多达约 40% 的高敏系统权限（读屏、无障碍、模拟点击、通知、悬浮窗、定位等）。

这三堵墙决定了：**MobileUse 绝不可能只靠模型厂或开源框架单方面“卷出一个手机版 Playwright”就解决，它从第一天起就是 OS 厂商、手机 OEM、大模型厂和超级 App 四方博弈的系统工程。**

---

## 4. 2026 年手机端 MobileUse 全景：大厂适配动作与四大技术路线

从 2025 年底到 2026 年 11 月，全球手机与 OS 厂商在 MobileUse 上密集交卷，原本混沌的路线已经清晰分化成四股力量，并在 2026 年下半年开始向“协议为主、受控 GUI 兜底”合流。

![2026 年手机端 MobileUse 全景：四大技术路线、厂商进展与生态博弈](/images/browser-use-coding-first-and-mobile-use/mobile-use-oem-landscape-2026.drawio.png)

*图 3：2026 年手机端 MobileUse 四大路线、代表厂商动作与超级 App 博弈时间线。[可编辑源文件](/images/browser-use-coding-first-and-mobile-use/mobile-use-oem-landscape-2026.drawio)。*

### 4.1 Google（Android 16/17 + Gemini）与三星：确立「双轨制」行业模板

如果要选一份 2026 年对手机端 Agent 架构影响最大的官方蓝图，一定是 Google 在 2026 年 2 月 25 日发布的《The Intelligent OS: Making AI agents more helpful for Android apps》，以及随后在 Google I/O 2026、Android 17 和三星 Galaxy S26 / Pixel 10 上落地的**双轨制体系**：

- **轨道 A：AppFunctions（端侧 Android MCP）——结构化主干道**
  Android 16（API 36）起引入的 `AppFunctions` 被 Google 官方明确定义为“**Android 端的本地 MCP（on-device MCP server）**”。App 开发者只需在 Kotlin 代码里用 `@AppFunctionDeclaration(isDescribedByKDoc = true)` 标注业务函数，Jetpack 编译期就会生成 XML Schema 注册到 Android 系统索引里。
  与云端 MCP 不同，AppFunctions 完全在端侧调用，直接复用 App 本地已登录状态和数据，不需要额外维护云端服务。2026 年下半年 Google 还上线了 **Google Connected Console（Android MCP）** 自助发布流：App 打包 `.aab` 提交 Play 审核时，系统自动校验内嵌的 AppFunctions 工具清单，过审后即可在 Gemini 里用 `@AppName` 或自然语言直接调用（甚至配套发布了官方 Agent Skill 帮开发者扫描代码自动生成 Kotlin 适配代码）。在三星 Galaxy S26（One UI 8.5）上，用户直接对 Gemini 说“把三星相册里我家猫的照片找出来发给朋友”，就是走 AppFunctions 静默跨应用完成的。
  但注意权限收口：跨应用发现和执行其他 App 的函数必须持有系统特权 **`android.permission.EXECUTE_APP_FUNCTIONS`**，普通第三方 Agent 无法平权调用。
- **轨道 B：Intelligent UI Automation——OS 受控的后台 GUI 兜底**
  Google 很清楚，靠开发者改造 AppFunctions 覆盖全部存量 App 需要数年时间。因此在同一天，Google 宣布在 Galaxy S26 和部分 Pixel 10 上开放 **Intelligent UI Automation** 早期预览：针对美韩市场首批精选的外卖、商超和网约车应用（如 Uber、DoorDash），用户长按电源键即可把多步任务交给 Gemini，**由操作系统在后台隔离环境里跑 UI 自动化，用户通过通知或“Live View（实时视图）”随时围观并一键接管，付款等敏感动作前强制暂停确认**。

这套“**AppFunctions 走结构化高速路 + 系统级后台 UI Automation 兜底存量 App**”的组合，本质上就是 Mobile 版的“WebMCP + 后台 Tab 自动化”，也成了目前全球 OS 厂商最认可的终局参考架构。

### 4.2 Apple（iOS / Siri AI Developer Preview）：坚决守住「纯契约路线」

相比 Google 的双轨务实，苹果继续把隐私边界和生态控制权拉到最满。经历了 2025 年新版 Siri 的延期风波后，苹果在 2026 年正式推进 **Siri AI Developer Preview**，围绕 **App Intents** 框架补齐了一整套 Agent 化的工具协议：

- **从固定 Schema 升级到通用 `ToolIntent`**：开发者用 `@AppIntent(AppIntentTraits)` 宏把自定义业务动作暴露成 Siri 可直接调用的 Tool，支持跨应用数据流转（例如“把我在某球鞋 App 里收藏的鞋发给微信/短信里的伴侣”）。
- **引入 `App Skills` 编排复杂任务**：为了解决模型面对模糊领域请求时不知道怎么组合多个 Tool 的问题，苹果直接推出了官方的 **App Skills** 机制，让开发者用类似技能说明的方式指导 Siri AI 编排复杂多步动作，并新增 `GenerableEntity`（允许模型直接构造临时实体）与 `CardSnippet`（在 Siri 界面里用 App 自己的品牌卡片渲染结果）。
- **“屏幕上下文”绝不靠截屏硬读**：苹果文档里的原话非常明确——“屏幕上可见的内容是 App 的私有数据”。想让 Siri 理解“帮我把屏幕上这张照片发出去”，开发者必须通过 `UITableViewAppIntentsDataSource`、`UICollectionViewAppIntentsDataSource` 或视图绑定机制，主动把当前可见 UI 映射到 `AppEntity`。
- **补齐开发者评测工具链**：Xcode 同步上线了 **Siri Integration Advisor** 和 **`SiriEvaluations` 框架**，允许开发者像写自动化测试一样编写自然语言用例，持续回归验证 Siri 调用自家 App Intents 的准确率。

苹果的打法优缺点都很极端：一旦头部 App 适配完成，它的执行延迟、隐私合规度和可靠性都是天花板级别；但反过来，如果 App 不愿配合写 App Intents，Siri 就绝不越雷池半步——这也是 2026 年秋季 iOS 27 实测中，不少用户依然吐槽苹果跨应用 AI 覆盖面偏慢的根本原因。

### 4.3 华为（HarmonyOS 6 / 小艺 + HMAF）：从意图框架升级到「鸿蒙智能体框架」

国内厂商中，技术路线最接近苹果与 Google 协议化思路的是华为。因为华为掌控着 HarmonyOS NEXT / HarmonyOS 6 的完整底层内核与应用生态，它从一开始就主推 **Intents Kit（意图框架）**，并在 HDC 2025 与 HDC 2026 连续两年将体系升级为 **HarmonyOS Agent Framework（HMAF，鸿蒙智能体框架）**。

它的核心思路不是让小艺去当一个“看图点屏幕的外挂”，而是把系统底层重构为“**系统智慧大脑（小艺）+ 垂域应用智能体（App Agent / Skill）**”的协同网络：开发者在小艺开放平台把自身服务封装成标准化意图或 Skill（HDC 2026 进一步把门槛降到支持低代码/自然语言快速生成上架 Skill），由系统统一负责意图路由、跨应用调度和权限鉴权，同时把流量入口重新分配给接入生态的伙伴。

### 4.4 荣耀、小米、OPPO、vivo：从“演示纯 GUI 点咖啡”转向“抢系统调度权”

2024 年底荣耀 MagicOS 9.0 靠 YOYO 智能体“一句话点咖啡”出圈，vivo OriginOS 也较早展示过基于蓝心大模型的 PhoneGPT，一度把国产手机圈卷进了“谁的 AI 能帮人自动点外卖”的军备竞赛。但到了 2026 年，华米 OV 荣的打法已经明显务实和收敛：

- **荣耀（MagicOS 10 / 11 · YOYO Next）**：2026 年升级 YOYO Next，强化端云协同、意图直达与 MCP 生态接入；同时在 2026 年 4 月的 GUI Agent 权限边界争议中，荣耀迅速明确与外部侵入式 GUI 控制划清界限，强调系统内生安全与合规边界。
- **小米（澎湃 OS 4 · 超级小爱 2.0）**：2026 年 8 月发布澎湃 OS 4，主打超级小爱 2.0 与专家模式，差异化重点不只是手机内跨 App，而是把“人车家全生态”的跨设备任务调度打通（手机、车机、米家设备统一编排）。
- **OPPO（ColorOS · 超级小布）与 vivo（OriginOS · 蓝心小V）**：2025 年底至 2026 年 9 月的“AI OS 密集发布潮”里，OV 两家普遍采用“**一键问屏做强感知 + 高频刚需场景走合作 API/意图直达 + 有限场景做受控 GUI 执行**”的务实组合。OPPO AI 负责人早就在公开访谈里挑明：纯 GUI 模拟点击只是过渡态，终局一定是 OS 级 Agent 协议和隐私沙盒。

### 4.5 模型厂激进实验与开源生态：豆包手机撞墙，开发者侧率先突围

与手机大厂的克制相反，大模型厂商和开源社区把纯视觉 GUI 路线推到了极限，也最早摸到了现实边界：

- **豆包手机（字节 Seed 1.8 × 中兴/努比亚）**：2025 年 12 月，字节跳动携手中兴试水拥有操作系统级权限的豆包手机工程机，底层依托融入海量真实移动端操作轨迹训练的 Seed 1.8 模型。纯论屏幕点击精度，正如 Tabbit 内部实测所印证的，Seed 1.8 在移动端 GUI 点击基准上一度把通用大模型甩开一大截。但工程机一亮相就遭到微信、淘宝、支付宝及多家金融 App 的集中风控拦截（直接弹异常登录或拒绝服务）。尽管 2026 年 7 月包括苹果智能、豆包手机在内的七家厂商同批通过备案、9 月正式开售时主动踩刹车收缩激进操作，但截至 2026 年 10 月媒体实测，**微信、淘宝等超过 150 款主流 App 依然拒绝无授权手机智能体的模拟操作**。
- **开源端到端 GUI 栈**：豆包遭遇围攻后，智谱在 2025 年 12 月立刻开源了 **`Open-AutoGLM`**（`AutoGLM-Phone-9B`，截至 2026 年 11 月 GitHub 已达 26.6k 星），非常务实地同时支持 **Android（ADB + ADB Keyboard）、HarmonyOS NEXT（HDC + 原生输入）和 iOS（WDA）** 三端控制；同期字节开源的 **`UI-TARS-desktop`**（39.6k 星）、阿里 **`Mobile-Agent`**（9.4k 星）以及在 AndroidWorld 上通过多智能体任务分解率先刷到 100% 的 **`minitap/mobile-use`**（arXiv:2602.07787），共同构成了开源 Mobile GUI Agent 的主力工具箱。
- **开发与测试侧的 Coding-First 飞地**：在不受超级 App 风控掣肘的研发与测试场景里，反而长出了最接近 Codex 思路的项目——比如 **`mobile-mcp`**（10.7k 星）及其姊妹框架 **`mobilewright`**（明确定位为“Playwright for mobile”），优先读取原生无障碍树而非每次截图，探索跑通后直接把 Agent 会话固化成确定性的 `@mobilewright/test` 代码用例进 CI；字节开源的 **`Midscene.js`**（15.6k 星）则把视觉模型接入 JavaScript/YAML 自动化脚本，兼顾了 AutoGLM 等专用视觉小模型与工程可维护性。

### 主流厂商 MobileUse 适配进度横向对比（截至 2026 年 11 月）

| 厂商 / 平台 | 核心协议 / 机制 | 是否开放受控 GUI 兜底 | 跨应用调用权限归属 | 当前落地进度与最大瓶颈 |
| --- | --- | --- | --- | --- |
| **Google Android 16/17** | AppFunctions（端侧 MCP）+ Connected Console | 是（Intelligent UI Automation 后台实时视图） | 仅系统特权 `EXECUTE_APP_FUNCTIONS` | Galaxy S26 / Pixel 10 首批落地；Android MCP 进入 Beta，第三方 Agent 无法平权 |
| **Apple iOS 26/27** | App Intents + `ToolIntent` + `App Skills` | 否（严禁屏幕模拟，必须主动绑定实体） | 仅系统 Siri AI | 处于 Siri AI Developer Preview；确定性高但长尾 App 覆盖慢 |
| **华为 HarmonyOS 6** | Intents Kit + HMAF（鸿蒙智能体框架） | 极有限（主推原生智能体与 Skill 协同） | 系统小艺统一路由 | HDC 2025–2026 持续扩展小艺开放平台，强依赖鸿蒙原生生态合作 |
| **三星 Galaxy / One UI 8.5** | 深度集成 Android AppFunctions + Gemini | 是（与 Google 联合首发后台任务） | 系统级 Gemini / Bixby | S26 系列率先量产“Agentic AI Phone”体验 |
| **荣耀 / 小米 / OPPO / vivo** | 意图直达 + MCP/A2A 对接 + 有限 GUI | 部分高频白名单场景 | 各家自有系统助手（YOYO / 超级小爱等） | 全面转向与头部 App 谈判协议接入，避开无授权硬刚 |
| **字节豆包手机 / 开源 GUI** | 系统级 GUI 轨迹（Seed 1.8）或 ADB/HDC/WDA | 是（纯视觉 GUI 主导） | 合作机型系统权限 / 开发者调试权限 | 点击精度高但消费侧遭 150+ App 风控拦截；开源栈在 QA 与个人极客场景活跃 |

---

## 5. 绕不开的暗线：超级 App 博弈与「让路但不让权」

如果只盯着模型准确率和系统 API，很容易看不懂 2026 年手机端 MobileUse 的真实节奏。这一年真正决定产品生死的暗线，其实是**手机厂商、大模型厂与超级 App 之间的调度权博弈**。

整个博弈在不到一年里走了三步极具戏剧性的转折：

1. **2025 年 12 月：暴力破门触发全面封杀**。豆包手机工程机展示系统级权限跨 App 操作后，微信、淘宝、支付宝、多家商业银行迅速升级风控策略，通过检测无障碍/模拟注入标记、行为轨迹特征和系统签名，直接拦截非授权智能体操作。这一战彻底打碎了“只要模型看图点得准，就能接管手机上所有 App”的幻想。
2. **2026 年 6 月：微信「让路，但不让权」**。硬封堵挡不住用户的真实需求，头部超级 App 开始换打法。2026 年 6 月，微信传出与多家手机厂商合作推出 **A2A（Agent-to-Agent）助手**（支持合规语音发消息、发起视频通话），并同步内测**微信智能体直接调取小程序完成交易与服务**，美团、滴滴、携程进入首批内测名单。逻辑非常精明：门可以开，但必须按超级 App 定的接口和授权协议走——**交易链路、用户关系链和分润规则必须留在微信和小程序体内，绝不允许外部模型黑盒截屏代点。**
3. **2026 年 9–10 月：双轨定型，无授权灰区彻底收窄**。随着七家厂商过备案、Google Android MCP 和华为 HMAF 铺开、国产 OEM 秋季集中发布新一代 AI OS，行业博弈迅速明朗：**拿了官方协议或合作白名单的系统级助手，体验越来越稳；试图绕过 App 同意、纯靠视觉硬点 150+ 主流商业 App 的激进路线，在 C 端几乎处处碰壁。**

---

## 6. 截至 2026 年底，MobileUse 沉淀出的六项行业共识与三个未解难题

把过去一年半的学术论文（AndroidWorld / MobileWorld / AndroidLens / iOSWorld / MobileWorldSafety）、大厂工程发布和商业博弈放在一起复盘，行业在 MobileUse 上已经沉淀出六项非常扎实的通识：

### 六项行业共识

1. **纯视觉 GUI 永远不是消费级 MobileUse 的终局，但短期内仍是不可替代的兜底**。
   端侧结构化协议（Android AppFunctions、iOS App Intents、HarmonyOS HMAF、WebMCP）决定了体验的上限——快、准、省 Token、合规；受控 UI 自动化决定了覆盖的下限——帮长尾和未改造 App 零代码接入。Google 的“双轨制”已经把这件事定调了。
2. **“看图点屏幕”的静态基准已经饱和，长程状态追踪与容错才是真正分水岭**。
   榜单代际更替极快：初代 AITW/AndroidLab 早已过时，二代 AndroidWorld 甚至已被多智能体方案刷到 97%–100%；但一换到需要 26 步以上长程操作、跨应用状态耦合的 **AndroidLens**，SOTA 准确率瞬间跌回 **12.7%**，跨应用 **iOSWorld** 也仅在 37%–52% 区间。正如 Tabbit 在评估端侧小模型 Jev 时看到的现象——**单步页面判断 95.2% 准确、延迟 0.76 秒，并不意味着长程 100 步任务能跑通**。
3. **没有结构化状态观测（AX / Intent / 系统状态），纯截图路线既有精度天花板，也有评估盲区**。
   无论是 ComponentBench 上“无障碍树 83.1% vs 纯像素 48.9%”的 34 分差距，还是 Interactive Reward Agent（arXiv:2607.25904）揭示的“被动截图裁判有超过 1/3 的成功轨迹漏判”，都指向同一个事实：**只看屏幕像素既看不全隐式状态，也验不准任务结果。**
4. **“后台隔离执行 + 实时透明围观 + 敏感节点强确认”是手机端不可妥协的 UX 底线**。
   手机不能像木偶一样在用户手里失控乱跳。Google 的后台虚拟屏 + Live View 接管、Codex 的四级确认与 `browserAuth` 凭据隔离，本质上解决的是同一个信任问题：用户必须能随时看清 Agent 在干什么、一秒夺回控制权，且所有涉及删数据、转账、发消息、传隐私的动作必须显式确认。
5. **移动端安全攻防已经进入“多步注入 + 技能投毒”深水区，光靠提示词防不住**。
   2026 年下半年集中爆发的一批安全研究把风险量化得很清楚：在真实 Android 环境下，环境提示注入（MobileWorldSafety）的攻击成功率高达 40%–67%，多步诱导（StepJack）能把成功率推到 72.9%，UGC 评论区注入（MIRAGE）甚至与视觉逼真度无关，更棘手的是 **SynChain** 展示的“把恶意指令埋进 Agent 自己沉淀的 Skill/Memory 里，在后续会话里作为可信上下文自动唤醒”。安全边界必须下沉到 OS 权限模型、沙盒和独立策略引擎，而不是指望大模型自己“自觉”。
6. **在手机上，“谁掌握 OS 特权与超级 App 合作协议，谁就掌握分发调度权”**。
   Web 端一个独立创业公司还能靠 Chrome 扩展或魔改 Chromium（如 Tabbit、Comet）分一杯羹；但在手机端，操作系统特权（`EXECUTE_APP_FUNCTIONS`、Siri AI、小艺路由）与微信/淘宝级 App 的白名单合作，把独立第三方 C 端 Mobile Agent 的生存空间压缩得非常窄。

### 三个仍未解决的行业难题

- **端侧算力与长程智力的剪刀差**：像 Seed 1.8、AutoGLM-Phone-9B、Jev 这类端侧/轻量模型点击快、接地准，但在开放复杂任务里的规划和纠错智力明显不够；把推理全搬上云端，延迟、流量、隐私合规和 Token 成本又扛不住。目前“端侧小模型执行 + 云端大模型规划”的协同架构在真实开放任务里依然存在路由失灵问题（Tabbit 实测 Jev+K3 协同几乎没减少大模型调用）。
- **跨生态标准碎片化**：Android 有 AppFunctions，Apple 有 App Intents + App Skills，华为有 Intents Kit + HMAF，微信推自己的 A2A 与小程序调用，Web 推 WebMCP。对一个要覆盖四端的 App 研发团队来说，维护四套语义契约、四套审核流程和四套评测集，边际成本不低。
- **跨应用复杂事务的责任归属**：如果系统 Agent 帮用户跨三个 App 比价下单，最后买错了尺码或误取消了机票，锅归 OS 厂商、模型提供方还是业务 App？在法务与赔付规则厘清前，大厂对高价值交易链路仍会长期保持保守。

---

## 7. 对 APP 自动化测试与 Mobile QA 的落地启发

看到这里，做 **APP 自动化测试与 Mobile QA** 的工程师反而应该感到兴奋：**C 端消费场景里把手机智能体卡得死死的三堵墙，在企业内部 QA 和研发测试环境里，恰好几乎都不存在。**

在自有 App 的测试机房、真机云和 CI 流水线里：
- 你天然拥有 **ADB / HDC / WDA** 调试权限、测试包体源码权限、Debug 符号与 Mock 网关；
- 你不需要跟自家 App 的风控打游击，反而可以主动在 Debug/QA 包里补齐 `accessibilityIdentifier`、`testTag`、DeepLink 和测试专用的状态探针；
- 因此，**Mobile QA 是整个移动端生态里，最先能够把 Codex 那套“Coding-First + 渐进降级 + 状态核验”完整落地并拿到确定性 ROI 的飞地。**

具体到工程落地，有五条可以直接照着改架构的建议：

### 1. 放弃“每次回归都让视觉大模型现场瞎点”，走「Agent 探索 → 代码固化」双阶段

Codex 往后台灌 200 条配置和 `mobile-mcp` → `mobilewright` 给出的其实是同一条黄金法则：**用 AI 做探索和脚本生成，用代码做高频确定性回归。**

- 在新需求提测或探索性测试阶段，允许 Agent 通过 `mobile-mcp` / ADB / HDC / WDA 结合无障碍树和截图自由探索页面，自动产出可执行的确定性脚本（Playwright / Mobilewright / Maestro / Appium）。
- 进入日常 CI/CD 回归时，直接跑固化下来的代码脚本，只在遇到弹窗突变、UI 微调导致选择器失效时，才局部唤醒视觉小模型（如 AutoGLM-Phone-9B 或 Midscene 视觉定位）做**受控自愈**——并且要严格监控自愈副作用（CUADebug 论文实测显示，单轮重跑修复中有 65% 的案例会顺手引入新错误，因此自愈改动必须走人工 PR 评审，不能静默覆盖基线用例）。

### 2. 复制 Codex 的“渐进观测栈”到移动端执行引擎

不要把手机自动化锁死在单一通道上，给自家测试执行器建立清晰的四级路由：

1. **L0 直达层（DeepLink / AppFunctions / 测试 Hook）**：登录态注入、造数、清理缓存、跳二级页面，能用 DeepLink、ADB broadcast、Mock API 或测试包内置接口一步到位的，绝不用 UI 点 10 步。
2. **L1 结构化层（UIAutomator / XCUITest / ArkUI 节点树 + 增量 Diff）**：参考 Codex 用 WASM 做 AX Tree Diff 的思路，在测试驱动层对 View Hierarchy 做裁剪与帧间 Diff，优先按 `resource-id` / `accessibilityIdentifier` / 文本语义定位，Token 省得多、执行也稳。
3. **L2 混合层（WebView CDP + 原生桥接）**：Hybrid App 里的 H5/小程序页面直接切到 WebView 调试协议（CDP），无缝复用 Playwright 语义定位。
4. **L3 视觉兜底层（截图 + 坐标 / 视觉模型）**：只在 Flutter 无语义节点、直播/游戏画布、复杂自定义图表或系统级权限弹窗失效时才降级启用，遇到 `FLAG_SECURE` 黑屏直接走测试包关闭安全标志或预设回调。

### 3. 把断言（Oracle）从“看最后一张截图”升级为“多通道只读状态核验”

纯靠 VLM 看终态截图判 Pass/Fail 已经被多篇 2026 年论文证伪（高漏判率 + 对环境系统类失败盲区极大）。Mobile QA 的断言应该把**“生成检查项”和“执行检查项”拆开**，优先读取只读确定性证据通道：

- **客户端状态**：`dumpsys activity/window`、SharedPreferences / plist、本地 SQLite、ContentProvider、View Hierarchy 关键节点属性；
- **运行时与网络证据**：时间窗口内的 `logcat` / iOS unified log、代理抓包/埋点上报、Crash/ANR 堆栈；
- **服务端真值**：直接调测试环境查询接口核对订单、评论或配置是否真实落库，只在样式错位、白屏、截断这类纯视觉问题上调用 VLM 裁判。

### 4. 用“成对观察轨迹”重构失败归因，别再只存一张报错终态图

大多数团队的自动化框架失败时只丢出一张红框报错截图，结果 47 条失败用例到底是一个环境弹窗引起的还是 5 个业务 Bug，全靠 QA 人工翻半天。借鉴 CUADebug 的配对追踪设计，每一条执行步骤都应落盘一份轻量结构化记录：

```text
step_record = {
  before_screenshot + compact_view_hierarchy,
  stated_intent,          // 这一步“打算干什么”（最常被漏掉，但最关键）
  executed_action + code, // 实际下发了什么定位器/坐标
  exec_status,            // 驱动层返回成功还是超时/元素不可见
  after_screenshot + diff_view_hierarchy,
  logcat_window           // 动作前后 2 秒内的关键日志/网络错误
}
```

把 `stated_intent` 和 `after_state` 配对之后，就能自动把失败分流给不同责任人：感知/控件缺失（开发补 `testTag`）、定位/手势漂移（框架调优）、业务编排/等待时机（用例问题）、系统弹窗/权限/超时/设备离线（环境治理），大幅压低人工排查成本。

### 5. 为团队 App 提前铺路“AI 友好度”测试基线

如果你们团队的产品本身面向 C 端，2026 年底还有一项全新的测试维度值得尽早纳入 QA 体系：**Agent 适配度与安全边界测试**。

- **正面可用性**：随着 Android AppFunctions、iOS App Intents（`SiriEvaluations`）和华为 HMAF 逐步放量，自家 App 暴露给系统助手的意图函数、参数校验、异常提示和 KDoc/Schema 描述，都需要像 OpenAPI 一样纳入持续自动化回归；
- **负面安全性**：自家 App 的 UGC 评论区、商品详情页和私信内容，是否会成为间接提示注入攻击载体？对外暴露的意图/小程序接口，是否正确校验了调用方身份与高敏动作二次确认？把这些用例放进安全测试基线，比等上线后被风控或安全研究员曝光从容得多。

---

## 总结

回顾 2025 到 2026 这两年，Browser Use 和 MobileUse 走出了两条截然不同、却在底层逻辑上彼此呼应的曲线：

- **Web 端（Browser Use）** 的答案已经非常清楚：当模型编程能力过线，**持久 REPL + 分层代码接口（WebMCP / AX Diff / Playwright / CDP）+ 视觉兜底 + 回合级安全治理** 彻底淘汰了逐帧猜坐标的仿生循环。
- **手机端（MobileUse）** 撞上了运行时碎片化、OS 强沙盒和超级 App 商业围墙三座大山，最终在 2026 年收敛为“**端侧结构化协议（AppFunctions / App Intents / HMAF / A2A）为主，系统受控后台 UI 自动化为兜底**”的双轨共识；消费级生态的调度权高度收口于 OS 与超级 App 之间的谈判。
- **而在 APP 自动化测试与 Mobile QA 领域**，由于天然具备调试权限与源码控制力，工程团队完全不必苦等消费级手机协议统一，现在就可以直接把 Codex 的 Coding-First、AX 增量 Diff、渐进降级、只读多通道断言和成对失败轨迹归因搬进自己的移动测试底座里。

真正苦涩的教训从来不是“旧架构没用”，而是**当你面对的环境底座变了、模型的能力边界变了，能不能第一时间放下手里磨了一年半的顺手锤子，按第一性原理重新选接口**。

---

## 参考资料

1. 潦草学者（Founder Park 转载），[《Tabbit 万字复盘：做了一年半 Browser Use，我们学到的苦涩教训》](https://mp.weixin.qq.com/s/6nHfcBLRSg7pGCrWXklZZw)，2026。
2. Richard S. Sutton，[《The Bitter Lesson》](http://www.incompleteideas.net/IncIdeas/BitterLesson.html)，2019。
3. Browser-Use，`browser-use 1.0: CDP is all you need` Release Notes（[GitHub Releases](https://github.com/browser-use/browser-use/releases/tag/1.0.0)），2026-11-10。
4. Chrome for Developers，[《WebMCP Early Preview Program》](https://developer.chrome.com/blog/webmcp-epp)，2026-02-10。
5. Android Developers Blog，[《The Intelligent OS: Making AI agents more helpful for Android apps》](https://android-developers.googleblog.com/2026/02/the-intelligent-os-making-ai-agents.html)，2026-02-25。
6. Android Developers Documentation，[《AppFunctions Overview》](https://developer.android.com/ai/appfunctions) 与 [《Create and manage Connected Apps with AppFunctions (Android MCP)》](https://developer.android.com/ai/appfunctions/create-manage-connected-apps)，2026。
7. Apple Developer Documentation，[《App Intents》](https://developer.apple.com/documentation/appintents)、[《Siri AI Developer Preview》](https://developer.apple.com/documentation/appintents/siri-ai-developer-preview) 与 [《Apple Intelligence and Siri AI》](https://developer.apple.com/documentation/appintents/apple-intelligence-and-siri-ai)，2026。
8. 开源 MobileUse 代表项目：[zai-org/Open-AutoGLM](https://github.com/zai-org/Open-AutoGLM)、[mobile-next/mobile-mcp](https://github.com/mobile-next/mobile-mcp)、[mobile-next/mobilewright](https://github.com/mobile-next/mobilewright)、[minitap-ai/mobile-use](https://github.com/minitap-ai/mobile-use)（arXiv:2602.07787）、[web-infra-dev/midscene](https://github.com/web-infra-dev/midscene)、[bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop)。
9. 移动端 GUI Agent 与评测/安全代表论文：Interactive Reward Agent（arXiv:2607.25904）、CUADebug（arXiv:2608.02643）、ComponentBench（arXiv:2608.18307）、MobileWorldSafety（arXiv:2608.17659）、StepJack（arXiv:2608.06477）、SynChain（arXiv:2608.06862）。
