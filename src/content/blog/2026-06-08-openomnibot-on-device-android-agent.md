---
title: "OpenOmniBot：把 Android 手机做成端侧 Agent 运行时"
description: "拆解 omnimind-ai/OpenOmniBot：它不是普通 AI 聊天 App，而是把 Android 无障碍、VLM、MCP、Alpine 工作区、Skill、记忆和 OmniFlow Function 接到同一个端侧 Agent 闭环里。"
date: "2026-06-08"
tags: ["OpenOmniBot", "AI Agent", "Android", "VLM", "MCP"]
draft: false
featured: false
readingTime: 18
---

[OpenOmniBot](https://github.com/omnimind-ai/OpenOmniBot) 最吸引我的地方，不是它在 Android 上接了一个聊天界面，而是它把手机本身包装成了一个 Agent 运行时。

它的核心思路可以概括为一句话：

**外层 Agent 负责理解目标、组织上下文、选择工具；真正需要操作手机时，把目标交给 VLM 内循环，由无障碍、截图、Shizuku、shell 和 OmniFlow Function 一起完成执行与反馈。**

本文基于 `omnimind-ai/OpenOmniBot` 的 `main@c4a70ab` 拆解。这个版本的远端 `main` 指针在写作时也指向同一 commit。

## 先看项目定位

OpenOmniBot 是一个 Android 原生 Kotlin + Flutter 的端侧 AI Agent。它不是单纯把模型 API 包一层 UI，而是在 App 内部组合了几类能力：

| 模块 | 作用 |
| --- | --- |
| `app` | Android 主宿主、Agent 编排、工具注册、MCP 服务、前台服务 |
| `ui` | Flutter 聊天界面、设置页、任务历史、WebChat Flutter Web 包 |
| `assists` | VLM 任务调度、状态机、页面观察、动作执行链 |
| `accessibility` | 无障碍服务、屏幕节点、手势、截图与窗口感知 |
| `baselib` | 存储、网络、模型配置、OCR、通用基础能力 |
| `omniintelligence` | 模型协议、任务状态、请求响应结构 |
| `uikit` | 原生浮层与 Android UI 能力 |
| `ReTerminal/core` | 内嵌终端体验 |
| `third_party/omniinfer` | 可选本地推理后端 |

构建上也能看出它的两条路线：`standard` flavor 关闭本地模型能力，`omniinfer` flavor 打开 `LOCAL_MODEL_FEATURE_ENABLED`，并额外引入 `:omniinfer-server`。同时，`app/build.gradle.kts` 会把 `ui/lib/web_main.dart` 构建成 Flutter Web 包，再同步进 Android assets，供内置 WebChat 服务托管。

## 端侧运行时总览

![OpenOmniBot 端侧运行时总览](/images/openomnibot/openomnibot-overview.svg)

这张图里最重要的是三层：

1. **入口层**：用户可以通过 Flutter App UI、半屏浮层、WebChat 或 MCP 接入。
2. **Agent 编排层**：`OmniAgentExecutor` 每轮拼上下文，`AgentOrchestrator` 负责模型流式响应和工具调用循环。
3. **设备底座**：所有工具最终落到共享工作区、Android 无障碍、截图、Shizuku、shell、Ktor 服务和 OmniFlow RunLog。

所以它不是“UI 调模型，模型直接点手机”。中间有一套很清楚的运行时：上下文、工具目录、并发策略、权限边界、任务状态和执行反馈都被显式建模了。

## 一条用户消息进来发生什么

入口在 `OmniAgentExecutor.processUserMessage`。这一步并不急着把用户消息扔给模型，而是先装配一次完整运行环境：

```kotlin
val workspaceManager = AgentWorkspaceManager(context)
val memoryService = WorkspaceMemoryService(context, workspaceManager)
val discoveredServers = RemoteMcpDiscoveryRegistry.discoverEnabledServers()
val toolRegistry = AgentToolRegistry(...)
```

这几行很能说明 OpenOmniBot 的设计倾向：每轮对话都是一个“带工作区的任务运行”，不是一段孤立聊天。

它会依次准备这些东西：

- `AgentWorkspaceManager`：把 App 内部目录映射成 shell 视角的 `/workspace`。
- `WorkspaceMemoryService`：加载 `SOUL.md`、`CHAT.md`、长期记忆、当天短期记忆。
- `OobFunctionSkillProfile`：根据目标和当前包名召回 OmniFlow Function 候选。
- `MemoryRetrievalPipeline`：从长期记忆索引里预取相关片段。
- `SkillIndexService` / `SkillLoader`：根据触发条件加载最多两个相关 Skill。
- `RemoteMcpDiscoveryRegistry`：发现已启用的远端 MCP server，并把它们的 tools 加进本轮工具目录。
- `AgentToolRegistry`：合成本轮可见工具，交给模型。

System Prompt 也很直接：模型被告知自己在 Alpine 工作环境里，同时可以通过工具操作用户手机；`/workspace` 与 Android App 内部工作区共享；`terminal_execute` 是一次性终端工具；`vlm_task` 只用于当前手机屏幕上的点击、滑动、输入、打开 App 和跨 App 流程。

这里有一个关键边界：**用户上传的图片不是当前手机屏幕，不应该用 `vlm_task` 识别。** 这条规则写进了系统提示，也写进了 VLM handler 的防误触逻辑。

## 工具目录是运行时合成的

很多 Agent 项目的工具表是固定的。OpenOmniBot 更像一个动态工具目录：每轮根据权限、模式、MCP 发现结果、OOB Function 策略和会话模式合成。

`AgentToolRegistry` 的来源大概有六类：

- 内置静态工具：`vlm_task`、`terminal_execute`、文件工具、browser、web search、系统工具等。
- Shizuku 授权后的高权限工具：例如 `android_privileged_action` 和 session 系列工具。
- 记忆工具：`memory_search`、`memory_write_daily`、`memory_upsert_longterm`、`memory_rollup_day`、`memory_load`。
- Skill 工具：`skills_list`、`skills_read`、`skills_read_reference`。
- 远端 MCP 工具：运行时从启用的 MCP server 发现并转换成模型可见工具。
- OmniFlow Function 工具：管理、查看、执行已沉淀的手机工作流片段。

合成后还会做两层约束：

1. 工具名必须匹配 `^[A-Za-z0-9_-]{1,64}$`，避免非法名称进入模型工具表。
2. 根据 `conversationMode` 和 `toolExposurePolicy` 过滤工具，Function 管理 profile 只保留指定工具集。

执行时由 `AgentToolRouter` 按 handler 顺序分发：VLM、图片选择、privileged、terminal、web search、browser、file、skills、OmniFlow action、system、memory、subagent、MCP fallback、OOB Function handler。

并发策略也不是“模型说 parallel 就全并发”。`AgentOrchestrator` 虽然把 `parallelToolCalls = true` 传给模型，但真正执行前会经过 `AgentToolConcurrencyPolicy.partitionToolCalls`。只有只读类工具会被放进并发批次，比如 `file_read`、`file_list`、`file_search`、`context_apps_query`、`memory_search`、`skills_list`、`skills_read`。终端、写文件、VLM、MCP、subagent、privileged 和 Function 默认都是 serial barrier。

这个设计很务实：读上下文可以并发，改变世界的动作必须有顺序。

## `vlm_task` 是手机操作内循环

![OpenOmniBot VLM 手机操作闭环](/images/openomnibot/openomnibot-vlm-loop.svg)

OpenOmniBot 对 VLM 的用法，和“给模型一张截图，让它输出坐标”差别很大。

外层 Agent 只调用一个 `vlm_task`，参数里有目标、目标包名、是否需要总结、最大步数、超时、是否禁用 OmniFlow recall 等。真正的手机操作发生在 `VlmToolCoordinator` 和 `VLMOperationService` 里。

每一步大致是这样：

1. 检查权限、锁屏和任务状态；必要时直接返回 `WAITING_INPUT`、`SCREEN_LOCKED`、`ERROR`。
2. 抓取当前页面：截图、无障碍 XML、前台包名、窗口信息。
3. 做上下文增强：页面 skill、可索引元素、UDEG page skill、OmniFlow Function recall。
4. 生成 VLM 请求，让模型输出原生 tool call。
5. 解析动作：`click`、`input_text`、`swipe`、`long_press`、`open_app`、`press_key`、`call_tool`、`finished`、`require_user_choice` 等。
6. 做 grounding 和 preflight：优先用 `element_index` / `scrollable_index`，坐标只是兜底。
7. 交给 `ActionExecutor` 和 `AndroidDeviceOperator` 执行。
8. 执行后再次 observe，把页面变化、诊断和 tool card event 写回。

最值得注意的是第 3 步和第 6 步。

第 3 步说明它不是裸跑 VLM。每个 step 都会把当前页面结构、可执行元素、页面 skill、Function recall 候选注入进去。OmniFlow Function 在这里不是外层 Agent 直接盲目 replay，而是在当前页面 fresh observe 后作为候选工作流出现。

第 6 步说明它不是坐标优先。`VLMToolDefinitions` 明确把 indexed page evidence 作为首选：点击、输入、长按优先填 `element_index`；滑动优先填 `scrollable_index + direction`；坐标是 0..1000 的兜底相对坐标，最终还会转成屏幕绝对像素。

这正是 GUI Agent 系统工程里最关键的部分：**视觉模型负责决策，但执行层尽量使用可解释、可校验的结构化目标。**

## 最后怎么真的操作 Android

VLM 输出动作后，并不是 Kotlin 代码里直接 `adb tap`。OpenOmniBot 走的是一条更分层的链路：

- `ActionExecutor` 把 `UIAction` 转成执行语义。
- `AndroidDeviceOperator` 先尝试无障碍 API，再按动作类型选择 Shizuku 或 shell fallback。
- `AccessibilityController` 绑定 `AssistsService.instance`，初始化点击、输入、截图等能力。
- `OmniAction` 负责 `ACTION_CLICK`、`ACTION_SET_TEXT`、`GestureDescription` 手势。
- `OmniCaptureAction` 抓前台 window/root，并过滤系统和自身 overlay。
- `OmniScreenshotAction` 按 Android 版本选择截图策略：Android 14+ 走窗口合成，Android 11-13 用 `takeScreenshot`，更低版本走 `ScreenCaptureManager`。

这个链路有一个好处：Agent 的动作语义和设备执行细节分开了。VLM 不需要知道每个 Android 版本截图 API 的差异，也不需要知道输入框是否能直接 `ACTION_SET_TEXT`。失败、重试、fallback 和诊断都在执行层消化。

## 手机同时也是 MCP / WebChat 服务端

OpenOmniBot 不只是“从手机上调用外部工具”，它也把手机暴露成一个受控服务端。

`McpServerManager` 用 Ktor CIO 启动内置 HTTP 服务，默认监听 `0.0.0.0:8899`。路由里有几类能力：

- `/mcp`：JSON-RPC，支持 `initialize`、`tools/list`、`tools/call`、`resources/list/read`、`prompts/list/get`。
- `/mcp/list_tools` / `/mcp/call_tool`：兼容式工具发现和调用。
- `/mcp/v1/task/vlm`：传统 VLM 任务入口。
- `/webchat/*`：WebChat 静态资源和 API，包括对话、消息、run、SSE events、工作区文件、浏览器镜像等。

安全边界也有明确实现：WebChat 和 MCP 都依赖 token 或 session；WebChat auth 会限制局域网地址；token 通过 AES-256-GCM 加密存储，派生材料来自 APK 签名摘要；比较 token 时使用时序安全比较。

所以这不是一个“随便开公网端口控制手机”的设计。它的默认假设是：同一局域网内，带 Bearer token 或 session 的客户端，才能把手机当成 MCP server 或 WebChat server 用。

## Alpine 工作区、记忆和 Skill

OpenOmniBot 的工作区设计也值得看。

`AgentWorkspaceManager` 把 App 内部目录组织成一个共享根，并在 shell 里暴露为 `/workspace`。默认会创建这些长期文件：

- `.omnibot/agent/SOUL.md`
- `.omnibot/agent/CHAT.md`
- `.omnibot/memory/MEMORY.md`

同时它还有 attachments、shared、offloads、browser、skills、memory、models 等子目录。Alpine 终端、文件工具、Agent 记忆、WebChat workspace file routes 看到的是同一个工作区，只是 Android 真实路径和 shell 映射路径不同。

`WorkspaceMemoryService` 把记忆分成三类：

- `SOUL.md`：身份、语气、行为边界。
- `MEMORY.md`：长期稳定偏好和长期约束。
- `short-memories/YY-MM-DD.md`：当天过程性记忆。

搜索时会从这些文件切 chunk，加载或刷新 `index/index.json`，有 embedding 时走语义 + 词法混合打分，没有 embedding 时退回词法打分。每天还可以 rollup，把当天短期记忆整理成候选长期记忆。

Skill 也放在工作区里。`AgentSkillRuntime` 会扫描 `SKILL.md`、references、scripts、assets、evals，并用 `SkillTriggerMatcher` 根据 id、名称、描述和短语打分，最多选两个匹配的 Skill。Apple/iOS-only 这类不兼容 Skill 会被过滤掉。

这套设计让我觉得它更像“手机上的 Codex-like workspace agent”，而不是传统 Android 助手。聊天只是入口，真正的状态在工作区里。

## OmniFlow Function：从成功路径沉淀可复用片段

OpenOmniBot 还有一条很有意思的复用线：OmniFlow Function。

一次手机任务成功后，RunLog 里会记录执行过的卡片和动作。`WorkspaceFunctionStore.distillFromRun` 会把成功路径镜像到 workspace，再由 `RunLogReusableFunctionCompiler` 编译成可复用 function spec，写到：

- `commands/{functionId}.json`
- `run_logs/*`

Function 不是“把整件事黑盒 replay 一遍”。它更像可组合的手机工作流片段，比如打开某个页面、搜索、填写表单、保存或发送内容。

外层 Agent 会通过 `OobFunctionSkillProfile.promptCandidateContext` 看到候选摘要。如果要看详情，用 `function_get`；如果要执行，用 `call_tool` 传 `function_id`。而在 VLM 内循环里，`OobVlmFunctionRecallProvider` 每步最多注入 3 个 Function 候选，并明确提示：执行后继续根据工具结果、历史上下文和下一次 fresh observe 判断任务是否完成。

这个点很重要。很多自动化系统一旦引入 replay，就容易和当前页面状态脱节。OpenOmniBot 的处理是：**Function 可以复用过去的成功动作，但每一步仍然要服从当前屏幕观察。**

## 边界与架构判断

我读完后的判断是：OpenOmniBot 真正有价值的地方，不是某个单点工具，而是它把几条容易割裂的链路接到了一起。

它有几个明显优点：

- **Agent 和设备执行分层清楚**：外层 Agent 负责目标和工具选择，VLM loop 负责手机操作，Android 执行层负责 API 差异和 fallback。
- **工具边界比较克制**：只读工具才并发，改变状态的工具默认串行。
- **工作区是统一状态中心**：文件、记忆、Skill、Function、终端和 WebChat 都围绕 `/workspace` 组织。
- **Function 复用没有脱离当前屏幕**：候选召回和执行都嵌在 fresh observe 的闭环里。
- **手机既是客户端也是服务端**：App UI、WebChat、MCP、MethodChannel 都能接入同一套运行时。

也有一些现实边界：

- VLM 手机操作依赖无障碍、截图权限、前台页面可读性、屏幕解锁和 App 状态。
- Shizuku / shell 类动作必须谨慎处理，高风险动作需要用户确认。
- 本地推理是 `omniinfer` edition 的可选能力，不应理解为所有模型都在端上跑。
- WebChat / MCP 默认适合同一局域网和 token 保护，不适合直接暴露公网。
- Function 是复用片段，不是完整规划器；它能省步骤，但不能替代外层 Agent 的判断。

如果把它放在 GUI Agent 的大趋势里看，OpenOmniBot 代表的是一种很工程化的方向：不要指望一个 VLM 直接把所有事情做完，而是把手机环境拆成可观察、可执行、可审计、可复用的运行时。

这也是我觉得它值得拆的原因。它不像论文 demo 那样只展示“能点”，而是在认真处理真实手机自动化里那些麻烦但绕不开的问题：权限、状态、失败、上下文、记忆、并发、服务端接入、工作区持久化和可复用流程。

## 源码索引

下面是本文主要参考的源码位置，链接固定到 `c4a70ab`：

- [README.zh-CN.md](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/README.zh-CN.md)
- [settings.gradle.kts](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/settings.gradle.kts)
- [app/build.gradle.kts](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/build.gradle.kts)
- [OmniAgentExecutor.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/runtime/OmniAgentExecutor.kt)
- [AgentOrchestrator.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/runtime/AgentOrchestrator.kt)
- [AgentToolRegistry.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/tool/AgentToolRegistry.kt)
- [AgentToolRouter.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/tool/AgentToolRouter.kt)
- [AgentToolConcurrencyPolicy.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/tool/AgentToolConcurrencyPolicy.kt)
- [VlmToolHandler.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/tool/handlers/VlmToolHandler.kt)
- [VlmToolCoordinator.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/vlm/VlmToolCoordinator.kt)
- [VLMOperationService.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/assists/src/main/java/cn/com/omnimind/assists/task/vlmserver/VLMOperationService.kt)
- [ActionExecutor.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/assists/src/main/java/cn/com/omnimind/assists/task/vlmserver/ActionExecutor.kt)
- [AndroidDeviceOperator.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/assists/src/main/java/cn/com/omnimind/assists/task/vlmserver/AndroidDeviceOperator.kt)
- [AccessibilityController.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/accessibility/src/main/java/cn/com/omnimind/accessibility/AccessibilityController.kt)
- [McpServerManager.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/mcp/McpServerManager.kt)
- [McpRoutes.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/mcp/McpRoutes.kt)
- [WebChatRoutes.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/mcp/WebChatRoutes.kt)
- [AgentWorkspaceManager.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/workspace/AgentWorkspaceManager.kt)
- [WorkspaceMemoryService.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/workspace/memory/WorkspaceMemoryService.kt)
- [AgentSkillRuntime.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/agent/skills/AgentSkillRuntime.kt)
- [OobFunctionSkillProfile.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/omniflow/OobFunctionSkillProfile.kt)
- [OobVlmFunctionRecallProvider.kt](https://github.com/omnimind-ai/OpenOmniBot/blob/c4a70ab7c97a4e7fc9b7e4ca45f4c5f5d2146e81/app/src/main/java/cn/com/omnimind/bot/vlm/OobVlmFunctionRecallProvider.kt)
