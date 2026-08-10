---
title: "Prime Agent 拆解：把工具面砍到只剩一个，让上下文变成变量"
description: "拆 PrimeIntellect-ai/prime-agent（commit a18809e）。它只给模型一个工具叫 ipython，读文件、改代码、派子 agent、改自己的提示词全在 Python 里做。核心赌注是：与其把工具结果塞进消息历史再总结，不如让它留在内核变量里，上下文只放索引。"
date: "2026-08-10"
tags: ["Prime Agent", "AI Agent", "RLM", "Agent Harness", "上下文工程", "源码拆解"]
draft: false
featured: true
readingTime: 22
---

大部分 coding agent 的形状是一样的：给模型十几个工具（读文件、写文件、grep、bash、web 搜索……），每轮把这些工具的 schema 发过去，模型挑一个调用，结果原样回到消息历史里。上下文快满了就总结一遍，接着跑。

[Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) 把这套东西整个换掉了。它只给模型**一个**工具，名字叫 `ipython`，参数就一个字符串。

| 要做的事 | 在 Prime Agent 里怎么写 |
| --- | --- |
| 读文件 | `open().read()` |
| 改代码 | `await edit(...)` |
| 派一个子 agent | `await rlm("...")` |
| 改自己的长期记忆 | `rlm.harness.create_memory(...)` |

全都是 Python 表达式，在一个跨轮次活着的 IPython 内核里执行。

> **阅读前提**
>
> 本文基于 commit `a18809e`（2026-08-07 16:23 -0700），文中行号对应该 commit。
>
> **我没有在本地执行这个仓库的代码。** 所有结论来自读源码、读 `docs/` 和读它自己的单元测试断言，不来自跑起来的输出。涉及运行时行为的判断都是按代码逻辑推导的，不是实测。

## 先说判断：它真正下注的是什么

README 把自己总结成两个抽象：**RLM**（Recursive Language Model）和 **Continual Harness**。这两个词单看都挺唬人，拆开之后各自只解决一件很具体的事。

- **RLM** 解决「工具结果放哪儿」。
- **Continual Harness** 解决「agent 学到的东西存哪儿」。

这两件事对应长跑任务里最贵的两笔账：上下文窗口，和跨会话的经验。前者每轮都在烧钱，后者每次新开会话都在重来。

**我读完的判断是：RLM 这一层自洽且激进，值得认真看；Continual Harness 想法对，但完成度明显低一截。** 具体差在哪，后面单独说。

还有一个前提不该跳过。README 和 `docs/architecture.md:49` 都写了同一句话：

> Prime Agent executes model-generated Python and project commands with your user permissions. Its worker and kernel processes improve lifecycle isolation and recovery; they are **not** a security sandbox.

拆进程是为了别互相拖死，不是为了别乱动你的机器。这句话在讲进程拓扑时还会再出现一次。

## 赌注一：同一份日志，两种存法

场景很具体：agent 要排查构建失败，`build.log` 有 80k tokens。

![左右对比图，标题为「同样一个 80k tokens 的日志文件，两种 harness 怎么处理」，副标题说明差别不在会不会读文件而在读完之后这堆内容存在哪里。左栏红色主题标为「A. 工具结果直接进消息历史（多数 harness 的做法）」，分四步：① 模型发一次 tool_call，等宽字体显示 read_file("build.log")；② 整份内容作为 tool_result 回传，80k tokens 一字不落地写进 message history 之后每一轮都要重发一遍，灰字注明模型没有选择权，它还没看到内容内容已经在上下文里了；③ 上下文窗口占用，一条横向进度条被三段由浅到深的红色填掉大半，依次标注第 1 次读取、第 2 次、第 3 次，末尾一小段灰色标注剩余；④ 快满了触发 summarize 压缩，让模型把前面的历史总结成一段短文本再用总结替换原文，灰字注明这一步是有损的，被总结掉的细节没有任何办法找回来。左栏底部红框结论「一串靠总结串起来的 agent」，说明每压缩一次信息就少一点，任务越长模型看到的世界越模糊，Prime Intellect 把这个现象叫 context rot 上下文腐烂；再下方灰框列出三条代价：单 token 成本随上下文线性上涨、模型能力随上下文变长而下降、压缩边界一过原始证据不可回溯。右栏绿色主题标为「B. 结果留在 Python 变量里（Prime Agent 的 RLM 做法）」，同样四步：① 模型只有一个工具即执行 Python，等宽字体显示 log = open("build.log").read()；② 80k tokens 落在 kernel 内存里不进上下文，进上下文的只有这一行代码本身以及模型主动 print 出来的部分，灰字注明这就是 prompt-as-a-variable，把数据当变量而不是当消息；③ 上下文窗口占用，同样宽度的进度条上只有左端三小段绿色，标注三次读取合计仍只占一小条；④ 下一轮想换个角度看直接对变量再切一刀，等宽字体显示用 re.findall 从 log 变量里取出前 20 条 ERROR 行，说明原始数据一直在想看哪段现取哪段不需要重新读文件，变量随 kernel 存活跨轮次跨压缩都还在。右栏底部绿框结论「上下文里放的是索引，不是原文」，引用官方博客说法 RLM 从不真正总结上下文所以也就没有总结带来的信息丢失；最下方黄框写「但这不是免费的」，模型必须真的会写代码去找数据，写不好检索代码它就是在一个自己看不见的变量上瞎猜。](/images/prime-agent-rlm-continual-harness/context-contrast.png)

**左边那条路的问题不是「上下文会满」，而是模型对这件事没有选择权。**

它发出 `read_file` 的那一刻，还没看到内容，内容就已经在上下文里了。哪怕只需要其中三行，剩下的 79k 也得占着位置，此后每一轮都要重发。

**右边这条路把决定权交回给模型。** `log = open("build.log").read()` 执行完，80k 字符在内核的内存里；进上下文的只有这一行代码，加上模型自己选择 `print` 出来的部分。下一轮想换个角度，`re.findall(r"ERROR.*", log)` 再切一刀，不用重读文件。

这条纪律被直接写进了系统提示词（`prompts/rlm.ts:23`）：

> Use Python for reading, searching, and editing files — it gives you reusable variables you can slice, filter, and act on without re-reading. **Always assign read/search results to named variables so you can revisit them later.**

### 但没有任何自动卸载机制

这一点容易被宣传语盖过去，我专门去代码里确认过。

没有 `bind_prompt()`，也没有「输出超过 N 就自动存成变量」。`tools/ipython.ts`、`kernel/index.ts`、`kernel/state-snapshot.ts` 三个文件我从头读到尾，没找到这类机制。

唯一的隐式绑定是 IPython 自带的输出历史。宿主发执行请求时带了 `store_history: true`（`kernel/index.ts:855`），所以 `_`、`Out[n]` 这些东西存在。但宿主代码从没提过它们，快照时还特意排除掉。

**也就是说，这个机制完全靠模型自觉。** 提示词让它把结果绑到变量上，它就绑；它要是写成 `print(open("build.log").read())`，80k 一样进上下文，只不过会被 `DEFAULT_MAX_OUTPUT_CHARS = 65536`（`kernel/index.ts:31`）砍断，末尾补一行 `[... output truncated at 65536 chars ...]`。

所以「RLM 从不总结上下文」成立的前提，是模型足够会写检索代码。这是个真实的能力门槛，不是免费午餐。Prime Intellect 自己训模型，这个前提对他们比对别人更容易成立。

## 赌注二：能力的单位不再是一个工具

上面那套做法有个直接推论：既然一切都在 Python 里发生，就不需要第二个工具了。

![左右对比图，标题为「工具面：给模型 N 个工具，还是给它 1 个工具加一门语言」，副标题写 Prime Agent 的默认工具集在源码里就一个词，即 selectedTools 缺省时取一个只含 ipython 的数组。左栏标为「A. 常见做法：每种能力一个 tool schema」，上方写每一轮请求都要把这些 schema 发给模型，下面十二个蓝色等宽字体方块排成三行，依次是 read_file、write_file、edit_file、bash、glob、grep、web_search、web_fetch、todo_write、task、notebook_edit 和一个省略号方块。中部橙色区块标题「再接一个 MCP server」，里面六个橙色方块列出 mcp__linear__list_issues、mcp__linear__get_issue、mcp__linear__create_…、mcp__linear__update_…、mcp__linear__search_… 和「…还有十几个」，下方注明一个服务接进来工具面就整体膨胀一圈。再下方灰框「这样做的两个代价」：第一 schema 自己就占上下文而且每轮都在，第二工具一多模型挑错工具填错参数的概率跟着涨；灰字补充更别扭的是组合，想把 grep 的结果喂给 web_fetch，中间结果必须先原样经过一次上下文模型才能接着用。左栏底部蓝框写「能力的单位 = 一个工具定义」，加能力就要改 harness 的工具列表，由 harness 作者决定。右栏绿色主题标为「B. Prime Agent：只有一个工具」，正中一个绿色大方块用等宽字体写 ipython，右侧箭头注释「← 模型看到的全部工具」，一条向下箭头指向下方的大框「能力全都放在 IPython 内核的命名空间里」。框内分五组：预装的第三方包，等宽列出 requests、httpx、pandas、numpy、scipy、bs4、lxml、pydantic、yaml、tomli、dotenv、tyro，注明不够就 uv pip install 自己装；预导入的 skill 模块，仓库里 13 个，带 Python 包的直接当函数调，等宽列出 edit、goal、agent_message、agent_observe、websearch、compact、refine、rlm_heartbeat、attach_image、linear、notion，示例写 await edit(path="pkg/f.py", old_str=..., new_str=...)；递归子智能体，示例 await rlm("review the API", name="api-reviewer")；持久化的 harness 状态，示例 rlm.harness.create_memory(...) 和 create_skill(...)；跑 shell，用 %%bash 魔法命令，每个 cell 一个一次性子 shell。这一栏末尾写所有调用都是 Python 表达式返回值可以直接接着用不必经过上下文中转。右栏底部绿框写「能力的单位 = 一个 Python 包 + 一份 SKILL.md」，并引用官方文档 MCP 集成不会暴露成新的 agent 工具，接十个 MCP server 模型看到的工具数还是 1。](/images/prime-agent-rlm-continual-harness/tool-surface.png)

这不是我的概括，是源码里的字面写法。

```ts
// core/tools/index.ts:46-47
export type ToolName = "ipython";
export const allToolNames: Set<ToolName> = new Set(["ipython"]);

// core/system-prompt.ts:65
const tools = selectedTools ?? ["ipython"];
```

更能说明态度的是 CLI 参数校验那段：

```ts
// cli/args.ts:63-64
const REMOVED_BUILTIN_TOOL_NAMES = new Set(["read", "write", "grep", "find", "ls"]);
const BUILTIN_TOOL_NAMES = ["ipython"];
```

这几个工具名不是「没实现」，是**被删掉了并且专门留了报错提示**。显式传 `--tool read`，它会告诉你这个内建工具已经不存在了。仓库里 `bash.ts`、`edit.ts` 的工厂函数还在，但没有注册进 `allToolNames`。

`ipython` 工具的完整 schema 就一个字段（`core/tools/ipython.ts:143-148`）：

```ts
const ipythonSchema = Type.Object({
	code: Type.String({ description: "Python scratchpad code or `%%bash` shell cells ..." }),
});
```

跑 shell 也不是另一个工具，是 IPython 的 `%%bash` 魔法命令。`docs/rlm.md:51` 划了语义边界：每个 `%%bash` cell 是一个一次性子 shell，但 Python 状态和 `%cd` 会留在内核里。

### MCP 接进来也不加工具

`docs/mcp-integrations.md` 写得很直白：

> Consistent with Prime Agent's single-tool design, MCP integrations are **not** exposed as new agent tools.

Linear 和 Notion 以 Python 模块的形式进命名空间（`skills/linear/`、`skills/notion/`），未知属性会被转成一次异步 MCP 调用（`mcp_base.py:283-303`）。接十个 MCP server，模型看到的工具数还是 1。

### 真正的好处是组合，不是省 schema

十几个工具的 harness 里，想把 grep 的结果喂给一个 HTTP 请求，中间结果必须原样经过一次上下文。在这里就是一句 `for m in re.findall(...): await fetch(m)`，一个 cell 里跑完，进上下文的只有主动 print 的那部分。

代价也很清楚：**能力的单位从「一条工具定义」变成了「一个 Python 包加一份 `SKILL.md`」。** 门槛更高，但也意味着模型可以在运行时自己造能力——仓库里的 `skill-creator` 就是干这个的，它把新能力打包成可编辑安装的 Python 包塞进内核的 venv。

## `await rlm(...)` 不返回答案

递归子 agent 是 RLM 名字里的 R。这里有个反直觉的地方，我认为是全项目最容易读错的 API。

![五泳道时序图，标题为「await rlm(...) 到底做了什么：派活立刻返回，答案后面才回来」，副标题写最反直觉的一点是这个 await 等的是任务被受理不是任务被做完。五条泳道从左到右分别是黑色的父 agent 的模型、青绿色的父 AgentSession（TypeScript 宿主）、橙色的 IPython 内核（Python 进程）、紫色的子 AgentSession（独立会话）、灰色的模型 provider。上半部分是浅绿底的第一阶段「同步派活（全程在一次工具调用里完成）」，包含七步：① 父模型调用唯一的 ipython 工具；② 父 session 向内核发 execute，内容是 await rlm("inspect the API")；③ 内核通过 Jupyter comm 向宿主发反向请求 host.request 的 rlm.run，注明走 control 通道不走 shell 通道；④ 父 session 自调用校验 RLM_DEPTH 小于 RLM_MAX_DEPTH，默认上限 1，并解析 model，不指定就继承父模型，指定但不可用则直接失败不静默降级；⑤ 父 session 自调用建 sub-xxxxxxxx 子目录并把任务登记进父级 registry，注明 registry 由 TypeScript 宿主持有，内核重启、压缩、恢复都不丢；⑥ 返回 RLMSpawnHandle，只有 id、name、session_dir、model 四个字段；⑦ cell 输出原样回到父模型，这一轮就结束了。中间一个红色高亮框写「关键：句柄里没有答案。rlm() 永远不会返回子 agent 的结果。」，并引用官方文档措辞 it never waits for or returns the child's answer，说明父 agent 应该就地结束这一轮而不是原地轮询等待。下半部分是浅紫底的第二阶段「异步执行（脱离父 agent 的这一轮，自己跑自己的）」：⑧ 父 session 创建子运行时并投递任务 prompt，标记为 task from parent，复用父级的 provider、模型注册表、工具、重试配置，拿到自己的 RLM_SESSION_DIR；子 agent 在自己的循环里⑨向 provider 发流式请求并接收响应和工具调用，标注可以跑很久；⑩ 子 agent 通过 await agent_message.send(msg, receiver_role="parent") 把结果送回父 session，注明要么这样显式回一句要么把结果写进文件让父 agent 自己去读；⑪ 这条消息作为一条普通 agent 消息出现在父 agent 之后的某一轮。底部两个说明框：左边「为什么响应必须走 control 通道」，IPython 串行处理 shell 消息，受理响应若也走 shell 就会死锁，正在执行的 cell 等响应而内核要等这个 cell 结束才处理响应；右边「费用算在谁头上」，子 agent 的用量会异步归并到发起它的那条父 assistant 消息上，计入账单总额但不会撑大父模型自己的上下文窗口读数。](/images/prime-agent-rlm-continual-harness/rlm-delegation.png)

`docs/rlm.md:55-62` 的原话：

> The call returns immediately after task admission with a child handle; **it never waits for or returns the child's answer.**

句柄里只有四个字段：`rlm_child_id`、`name`、`session_dir`、`model`（`agent-session.ts:9948-9953`）。宿主把启动和执行明确拆开了，注释写得很直接（`agent-session.ts:9732`）：

```ts
// Runtime startup and the task run are deliberately detached. The public spawn
// resolves at admission, while this task owns live tracking, usage, retention,
// cancellation, and late-startup cleanup.
```

**结果通过两条路回来：** 子 agent 显式调 `await agent_message.send(..., receiver_role="parent")`，或者把结果写进自己的 `session_dir` 让父 agent 去读。

要是子 agent 跑完一句话都没回，宿主会补一条 `completed_without_reply` 通知（`agent-session.ts:9838-9847`），不至于让父 agent 干等。

**这个 API 形状意味着父 agent 派完活应该就地结束这一轮**，而不是原地写循环轮询。这跟大多数人对 `await` 的直觉是反的，也是这里最容易踩的坑。

几个值得记的细节：

- **参数只有两个**：`name` 和 `model`。传别的会报错而不是被忽略（`agent-session.ts:9603-9610`）。`docs/rlm-runtime.md:151-156` 明确写了 Unknown options fail instead of being ignored。
- **`model` 指定了但不可用就直接失败**，不静默降级到父模型。它会先做一次鉴权预检，过滤掉 stale 和 expired 的凭据。
- **默认递归深度是 1**（`_resolveRlmMaxDepth`，`agent-session.ts:1573-1592`）。根会话能生孩子，孩子默认不能再生。环境变量里也有 `RLM_MAX_DEPTH`，但代码注释说得很清楚：kernel 的环境变量是启动时快照，可能是旧的，**以 TypeScript 侧的检查为准**。
- **子 agent 是真正隔离的**：新的 `SessionManager`、新的会话文件、自己的 IPython 内核、自己的 `sub-xxxxxxxx/` 目录。共享的只有 provider、模型注册表和重试配置。
- **用量往上归并**：子 agent 花的 token 异步记到发起它的那条父 assistant 消息上（`appendChildUsageAttribution`），账单总额是对的，但不会撑大父模型自己的上下文读数。

### 一个漂亮的工程细节：响应走 control 通道

内核向宿主发反向请求（`rlm.run` 是其中一种）用的是 Jupyter comm，target 叫 `host.request`。宿主的**响应必须走 control 通道，不能走 shell 通道**（`kernel/index.ts:1272-1279`）：

```ts
const channel = this.control ?? this.shell;
```

原因在 `docs/rlm-runtime.md:113-123`：shell 通道正被那个还没执行完的 cell 占着。响应要是也走 shell，就变成「cell 等响应、内核等 cell 结束才处理响应」的死锁。Python 侧对应地把 comm handler 装在了 control 上（`rlm/__init__.py:63-64`）。

还有一处小心思：`comm.open(data={**(payload or {}), "type": request_type})`。`type` 放在最后展开，这样 payload 里如果有个同名的 `type` 键，也劫持不了路由。

## 让 agent 改自己的提示词，但只准改一层

这是第二个抽象。`prompts/rlm.ts:31` 给了一句精确的术语划分：

> **continual harness** names the persisted prompt, memory, skill, and subagent layer; **RLM** names the runtime, IPython kernel, and native call interface exposed to the model.

![三区块图，标题为「Continual Harness：让 agent 改自己的提示词，但只准改一层」，副标题写基础提示词编译进二进制任何人改不了，能改的是挂在它后面的那一段。左上黑色标题栏面板「每一轮的系统提示词是怎么拼起来的」，说明从上到下按顺序拼接、只有第 3 层可写，列出七层：1 是 buildRlmPrompt() 基础提示词，包含身份、工作目录、递归机制、IPython 使用纪律，写死在代码里，标只读；2 是子 agent 委派指引，讲什么时候该派活怎么派，标只读；3 是紫色高亮的 # Continual Harness State，包含补充提示词、记忆、技能描述、子 agent 规格，标可写，并注明这是全篇唯一能被 /refine 写的地方；4 是 # Additional Guidance 即工具带来的补充说明；5 是 # Project Context，AGENTS.md 或 CLAUDE.md 全文原样贴进来由人来维护；6 是 <available_skills> 技能索引，只有名字、类型、import 名、一句话描述、文件路径；7 是 appendSystemPrompt 即用户自己追加的。面板底部黄框「为什么第 1 层不让动」，源码注释把它称作 trained prefix，模型是照着这段被训过的。右上紫色标题栏面板「那一层里到底存了什么：四类条目，两个作用域」，四个卡片：prompt 补充提示词，很窄的行为约定比如提交前先看 git status，校验里明确挡掉 id 为 base_system_prompt 的编辑，它是附注不是对基础提示词的覆盖；memory 记忆，事实、做过的决定、踩过的坑、用户偏好、某次尝试的结果，是四类里最常被写的一类；skill 可复用调用的描述，注意这里存的是描述不是代码，必须带 reference（python import 加可调用对象）和 arguments（参数、必填、默认值）否则校验不过，真正打包成 Python 包是 skill-creator 的活；subagent 委派规格，一个可复用的角色即干什么怎么干什么时候该叫它，源码注释说这个菜单的排布是对着 Claude Code 的 Agent 工具抄的。下方「两个作用域，默认写本地」，等宽字体列出本地路径 session-artifacts/<会话 id>/harness/harness_state.json 和全局路径 ~/.prime/agent/harness/harness_state.json，分别注明本地是默认用于这次会话自己的进度和临时结论，全局要显式 --global 用于跨会话的稳定经验，并说明读的时候两边合并全局打底本地覆盖、写的时候一次只写一边、id 撞车时本地那条显示成 local:<id>。最下方红框「最容易误解的一点：进提示词的是索引，不是全文」，每一类最多注入 6 条每条内容截断到 180 字符多出来的只显示成 +N more，模型看到的是一份路由提示要看细节得自己去 rlm.harness 里读，写太多条后面的等于隐身。图的下半部分是「/refine 一次跑完的五步」，五个青色方框横向排列并用箭头连接：① 触发，人手敲 /refine、模型自己 await refine.run()、自动即默认每 25 轮一次压缩后也会查一次冷却 20 分钟，子 agent 里完全禁用；② 审核闸只在自动路径，另起一次 LLM 调用只回答一个问题这段轨迹值不值得写进去，提示词里明写一次性的噪音和没证据的猜测一律驳回，宁可什么都不写；③ 规划，喂进去的是轨迹的最后 80k 字符、当前 harness 概览、最近 20 条改动历史，只允许返回 JSON 编辑列表而且刻意关掉了 thinking；④ 逐条校验，检查结构对不对 id 存不存在、skill 条目必须带调用契约、create 不能悄悄覆盖已有条目、规划期间条目被改过就跳过，某一条挂了只记下错误不影响同批其他条目；⑤ 应用，先写临时文件再 rename 避免写坏，落盘后立刻重建系统提示词然后自动把 agent 唤醒继续干，规划在后台跑不挡新一轮只有落盘这一小段是阻塞的。底部左侧绿框「回滚不需要再问模型一次」，每条 edit 落盘时都存了这条目改动前后的完整快照，/refine rollback <id> 就是把这批快照倒着回放，删掉的重建、改过的还原、新建的删除，全程零 LLM 调用所以它便宜确定可重复，回滚本身也会被记成一次新的 refinement 所以回滚也能再回滚。底部右侧黄框「读源码时注意到的几个粗糙处」：没有任何界面能浏览 harness 条目或列出可回滚的 id，想回滚得自己去翻 json 文件找 id；条目只增不减没看到淘汰策略，配合每类只注入 6 条，写多了之后早期条目实际上就沉底了；并注明以上基于 a18809e 的源码阅读未实际运行可能已被后续提交改掉。](/images/prime-agent-rlm-continual-harness/continual-harness.png)

### 「基础提示词不可变」靠的是结构，不是校验器

这是我一开始最怀疑的一句话。看完 `system-prompt.ts:116-166` 的拼装顺序才明白。

它成立不是因为有个校验器拦着，而是因为 harness 的条目根本没有任何路径能进到 `buildRlmPrompt` 里去。基础提示词是编译进二进制的字符串，harness 内容作为一个独立的 `# Continual Harness State` 段落追加在它后面。代码注释也点了这件事：这一段是 Appended AFTER the trained buildRlmPrompt prefix。

校验层面确实还有一道：`prompt` 类型的条目里，`id` 为 `base_system_prompt` 的编辑会被明确挡掉。但那更像双保险。

**`trained prefix` 这个词值得留意。** Prime Intellect 自己训模型，基础提示词是训练时输入分布的一部分。让 agent 随便改它，等于在推理时把模型推出训练分布。这个不可变约束有具体动机，不只是洁癖。

### 进提示词的是索引，不是全文

这是我读这一块最大的收获，也是最容易被文档一句话带过去的细节。

`# Continual Harness State` 这一段**不是把条目全文贴进去**：

```ts
// refinement/refinement.ts:26-28
const DEFAULT_OVERVIEW_ENTRY_LIMIT = 6;
const DEFAULT_OVERVIEW_REFINEMENT_LIMIT = 5;
const DEFAULT_OVERVIEW_CONTENT_LIMIT = 180;
```

每一类最多注入 6 条，每条内容截断到 180 字符，多出来的显示成 `+N more`。提示词里自己也说了，这些是 compact summaries, not full descriptions... routing/context hints——它是一份目录，告诉模型有这么个东西存在，要看细节自己去 `rlm.harness` 里读。

**这个设计本身是对的**，跟前面「上下文里放索引不放原文」是同一个思路。但它有个直接后果：条目写超过 6 条之后，后面的在提示词里基本等于隐身。而我在代码里**没找到任何淘汰、打分或者按相关性排序的机制**，条目只增不减。长期跑下来，早期写的东西会自然沉底。

### `/refine` 一次做什么

触发有三条路：人手敲 `/refine`、模型自己 `await refine.run()`、自动触发。自动那条的默认参数在 `settings-manager.ts:883-896`：**每 25 个 assistant 轮次**检查一次，压缩之后也会检查一次，**冷却 20 分钟**。子 agent 里完全禁用。

自动路径比手动多一道**审核闸**：单独起一次 LLM 调用，只回答「这段轨迹值不值得写进去」。它的系统提示词（`refinement.ts:175`）明确要求驳回一次性的噪音和没证据的猜测，宁可返回空。

这一层的存在说明作者清楚：让模型自己决定记什么，最大的失败模式不是记漏，是记一堆废话。

规划阶段喂进去三样东西：

- 轨迹的**最后 80k 字符**（`refinement.ts:892`）
- 当前 harness 概览
- **最近 20 条**改动历史（`refinement.ts:553`）

输出被限制成 JSON 编辑列表，而且**刻意关掉了 thinking**。这是个有意思的选择，说明他们把这一步当成结构化抽取，不当成推理。

然后逐条校验、原子写盘、重建系统提示词。某一条编辑挂了只记错误，不影响同批其他条目。

### 回滚这一块设计得很好

每条 edit 写盘时都存了这个条目改动前后的完整快照。`/refine rollback <id>` 就是把这批快照倒着回放：删掉的重建、改过的还原、新建的删除。

**全程零 LLM 调用**，所以它便宜、确定、可重复。回滚本身也被记成一次新的 refinement，所以回滚也能再回滚。

「让模型改状态、但回退是纯确定性的」，这个组合比 refine 本身更值得抄。

### 但这一层的完成度明显不如 RLM

两个具体的粗糙处：

**没有任何界面能浏览 harness 条目，也没有命令能列出可回滚的 `id`。** `/refine rollback <id>` 需要一个 `id`，但得自己去翻 `harness_state.json` 找。这不像设计取舍，更像还没做。

**条目没有生命周期。** 只增不减，配合「每类只注入 6 条」，效果是早期条目静默失效。这个组合在短会话里没问题，在它主打的长跑 agent 场景里恰恰最要命。

## 为什么关掉终端 agent 还在跑

前面讲的都是模型看到的那一面。下面这层是它能长跑的原因。

![五列进程拓扑图，标题为「进程拓扑：为什么关掉终端 agent 还在跑」，副标题写界面、协调、执行、Python 运行时被拆成四类进程，每条边界挡住一种故障。第一列黑色标题「① 客户端进程」，含交互式 TUI（渲染、键盘、本地偏好）、Print/JSON/RPC 无界面自动化入口、蓝色的 AgentConnection 客户端侧的执行边界，底部红框「客户端不拥有执行」，关掉它下面的活照跑，回来 attach 就能接上。第二列蓝色标题「② 守护进程」，含 Supervisor 负责发现与路由、attach/detach、worker 健康与恢复、跨 agent 消息投递，以及 Catalog 进程负责扫描已保存的会话，底部绿框「它只做协调」，不跑模型不执行代码所以可以一直轻量常驻。第三列青绿色标题「③ Session worker 进程（一棵会话树一个）」，最上是 AgentSessionRuntime 并注明 SDK 场景下可以直接在进程内跑同一个 runtime，下面并排 Root AgentSession（调 provider 管队列、工具分发压缩、goal 与子 agent 生命周期、写 transcript）和 Scheduler（心跳、定时任务、goal 续跑、自主模式），底部紫框「RLM 子运行时」说明每个 await rlm(...) 起一个独立的子 AgentSession，有自己的会话文件和可选的自己的内核，默认递归深度上限 1 即根可以生孩子孩子不能再生。第四列橙色标题「④ IPython 内核进程」，含持久命名空间（变量、函数、import、中间结果跨轮次都在，首次用到时才懒启动）、prime-agent-runtime（Python 侧只是薄壳，rlm、harness、skill 模块，它不调 provider 也没有 agent 循环），底部红框「这不是安全沙箱」，内核用的是你本人的系统权限，拆进程是为了隔离故障和生命周期。第三列和第四列之间有一个双向箭头和竖排文字标注 Jupyter 协议 ZeroMQ，shell、iopub、control 三个通道。第五列上方是「模型 provider」，凭据由 TypeScript 宿主统一持有和解析，只有一份有界的模型目录作为元数据进到 Python 侧完整鉴权库不过界，一条虚线箭头从 worker 上方绕行连到它标注模型流式请求；下方是「磁盘状态」，等宽字体列出目录树 ~/.prime/agent/ 下的 sessions/<id>.jsonl 和 session-artifacts/<id>/ 目录及其内容 kernel-state.dill、scheduled-jobs.json、harness/harness_state.json、sub-xxxxxxxx/，一条虚线箭头从 worker 指向它标注追加 transcript 与产物。图下半部分标题「每条进程边界各自挡住一种故障」，四个框：①—② 客户端与守护进程之间，终端崩了 SSH 断了或你主动 detach 执行完全不受影响，重新 attach 时 supervisor 会给一份恢复快照把界面重放回当前状态；②—③ 守护进程与 worker 之间，一个 worker 只管一棵会话树，某个 agent 把自己搞崩不会连累同时在跑的其他 agent，supervisor 负责发现并恢复；③—④ worker 与内核之间，模型写的 Python 把内核跑挂了会话本身还在，子 agent registry 由宿主持有内核重启后依然能对得上；第四个红框「但边界不等于隔离」，这套拆分解决的是别互相拖死不是别乱动我的机器，内核以你的用户权限执行模型生成的代码，不可信仓库请套外部沙箱。最底部横条写「还有一条不在图上的路径」：心跳、定时任务、goal 续跑、自主模式、别的 agent 发来的消息，进的是同一个会话队列走的是同一条执行和持久化链路，区别只在于这一轮是谁发起的。](/images/prime-agent-rlm-continual-harness/process-topology.png)

`docs/architecture.md:43-49` 把职责划分写得很清楚，这里只挑几条实现细节。

**客户端是纯视图。** `docs/agent-connection.md:142-148` 用架构约束强制了这件事：`InteractiveMode` 不允许依赖 `AgentSessionRuntime`、`AgentSession`、`SessionManager` 或者守护进程的 socket 路径，它只能握一个 `AgentConnection`。所以同一个 TUI 既能驱动远端 worker，也能驱动进程内会话。

**detach 是一条协议命令，不是信号。** `daemon-mode.ts:3653-3661` 的实现就是把这个客户端从事件扇出集合里摘掉，压根不碰会话、队列和 worker。终端被杀、SSH 断了走的是同一条路（socket close），效果一样。worker 本身是 `detached: true` 起的，`stdio` 里没有终端，所以也没有 SIGHUP 这条路径。

**唯一会被自动清理的是客户端拥有的 worker。** `--print`、`--json`、`rpc` 这几种一次性调用起的 worker 有 30 秒断连宽限期（`OWNED_WORKER_DISCONNECT_GRACE_MS = 30_000`），超时才停。交互式常驻会话不走这条路。

**worker 崩了只影响一棵会话树。** 重试延迟是 250ms、1s、5s，三次失败标记这个根为 failed（`daemon-supervisor.ts:136`）。supervisor 自己从不 import provider SDK、不执行工具、不扫 transcript（那是另一个 catalog 子进程的活），所以能一直保持小而稳。

**supervisor 挂了 worker 也还在。** `~/.prime/agent/daemon-workers/<key>/` 下面存着 worker descriptor 和恢复日志，新起的 supervisor 拿着里面的 token 重新连上去认领。

这里有两个防御细节：`pid` 配 `processStartId` 防 PID 复用；`stopRequestedAt` 是「在杀掉之前先写进文件的意图」，防止替补 supervisor 把你故意停掉的东西又拉起来。

**transcript 每条都是同步 `appendFileSync`。** 吞吐让位给持久性，好处是这个文件在任何时刻都是一个合法的 JSONL 前缀。它还是**懒创建**的：第一条 assistant 消息之前什么都不写盘，所以打开又关掉的会话不留垃圾文件。

> **读文档会被坑到的两个点**
>
> `docs/daemon.md` 标题写着 Public Daemon Protocol v4，但 `daemon-protocol.ts:52` 里是 `DAEMON_PROTOCOL_VERSION = 7`。文档滞后了，**以代码为准**。
>
> 文档里的拓扑图既没画 catalog 子进程，也没画 Linux 上的 Python forkserver。

## 长跑要的那些零件

这部分不展开讲，数字比形容词有用。先给核对过的默认值：

| 机制 | 关键默认值 | 源码位置 |
| --- | --- | --- |
| 压缩触发 | `contextTokens > contextWindow - 16384`，保留最近 20000 tokens | `compaction.ts:128-132` |
| 快照上限 | 每变量单独 dill，单个失败不毁整体 | `state-snapshot.ts:56-138` |
| goal 预算 | 只算 `input + output`，**不算缓存 token** | `goals.ts:96-98` |
| 心跳 | 默认 5 分钟一次，递归间隔最小 10 秒 | — |
| 自主模式 | 3 次续跑 / 12 轮 / 80000 tokens / 30 分钟 | `autonomous.ts:48-55` |
| agent 消息 | 单条 ≤ 16384 字符，每会话 ≤ 20 条待处理 | `agent-messages.ts:24` |
| 空闲驱逐 | 90 分钟降级为 passive | `session-action-store.ts:337-367` |

下面四件事值得单独说。

### 压缩不碰内核，但要重新播报

压缩的切点永远不会落在 `toolResult` 上，否则会切出一个没有结果的工具调用。总结用固定的六段式：Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical Context。

**压缩跟 RLM 的配合是这里最巧的一处：压缩完全不碰内核。** 它只重写 transcript，Python 变量一个都不掉。

但模型会忘掉这些变量叫什么——定义它们的那些 cell 被总结掉了。所以压缩的最后一步是去内核里列一遍活着的名字，塞一条消息回去（`agent-session.ts:6887-6935`）：

```
<ipython_state>
Your IPython kernel persisted through compaction; all variables, imports, and helpers
you defined remain available. These names are still defined: log, errs, src_text, ...
</ipython_state>
```

给总结用的提示词里也专门有一句（`compaction.ts:498-499`）：内核还活着，定义这些名字的 cell 不会出现在上面，**把值得记的名字写进总结里，别去重新定义一遍**。

跨会话是另一套机制：`dill` 逐变量打包成 `kernel-state.dill`，一个对象序列化失败只丢那一个名字。`rlm` 和 `asyncio` 在永不快照的名单里，因为它们每次启动都会被重新注入——恢复顺序也是先恢复再 bootstrap，让活的句柄盖掉恢复出来的旧壳。

### goal 跟着分支走

goal 存在会话 JSONL 里的一条 custom 条目，读的时候从后往前找最近一条，所以它天然跟着分支和回溯走。

续跑提示词里有一句我很喜欢的话：完成前要对着目标逐条核对，不要拿意图、部分进展、对早前工作的记忆、或者一个看起来说得通的最终答案当作完成的证据。目标文本本身被当成不可信数据处理，明确告诉模型这是任务，不是更高优先级的指令。

### 自主模式：指纹没变就不重跑

质量闸就是一串 shell 命令。这里有个很聪明的设计：重跑一个之前失败的闸之前，它先给工作区做指纹——`git status --porcelain` 加 `git diff --binary HEAD` 加未跟踪文件的 SHA-256。

**指纹没变就不重跑**，直接告诉模型：

> The autonomous gate was not rerun because the workspace has not changed since this failure. Edit source files, tests, or a blocker artifact before attempting to finish again.

这一手直接掐死了「反复跑测试指望它自己变绿」这种行为。

### agent 之间发消息：只能找核心家庭

寻址范围被限制成 parent、sibling、child，没有祖父母也没有堂兄弟。`From` 字段由守护进程根据发送方身份填，**发送方伪造不了**。

代码里有一处很实在的注释：投递不能 await。排队的消息只有在目标那轮推进时才会送达，而发送方正卡在自己那轮里——互相发消息的两个繁忙会话会直接死锁。

心跳和定时任务共用同一套 `AgentCronJobStore`。投递模式分 `steer`（插进当前这轮）和 `follow_up`（排队等下一轮）。定时语法支持 `in 30m`、`every 10m`、`at <ISO 时间>` 和标准 cron 表达式。有个反馈环值得注意：**带活跃心跳的会话不会被空闲驱逐**。

子 agent 的驻留状态有三档：

- **running**：在跑。
- **retained**：跑完了，但会话对象还留在内存，还能收消息。
- **passive**：被逐出内存，只剩磁盘上的 registry 行。

降级成 passive 要同时满足五个条件：空闲 90 分钟、没有附着客户端、没有心跳、没有定时任务、没有活着的后代。

要用的时候再从 registry 行水化回来，但**必须有个还在内存里的根父会话**——孤儿子 agent 是复活不了的。

## 边界在哪

**它不是沙箱。** 这一句在 README、`architecture.md:49` 和 `docs/rlm.md:143` 各写了一遍。内核以你本人的系统权限执行模型生成的 Python。拆成 worker 和 kernel 两个进程是为了故障和生命周期，跟安全无关。跑不可信仓库请自己套一层外部隔离。

**模型必须真的会写代码。** 没有自动卸载，整个上下文策略压在模型愿不愿意、会不会把结果绑到变量上再自己写检索逻辑。模型弱一点，这套设计的收益就打折，而且失败模式很难看——它会在一个自己看不见的变量上瞎猜。

**harness 那层还缺东西。** 没有浏览界面、没有列 ID 的命令、条目没有淘汰策略。

**文档和代码有漂移。** 协议版本 v4 与 v7 是一处。`docs/long-running-agents.md` 里写的 `agent_message.send(..., mode="auto")` 是另一处——发布的 Python skill 里根本没有 `mode` 参数，投递侧硬编码成 `"steer"`。读文档时要留个心眼。

**内核是单线程串行的。** 工具声明了 `executionMode: "sequential"`，一批里不能并发跑两个 `ipython` 调用。一个 cell 卡住，这条会话就卡住了。UI 上给了两个选项：等它跑完保住状态，或者杀掉内核重启。这是个真实的可用性权衡。

**代码规模不小。** `agent-session.ts` 一个文件将近 400 KB，`daemon-supervisor.ts` 181 KB，`daemon-mode.ts` 242 KB。这几个文件我和调研用的子 agent 都只能分片读，不能说全都看过。

## 换到自己的活里，能拿走什么

我平时做客户端性能和 GUI Agent 的自动化测试，长跑任务和大块非结构化数据这两件事都躲不掉。四条我准备直接搬：

**第一，把大块数据留在执行环境里，上下文只放句柄。**
这条最通用，跟用不用 IPython 无关。GUI Agent 跑一轮会产出一堆截图、view hierarchy、日志，全塞进上下文一轮就废了。留在一个进程的变量里，只把「第几帧、控件树多大、有几个 ERROR」这种索引信息给模型，让它自己写代码去取需要的那一段。前提是这个执行环境得跨轮次活着——这是实现成本的大头，也是 Prime Agent 花力气最多的地方。

**第二，压缩之后要把「你还有什么」重新报一遍。**
`<ipython_state>` 那一手成本极低但很关键：状态还在，只是模型不知道它还在。任何「上下文之外还有状态」的设计都得配一个这样的重新播报，否则模型会重新做一遍已经做过的事。

**第三，让模型写状态，但回退必须是确定性的。**
`/refine` 的写入靠 LLM，回滚靠 before/after 快照，零模型调用。这个组合可以直接抄到任何「agent 自己维护配置、规则或用例」的场景里。让模型改，但每次改都留一条能确定性倒回去的路。

**第四，重跑之前先看工作区指纹。**
自主模式那招 git 指纹去重，改成 GUI 测试就是：重跑一个失败用例之前，先看被测应用的版本、用例文件、环境配置有没有变；没变就别重跑，把这句话原样告诉 agent。这能省掉大量「重试三次希望它自己好」的无效轮次。

至于要不要直接用 Prime Agent 本身。**它的默认工具集只有一个 `ipython`，换到它上面不是换个工具，是换一整套工作方式**，而且这套方式对模型的代码能力有明确要求。

我的判断是：单工具加持久 REPL 这个思路值得认真评估，尤其是数据密集型的 agent 任务。但直接换过去之前，先拿自己在用的模型试一下它到底会不会主动把结果绑到变量上——这一条不成立，后面全都不成立。

它最有价值的地方，是把上下文管理从 harness 的一个后处理步骤（总结压缩），变成了模型可以直接编程操作的东西。这个转变比它砍掉多少个工具更值得看。

---

*本文基于 `PrimeIntellect-ai/prime-agent` commit `a18809e`（2026-08-07）的源码与 `docs/` 分析。未在本地执行该仓库代码，涉及运行时行为的判断均来自代码逻辑推导，不构成实测结论。文中行号对应该 commit，后续提交可能已经改动。*
