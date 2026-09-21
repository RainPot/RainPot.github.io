---
title: "ARTEMIS 执行链路拆解：Android Agent 为什么又快又准"
description: "从源码追踪 ARTEMIS 从 CLI、设备队列、Flash/Pro 分流，到 ScreenIndex、Safety Net、Action Burst、Execution Incident 和 Checker 的完整闭环。"
date: "2026-09-21"
tags: ["ARTEMIS", "Android Agent", "GUI Agent", "源码拆解", "Agent Runtime", "Benchmark"]
draft: false
featured: false
readingTime: 30
---

> 项目：[google/artemis](https://github.com/google/artemis)
> 分析版本：`main@371aa6d`，提交时间 `2026-09-11T19:59:21-07:00`
> 核心结论：**ARTEMIS 把“快”和“准”拆成了不同层次的问题：快来自减少热路径上的模型往返、传输和上下文成本；准来自新鲜屏幕证据、结构化目标定位、动作前校验、失败事件持久化和退出复核。**

很多 Android Agent 的介绍停在“模型看截图，然后点击”。这个抽象足够解释 demo，却解释不了真实设备上的两个问题：为什么一个 Agent 能连续执行几十步，以及为什么页面刚好发生位移时，它没有立刻点到错误的位置。

ARTEMIS 的答案不在某一个更大的视觉模型里，而在执行链路本身。它把设备调度、屏幕观察、目标定位、动作分发、历史压缩和结果验证拆成了互相约束的环节。下面不按目录介绍模块，而是跟着一次任务从入口走到收口，再回头解释每个环节如何减少延迟或降低误操作。

## 先把 README 里的 99%+ 说清楚

ARTEMIS 的 README 声称：它在 Google Research 的 AndroidWorld 上取得了 **99%+ completion rate**，覆盖 20 多个应用和 100 多个多步任务。[README 的 Benchmark 小节](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/README.md#benchmarks)同时展示了一张排行榜图片。

这个数字值得关注，但不能直接当作本文的实测结论。本文分析的代码快照里，AndroidWorld 相关内容主要出现在 README 和排行榜资源中，没有看到可独立运行的 AndroidWorld 任务集、跑分入口、原始轨迹或复现实验配置。因此，本文会把 99%+ 写成“项目方公开报告的结果”，把源码能够证明的执行机制单独拿出来分析。

这一区分很重要：源码可以证明 ARTEMIS 如何执行、如何拦截、如何记录和如何复核；它不能单凭一个仓库快照证明某次 benchmark 在当前环境中可以复现。

## 一次任务的总路径：先排队，再选择执行引擎

![ARTEMIS 从 CLI 到设备的任务入口与 Profile 分流](/images/artemis-execution/artemis-ingress-profile-flow.drawio.png)

从 CLI 开始，ARTEMIS 并不会马上把一个点击动作发给手机。默认入口会尝试连接统一 Daemon，把任务放入调度队列；只有 Daemon 不可用，或者显式使用 standalone 模式时，才回退到本地执行。[`run_command()` 的调度入口](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/interfaces/cli/commands/run.py#L348-L440)把这层边界写得很清楚：队列不是一个可选的 UI 包装，而是任务真正进入设备执行前的第一层控制面。

CLI 最终会把目标、设备 serial、profile、应用包名、录制和 Checker 配置装进 `TaskRequest`，再调用 SDK：

```python
task = agent.new_task(goal)
if profile:
    task.using_profile(profile)
await agent.run_task(request=task.build())
```

源码位置是 [`execute_task()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/interfaces/cli/commands/run.py#L40-L182)。这段代码本身很短，但它把所有命令行开关汇聚成一个统一的任务对象，后面的运行时不需要再理解 CLI 参数。

### 设备锁为什么放在环境初始化之前

`Agent._run_task()` 创建 `ArtemisContext` 后，会为设备建立 `DeviceExecutionLock`。任务只有拿到锁、排到队首，才会连接屏幕、解锁设备、安装应用、准备环境。源码在锁边界旁边明确说明：所有设备变更和 UI 初始化都必须发生在全局 FIFO 队列的队首之后。[`Agent._run_task()` 的锁与环境准备](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/sdk/agent.py#L581-L655)

这解决的不是模型问题，而是实验和执行的一致性问题。假设两个任务同时连接同一台手机：即使每个 Agent 都能正确识别按钮，第二个任务看到的页面也可能已经被第一个任务改变。把锁放在“连接和初始化”之前，才能保证一个任务看到的屏幕、应用状态和 trace 属于同一个执行上下文。

### Profile 分流发生在真正执行之前

环境准备完成后，SDK 才根据 `request.profile` 分流：

```python
if request.profile and request.profile.lower() == "flash":
    runner = FlashRunner(context, goal=request.goal, max_turns=max_turns)
    flash_result = await runner.run(state)
else:
    async for chunk in (await get_graph(context)).astream(input=graph_input, ...):
        ...
```

这段分支来自 [`Agent._run_task()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/sdk/agent.py#L684-L752)。它揭示了 ARTEMIS 的一个关键设计：Flash 不是 Pro 的“少跑几步”，而是一条不同的运行时路径；Pro 也不是 Flash 的“多调用几个工具”，而是 LangGraph 中的多节点闭环。

## Flash：把每一步压缩成一个反应式热循环

![ARTEMIS Flash 与 Pro 的执行闭环对比](/images/artemis-execution/artemis-flash-pro-loop.drawio.png)

README 将 Flash 描述为单模型反应式循环，并给出约 3–5 秒/step 的项目标称值；Pro 则是约 15–40 秒/step 的多 Agent 图。这里的数字是 README 的项目说明，不是我在本机设备上重新跑出的基准。需要看的不是“快”这个结论，而是 Flash 到底删掉了哪些步骤，以及删掉之后为什么仍然能继续执行。

### FlashRunner 的每轮做了什么

`FlashRunner.run()` 的主循环可以还原成下面的顺序：

1. 初始化 LLM、动作工具、共享 transcript ledger 和可选的 step summarizer；
2. 通过统一观察接口取得当前截图和 UI 元素列表；
3. 读取本轮的注入指令，构造当前 observation tail；
4. 对旧上下文做增量压缩，然后调用模型；
5. 解析原生 tool call，必要时兼容 JSON code fence；
6. 按本轮开始时的元素列表解析索引目标；
7. 执行动作，捕获动作后的截图和 UI 列表；
8. 把动作记录写入 trace，并把下一帧作为下一轮观察。

对应的代码集中在 [`FlashRunner.run()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/flash/runner.py#L1035-L1174)。模型调用设置了 10 秒软超时和 180 秒硬超时，但正常任务不会因为每轮都要进入 Planner、Checker 或图状态同步而额外增加一层模型往返。[模型调用与动作处理](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/flash/runner.py#L760-L894)

### 为什么 Flash 不会把旧的 `[3]` 误用到新页面

Flash 的速度优化有一个容易被忽略的约束：**索引目标使用本轮观察的快照，不跟着前一个动作刷新后的列表漂移。**

`_process_tool_calls()` 在开始处理工具调用时先保存 `state.indexed_elements`。这一轮后续的 `click(3)`、`focus_and_input_text(3, ...)` 都解析到同一份快照；每个动作执行后，状态仍然会刷新成最新屏幕，供下一轮使用。这样做的原因很实际：一个模型回合里连续动作可能改变页面，若第二个索引立即改用新列表，模型刚刚看到的 `[3]` 就会失去语义。[`_process_tool_calls()` 的快照边界](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/flash/runner.py#L896-L975)

动作执行器还会把索引解析成归一化坐标，并记录目标文本、bounds、resource id 和 class：

```python
element = elements[index - 1]
return [_norm_x(center[0]), _norm_y(center[1])], recorded
```

这里的 `recorded` 不是装饰信息。它会进入后续 trace 和 Pro 的 Safety Net，成为“模型当时想点什么”的证据。动作执行器的索引解析、坐标归一化和记录字段见 [`McpActionExecutor._resolve_index()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/mcp/action_executor.py#L428-L483)。

### 动作之后为什么能快速拿到下一帧

`McpActionExecutor` 第一次使用动作工具时会创建一个进程内 `ActionSession`。同一个任务的后续动作复用这个 session，而不是每次动作重新创建 MCP client/server。动作成功或某些允许观察的失败发生后，执行器调用 `session.observe(settle_ms=400)`，把截图、UI 列表和元素索引一起更新。[动作执行与动作后观察](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/mcp/action_executor.py#L116-L251)

`ActionSession` 自己还把所有传输调用放到一个 owner task 中，保证 MCP context manager 的生命周期不跨任务漂移。[`ActionSession`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/mcp/action_session.py#L66-L178) 解决的是基础设施级的延迟和取消问题：动作调用不会因为上层协程超时就把底层会话半截取消，下一次可以继续复用或重建一个明确失效的 session。

### Action Burst：把“瞬时 UI”从模型时间里拿出来

Flash 支持 `click_sequence`，用于自动消失的控制条、Toast 或连续菜单。Pro 也支持多动作 burst，但两者都遵守同一个基本事实：连续动作之间不能等待下一次模型观察，否则瞬时 UI 可能已经消失。

`click_sequence` 接受已经归一化的坐标对，而不是元素索引。它要求调用方在同一轮里根据当前观察把坐标确定下来，执行器不会在 sequence 中途重新定位元素。[`_resolve_sequence()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/mcp/action_executor.py#L516-L547)

这是一项明确的取舍：burst 节省了模型往返和中间截图，但也放弃了每一步之间的安全校验。它适合一组必须连续发生的短动作，不适合把普通的长流程批量塞进一个回合。

## Pro：把执行过程变成可收敛的闭环

Pro 的图不是“Planner 做计划、Operator 执行动作”这么简单。当前源码中的节点和边是：

```text
START
  → planner
  → convergence
  → perception
  → operator
  → execution_check
       ├─ review_subgoals → convergence
       └─ execute_decisions → validator → summarizer → convergence
  → exit_settlement → END
```

完整图定义在 [`get_graph()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/graph/graph.py#L965-L1076)。它的重点不是节点多，而是每个节点承担一种不能互相替代的职责。

### Planner：把自然语言目标写成机器可收敛的计划

Planner 把计划写进 `task_plan` note，并用统一的 checkbox grammar 校验。计划至少要有一个顶层 subgoal；状态字符不能超出 grammar；如果模型忘了调用 `save_note` 或 `update_note` 提交计划，Planner 会把错误反馈回去，最多重新尝试三轮，每轮最多处理十次工具迭代。[Planner 的提交和格式校验](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/planner/planner.py#L222-L456)

当检查能力打开时，计划还可以声明 `verify` 和 `assert` 条件。这样“点击完成”与“目标满足”就不再是同一件事：前者是动作层事实，后者是验证层事实。

### Convergence：决定继续循环还是进入退出收口

`convergence_gate()` 每次都会重新读取计划，而不是相信上一个节点留在内存中的旧副本。它检查：

- 计划文件是否存在、是否有顶层 subgoal；
- 所有顶层 subgoal 是否完成；
- 是否仍有连续监控 `[Loop:continuous]`；
- 是否还有 pending checkpoint、已有 checker ledger 或开启了 final check；
- 是否因为 `assert` 失败而 latched halt。

即使所有顶层任务都标记完成，只要还需要 settlement 或 final review，也不会直接结束，而是进入 `exit_settlement`。[收敛判断](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/graph/graph.py#L889-L962)

### Perception 与 Operator：每一轮都重新观察

Pro 的 Operator 不直接使用上一轮的截图。Perception 节点先把当前截图、UI hierarchy 和 OCR 结果放进 state，Operator 再用这一帧构造 minimal element list，保存 `indexed_elements`，并把计划、历史和当前屏幕一起交给模型。[`OperatorNode.__call__()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/operator/operator.py#L863-L984)

Operator 的输出先不是“已经执行”，而是结构化动作决策。`execution_check` 会无条件把这一轮的观察、动作、思考和 subgoal hash 记录到 DataEngine，再决定这轮是只复核计划，还是把动作交给 Validator。[`execution_check_node()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/graph/graph.py#L125-L244)

这个顺序避免了一个常见错误：模型在上下文里说“我已经完成了”，系统就把它当成完成。ARTEMIS 先把模型的意图记录成证据，再让专门的执行层决定动作是否真的被设备接受。

## 目标定位：先用结构化证据，模型只处理剩余的不确定性

这是 ARTEMIS 速度和准确性同时成立的关键。

![ARTEMIS 目标定位、安全网与 Execution Incident 路径](/images/artemis-execution/artemis-target-safety-net.drawio.png)

### ScreenIndex 只建立一次，多个工具共享同一帧

Explorer 每次定位都会先加载当前屏幕：读取截图记录，确定屏幕尺寸，融合 UI hierarchy 与已有 OCR，然后构造一份内存中的 `ScreenIndex`。同一次 Explorer 调用里的结构化预检、文字搜索、坐标审计和视觉工具都使用这份快照，不需要每个工具再去查询 DataEngine。[Explorer 的屏幕加载](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/explorer/run_setup.py#L181-L202)

`ScreenIndex` 会丢弃不可见和零面积节点，按“归一化文本 + bounds”去重；同一个位置同时有 UI tree 和 OCR 文本时，优先保留 UI tree，因为它还带有 class、resource id 和交互属性。[`ScreenIndex.from_hierarchy()` 与去重](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/explorer/screen_index.py#L129-L210)

精确匹配会再次做重叠去重：

```python
hits = [e for e in self.elements if normalize_text(e.text) == wanted]
hits.sort(key=lambda e: (e.source != "xml", e.area))
```

如果查询文本在当前屏幕上只命中一个元素，结构化预检直接生成坐标和 bounds；如果命中零个或多个，就把这一部分留给后续模型消歧。相关实现见 [`exact_matches()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/explorer/screen_index.py#L223-L266) 和 [`_structural_prepass()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/explorer/explorer.py#L296-L329)。

因此，Explorer 的第一层不是“让模型看图找按钮”，而是“先问 UI tree：有没有一个唯一且足够明确的答案”。ARTEMIS 在代码中明确记录了这个快路径：

```python
if prepass and not unresolved:
    return json.dumps({"candidates": prepass, "fallback_message": ""})
```

这就是为什么简单、确定的目标可以少一次甚至零次模型调用。

### 不确定时才提升 Explorer tier

当前 Explorer tier 是调用方的配置，不是模型自己临时选择的：

| Tier | 行为 | 工具与回合上限 |
| --- | --- | --- |
| `flash` | 当前截图的一次视觉检测 | 1 回合，无 perception tool |
| `pro` | UI tree 搜索、坐标审计、视觉检测的短循环 | 最多 3 回合，`ask_perception_tool` |
| `ultra` | 加入 OCR、放大、像素级图像处理 | 最多 8 回合，开启更多工具和缓存 |

配置来自 [`tiers.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/explorer/tiers.py#L43-L110)。简单文本目标走结构化快路径，Canvas、Compose、Flutter 自绘控件或存在多个相似标签时，才需要更深的视觉推理。

即使模型返回了一个 label，ARTEMIS 也不会单独相信这个 label。`_enrich_candidates()` 会检查候选坐标是否落在注册元素的 bounds 内，并使用屏幕宽高的 2% 作为边界容差；不在元素范围内的点不能被自动补成一个可信的结构化目标。[候选边界校验](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/explorer/explorer.py#L266-L294)

## Safety Net：动作前先问“我现在还在点刚才那个东西吗？”

Explorer 解决的是“刚才看到什么”，Safety Net 解决的是“动作真正发出前，那个东西还在不在”。两者不是同一层。

### 单动作走 XML-first，再走 Pixel fallback

Validator 的执行循环把动作分成两类：

- 一个 turn-ending action：先执行 Safety Net，再做本地短重试；
- 两个或更多 action：进入 fast-action burst，连续分发，不做 Safety Net、不做中间截图、不做重试。

这个语义写在 [`execution_loop.py` 的模块说明](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/execution_loop.py#L15-L36)，不是根据日志推测出来的。

单动作的 Safety Net 先看动作里是否带有索引目标的 metadata。只要有文本、bounds 或 resource id，优先从 live UI hierarchy 中找候选；XML 检查失败或无法使用时，才拿新截图做像素级 fallback。[Safety Net 的分流](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/execution_loop.py#L76-L127)

XML 候选不是只比较坐标，而是综合多个信号：

- resource id 权重 `0.5`；
- text 相似度权重 `0.4`；
- bounds 重叠权重 `0.3`；
- 原始坐标是否落在元素内权重 `0.3`。

如果屏幕正在转场，XML 预检最多尝试三次，每次间隔 0.4 秒。重试逻辑见 [`validate_action_precondition()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/precondition_xml.py#L40-L93)，信号合成见 [`_combine_signals()`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/precondition_xml.py#L223-L330)。

Pixel fallback 会重新截图，只裁剪动作目标附近的区域交给视觉模型判断。如果模型判断目标存在，放行动作；如果判断目标消失且置信度至少为 0.7，则拦截；如果“目标不存在”的置信度低于 0.7，则绕过这次像素检查，避免低置信度的视觉误判把任务永远卡住。[像素级 Safety Net 的分支](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/precondition_pixel.py#L155-L260)

### Safety Net 保证的是目标身份，不是业务效果

通过预检后，普通动作最多本地重试两次，重试间隔 0.5 秒；`launch_app` 只尝试一次。代码特意没有在这里轮询“业务效果”：Validator 的成功只表示设备接受并分发了命令，不表示页面已经达到了用户目标。[本地执行重试](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/execution_loop.py#L130-L158)

这条边界看起来保守，实际上让职责更清楚：

- Safety Net 判断动作目标有没有漂移、被遮挡或消失；
- 动作执行器记录设备是否接受命令；
- 下一次观察、Operator 和 Checker 判断页面效果是否满足目标。

如果把这三件事混成一个 `success=true`，速度快的时候反而更容易产生假成功。

### Burst 为什么快，也为什么危险

当一个 turn 里有两个或更多动作时，Validator 将它们视为一个 burst：

1. 不做动作前 Safety Net；
2. 不在动作之间重新截图；
3. 每个动作只发送一次；
4. 第一处失败立即中止剩余动作；
5. 未执行的动作写成 `Skipped (burst aborted)`。

这正是它能处理自动消失控件的原因：动作之间没有新的模型回合，也没有安全校验的额外延迟。但它的适用边界也同样明确：burst 是一组必须连续发生的短动作，不是普通长流程的批处理。

## Execution Incident：失败不会被一条错误消息冲掉

如果 Safety Net 拦截动作，或者设备执行动作失败，Validator 不会启动一个新的 repair agent，也不会只把错误文本丢给模型。它会创建 `open_incident`，写入当前 state 和 step 的 execution report，内容包括：

- 失败种类：Safety Net 拦截还是设备执行错误；
- 分类：目标移动、目标被遮挡、目标消失等；
- 失败动作和动作在 burst 中的位置；
- 连续失败次数；
- 当前截图和目标位置等证据。

下一轮 Operator prompt 会重新渲染这个 incident；incident 保持打开，直到一个 terminal action 成功。成功后，下一轮会收到一条 CLOSED notice，要求 Operator 重新判断原始意图是已经满足、仍然待办，还是已经不需要。[Incident 数据结构](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/incidents.py#L15-L120)，以及 [Operator 的 incident prompt](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/operator/prompts.py#L493-L616)。

这里的恢复路径很明确：它不是另一个隐藏的 agent，而是下一轮正常 Operator 的输入条件。这样系统不会在失败后丢失“原本想做什么”，也不会因为自动 repair agent 的额外推理把故障路径变成不可解释的分支。

## Checker：在收尾处把“动作完成”与“目标完成”分开

Checker 是只读 verifier。它可以读取历史、note 和枚举的只读设备 probe，但不能调用设备动作、写 note 或创建子 Agent。[Checker 模块说明](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/checker/checker.py#L15-L30)

它有两个入口：

- `run_checkpoint_check()`：检查一个已经完成的 subgoal，使用完成时锚定的历史证据，不读取已经变化的 live screen；
- `run_final_check()`：任务退出时重新抓取最终屏幕，把原始目标、最终计划、历史 verdict ledger 和最终屏幕元素放在一起审计。

最终检查的输入包括最终截图、融合后的 UI 元素列表、历史摘要和 checkpoint ledger。[checkpoint 与 final check](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/checker/checker.py#L669-L859)

Checker 的 release 规则也不由模型自由决定：`verify` verdict 必须是 `passed` 或 `inconclusive` 才允许 release；`assert` 的失败不会被偷偷改写成通过，但不会直接改变这个 verify release 判定。这样模型可以给出证据和建议，真正的放行条件仍由节点代码计算。[release 判定函数](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/checker/checker.py#L79-L118)

工厂配置默认开启 final check，checkpoint check 默认关闭；也就是说，默认 Pro 路径至少会在退出时做一次针对原始目标的复核，而不是只看计划是否全部打勾。[默认 Agent 配置](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/resources/config/artemis.jsonc#L152-L185)

## 历史压缩：速度的另一半是控制上下文，而不是删掉证据

长任务的瓶颈经常不是动作本身，而是模型每一轮都重新携带几十张截图、完整 XML 和已经结束的工具消息。ARTEMIS 的做法不是简单截断历史，而是分层压缩。

当前默认配置给了一个很具体的形状：

| 层次 | 默认策略 | 作用 |
| --- | --- | --- |
| 当前上下文 | 80,000 token budget；在 35% 后准备压缩，70% 进入软压力，90% 是硬边界 | 控制 Operator prompt 的增长 |
| 图片边界 | 常态深度 3，放松时深度 6，摘要最多等待 3 步 | 旧截图替换成视觉摘要或证据占位符 |
| 文本边界 | `xml_scrub_depth=1` | 只有最新 observation 保留可索引 UI 列表 |
| L2 chunk | 最多 12 步，至少 3 步，目标源文本约 2000 token，最多 8 个 chunk | 把连续步骤折叠成可回忆的阶段 |
| 主动回忆 | `search_history` 最多 5 条；`replay_steps` 最多 5 步 / 12000 token | 需要时再取回细节 |

配置见 [`artemis.jsonc` 的 memory 段](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/resources/config/artemis.jsonc#L193-L264)。这些数字不是越小越好：太早替换截图会损失视觉证据，太晚压缩又会让模型每轮都背着历史前进。

### 压缩器为什么不会留下过期索引

`ScrubEdgeCompressor` 有两条边：文本边和图片边。文本边经过一个更新的 observation 后，就会从旧消息中移除 UI element list 和 per-turn ephemeral blocks；图片边到达深度后，再把截图原位替换成视觉摘要、失败占位或 DataEngine step 引用。

这样做有两个结果：

1. 历史仍然保留“这一步发生过什么”的可读摘要和证据引用；
2. 旧消息不会继续携带一个看起来像当前屏幕的 `[3]`，模型无法轻易把旧索引当成新目标。

Flash 的 `VisualStepSummarizer` 在动作记录完成后异步提交摘要任务，主循环不等待；源截图在摘要完成前保持不变，摘要失败则留下带 step 引用的占位符。[Flash 的异步摘要](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/flash/summarizer.py#L139-L257)，与 [增量压缩](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/flash/context_compressor.py#L65-L159)共同完成历史整理。

结果是：主路径不必等待摘要，历史也不会被粗暴清空。

## 为什么它能同时做到快和准

把整条链路压缩成一张表，会更容易看到工程取舍：

| 机制 | 它省掉了什么 | 它保护了什么 | 明确代价 |
| --- | --- | --- | --- |
| ScreenIndex 精确预检 | 简单目标的一次模型调用 | UI tree、bounds、resource id | 只适用于唯一且明确的当前帧目标 |
| Flash 单模型循环 | Planner、Graph、Checker 的多层往返 | 下一帧观察和 trace | 没有 Pro 的计划、安全网和最终复核 |
| ActionSession 复用 | 每个动作重新建 MCP 会话 | transport 生命周期和取消边界 | 会话失效时需要整体重建 |
| Action Burst | 瞬时 UI 中间的模型 RTT、截图和校验 | 连续动作的时间窗口 | 没有 Safety Net、重试和中间截图，首错即停 |
| Pro Safety Net | 错误目标的设备分发 | 目标身份、漂移和遮挡证据 | 每个单动作增加 UI/XML/像素判断 |
| Execution Incident | 失败后重新猜测原始意图 | 失败原因、类别、连续次数 | 恢复仍依赖下一轮 Operator 推理 |
| 异步历史压缩 | 长上下文重复携带图片和 XML | 摘要、step 引用、按需回放 | 摘要模型仍有后台成本 |
| Checker final review | 把“动作已发出”当“任务成功” | 原始目标与最终屏幕的独立复核 | 退出阶段增加只读检查时间 |

所以，“又快又准”不是同一条路径上的一个参数，而是两条路径加几层共享基础设施：

- 对简单、确定、瞬时的动作，走 Flash、结构化预检和 burst，把延迟压到热路径之外；
- 对动态、长程、需要诊断和验证的任务，走 Pro，把额外时间花在计划、Safety Net、incident 和 Checker 上；
- 两条路径共享动作协议、设备会话、观察结果、trace 和历史压缩，避免重复建设。

## 读源码时最容易误判的三件事

### 1. “模型找到坐标”不等于“目标已经被可靠定位”

模型坐标需要经过候选边界校验；索引目标会附带 UI tree metadata；Pro 单动作还会在发出前重新检查 live screen。真正的定位结果是“坐标 + 目标语义 + 当前证据”，而不是一个裸 `[x, y]`。

### 2. “动作返回 success”不等于“用户目标完成”

Flash 的动作执行器会在动作后观察，Pro 的 Validator 会记录 dispatch 结果，但 Validator 代码明确不做 effect polling。最终效果要靠下一次屏幕观察、Operator 的计划判断和 Checker 的 verify verdict。

### 3. “Action Burst”不等于“安全批处理”

Burst 故意跳过了 Safety Net、重试和中间截图，它买到的是瞬时 UI 的时间窗口。工程上应该只把必须连续的短动作放进 burst，并保留失败后由 incident 恢复的路径。

## 源码阅读路线

如果你想沿着真实执行路径继续读，建议按下面的顺序打开源码：

1. [`run.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/interfaces/cli/commands/run.py)：CLI 参数、Daemon 调度和本地回退；
2. [`sdk/agent.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/sdk/agent.py)：设备锁、环境准备和 Flash/Pro 分流；
3. [`graph/graph.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/graph/graph.py)：Pro 图、收敛和退出收口；
4. [`agents/flash/runner.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/flash/runner.py)：Flash 主循环和动作快照；
5. [`agents/explorer/screen_index.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/explorer/screen_index.py)：当前屏幕的结构化索引；
6. [`agents/explorer/explorer.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/explorer/explorer.py)：结构化预检与 Explorer tier；
7. [`agents/validator/execution_loop.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/execution_loop.py)：单动作、burst、失败中止和 incident；
8. [`agents/validator/precondition_xml.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/precondition_xml.py) 与 [`precondition_pixel.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/validator/precondition_pixel.py)：动作前校验；
9. [`agents/checker/checker.py`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/agents/checker/checker.py)：checkpoint 和 final review；
10. [`resources/config/artemis.jsonc`](https://github.com/google/artemis/blob/371aa6df56880643da57b30da936e9812fb0ec66/artemis/resources/config/artemis.jsonc)：默认 profile、Explorer、Checker 和 history 参数。

## 结尾：真正值得复用的是分层闭环

ARTEMIS 的执行速度，来自它知道哪些判断不应该交给模型：唯一文本匹配、坐标归一化、设备互斥、MCP 会话复用和历史增量压缩，都在模型之外完成。

ARTEMIS 的执行准确性，来自它也知道哪些事情不能只看模型的自信：动作前要看 live UI，漂移后要有像素 fallback，失败要保留 incident，长任务要有计划和收敛条件，退出时要回到原始目标做只读复核。

这套设计可以概括成一句话：**让确定性代码负责缩短路径，让模型负责处理不确定性，让验证层负责阻止“看起来完成”的假象。**

这也是阅读 Android Agent 源码时最应该追踪的主线：不要只问“模型用了什么”，而要问一次动作从哪里产生、经过几次新鲜观察、在哪个边界被拦截、失败后谁接住它，以及最终成功由哪一层定义。
