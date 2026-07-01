---
title: "AgentScope Java：从 ReActAgent 到生产级 Harness"
description: "基于 agentscope-ai/agentscope-java 最新 main commit，拆解 AgentScope Java 如何把 ReAct 循环、事件流、middleware、工具权限、workspace、sandbox、skill 和 subagent 组合成 Java 侧生产级 Agent 框架。"
date: "2026-07-01"
tags: ["AI Agent", "AgentScope", "Java", "源码拆解", "ReAct"]
draft: false
featured: false
readingTime: 20
---

AgentScope Java 的核心不只是一个 ReAct Agent。源码看下来，它更像一个分层的 Agent 运行框架：`agentscope-core` 负责消息、模型、事件流、ReAct 循环、工具和权限；`agentscope-harness` 在 core 之上补 workspace、filesystem、sandbox、skill、subagent、memory 和 plan mode；`agentscope-extensions` 再接模型供应商、RAG、协议、channel、scheduler 和 Spring Boot starter。

这也是它和很多轻量 agent loop 的差异。AgentScope Java 没把“生产级能力”硬塞进一个 while-loop，而是把 ReAct 执行链路做成事件流和 middleware，再由 Harness 在构建阶段把上下文、状态、工具和隔离能力装进去。

源码版本固定在 [agentscope-ai/agentscope-java](https://github.com/agentscope-ai/agentscope-java) `main` 分支 commit `156eaffbc9b7060038eb7093408ffcb4954754d5`，提交时间是 `2026-06-29 16:43:36 +0800`。仓库根 `pom.xml` 当前版本是 `2.0.0-SNAPSHOT`，Java 版本要求是 17。

我本地跑过两组 sanity check：

```bash
mvn -q -pl agentscope-core -Dtest=ReActAgentNewLoopReplyTest,ReActAgentMiddlewareIntegrationTest,ToolExecutorTest,PermissionEngineTest test
mvn -q -pl agentscope-harness -am -Dtest=SkillRuntimeTest,SkillLoadToolFrontmatterViewTest,DynamicSubagentsMiddlewareTest,SubagentIsolationIntegrationTest,WorkspaceContextMiddlewarePathBoundsTest,SandboxManagerIsolationTest test
```

两组命令都通过，只输出 Java 25、SLF4J、SQLite、Mockito、ByteBuddy 相关警告。

先贴一张官方总览图。官方文档里的这张图是产品视角：中间是智能体运行核心，外围是消息事件、模型接入、middleware、上下文管理、权限系统、workspace 和 agent service。后面我自己画的图会更偏源码调用关系。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AgentScope 2.0 官方运行核心总览图" src="/images/agentscope-java/official/as2-release-runtime-core.png" style="width: 960px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：AgentScope 2.0 runtime core modules，来自 AgentScope Java 官方文档。</p>
</div>

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AgentScope Java 分层架构" src="/images/agentscope-java/agentscope-java-architecture.drawio.png" style="width: 960px; max-width: none; margin: 0;" />
</div>

## 1. 项目分层：core 管执行语义，harness 管生产上下文

仓库根模块很直接：

```xml
<modules>
    <module>agentscope-core</module>
    <module>agentscope-harness</module>
    <module>agentscope-extensions</module>
    <module>agentscope-examples</module>
    <module>agentscope-dependencies-bom</module>
    <module>agentscope-distribution</module>
</modules>
```

几个模块的边界大致是：

```text
agentscope-core
  ReActAgent、Agent/Msg、Model、Toolkit/Tool、Middleware、Memory、Permission、Skill、RAG、Tracing。

agentscope-harness
  HarnessAgent、workspace、filesystem、sandbox、subagent、skill 管理、memory flush、compaction、MCP tools.json、plan mode。

agentscope-extensions
  模型 provider、RAG 实现、A2A/AGUI/chat completions 协议、channel、sandbox、scheduler、Spring Boot starter。
```

所以读源码时不要从 examples 一路追到底。更好的顺序是先看 `ReActAgent`，理解 core loop；再看 `Toolkit`、`ToolExecutor` 和 `PermissionEngine`，理解工具调用边界；最后看 `HarnessAgent.Builder.build()`，理解生产能力是怎么被装配进去的。

## 2. ReActAgent：call 和 streamEvents 复用同一条事件流

核心入口在：

```text
agentscope-core/src/main/java/io/agentscope/core/agent/ReActAgent.java
```

`ReActAgent` 的一个关键选择是：同步调用和流式调用不走两套逻辑。`callInternal()` 只是从统一事件流里取最终结果：

```java
return buildAgentStream(msgs, context, doCallFn)
        .filter(e -> e instanceof AgentResultEvent)
        .cast(AgentResultEvent.class)
        .map(AgentResultEvent::getResult)
        .takeLast(1)
        .next();
```

真正的执行入口是 `buildAgentStream()`。它负责发 `AgentStartEvent`，执行 `runLifecycle(...)`，最后发 `AgentEndEvent` 和 `AgentResultEvent`。外围还会套一层 `onAgent` middleware：

```java
return MiddlewareChain.build(
        middlewares,
        this,
        context,
        MiddlewareBase::onAgent,
        core).apply(input);
```

这个设计有两个好处。

第一，CLI、WebSocket、HTTP streaming 或测试代码都可以观察同一套 `AgentEvent`。工具调用、模型输出、确认请求、停止原因都不需要另起一套回调协议。

第二，middleware 的切点比较稳定。`MiddlewareBase` 暴露的主钩子只有几类：

```text
onAgent
onReasoning
onActing
onModelCall
onSystemPrompt
```

前四个是 onion-style 调用链，最后一个用于改写 system prompt。`MiddlewareChain` 从后往前包，列表里的第一个 middleware 在最外层：

```java
Function<I, Flux<AgentEvent>> chain = core;
for (int i = middlewares.size() - 1; i >= 0; i--) {
    MiddlewareBase mw = middlewares.get(i);
    Function<I, Flux<AgentEvent>> next = chain;
    chain = input -> method.apply(mw, agent, ctx, input, next);
}
```

这让后面的 Harness 能用 middleware 插入 workspace、sandbox、skill、subagent、plan mode 和 compaction，而不需要改 `ReActAgent` 主体。

官方 middleware 图也在强调同一件事：middleware 不接管主循环，而是挂在模型调用、思考规划和工具执行这些关键阶段旁边。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AgentScope 官方 Middleware 机制图" src="/images/agentscope-java/official/as2-release-middleware.png" style="width: 960px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：Middleware hooks into key execution stages，来自 AgentScope Java 官方文档。</p>
</div>

## 3. ReAct 主循环：reasoning 产出 tool_use，acting 处理权限和执行

AgentScope Java 的 ReAct 链路可以压成一句话：

```text
输入消息 -> system prompt -> model.stream -> 收集文本/思考/tool_use -> 权限判断 -> 工具执行 -> 写回 tool_result -> 下一轮 reasoning
```

完整链路如下：

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AgentScope Java ReAct 执行链路" src="/images/agentscope-java/agentscope-java-react-flow.drawio.png" style="width: 960px; max-width: none; margin: 0;" />
</div>

`reasoning()` 会先准备模型输入、system prompt 和当前激活工具的 schema：

```java
List<ToolSchema> tools =
        toolkit.getToolSchemas(state.getToolContext().getActivatedGroups());
```

之后通过 `onReasoning` 和 `onModelCall` 两层 middleware 调 `model.stream()`。流式输出里会累积几类 block：

```text
TextBlock       普通文本
ThinkingBlock   推理或思考过程
ToolUseBlock    模型要求调用工具
```

如果模型消息已经完成，循环结束。如果出现 `ToolUseBlock`，就进入 `acting()`。

`acting()` 的第一步是取 pending tool calls：

```java
List<ToolUseBlock> pendingToolCalls = extractPendingToolCalls();

if (pendingToolCalls.isEmpty()) {
    return executeIteration(iter + 1);
}
```

然后进入权限判断。遇到需要用户确认的工具调用，Agent 不会继续偷偷执行，而是发两个事件：

```java
new RequireUserConfirmEvent(replyId, pending)
new RequestStopEvent("permission asking", GenerateReason.PERMISSION_ASKING)
```

确认通过后，工具结果会被封装成 `ToolResultBlock` 写回 `AgentState`，下一轮 reasoning 就能看到这些 tool result。达到最大轮数时，流程会进入 summarizing，避免无限循环。

这里的关键点是：工具调用不是模型输出后的附属动作，而是 Agent 状态机的一部分。权限、事件、状态写回、下一轮模型输入都在同一个事件流里。

## 4. 工具系统：Toolkit 是门面，ToolExecutor 管执行细节

工具相关代码主要在：

```text
agentscope-core/src/main/java/io/agentscope/core/tool/
```

`Toolkit` 是门面，负责注册工具、工具组、schema 暴露、MCP client、meta tool 和执行器。具体工具继承 `ToolBase` 或通过 `ReflectiveFunctionTool` 从 `@Tool` 注解方法桥接进来。

`ToolBase` 上有几个生产环境很重要的属性：

```text
concurrencySafe   是否可以并发执行
readOnly          是否只读
externalTool      是否外部异步工具
stateInjected     是否需要注入状态
mcp               是否来自 MCP
```

`ToolExecutor` 才是真正把一次 tool call 落地的地方。它会查工具、检查 group 是否激活、校验 schema、合并 runtime context、合并 preset 参数，然后调用工具：

```java
AgentTool tool = toolRegistry.getTool(toolCall.getName());
String validationError =
        ToolValidator.validateInput(toolCall.getContent(), tool.getParameters());

return tool.callAsync(executionParam);
```

批量工具执行时，它不是简单全部并发。源码会按 `concurrencySafe` 分段：并发安全的工具合并执行，不安全的工具单独串行，同时保留输出顺序。

```java
if (isConcurrencySafe(toolCall)) {
    safeBatch.add(mono);
} else {
    if (!safeBatch.isEmpty()) {
        chunks.add(Flux.mergeSequential(safeBatch));
        safeBatch = new ArrayList<>();
    }
    chunks.add(mono.flux());
}
```

执行器还统一套调度、超时、重试和 shutdown guard：

```java
execution = applyScheduling(execution);
execution = applyTimeout(execution, executionConfig, toolCall);
execution = applyRetry(execution, executionConfig, toolCall);
execution = applyShutdownGuard(execution);
```

这部分代码解释了为什么工具系统没有停留在“反射调用 Java 方法”。Agent 框架真正难的地方不是把函数 schema 给模型，而是让工具在异步、并发、超时、外部挂起、权限拦截和关闭过程里都有明确语义。

## 5. 权限系统：deny、ask、tool-specific、allow 分层判断

权限判断在：

```text
agentscope-core/src/main/java/io/agentscope/core/permission/
```

`PermissionEngine` 的判断顺序是：

```text
deny rules
ask rules
tool-specific checks
allow rules
BYPASS fallback
default ASK / DONT_ASK
```

这比单纯的 allowlist 更细。比如文件编辑、shell 执行、MCP 工具和外部工具，可以根据运行模式、工具元信息和规则组合出不同策略。

官方权限系统图把这个判断压成了三种结果：允许、拒绝、确认。源码里的 `deny -> ask -> tool-specific -> allow -> fallback`，就是这张图背后更细的执行顺序。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AgentScope 官方权限系统图" src="/images/agentscope-java/official/as2-release-permission.png" style="width: 960px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：Permission system，来自 AgentScope Java 官方文档。</p>
</div>

有一个细节值得注意：tool-specific checks 放在 allow rules 前面。这意味着工具本身可以根据 `readOnly`、危险路径、当前模式等信息参与判断，而不是完全被外部规则覆盖。对于 coding agent 场景，这个顺序很关键，因为“允许某个工具”不等于“允许它以任何参数修改任何路径”。

## 6. HarnessAgent：不是另一个 Agent，而是生产能力装配器

`agentscope-harness` 的核心类是：

```text
agentscope-harness/src/main/java/io/agentscope/harness/agent/HarnessAgent.java
```

类注释里列出的能力包括：

```text
Workspace-based context loading
Pluggable file-system backend
Subagent orchestration
Skill loading
Memory flush + message offload
workspace-managed tools.json
Plan mode
Context-overflow emergency compaction
```

这说明 `HarnessAgent` 的定位不是重写 ReAct，而是 wrap `ReActAgent`。构建时它会先复制用户传入的 `Toolkit`，再解析 workspace、filesystem、sandbox、state store、message bus、async tool registry，最后把 middleware 和工具批量注册进去。

可以把 `HarnessAgent.Builder.build()` 理解成一张装配清单：

```text
1. 复制 Toolkit，避免污染外部实例
2. 校验 filesystem 配置：sandbox / remote / local 三选一
3. 解析 workspace，默认 .agentscope/workspace
4. 准备 stateStore，默认 ~/.agentscope/state/<agentId>
5. 需要 sandbox 时构建 SandboxBackedFilesystem 和 lifecycle middleware
6. 注入 WorkspaceContext、Memory、Compaction、Inbox、Subagents、PlanMode、Skill 等 middleware
7. 注册 filesystem、shell、memory、subagent、async、plan、skill 管理工具
8. 读取 workspace 里的 tools.json，注册 MCP server 和 allow/deny filter
9. inner.build() 得到真正的 ReActAgent delegate
```

所以 Harness 的复杂度主要在 build 阶段，不在运行阶段。运行时依然是 core 的事件流，只是这条事件流已经被各种 middleware 和工具扩展过。

## 7. Workspace、Filesystem、Sandbox：把文件和执行环境隔离出来

文件系统抽象在 harness 里很重，入口是 `AbstractFilesystem`。它统一了这些操作：

```text
ls / read / write / edit / grep / glob / upload / download / delete / move / exists
```

每个操作都接收 `RuntimeContext`。这意味着同一个 filesystem 实例可以按 session、user、sandbox 或其他上下文做隔离。

`OverlayFilesystem` 的语义很典型：上层可写，下层共享。读文件时先看 upper，再看 lower：

```java
if (upper.exists(runtimeContext, filePath)) {
    return upper.read(runtimeContext, filePath, offset, limit);
}
return lower.read(runtimeContext, filePath, offset, limit);
```

写入永远落到 upper：

```java
return upper.write(runtimeContext, filePath, content);
```

这套结构适合 agent workspace：基础资料可以共享，运行中产生的计划、记忆、临时文件、patch 则写入当前会话或当前用户的 workspace。

`FilesystemTool` 对模型暴露的是 `read_file`、`write_file`、`edit_file`、`grep_files`、`glob_files`、`list_files`。`ShellExecuteTool` 更谨慎，只在 filesystem 是 `AbstractSandboxFilesystem` 时注册，并且 `working_directory` 不能是绝对路径、`~` 或包含 `..`。

Sandbox 生命周期由 `SandboxLifecycleMiddleware` 接管。每次 agent call 前 acquire/start sandbox，把 sandbox 注入 filesystem proxy；结束时 persist/release/clear：

```java
SandboxAcquireResult result = sandboxManager.acquire(sandboxContext, ctx);
Sandbox sandbox = result.getSandbox();
sandbox.start();
filesystemProxy.setSandbox(sandbox);
```

释放阶段会持久化 sandbox state，必要时 stop 自管理 sandbox。cleanup 失败只记录日志，不覆盖 agent call 的结果。

这套设计的重点是：文件 API 和 shell 执行不是默认绑定本机目录，而是先过 workspace 和 sandbox 抽象。对于 Java 服务端场景，这比“给 Agent 一个本地路径”更容易做多租户和远程执行。

官方 workspace 图讲得更直观：Agent 的运行逻辑尽量不变，本地、容器、云沙箱这些执行环境通过 Workspace 抽象替换。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AgentScope 官方 Workspace 图" src="/images/agentscope-java/official/as2-release-workspace.png" style="width: 960px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：Workspace decouples agent logic from execution environment，来自 AgentScope Java 官方文档。</p>
</div>

## 8. Skill：system prompt 只给目录，正文按需加载

Skill 相关代码分两层。

core 里有 `DynamicSkillMiddleware`，负责在 `onSystemPrompt` 时合并 skill repositories，按运行上下文生成可见 skill，并注册 `load_skill_through_path`。

harness 里有更完整的 `HarnessSkillMiddleware`。它每次生成 system prompt 时会做这些事：

```text
merge repositories
visibility filter
marketplace staging
build SkillCatalog
runtime.install(catalog, agentToolkit)
render <available_skills>
```

`SkillRuntime` 的实现很克制：`load_skill_through_path` 只注册一次，后续只是更新 `AtomicReference<SkillCatalog>`。

```java
catalogRef.set(catalog != null ? catalog : SkillCatalog.empty());
if (toolInstalled.compareAndSet(false, true)) {
    toolkit.registerAgentTool(loadTool);
}
```

也就是说，system prompt 不会塞满所有 skill 正文。模型先看到 `<available_skills>` 列表，需要时再调用 `load_skill_through_path` 读取 `SKILL.md` 或资源文件。

`SkillLoadTool` 对 `SKILL.md` 有特殊处理，会返回 frontmatter 加正文；其他资源按 in-memory resources、lazy resources 的顺序查找。这样既能减少上下文占用，又能保留 skill 的完整文档结构。

Harness 还提供 `SkillManageTool`，支持 `create`、`edit`、`patch`、`write_file`、`remove_file`、`delete` 等动作。默认 create 会写到 `skills/_drafts/<name>`，并经过 security scan；如果发现危险内容可以回滚。这说明 AgentScope Java 不只是“加载 skill”，还在尝试把 skill 的生成、暂存、审计和提升做成一套闭环。

## 9. Subagent：声明式子 Agent 加动态刷新

Subagent 的主线在 harness。

`HarnessAgentBuilderSupport` 会默认注册一个内置的 `general-purpose` subagent，同时合并三类来源：

```text
programmatic declarations
workspace subagents/*.md
custom factories
```

每个声明式 subagent 会解析自己的 prompt、model override、tools allowlist、workspace mode 和 skill allowlist，然后构建一个 child `HarnessAgent`。

子 agent 的 session id 不是简单复用父 agent。源码会按声明名、父 session 和 user 派生：

```java
StringBuilder sb = new StringBuilder(declName);
if (sid != null) sb.append('@').append(sid);
if (uid != null) sb.append('#').append(uid);
return sb.toString();
```

这能避免不同父会话或不同用户共用子 agent 状态。

`DynamicSubagentsMiddleware` 还会在 reasoning 前动态刷新 subagent 配置。它支持两层加载：

```text
Layer 2: local workspace subagents/
Layer 1: filesystem namespace override
```

同名时动态声明覆盖静态声明。刷新后，它会更新 `DefaultAgentManager`，并把可用 subagent 信息和 task summary 追加到 system message 前。

任务工具也做了作用域限制。`TaskTool` 暴露 `task_output`、`task_cancel`、`task_list`，全部 scoped to current parent session id。已经完成并投递过的 terminal task 会被标记 delivered，避免下一轮重复推送。

这部分的设计取舍很明确：subagent 是可声明、可刷新、可隔离的运行单元，而不是一次普通工具调用的别名。

## 10. 设计取舍：把 Agent 做成可运行系统，而不是 demo loop

看完整体结构后，AgentScope Java 的几个取舍比较清楚。

第一，事件流优先。`call()` 只是消费最终 `AgentResultEvent`，真实运行链路始终是 `Flux<AgentEvent>`。这让流式输出、工具事件、确认事件和运行结果天然一致。

第二，middleware 是主要扩展点。workspace、skill、subagent、memory、plan mode、sandbox lifecycle 都不需要改 ReAct 主循环，而是挂到 `onAgent`、`onReasoning`、`onActing`、`onModelCall`、`onSystemPrompt` 上。

第三，工具不是裸函数。`Toolkit`、`ToolBase`、`ToolExecutor` 和 `PermissionEngine` 一起处理 schema、并发、超时、重试、外部挂起、权限、MCP 和 shutdown。这里才是生产框架和 demo agent 的主要差距。

第四，Harness 把“运行环境”前置到 build 阶段。filesystem、sandbox、workspace、state store、message bus、async tool registry、MCP tools.json 都在 `build()` 里装配好，运行时只沿着 core 事件流前进。

第五，Skill 和 Subagent 都避免一次性塞满上下文。Skill 只渲染目录，正文按需加载；Subagent 动态刷新并做 session 隔离。这两点都服务于长任务场景。

## 11. 建议阅读顺序

如果只想快速理解这个仓库，可以按下面顺序读：

```text
1. agentscope-core/.../agent/ReActAgent.java
2. agentscope-core/.../middleware/MiddlewareBase.java
3. agentscope-core/.../middleware/MiddlewareChain.java
4. agentscope-core/.../tool/Toolkit.java
5. agentscope-core/.../tool/ToolExecutor.java
6. agentscope-core/.../permission/PermissionEngine.java
7. agentscope-harness/.../agent/HarnessAgent.java
8. agentscope-harness/.../filesystem/AbstractFilesystem.java
9. agentscope-harness/.../sandbox/SandboxLifecycleMiddleware.java
10. agentscope-harness/.../skill/HarnessSkillMiddleware.java
11. agentscope-harness/.../subagent/DynamicSubagentsMiddleware.java
```

读完这几条线，AgentScope Java 的主干就比较清楚了：core 定义 Agent 如何运行，harness 定义 Agent 在什么环境里运行，extensions 负责把外部模型、协议和基础设施接进来。

这个项目值得关注的点也在这里。它没有把 Java Agent 框架做成一个简单的 ChatModel + Tools 封装，而是把事件、权限、工具执行、workspace、sandbox、skill 和 subagent 全部放进同一套可组合的运行模型里。对于需要把 Agent 嵌进 Java 后端服务、企业系统或多租户执行环境的团队，这比单文件 agent loop 更接近真实工程问题。
