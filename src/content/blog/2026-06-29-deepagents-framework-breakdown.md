---
title: "Deep Agents 源码拆解：四个模块背后的实现机制"
description: "按官方文档的 Execution environment、Context management、Delegation、Steering 四个模块拆解 langchain-ai/deepagents 的源码实现：middleware、backend protocol、虚拟文件系统、上下文压缩、subagent、HITL 与 LangGraph runtime 如何拼起来。"
date: "2026-06-29"
tags: ["AI Agent", "LangChain", "LangGraph", "Agent Harness", "源码拆解"]
draft: false
featured: true
readingTime: 18
---

Deep Agents 容易被名字带偏。源码看下来，它不是一个替代 LangGraph 的新 runtime，也不是把 LangChain 的 agent loop 重写了一遍。更准确的定位是：Deep Agents 在 LangChain `create_agent()` 和 LangGraph runtime 之上，加了一层 opinionated harness，把长任务 Agent 常用的执行环境、上下文管理、任务委派和人工介入默认装好。

这篇不讲“Deep Agents 是什么、怎么用”。我只按官方文档里的几个模块拆实现：

1. Execution environment：tools、virtual filesystem、optional sandbox、REPL / interpreter；
2. Context management：skills、memory、summarization、context offloading、prompt caching；
3. Delegation：subagent spawning、task planning；
4. Steering：human-in-the-loop approval、interrupts；
5. 最后看这些模块如何被 `create_deep_agent()` 拼进 LangChain / LangGraph 的运行链路。

源码版本固定在 `langchain-ai/deepagents` 仓库 `main` 分支 commit `5e01fec72d8b179a3b075b07268162d2eaebfe84`，`deepagents` SDK 版本 `0.6.12`。我本地跑过相关单测作为 sanity check：`tests/unit_tests/test_graph.py`、`tests/unit_tests/middleware/test_filesystem_middleware_init.py`、`tests/unit_tests/test_subagents.py`，结果是 `130 passed, 1 xfailed, 1 warning`。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="Deep Agents framework stack" src="/images/deepagents-framework/deepagents-stack.svg" style="width: 900px; max-width: none; margin: 0;" />
</div>

先把边界说清楚：

```text
LangGraph：runtime，负责 state、checkpoint、streaming、interrupt。
LangChain create_agent：agent loop，负责 model + tools + middleware。
Deep Agents：harness，负责选择默认 middleware、backend、subagent、memory、skills、profile。
```

这也是理解后面源码的主线。Deep Agents 大部分能力不是写在一个“智能循环”里，而是拆成 middleware 和 backend protocol，再交给 LangChain / LangGraph 去调度。

## 0. 装配入口：`create_deep_agent()` 不是执行器，而是组装器

核心入口在：

```text
libs/deepagents/deepagents/graph.py
```

`create_deep_agent()` 最后返回的是 LangChain `create_agent(...)` 构造出的图，并通过 `.with_config(...)` 设置 `recursion_limit=9999` 和一些 tracing metadata。也就是说，它真正做的是“装配”，不是自己写一个 while-loop 去驱动模型。

它的装配顺序大致如下：

1. 解析模型：字符串模型名会走 LangChain 的模型初始化路径；如果传入的是 chat model 实例，则直接使用。
2. 选择 harness profile：profile 可以覆盖 base prompt、tool description、excluded tools、extra middleware、默认 general-purpose subagent 等。
3. 准备 backend：默认是 `StateBackend()`，也可以换成 filesystem、store、local shell、sandbox 或 composite backend。
4. 处理 subagents：用户传入的 subagent 会被标准化；如果没禁用，还会自动补一个 `general-purpose` subagent。
5. 构建主 Agent middleware stack：`TodoListMiddleware`、`SkillsMiddleware`、`FilesystemMiddleware`、`SubAgentMiddleware`、`SummarizationMiddleware`、`PatchToolCallsMiddleware`、async subagent middleware、用户 middleware、profile middleware、prompt caching、memory、HITL。
6. 拼 system prompt：用户 prompt 在前，Deep Agents 的 base prompt 在后；如果传入 `SystemMessage`，会保留已有 content blocks 和 `cache_control` 标记。
7. 调用 LangChain `create_agent()`，把 tools、middleware、state schema、checkpointer、store、cache 全部交出去。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="create_deep_agent construction and runtime flow" src="/images/deepagents-framework/create-deep-agent-flow.svg" style="width: 960px; max-width: none; margin: 0;" />
</div>

这段入口代码的关键点不是“默认工具多”，而是它把所有能力都做成可替换的层：模型可以换，backend 可以换，middleware 可以增删，profile 可以调顺序，subagent 可以继承或覆盖主 Agent 的工具和权限。

## 1. Execution environment：把“可执行环境”抽象成 tools + backend protocol

官方文档里的 Execution environment 包括 tools、virtual filesystem、optional sandbox、REPL / interpreter。源码里它主要落在三层：

```text
libs/deepagents/deepagents/middleware/filesystem.py
libs/deepagents/deepagents/backends/protocol.py
libs/deepagents/deepagents/backends/*.py
```

### 1.1 Tools：模型看到的是工具，不直接看到 backend

`FilesystemMiddleware` 会创建一组 LangChain `StructuredTool`：

```text
ls
read_file
write_file
edit_file
delete
glob
grep
execute
```

这些工具函数内部做几件固定的事：

1. 从 `ToolRuntime` 里取当前 state / runtime；
2. 解析出本次调用应该使用哪个 backend；
3. 校验路径必须是绝对路径，拒绝 `..`、`~` 等不安全形式；
4. 检查 filesystem permission；
5. 调 backend 的 `read`、`write`、`ls`、`grep`、`execute` 等方法；
6. 把 backend result 格式化成 `ToolMessage` 返回给 agent loop。

以 `read_file` 为例，工具函数不会自己读磁盘。它只负责校验 `file_path`、检查权限，然后调用 `resolved_backend.read(validated_path, offset=..., limit=...)`。如果 backend 返回文本，它会补行号；如果返回 base64 或非文本文件，它会转成 multimodal content block；如果内容太长，还会按 token 粗略上限截断。

这层设计让 Deep Agents 的工具面保持稳定：模型永远调用 `read_file` / `write_file`，但背后可以是 state、真实文件系统、LangGraph store、LangSmith sandbox，或者一个 composite route。

### 1.2 Virtual filesystem：文件系统不是目录，而是 backend 协议

虚拟文件系统的核心不是某个目录，而是 `BackendProtocol`。协议在：

```text
libs/deepagents/deepagents/backends/protocol.py
```

它定义了一组文件操作返回结构，比如 `ReadResult`、`WriteResult`、`LsResult`、`GlobResult`、`GrepResult`、`FileUploadResponse`、`FileDownloadResponse`。同步方法旁边一般还有异步版本；默认异步实现很多是 `asyncio.to_thread(...)` 包一层同步调用。

几个内置 backend 的职责不一样：

- `StateBackend`：默认 backend，把文件存在 LangGraph state 里。它是 thread-scoped 的，适合让 agent 在一次会话里写 scratchpad、todo、临时报告。
- `FilesystemBackend`：把虚拟路径映射到宿主机某个 `root_dir`，直接读写真实文件。
- `StoreBackend`：接 LangGraph store，用于跨 thread 的持久化。
- `CompositeBackend`：按路径前缀把不同子树路由到不同 backend。
- `LocalShellBackend`：同时提供本地文件系统和 shell 执行能力。
- sandbox 相关 backend：实现更强的执行隔离，通常由 partner package 或 LangSmith sandbox 提供。

`CompositeBackend` 很值得看。它用 `_route_for_path(...)` 根据路径前缀找 backend，最长前缀优先；例如 `/artifacts/**` 可以走持久存储，`/workspace/**` 可以走 sandbox 文件系统，其他路径落到默认 backend。这解释了为什么 Deep Agents 的文件系统叫 virtual filesystem：它给模型一个统一的 POSIX-like 路径空间，但每个路径背后可以是不同存储。

### 1.3 Optional sandbox：`execute` 只在 backend 支持执行时可用

`execute` 工具不是无条件跑 shell。源码里它先判断当前 backend 是否支持 execution capability：

```text
SandboxBackendProtocol / supports_execution(...)
```

如果 backend 不支持，工具返回错误：这个 agent 的 backend 不支持 command execution，需要提供实现 `SandboxBackendProtocol` 的 backend。支持执行时，`execute` 会继续检查 timeout 参数，再调用 backend 的 `execute(...)` 或 `execute_with_offload(...)`。

这里有两个实现细节很工程化：

第一，`execute` 和文件系统走的是同一个 backend resolution 入口，所以执行环境和文件系统可以共享 workspace。命令输出如果太大，还可以被 offload 到 backend 的文件路径里，模型只拿到预览和路径。

第二，本地执行和 sandbox 执行没有被写死在 middleware 里。`LocalShellBackend` 是一个实现；LangSmith sandbox、Daytona、Modal、Runloop 等 partner backend 也是实现。Deep Agents 关心的是 protocol，不关心底下是 Docker、远端 VM、serverless 还是本机 shell。

### 1.4 REPL / interpreter：SDK 层是 `execute` 能力，产品层再做交互壳

官方文档里常把 REPL / interpreter 放在 execution environment 里。源码里要分清两层：

- `libs/deepagents` SDK 本身提供的是 `execute` 工具和 backend execution protocol；
- 交互式终端产品、slash command、Textual REPL 等主要在 `libs/code` 这一层，也就是 `deepagents-code`。

所以不要把 SDK 写成“内置了一个 Python REPL”。更准确的说法是：SDK 把“让模型执行命令 / 代码”的能力抽象成 `execute` 工具；具体解释器是什么，由 backend 和产品层决定。比如 local shell 可以执行宿主命令，sandbox backend 可以在隔离环境里执行，`deepagents-code` 再把它包装成交互式 coding agent。

## 2. Context management：不是简单截断，而是 prompt、state、backend 三处一起动

Context management 对应的源码主要在：

```text
libs/deepagents/deepagents/middleware/skills.py
libs/deepagents/deepagents/middleware/memory.py
libs/deepagents/deepagents/middleware/summarization.py
libs/deepagents/deepagents/middleware/_message_eviction.py
libs/deepagents/deepagents/graph.py
```

官方文档把 context 拆成 startup input、runtime context、compression、isolation、long-term memory。源码里可以对应到五个机制：skills、memory、summarization、context offloading、prompt caching。

### 2.1 Skills：用 progressive disclosure 控制 prompt 膨胀

`SkillsMiddleware` 做的不是把所有技能全文塞进 prompt。它先读取 skill source 里的 frontmatter / 描述，把“有哪些 skill、什么时候用”注入 system prompt；完整内容只有在模型触发相关 skill 工具时才加载。

这个机制解决的是 token 使用方式，而不是能力发现本身：

- always-on 的规则不适合放 skill，因为 skill 不一定会被加载；
- 长流程、领域知识、参考材料适合放 skill，因为可以按需展开；
- skill 可以带 references / assets 等附属文件，由 backend 读出。

从实现角度看，skills 不是一个外部插件系统，而是 middleware 注入 prompt + tools，再通过 backend 读取文件内容。这和文件系统 backend 复用得很紧。

### 2.2 Memory：always injected，并且故意排在 prompt caching 后面

`MemoryMiddleware` 处理的是 persistent context，比如 `AGENTS.md`。它和 skills 最大的区别是：memory 是 always injected，启动后每轮都会作为 system prompt 的一部分出现。

源码里 `MemoryMiddleware` 的重点有两个：

第一，它从 backend / sources 读取 memory 文本，拼到 system prompt。因为 memory 每轮都会注入，所以它适合放项目约定、用户偏好、长期规则，不适合放大段参考资料。

第二，它和 prompt caching 的顺序被专门处理过。`graph.py` 里先 `_append_prompt_caching_middleware(deepagent_middleware)`，然后才 append `MemoryMiddleware(add_cache_control=True)`。注释说明了原因：memory 更新会改变 system prompt，如果把它放在静态 prompt cache 前面，容易让 Anthropic 的 prompt cache prefix 失效。

`MemoryMiddleware` 本身也有 Anthropic 特化逻辑：当 `add_cache_control=True` 且 request model 是 `ChatAnthropic` 时，会给最后一个 system-message content block 加 `cache_control: {"type": "ephemeral"}`。这不是模型无关的通用缓存，而是 provider-specific 的 prompt cache breakpoint。

### 2.3 Summarization：通过 `wrap_model_call` 改 model request，不直接删 LangGraph state

`SummarizationMiddleware` 的实现比“超过长度就总结”更细。它的 hook 是 `wrap_model_call` / `awrap_model_call`，也就是在真正调用模型前拦截 request。

关键流程是：

1. 根据之前的 `_summarization_event` 构造 effective messages；
2. 计算当前 messages + system prompt + tools 的 token 数；
3. 如果配置了大参数截断，先截断旧 tool call args；
4. 判断是否需要 summarization；
5. 如果不需要，先用原消息调用模型；如果模型抛 `ContextOverflowError`，再 fallback 到 summarization；
6. 选择 cutoff，把旧消息分成 `messages_to_summarize` 和 `preserved_messages`；
7. 先把旧历史 offload 到 backend，再生成 summary；
8. 用 `summary_message + preserved_messages` 替换本次 model request；
9. 返回 `ExtendedModelResponse`，通过 `Command(update={"_summarization_event": ...})` 更新 middleware state。

最关键的一点：它“不直接修改 LangGraph state 里的完整 messages”。源码注释里明确说，旧的 `before_model` 风格会改 state；现在的实现是追踪 summarization event，并在 model request 层改 effective messages。这样可以保留更完整的 state，同时给模型一个压缩后的视图。

### 2.4 Context offloading：大历史和大工具结果写回 backend，prompt 里只留指针

Deep Agents 的 context offloading 有两条路径。

第一条在 `SummarizationMiddleware` 里：旧 conversation history 会写到类似下面的路径：

```text
/conversation_history/<thread_id>.md
/conversation_history/media/...
```

如果消息里有 inline media，会先上传到 backend，再把内联 data URL 替换成路径引用。这样 summary 和历史文件看到的是同一套 path references，而不是一边存原图、一边存 base64。

第二条在 filesystem / execute 工具附近：大 tool message 或大命令输出会被 `_message_eviction.py` 之类的逻辑写入 backend，例如 `/large_tool_results/...`，然后 tool message 里只留预览和文件路径。

这点对长任务 Agent 很重要。真实任务里最容易撑爆上下文的不是对话本身，而是 grep 结果、测试输出、日志、编译错误、网页正文、图片 base64。Deep Agents 的选择是：完整内容进 backend，prompt 留摘要和路径。

### 2.5 Prompt caching：不是自己实现缓存，而是插 provider middleware

Prompt caching 在 `graph.py` 中由 `_append_prompt_caching_middleware(...)` 负责：

```text
AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore")
BedrockPromptCachingMiddleware(...)  # 如果 langchain-aws 可用
```

也就是说 Deep Agents 不自己实现 prompt cache；它把 provider-specific middleware 插到 middleware stack 里。Anthropic middleware 对非 Anthropic 模型 no-op；Bedrock middleware 只有安装了 `langchain-aws` 才会创建。

这解释了为什么 `graph.py` 很在意 middleware 顺序：profile extra middleware、tool exclusion、prompt caching、memory、HITL 的位置不是随便排的。尤其 memory 放在 prompt caching 后面，是为了避免每次 memory 变动都破坏静态 prompt 前缀缓存。

## 3. Delegation：subagent 不是线程池，而是把另一个 LangChain agent 包成 `task` 工具

Delegation 对应的源码主要在：

```text
libs/deepagents/deepagents/middleware/subagents.py
libs/deepagents/deepagents/middleware/async_subagents.py
libs/deepagents/deepagents/graph.py
```

### 3.1 同步 subagent：`SubAgentMiddleware` 注入一个 `task` 工具

同步 subagent 的核心实现是 `SubAgentMiddleware`。它做两件事：

1. 生成一个 `task` 工具，让主 Agent 可以调用指定类型的 subagent；
2. 在 system prompt 里追加可用 subagent 的 name / description，让模型知道什么时候该委派。

`task(description, subagent_type, runtime)` 被调用时，源码会：

1. 校验 `subagent_type` 是否存在；
2. 从 `runtime.state` 拷贝父 Agent state；
3. 删除私有 state keys，避免把 middleware 内部字段泄漏给 subagent；
4. 把 subagent 的 `messages` 重置成单条 `HumanMessage(content=description)`；
5. 调 `subagent.invoke(subagent_state, subagent_config)`；
6. 从 subagent 结果里拿最后一个非空 `AIMessage`，包装成给主 Agent 的 `ToolMessage`；
7. 用 `Command(update=...)` 把允许共享的 state 更新回主 Agent。

这里最重要的设计是“上下文隔离”。主 Agent 不把完整对话塞给 subagent，而是给一段任务描述；subagent 自己跑多步工具调用，最后只把结果摘要回传。这样可以把大量中间搜索、文件读取、推理步骤留在子 Agent 的上下文里，主 Agent 的上下文不被污染。

### 3.2 subagent 的 middleware stack 会重新装配

`graph.py` 里处理 subagent 时，不是简单复用主 Agent 的 runnable。它会给每个 subagent 组装自己的 middleware：

- `TodoListMiddleware`
- `FilesystemMiddleware`
- `create_summarization_middleware(...)`
- `PatchToolCallsMiddleware`
- 可选 `SkillsMiddleware`
- profile extra middleware
- tool exclusion
- prompt caching
- 可选 `HumanInTheLoopMiddleware`

subagent 可以继承父 Agent 的工具，也可以声明自己的工具；可以继承父 Agent 的 interrupt policy，也可以自己覆盖。默认的 `general-purpose` subagent 也是这样生成的，只是由 profile 控制是否启用。

这比“在 prompt 里告诉模型可以分工”更实在。Deep Agents 真的编译了多个 agent runnable，并通过一个工具边界把它们接起来。

### 3.3 Task planning：主要靠 todo 工具和 prompt discipline，不是独立 planner

官方概览会把 task planning 作为 deep agents 的内置能力之一。源码里要小心，不要误写成有一个单独的 planner 模块。

当前 SDK 里，planning 主要来自三处：

1. `TodoListMiddleware` 提供 `write_todos`，让模型维护任务列表；
2. base prompt 和 subagent prompt 会引导模型先拆任务、再执行；
3. subagent delegation 让复杂任务可以被拆到独立上下文里完成。

也就是说，planning 更像 harness 层的“工具 + prompt 约束 + 子 Agent 隔离”，而不是一个确定性 planner 或搜索算法。这种实现方式很 LangChain：把规划行为暴露给模型，由工具和 middleware 约束它，而不是把规划写死在 runtime 里。

### 3.4 异步 subagent：通过 LangGraph SDK 管远端 run

`AsyncSubAgentMiddleware` 是另一套机制，主要面向部署在 LangGraph / LangSmith 上的远端 agent。它不是本地同步 invoke，而是注入一组工具，例如：

```text
create_async_task
check_async_task
update_async_task
cancel_async_task
list_async_tasks
```

它会通过 LangGraph SDK client 创建 thread / run，把 `task_id`、`thread_id`、`run_id`、状态、时间戳等写进主 Agent state 的 `async_tasks` 字段。后续工具再用这些 id 查询、更新或取消远端 run。

同步 subagent 适合“当前轮要等结果回来”；异步 subagent 更像把长期任务丢给远端 worker，主 Agent 之后再 poll 或 check。两者共用的是 delegation 思路，但执行模型不同。

## 4. Steering：Human-in-the-loop 不是工具里弹窗，而是把权限规则编译成 LangGraph interrupt

Steering 主要看两个文件：

```text
libs/deepagents/deepagents/middleware/_fs_interrupt.py
libs/deepagents/deepagents/graph.py
```

以及 LangChain 的：

```text
HumanInTheLoopMiddleware
```

### 4.1 Permission 有三种 mode：allow / deny / interrupt

文件权限规则的数据结构在 `filesystem.py`：

```text
FilesystemPermission:
  operations: ["read" | "write"]
  paths: ["/some/pattern/**"]
  mode: "allow" | "deny" | "interrupt"
```

`deny` 是工具执行前直接拦截。例如 `read_file` 会先 `_check_fs_permission(...)`，如果命中 deny，就返回 permission denied 的 `ToolMessage`。

`interrupt` 不在 filesystem tool 里直接处理。源码注释写得很清楚：`FilesystemMiddleware` 自己不懂 HITL；它只做 deny 规则和结果过滤。真正的 interrupt 由 `graph.py` 在装配时，把 permission rule 转成 `HumanInTheLoopMiddleware` 的 `interrupt_on` 配置。

### 4.2 `_fs_interrupt.py` 把路径规则编译成 `when` predicate

`_build_interrupt_on_from_permissions(...)` 会扫描所有 mode 为 `interrupt` 的 permission rule，然后为每个 filesystem tool 生成一条 `InterruptOnConfig`。

它不是粗暴地“这个工具一调用就暂停”。每个工具都有路径参数和 scope：

```text
ls:        read,  path,      bulk
read_file: read,  file_path, exact
write_file:write, file_path, exact
edit_file: write, file_path, exact
delete:    write, file_path, bulk
glob:      read,  path,      bulk, pattern
grep:      read,  path,      bulk
```

exact 工具只在目标路径命中 interrupt rule 时暂停。bulk 工具更麻烦，因为 `grep(path=None)` 或 `glob(pattern="/secrets/**")` 可能扫到一片子树。源码里专门用 `_glob_anchor(...)`、`_paths_overlap(...)` 判断搜索范围是否可能和敏感路径重叠；无法定位的 pathless bulk call 会保守触发 interrupt。

这就是 Deep Agents 的 HITL 细节：它不是简单按工具名审批，而是把虚拟文件系统权限规则转成 path-aware 的 tool-call predicate。

### 4.3 `HumanInTheLoopMiddleware` 负责真正的 pause / approve / edit / reject / respond

`graph.py` 里最终会做：

```text
main_interrupt_on = merge(filesystem interrupt rules, user interrupt_on)
if main_interrupt_on is not None:
    deepagent_middleware.append(HumanInTheLoopMiddleware(interrupt_on=main_interrupt_on))
```

subagent 和默认 general-purpose subagent 也会走类似逻辑。`_merge_fs_interrupt_on(...)` 会把 filesystem-derived interrupt 和用户显式传入的 `interrupt_on` 合并。

真正的暂停、恢复、批准、编辑、拒绝、直接响应，不由 Deep Agents 自己实现，而由 LangChain / LangGraph 的 HITL middleware 和 runtime interrupt 机制承担。Deep Agents 做的是把自己的权限模型编译成 `interrupt_on`。

允许的 decision 默认包括：

```text
approve
edit
reject
respond
```

这里有个安全边界：HITL 是人工审批机制，不是 sandbox。即便人工批准，工具执行前仍会再经过 deny permission check；如果是 `respond`，则可以跳过工具执行直接回给模型 / 用户。

### 4.4 Steering 还包括 profile 和 tool exclusion，但它们不是安全边界

除了 HITL，Deep Agents 还有一些 steering-like 机制：

- harness profile 可以修改 base system prompt、tool description、默认 subagent；
- `_ToolExclusionMiddleware` 可以隐藏 profile 排除的工具；
- `PatchToolCallsMiddleware` 会修补一些模型 tool call 形态；
- rubric middleware 可以给输出增加评估约束。

但这些主要是行为引导，不是强安全边界。真正涉及读写权限的地方，仍然要看 filesystem permission、backend 隔离和 HITL interrupt。

## 5. 四个模块如何落到运行时：middleware 是横切面，backend 是能力边界

把上面几块拼起来，可以看到 Deep Agents 的实现风格很一致：

```text
能力入口：LangChain tool
横切逻辑：AgentMiddleware hook
状态更新：LangGraph Command / state schema
长内容存储：BackendProtocol
人工暂停：HumanInTheLoopMiddleware + LangGraph interrupt
```

这比“写一个超级 Agent 类”更灵活。比如同一个 `read_file` 工具，在默认 `StateBackend` 下读 state；在 `FilesystemBackend` 下读本机目录；在 sandbox backend 下读隔离 workspace；在 `CompositeBackend` 下按路径路由。模型侧看到的工具名不变，环境能力由 backend 决定。

同样，context management 也没有塞进 agent loop。skills、memory、summarization、prompt caching 都是 middleware：

- skills 改 system prompt、加按需加载工具；
- memory 改 system prompt，并可加 Anthropic cache breakpoint；
- summarization 改 model request，并用 `ExtendedModelResponse` 回写 `_summarization_event`；
- prompt caching 插 provider-specific middleware；
- offloading 通过 backend 存完整内容，prompt 只留摘要 / 文件路径。

Delegation 也遵守这个模式：同步 subagent 被包装成 `task` 工具；异步 subagent 被包装成 task lifecycle tools；真正执行仍然是另一个 compiled agent 或远端 LangGraph run。

所以 Deep Agents 的核心不是某个算法，而是一组工程约定：

1. 模型只通过工具接触外部世界；
2. 工具不直接绑定基础设施，而是走 backend protocol；
3. 上下文膨胀不要只靠截断，要结合 summarization 和 offloading；
4. 子任务尽量隔离到 subagent，上下文只回传结果；
5. 高风险动作不要只靠 prompt，至少转成 interrupt / permission / backend 隔离。

## 6. 我会怎么借鉴它的实现

如果要自己做一个长任务 Agent 框架，Deep Agents 最值得抄的不是默认 prompt，而是这几个结构性选择。

第一，先定义 backend protocol，再做工具。很多 Agent 项目一开始就把工具写死成“读本机文件”“跑本机命令”，后面要迁移到 sandbox、远端执行、多租户环境就会很痛。Deep Agents 反过来：工具面稳定，backend 可替换。

第二，把上下文管理做成运行时机制，而不是写在提示词里。让模型“注意不要读太多文件”没什么用；真正有用的是大结果自动 offload、旧历史自动 summary、subagent 隔离上下文、memory 和 skills 分层注入。

第三，权限和人工审批要在 tool boundary 做。Deep Agents 的 `interrupt` 规则能转成 path-aware predicate，这比“危险时先问用户”这种 prompt 约束可靠得多。不过它仍然不是完整安全方案，最后还要依赖 sandbox / backend 隔离。

第四，task planning 不一定要做成复杂 planner。Deep Agents 目前更像用 todo 工具、prompt discipline 和 subagent delegation 让模型自己规划。这种方案不神秘，但可维护，也符合 LangChain middleware 的组合方式。

最后再强调一次边界：Deep Agents 不是一个新 runtime。它把 LangChain / LangGraph 已有的 model、tools、middleware、state、interrupt、store、checkpointer 组织成一套长任务 Agent harness。理解这一点，再看它的源码，就不会被“Deep Agent”这个名字带着走。真正有价值的地方，是它把 Agent 产品化里最麻烦的几件事放到了可替换的工程接口上。
