---
title: "Page Agent：页面内 GUIAgent 的 loop 是怎么实现的"
description: "基于 alibaba/page-agent 当前 main commit，拆解 PageAgent 怎样用 DOM 文本观察、单步 AgentOutput 和 PageController 动作执行，跑出一个页面内的 GUIAgent loop。"
date: "2026-07-07"
tags: ["GUI Agent", "PageAgent", "前端", "源码拆解", "Agent Loop"]
draft: false
featured: false
readingTime: 18
---

> 项目：[alibaba/page-agent](https://github.com/alibaba/page-agent)  
> 分析版本：`main@08624ec`，提交时间 `2026-07-06T09:34:56Z`，根包版本 `1.11.0`  
> 核心结论：**Page Agent 这套 GUIAgent loop 不是截图和坐标驱动。它把主循环放在网页里，每轮把当前 DOM 压成可读文本，让模型通过 `AgentOutput` 交出“反思 + 一个动作”，再由 `PageController` 把动作落成真实 DOM 操作。**

读 `page-agent`，不要先盯着“它能不能点按钮”。更关键的是：它把一次 agent loop 放到当前网页里完成，观察、决策和动作都尽量不离开页面上下文。README 里的定位也很直接：纯页面内 JavaScript、基于文本的 DOM 操作、可选 Chrome 扩展支持多页面任务。它更像嵌进现有 Web 应用里的操作层，而不是浏览器外部的自动化框架。

这个定位决定了它的实现路线。常见 GUI agent 的观察输入是截图和坐标，Page Agent 的观察输入则是 `PageController` 抽出来的 DOM 文本状态：哪些元素可点、元素上显示了什么、当前页面还能往哪里滚、哪些控件是这一步新出现的。模型不直接看像素，而是在一个带索引的文本界面里做决策。

## 总览：对外是 PageAgent，对内是 PageAgentCore 闭环

<div style="overflow-x: auto; margin: 1.5rem 0;">
  <img src="/images/page-agent-guiagent-loop/page-agent-overview.drawio.png" alt="PageAgent 的单页 GUIAgent 架构总览" style="min-width: 880px; width: 100%; max-width: none; border-radius: 8px;" />
</div>

先把职责边界拆开：`PageAgent` 不是主循环本身，它只是外层封装。真正跑 loop 的是 `PageAgentCore`；`PageController` 负责观察和动作；`Panel` 只负责把步骤和状态展示出来。

这个职责切分在 `packages/page-agent/src/PageAgent.ts` 里写得很直白：

```ts
const pageController = new PageController({
	...config,
	enableMask: config.enableMask ?? true,
})

super({ ...config, pageController })

this.panel = new Panel(this, {
	language: config.language,
	promptForNextTask: config.promptForNextTask,
})
```

这段代码说明 `PageAgent` 只做装配：

1. 创建 `PageController`，把 DOM 抽取和页面动作封装起来。
2. 把 `pageController` 交给 `PageAgentCore`。
3. 再挂一个 `Panel` 作为 UI 外壳。

如果只关心 GUIAgent loop，重点文件就是三处：

- `packages/core/src/PageAgentCore.ts`
- `packages/page-controller/src/PageController.ts`
- `packages/core/src/tools/index.ts`

## 入口：`execute()` 负责把任务推进到 while-loop

主入口在 `PageAgentCore.execute(task)`。这个函数先做生命周期和并发保护，再进入一个 `while (true)` 循环。

来自 `packages/core/src/PageAgentCore.ts`：

```ts
if (this.disposed) throw new Error('PageAgent has been disposed. Create a new instance.')
if (this.#status === 'running') throw new Error('A task is already running.')
if (!task) throw new Error('Task is required')

this.task = task
this.taskId = uid()
this.history = []
this.#abortController = new AbortController()
```

这里先把几个运行时边界定死：

- 同一个 `PageAgentCore` 实例不允许并发跑两个任务。
- `dispose()` 之后实例不可复用。
- 每次任务都会重置 `history`、`observations` 和内部浏览器状态。

之后才进入真正的循环：

```ts
while (true) {
	await onBeforeStep?.(this, step)

	this.#states.browserState = await this.pageController.getBrowserState()
	await this.#handleObservations(step)

	const messages = [
		{ role: 'system', content: this.#getSystemPrompt() },
		{ role: 'user', content: await this.#assembleUserPrompt() },
	]
```

这几行已经把主循环骨架交代清楚了：

```text
任务开始
  -> 读浏览器状态
  -> 拼 prompt
  -> 调模型
  -> 执行动作
  -> 写回 history
  -> 下一轮
```

主流程不绕，但运行时边界补得比较认真：`onBeforeTask`、`onAfterTask`、`onBeforeStep`、`onAfterStep` 都能插进来；`AbortSignal` 会一路传到模型请求和工具执行；错误要么写进 `history`，要么直接结束任务。

<div style="overflow-x: auto; margin: 1.5rem 0;">
  <img src="/images/page-agent-guiagent-loop/page-agent-loop.drawio.png" alt="PageAgent GUIAgent 单步 loop 流程图" style="min-width: 980px; width: 100%; max-width: none; border-radius: 8px;" />
</div>

这张图只画主线：`Observe`、`Think`、`Act`。Page Agent 每轮都按这个顺序推进，没有把多步推理和多工具并发塞进同一步。两侧的框是实现约束：`normalizeResponse()` 负责修正模型输出，`parallel_tool_calls=false` 保证一轮只落一个动作，`afterStep / maxSteps / abort` 负责收口。

## 观察阶段：PageController 把页面压成一个“可执行文本界面”

Page Agent 和很多 GUI agent 的差别，主要就在 observe 阶段。

`PageController.getBrowserState()` 不是截图，而是返回一个结构化文本状态：

```ts
const titleLine = `Current Page: [${title}](${url})`

const pageInfoLine = `Page info: ${pi.viewport_width}x${pi.viewport_height}px viewport, ${pi.page_width}x${pi.page_height}px total page size, ${pi.pages_above.toFixed(1)} pages above, ${pi.pages_below.toFixed(1)} pages below`

const content = this.simplifiedHTML

return { url, title, header, content, footer }
```

重点不是它返回了多少字段，而是 `content` 从哪里来。`getBrowserState()` 会先调用 `updateTree()`；后者刷新 DOM 树、提取交互元素、建立 `selectorMap` 和 `elementTextMap`，最后把结果串成一段适合 LLM 阅读的简化文本。

来自 `packages/page-controller/src/PageController.ts`：

```ts
this.flatTree = dom.getFlatTree({ ...this.config, interactiveBlacklist: blacklist })

this.simplifiedHTML = dom.flatTreeToString(
	this.flatTree,
	this.config.includeAttributes,
	this.config.keepSemanticTags
)

this.selectorMap = dom.getSelectorMap(this.flatTree)
this.elementTextMap = dom.getElementTextMap(this.simplifiedHTML)
```

`flatTreeToString()` 的输出格式影响后续决策。源码里对新出现元素会加一个 `*` 标记：

```ts
const highlightIndicator = node.isNew
	? `*[${node.highlightIndex}]`
	: `[${node.highlightIndex}]`
```

最终给模型的文本大致长这样：

```text
[12]<input placeholder=Search />
*[18]<button>Submit />
	[19]<div data-scrollable="bottom=842">Results />
```

这带来三个直接效果。

第一，模型不需要看截图，也不需要输出坐标。它只要引用 `[18]` 这样的索引。

第二，滚动区域被显式标出来了。Page Agent 不是只告诉模型“可以 scroll”，还会在元素上挂 `data-scrollable` 信息，提示可滚方向和剩余距离。

第三，它把“页面变了没有”这个问题改写成了文本 diff。`*[index]` 明确告诉模型哪些元素是新出现的，这比让模型自己回忆上一轮截图里多了什么稳定得多。

这也是 README 里“Text-based DOM manipulation”真正落到代码里的地方。

## 思考阶段：用 `AgentOutput` 强制模型先反思，再给一个动作

Page Agent 在 think 阶段加了一条硬约束：每一步都必须调用同一个宏工具 `AgentOutput`。它没有把 `click`、`input`、`scroll` 这些动作直接平铺给模型，而是先套了一层统一输出协议。

来自 `packages/core/src/PageAgentCore.ts`：

```ts
const macroToolSchema = z.object({
	evaluation_previous_goal: z.string().optional(),
	memory: z.string().optional(),
	next_goal: z.string().optional(),
	action: actionSchema,
})

return {
	description: 'You MUST call this tool every step!',
	inputSchema: macroToolSchema,
}
```

也就是说，模型每一步输出的不是“直接点哪个元素”，而是先交出：

1. 上一步到底成功没有；
2. 这一步应该记住什么；
3. 下一步要做什么；
4. 以及一个具体动作。

系统 prompt 也把这个契约写得很死。来自 `packages/core/src/prompts/system_prompt.md`：

```json
{
  "evaluation_previous_goal": "...",
  "memory": "...",
  "next_goal": "...",
  "action": {
    "Action name": {}
  }
}
```

这层设计的价值不在于“格式更整齐”，而在于它把 agent 的短时状态显式写了出来。`history` 里保存的不只是动作结果，还有每轮的 `evaluation_previous_goal`、`memory` 和 `next_goal`。下一轮组 prompt 时，模型会再次看到这些内容，而不是只看到“我刚才点过一个按钮”。

LLM 请求本身也故意做成“单轮、单工具、不开并发”的模式。来自 `packages/llms/src/OpenAIClient.ts`：

```ts
const requestBody = {
	model: this.config.model,
	messages,
	tools: openaiTools,
	parallel_tool_calls: false,
	tool_choice: toolChoice,
}
```

这里有两个很明确的取舍：

- `parallel_tool_calls: false`，每一轮只做一个动作，不走多工具并发。
- `tool_choice` 会优先点名 `AgentOutput`，避免模型绕开这层宏工具。

代价是一步只能落一个动作，不能靠并发把多个操作一起做完。收益也很明确：状态更稳，history 更容易解释，动作结果也更容易归因。

## 行动阶段：`MacroTool` 再把动作分发给真实工具

模型返回 `AgentOutput` 后，并不会直接改页面。真正把动作落下去的是 `#packMacroTool()` 里那段 `execute()`。

来自 `packages/core/src/PageAgentCore.ts`：

```ts
const toolName = Object.keys(action)[0]
const toolInput = action[toolName]
const tool = tools.get(toolName)

this.#emitActivity({ type: 'executing', tool: toolName, input: toolInput })

const result = await tool.execute.bind(this)(toolInput, { signal })
signal.throwIfAborted()
```

这段逻辑很直接：

1. 从 `action` 里拿到这一步唯一的工具调用；
2. 查 `tools` 表；
3. 执行；
4. 把执行结果和持续时间写进活动流；
5. 再把结果封回 `history`。

内部工具集合在 `packages/core/src/tools/index.ts` 里，默认包括：

- `click_element_by_index`
- `input_text`
- `select_dropdown_option`
- `scroll`
- `wait`
- `ask_user`
- `done`
- `execute_javascript`（实验能力，默认关闭）

这些工具本身不复杂，真正影响稳定性的是 `PageController` 怎么把动作变成 DOM 事件。比如点击不是直接调一个 `element.click()`，而是补了一整套更接近真实浏览器的事件序列：

```ts
target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts))
target.dispatchEvent(new MouseEvent('mousedown', mouseOpts))
element.focus({ preventScroll: true })
target.dispatchEvent(new PointerEvent('pointerup', pointerOpts))
target.dispatchEvent(new MouseEvent('mouseup', mouseOpts))
target.click()
```

这里真正麻烦的不是“能不能触发点击”，而是不同前端框架和富交互组件对 `focus`、`pointerdown`、`input`、`change` 的依赖不一样。只调一个 `click()` 往往不够。Page Agent 在 action 层做的主要工作，就是尽量把“模型决定动作”翻译成“页面能接受的交互事件”。

## 输出纠偏：`normalizeResponse()` 用来收拾不规整模型输出

这个项目还有一个很工程化的处理：它默认认为模型输出不总是规整的，所以在调工具之前先做一层修正。

来自 `packages/core/src/utils/autoFixer.ts`：

```ts
if (toolCall?.function?.arguments) {
	resolvedArguments = safeJsonParse(toolCall.function.arguments)
	if (toolCall.function.name && toolCall.function.name !== 'AgentOutput') {
		resolvedArguments = { action: safeJsonParse(resolvedArguments) }
	}
}
```

这个 `normalizeResponse()` 会兜几类常见问题：

- 模型没走 `tool_calls`，而是把 JSON 直接吐在 `message.content` 里；
- 模型把动作名当成工具名，跳过了 `AgentOutput`；
- 参数被双重 JSON 字符串化；
- `action` 缺失时退回 `wait`；
- 单字段工具返回了原始值而不是对象。

这段代码不漂亮，但符合真实场景。前端内嵌 agent 的常见问题，往往不是理论能力不够，而是模型输出偶尔会歪。先补一层 auto-fix，比默认所有 provider 都会严格遵守 schema 更务实。

## 停止、重试和运行时约束：这个 loop 更像一个前端 runtime

如果只看主流程，Page Agent 容易被误读成一个轻量 demo。把 `PageAgentCore.test.ts` 和 changelog 放在一起看，会更容易看出作者在往“页面内 runtime”这个方向打磨它。

测试里重点覆盖了几类生命周期语义：

- 运行中再次 `execute()` 会抛错；
- `stop()` 会中断正在执行的任务，但实例还能复用；
- `dispose()` 会终止当前任务，并且阻止后续执行；
- 即使工具忽略了取消信号，任务层也会在工具返回后再次检查 abort，避免“停不下来”。

例如测试里专门有一条：

```ts
await expect(agent.execute('second')).rejects.toThrow('A task is already running.')
```

changelog 也能对上这些约束。`1.9.0` 提到并发保护和 abort handling 重写，`1.5.1` 提到默认 `maxSteps` 提高到 40，并加入 step 间 400ms 延迟。这些行为不是附带细节，而是这个 runtime 设计的一部分。

## 边界和取舍：它不是通用桌面 Agent

把 loop 顺下来之后，这个项目的边界也很清楚。

### 1. 它默认只处理单页能力

系统 prompt 里直接写了：

```text
You can only handle single page app. Do not jump out of current page.
```

所以 `PageAgentCore` 的默认能力范围是当前页面，甚至会避免点开 `target="_blank"` 的链接。多标签页和站外触发不是主循环解决的，而是交给 Chrome extension 和 MCP 层去扩。

### 2. 它依赖 DOM 可见性，而不是像素理解

这让它不需要截图和多模态模型，但代价也很直接：只要页面结构抽不出来，或者交互主要靠 canvas、虚拟化列表、复杂富文本编辑器，loop 就会明显变难。

### 3. 它还没有专门的 loop detection

`#handleObservations()` 里直接留了 `@todo loop detection`。也就是说，当前版本主要靠历史反思、剩余步数警告和 `done` 规则来避免乱转圈，还没有更显式的循环检测器。

### 4. `execute_javascript` 是有意留的逃生门

这个工具默认关闭，而且源码注释写得很谨慎：它可能绕过一些 safeguard。它的存在说明作者知道文本 DOM 工具不可能覆盖所有页面，所以还是留了一个更强、也更危险的出口。

## 源码阅读索引

如果你想自己顺着这个项目读下去，比较省时间的顺序是：

1. `packages/page-agent/src/PageAgent.ts`  
   先确认对外 API 只是装配层，不要一开始就把 Panel、PageController 和 loop 混成一块。

2. `packages/core/src/PageAgentCore.ts`  
   主循环、prompt 组装、宏工具、状态流和生命周期都在这里。

3. `packages/core/src/tools/index.ts`  
   看默认动作集合，以及 `done`、`wait`、`ask_user` 的运行语义。

4. `packages/page-controller/src/PageController.ts`  
   看观察和动作真正怎么落到 DOM 上。

5. `packages/page-controller/src/dom/index.ts`  
   看可交互元素如何被编号、串成文本，以及新元素标记如何生成。

6. `packages/core/src/utils/autoFixer.ts`  
   看这个 loop 怎样处理“模型输出不够规整”。

7. `packages/core/src/PageAgentCore.test.ts`  
   看作者真正想固定住的运行时语义是什么。

## 总结

Page Agent 这套 GUIAgent loop 的取舍很明确：**不用截图，不做多步并发，不把动作直接裸露给模型，而是先把网页压成可读文本，再要求模型交一个“反思 + 单动作”的结构化结果，最后用 `PageController` 把动作变成真实 DOM 事件。**

它比较适合两类场景：一类是你已经控制页面代码，想给自家 Web 应用加一个内嵌式 AI 操作层；另一类是你更在意部署成本和前端集成成本，而不是追求跨网站、跨桌面、跨模态的通用性。

如果只看源码实现，`page-agent` 最有参考价值的地方，不是它内置了多少工具，而是它把浏览器内 agent loop 收成了一个清楚的 contract：**DOM 文本状态、单步宏工具、显式 history、可中断 runtime。** 这四件事合在一起，才让“在网页里跑一个 GUIAgent”更像一个能维护的工程组件，而不是一次性的演示脚本。
