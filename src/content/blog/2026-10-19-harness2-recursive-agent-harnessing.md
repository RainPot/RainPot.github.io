---
title: "Harness² 源码拆解：Agent 如何从执行证据中改进自己的运行配置"
description: "沿着 Propose–Probe–Compose 执行链路，拆解 google-research/harness2 的两层递归、八类可编辑组件、经验入库、盲选与评测隔离，并用本地 demo 核实它的行为和预算。"
date: "2026-10-19"
tags: ["AI Agent", "Agent Harness", "源码拆解", "自我改进", "Agent Memory", "评测"]
draft: false
featured: false
readingTime: 25
---

同一个模型，换一份系统提示词、一个工具使用流程，或者一段数据处理脚本，任务结果就可能不同。在 Agent 工程中，这种差异反复出现：模型能力只解释了一部分表现，围绕模型组织的执行配置，同样决定它能把事情做到什么程度。

这层配置通常被称为 **harness**，包括 prompt、工具指导、记忆、skills、子代理、脚本和运行时插件。人工维护时，工程师会读失败日志、提出修改、重新执行、确认变化，再决定是否保留。任务一旦跨越不同领域，这套工作就很难靠一份固定模板覆盖。

Google Research 开源的 [harness2][repo] 把这套改进过程做成了可执行框架：**保持模型权重不变，在当前任务上提出 harness 修改、试跑并比较行为，再把有证据支持的修改经验留给后续任务。** 项目名中的平方，对应两个相连的改进层次：任务内改进执行配置，任务间积累“怎样改配置”的经验。

![作者仓库中的 Harness² 总流程原图：蓝色区域依次执行基础任务、提出通用与领域修改、试跑候选和组合配置，右侧反思过程更新后续任务使用的改进经验](/images/harness2-recursive-agent-harnessing/original/harness2_pipeline.png)

*图 1：作者仓库的总流程原图。来源：[assets/harness2_pipeline.png][repo-pipeline]。原图较宽，可点击放大。*

蓝色区域是当前任务的改进过程：先运行基础 harness，再分别提出通用与领域修改，试跑后交给 Composer 组合。右侧的 Experience Reflector 在任务结束后提炼经验，更新供下一项任务使用的 improvement harness。底部返回下一项任务的箭头表示经验继续发挥作用；结合源码看，新任务仍从公共基础 H₀ 开始，不会直接继承上一个任务的全部执行配置。

下文基于 `google-research/harness2` 的 [`1cfe254e8d25`][commit]，对应 Python 包版本 `0.1.0`，代码核查时间为 **2026 年 10 月 19 日**。论文是 [Harness²: Recursive Agent Harnessing for an Open World][paper]。本文分别标明源码行为、本地验证与作者实验；本地运行覆盖无模型 demo 和工作流回归测试，没有复跑三套模型 benchmark。

## 1. 先看一个能跑通的例子：负数为什么漏算了

仓库自带的 demo 很适合建立直觉。任务要求对 CSV 中所有带符号金额求和，基础 harness 却携带了一段只累计正数的脚本。第一份账本包含：

```text
100.25
-20.10
5.00
```

基础脚本的关键一行来自 [`harness2/demo.py`][demo]：

```python
total = sum((amount for amount in amounts if amount > 0), Decimal(0))
```

它给出的结果是 `105.25`，而任务需要的总额是 `85.15`。demo 的编辑器会移除正数过滤条件，把修改后的脚本放回 harness，再通过真正的 Python 子进程执行。随后，系统保存参考轨迹、修改差异、试跑产物和采用结果。

这个例子展示了一次完整的改进：**修改的是会影响下一次执行的文件，观察的是这些文件改变以后出现的实际行为。** 一句“计算时注意负数”的反思，只有落实到配置或脚本并经过试跑，才有可比较的后果。

这个 demo 有一个限制：`DemoProposer` 是预先写好的确定性编辑器，选择器也会直接按源账本计算总额。它能证明调度、执行、取证、采用和经验存储这些接口协同工作，不能证明模型能独立发现这处错误，更不能代表模型 benchmark 的收益。

## 2. 八类组件规定了 Agent 可以改什么

![作者仓库的八类组件原图：系统提示词、规则、记忆和 skills 影响上下文，工具指导与脚本影响工具接口，子代理负责委派，插件在工具调用过程中介入](/images/harness2-recursive-agent-harnessing/original/components.png)

*图 2：作者按运行时职责组织的八类组件。来源：[assets/components.png][repo-components]。*

这张图按组件介入运行的位置分组：左侧的 Context construction 决定模型读到什么，右上方的 Tool interface 与 Middleware 影响工具调用和结果返回，右下方的 Orchestration 管理子代理委派。组件放在哪里，会影响它何时生效、占用多少上下文，以及能干预执行的哪一步。图中路径是示意，当前版本的具体目录以下表和源码为准。

Harness² 把可编辑对象收敛成文件树。当前 OpenCode 适配的主要映射如下，定义见 [`OPENCODE_SURFACE`][oc-surface] 与 [组件编辑协议][surface-prompts]：

| 组件 | OpenCode 中的文件或目录 | 影响的行为 |
| --- | --- | --- |
| 系统提示词 | `systemprompt.md` | 角色、任务处理程序、执行顺序 |
| 行为规则 | `guardrails.md` | 持续生效的约束与触发条件 |
| 长期记忆 | `LongTermMEMORY.md` | 执行时读取的领域知识 |
| 工具指导 | `tool_descriptions/tool_guidance.md` | 何时以及怎样使用工具 |
| 子代理 | `sub_agents/<name>/AGENT.md` | 可委派角色及其职责 |
| Skills | `skills/<name>/SKILL.md` | 按需加载的流程与操作知识 |
| 脚本 | `scripts/<name>.py` | 确定性计算与辅助处理 |
| 运行时插件 | `plugin/<name>.ts` | 工具循环中的行为干预 |

这八类组件的运行成本不同。前四类是常驻文本，每次占用上下文；skill 正文按需加载；脚本通过执行发挥作用；插件能够进入工具循环。把一段十几步的处理流程塞进常驻 prompt，与把它写成一个带触发条件的 skill，是两种不同的工程选择。

Codex 适配保留这些职责，但采用了另一套物理布局：常驻文本集中到 `AGENTS.md`，skills 放进 `.agents/skills/`，运行时干预通过 `.codex/hooks.json` 表达。当前代码把 OpenCode 常驻文本上限设为 **24,000 个字符**，Codex 设为 **8,000 个字符**。这是该项目的编辑预算，不能当作相应工具的通用上下文限制。映射与上限见 [`CODEX_SURFACE`][cx-surface]。

因此，论文里的八类组件不意味着每个执行器都必须拥有八个同名文件。框架需要的是职责和激活方式明确的编辑接口。

还要区分两种“记忆”。`LongTermMEMORY.md` 是执行 harness 的组成部分，会影响求解任务；后文的 improvement library 则给编辑器提供历史修改经验，用来决定这次该怎样改 harness。

## 3. 仓库把改进方法、执行器和任务适配分开

沿一条任务链路读源码，比逐个目录浏览更容易理解它的组织方式：

```text
CLI 选择任务与预算
  → schedule.run_sweep / run_domain / run_task
  → recursion.run_parallel 或 run_sequential
  → context.build 准备证据，Proposer 生成修改
  → BenchmarkAdapter.execute 执行任务
  → selection 采用一个已有产物
  → reflection / Library 保存可复用经验

独立的 judge / report 命令负责事后评测
```

其中有三个相互独立的接口：

| 接口 | 负责的内容 | 主要源码 |
| --- | --- | --- |
| 改进方法 | 候选生成、试跑、组合、选择、经验更新 | `core/recursion.py`、`core/schedule.py` |
| Substrate | 可编辑文件布局、安装方式、CLI 启动、轨迹解析 | `substrate/opencode.py`、`substrate/codex.py` |
| BenchmarkAdapter | 任务、源材料、基础配置、执行、交付物读取、评分接口 | `core/spec.py`、`benchmarks/` |

`BenchmarkAdapter` 的 [协议定义][adapter] 把执行与评分拆成了不同方法：`execute()` 返回运行目录，`trajectory()` 和 `deliverable_text()` 提供可读证据，`score()` 留给之后的评测调用。

接入新场景时，仍要实现这些接口。任务从哪里加载、候选怎样进入隔离的环境、怎样判断交付物存在、日志怎样转成统一轨迹，都必须由适配器实现。项目所说的即插即用，前提是执行系统已经具备这些接口。

## 4. Propose：每处修改都要指出它针对哪段行为

一个任务先在公共基础 harness 下获得参考执行。参考执行提供的是“当前配置怎样工作”的记录，包含动作、观察、错误和交付物；这些记录不能直接当作正确答案。

之后，编辑器分别从两个视角提出候选：

- **INV，通用行为视角**：规划、工具使用、上下文管理、委派等跨领域问题。
- **DOM，领域视角**：当前工作所需的知识、程序、约束和环境习惯。

例如，同一次账本任务既可能暴露“没有读取完整输入”的通用问题，也可能暴露“把贷项当成无效金额”的领域问题。拆成两个视角，是为了让候选针对不同原因提出修改；二者仍然受同一文件编辑协议约束。

[`propose()` 的提示词][propose] 给出了一个很具体的优先级：先找参考执行之间的行为分歧，再找反复出现的具体错误，最后考虑轨迹中尚未实际发生的风险。每处修改都要回答：哪一次执行的哪个时刻暴露了问题，这条新指令会怎样改变那个时刻的行为。

这个顺序很实用。如果相同配置下，有的执行能完成某一步，有的执行不能，模型至少已经展现过相应能力。编辑器可以优先尝试让成功行为更稳定，而不必立刻增加复杂工具。相反，一个没有出现在轨迹里的“最佳实践”，会额外消耗上下文，却缺少当前任务上的收益证据。

### 证据通过文件提供，任务提示只指向证据

[`context.build()`][context] 会为编辑会话准备一棵证据树，典型内容包括：

```text
context/
  task.md                   当前任务
  source/                   任务源材料
  harness/                  这次允许修改的组件树
  rollouts/                 参考执行的可读轨迹
  deliverables/             产物文本或文件清单
  pool/<label>/
    harness/                某个候选的完整配置
    harness.diff            候选相对当前配置的差异
    rollout.md              候选试跑轨迹
    produced.md             候选产物的可读表示
  decisions/                已有修改与组合决策
  library/                  当前领域可用的历史经验
```

编辑器收到的是一份简短 mission，通过工具按需读取文件。这样避免在单次 prompt 中塞入所有历史，但不意味着每个工具返回都无限长：适配器仍然有观察截断和轨迹呈现的配置。

产物的呈现范围也有限制。`proposer_deliverables="names"` 时，编辑器只收到产物清单；代码解释了原因：某些 benchmark 的试验目录把交付物与 grader 输出放在一起，直接读取整个目录会把评分字段一并带进来。哪些证据能提供给哪个角色，需要在数据边界处处理。

## 5. Probe 与 Compose：用行为差异约束下一次修改

提出候选以后，框架把候选安装进执行环境，在同一个任务上真正运行。随后，组合器一起读取基础执行、候选文件、差异和对应轨迹。

账本例子能说明这一步的价值：

| 证据 | 能支持的判断 |
| --- | --- |
| 基础脚本包含 `if amount > 0` | 存在一个会排除负数的具体机制 |
| 基础执行输出 `105.25` | 这次执行表现出漏算负数的后果 |
| 候选移除了过滤条件 | 修改实际落到了可执行文件 |
| 候选执行输出 `85.15` | 这次试跑的行为与修改机制一致 |

相比“候选回答看起来更专业”，这组证据更接近一条可检查的解释：文件改了什么，执行怎样变化，变化为什么符合任务要求。

这些证据仍不能自动证明因果关系。候选执行有随机性，也可能一次改动多个组件；基础和候选通常还共享模型偏差。[组合提示词][compose] 中有一句明确提醒：

> Agreement is support, not independent proof.

一致可以提供支持，但不能当作独立证明。组合器需要检查具体发生变化的轨迹位置，并同等考虑退化风险。如果某项改动曾有一次试跑没有交付物，提示词要求明确记录这个事实。

Compose 可以合并多个候选中的局部修改，可以修正冲突，可以采用一份候选，也可以保留当前 harness。**组合完成后还会执行一次**，因此最终进入候选池的是有对应执行结果的组合配置。

### 配置进入执行前，还要通过接口校验

配置生成后、执行前，框架会做确定性检查。[`_run_stage()`][stage] 与 [`tree.validate()`][validate] 会处理：

- 文件路径是否位于允许的编辑范围，是否存在路径逃逸；
- 常驻文本是否超出字符预算；
- skill 的 frontmatter、名称和触发条件是否完整；
- 部署是否允许子代理，角色文件格式是否符合接口；
- 受检查的 Python 脚本能否编译，引用的辅助脚本是否随配置提供；
- Codex hooks 是否满足当前 schema，以及 benchmark 自己的配置不变量。

还有一个容易遗漏的细节：写了 skill 文件，并不等于 Agent 会调用它。`autotrigger()` 会尝试在常驻文本中补充命名该 skill 的触发规则；如果字符预算不够，补充会被跳过，之后的校验仍可能拒绝这个无法被触发的 skill。

当前实现允许无效提案在收到具体错误后重试一次。仍然失败，就沿用当前配置，并在阶段记录中标明 fallback 与错误。这些校验主要检查配置能否接入、解析，任务正确性仍然要靠执行证据和后续检查。

## 6. parallel 与 sequential：k 怎样影响探索过程

`k` 是任务级探索预算。两种模式都先获取 `k` 份基础执行，但使用候选的方式不同。

![作者仓库的递归模式原图：左侧 parallel 从同一批基础执行向多个候选展开，右侧 sequential 通过回接箭头把前轮修改带入后轮](/images/harness2-recursive-agent-harnessing/original/harness2_recursion_modes.png)

*图 3：作者仓库的并行与串行递归原图。来源：[assets/harness2_recursion_modes.png][repo-recursion]，对应论文 Figure 4 的两种模式。*

两侧的区别在候选之间有没有继承关系。左图各组修改独立提出，组合阶段读取完整候选池；右图的黑色回接箭头表示下一轮继续修改上一轮得到的配置。对照代码，左侧组合产物叫 `agg1 … aggk`，右侧各轮产物叫 `c1 … ck`。最终选择与经验提炼另计；串行模式也可以采用较早的 `c1`，不强制交付最后一轮。

### parallel：扩大同一轮探索的宽度

[`run_parallel()`][parallel] 的流程是：

1. 从同一份基础配置和参考证据出发，提出 `k` 个 INV 候选与 `k` 个 DOM 候选。
2. 每个候选执行一次，得到 `2k` 份试跑证据。
3. 发起 `k` 个相互独立的组合会话，每个都读取完整候选池。
4. 每份组合再执行一次，得到 `agg1 … aggk`。

当前发布版执行一次这样的群体更新。把 `k` 从 1 增到 5，会增加这一轮的宽度，不会变成五轮依次继承配置的更新。

### sequential：沿着当前配置继续修改

[`run_sequential()`][sequential] 会连续执行 `k` 轮。每轮都有 INV、DOM 两份提案、两次试跑、一次组合和组合后的执行；下一轮拿到上一轮配置与积累的证据。

状态通过这一行传给下一轮：

```python
current_harness = comp.tree
```

因此，第二轮的“保持基础”指保持当前 checkpoint，不会退回原始 H₀。最终候选池包含每一轮的组合产物 `c1 … ck`，允许选择中间轮，避免把“最后一轮”预设成“最好的一轮”。

### 单次改进已经包含多次任务执行

[`ledger.py`][ledger] 固定了两种模式共同的计数关系：

$$
R = k + 2k + k = 4k, \qquad P = 2k + k = 3k
$$

这里 `R` 是任务执行次数，`P` 是改进阶段数。阶段内部可能发生重试；一次执行或编辑会话，也可能包含许多轮模型调用和工具操作。

| k | 任务执行 R | 改进阶段 P | 最终选择器 |
| --- | --- | --- | --- |
| 1 | 4 | 3 | 跳过，直接交付唯一组合产物 |
| 2 | 8 | 6 | 从两份组合产物中选择 |
| 5 | 20 | 15 | 从五份组合产物中选择 |

`R=4k、P=3k` 不包含选择、反思的开销，也不反映阶段内的重试次数。评估实际成本，需要把相应 token、费用、工具运行和耗时一起汇总。若同时比较两种模式，基础执行会共享；不能简单把两份账本相加当作真实执行总数。

## 7. 选择已有产物，与证明修改有效，是两件事

`k > 1` 时，选择器拿到匿名化的候选产物、当前任务和源材料。候选 ID 会稳定地打乱；选择上下文隐藏其 harness 来源。选择器只能提交一个已有结果，不能在这个阶段综合重写出一份新答案。

当前实现的 [`selection_pool()`][selection-pool] 只放入组合阶段的 `k` 个 final。参考执行不在池内。这个约定带来两个具体后果：

- Compose 可以保留当前 harness，但最终选择器不能直接在参考执行和组合产物之间做全量择优。
- `k=1` 没有额外的盲选检查，会直接采用唯一的组合产物。

因此，源码没有保证最终结果至少不差于基础执行。

![Harness² 把产物选择与经验提炼分开：选择器根据匿名产物和源材料提交一个结果；反思读取完整修改与轨迹记录，证据充分才保存经验，之后的 benchmark judge 独立评分](/images/harness2-recursive-agent-harnessing/harness2-evidence-and-adoption.drawio.png)

*图 4：本文补充的采用与经验提炼图。选中某份输出，只说明系统采用了它；经验提炼还需要解释修改与行为变化之间的关系。*

### 反思读取所有候选，不只看最后赢家

[`reflect_adoption()`][reflection] 会准备完整的任务内改进记录：基础 harness、候选及其差异、试跑轨迹、组合决策，以及最终采用记录。

[`experience()`][experience] 要求先逐项记录组件修改，给出四类判断：有帮助、有损害、未观察到效果、存在混杂。若同时修改多个组件，没有执行隔离其中某一项，就应该保留 `confounded`，而不是编造归因。

这个要求有实际意义：落选候选中的某处修改可能确实有用；被采用候选中的某处修改，也可能根本没有贡献。产物排序无法单独回答这两个问题。

之后最多提炼一条持久经验，包含：

| 字段 | 要记录什么 |
| --- | --- |
| `cue` | 适用于哪类任务或情境 |
| `lesson` | 应怎样修改哪个 harness 组件 |
| `evidence` | 哪项修改和哪段行为对照支持这条经验 |
| `confidence` | 信心及其条件，可选 |

如果没有具体、可迁移的行为对照，反思可以返回 `NO_ENTRY`。[`Library.add()`][library] 在缺少完整经验时不会入库。

当前实现也有限制：程序会检查必填字段以及部分评分泄露特征，但不会用独立因果检验器证明 `evidence` 的论证成立。证据是否足够、归因是否恰当，仍然依赖反思模型遵循提示词。

## 8. 跨任务复用：保存修改经验，再从公共基础开始

经验库保存的是完整 harness 文件树，以及解释采用原因与修改效果的 `EXPERIENCE.md`，通过 `INDEX.md` 提供索引。一个条目的结构可以简化为：

```text
accounting/
  INDEX.md
  harnesses/
    ledger-1/
      harness/
        systemprompt.md
        scripts/summarize.py
      EXPERIENCE.md
```

后续编辑器先浏览索引，再按需要读取相关条目。它既能学习修改条件，也能取用实际组件代码；最终是否复用，以及怎样适配，仍然属于本次 Propose 与 Compose 的决定。

新任务的起点，可以从 [`run_task()`][task] 看清楚：

```python
base_tree = harness_tree.read_tree(surface, adapter.base_harness())
```

任务会重新读取公共基础配置。历史 harness 不会自动变成下一项任务的执行配置。这样可以降低上一项任务的专用指令一路累积、逐渐挤占上下文的风险，但也要付出再次提案和试跑的成本。

在线经验还有时间与领域边界。[`run_domain()`][domain] 按顺序处理同一领域的任务，每次只保留当前任务之前的条目；不同领域可以并发。实验库还按执行器、递归模式、预算和 seed 等配置区分。这些约束让后面的任务可以使用前面的经验，同时避免恢复运行时不小心读到“未来任务”的记录。

默认经验检索依靠领域目录和文件索引，没有在这条路径上引入向量库。论文研究了跨 benchmark 转移，但当前正常在线调度使用的是受领域与历史前缀约束的经验库，两者的实验条件需要区分。

![论文 Figure 7 原图：左侧比较没有执行反馈时用不同经验库直接修改 harness 的结果，右侧比较把 JobBench 经验转移到 WorkBuddy 后的分数变化](/images/harness2-recursive-agent-harnessing/original/library_transfer.png)

*图 5：论文 Figure 7，经验库与跨 benchmark 迁移实验。来源：[论文原图及说明][paper-library]；保留作者的[原始 SVG](/images/harness2-recursive-agent-harnessing/original/library_transfer.svg)，正文使用等比渲染的 PNG。*

左图考察一个更苛刻的条件：编辑器没有当前任务的参考执行和候选试跑，只能直接修改 harness。橙色柱表示不使用经验库，WB-code 从基础的 `73.4` 降到 `63.2`，WB-web 从 `69.9` 降到 `65.0`。引入经验库后，结果回升；深蓝色的 `k=5` 表示经验来自此前探索预算为 5 的任务，并不表示这次又做了 5 轮试跑。这组实验支持的是：过去怎样修改配置、修改后发生了什么，能够帮助编辑器判断当前该改什么。

右图把 JobBench 积累的经验用于 WorkBuddy 的单步改进，Code、Web、Office 分别增加 `0.6`、`0.5`、`2.9` 分。这个实验允许跨 benchmark 读取经验，和前面按领域、按历史顺序运行的默认调度不同。它提供了迁移有效的证据，不能据此认定任意领域之间都能直接复用。

## 9. 评分被放在后面，但网络泄露仍是现实边界

Harness² 的“无标准答案反馈”，指的是改进链路不接收 benchmark judge 的分数和标准答案。任务指令、源材料、轨迹、程序错误和交付物都仍然是反馈来源。

源码做了几层分离：`RunView` 不携带评分字段；任务源文件会按 `leak_globs` 排除答案路径；证据树与经验会检查部分 grader 字段；[`core/judge.py`][judge] 在采用结果之后，通过独立命令调用 `score()`。

评分失败会单独处理：记成未评分，不当作零分缓存，汇总时不进入有效评分分母。因此看报告时需要同时看完成数、失败数和已评分数，不能只看一个平均分。

这些代码边界不等于网络隔离。[官方实验指南][experiments] 记录：在发布版的一次验证运行中，Codex 没有收到相关指示，却下载了 JobBench 对应任务的公开 rubric。当前 release 不限制执行器网络，Codex 的启动参数还会关闭 sandbox。

这次运行说明，“没有主动把评分文件塞进 prompt”与“执行器无法接触评分文件”并不是同一层保证。要复现实验，应该在下载依赖之后，对执行阶段的网络出口施加约束，并报告具体策略。仓库记录的这次运行已经暴露了这个限制，不能仅靠一条禁止寻找答案的 prompt 解决。

同理，文件白名单、Python 编译与 hook schema 校验，主要保证组件可装载。接入有外部副作用的业务系统时，还需要单独处理权限与环境恢复。

## 10. 本地验证：工作流跑通了哪些环节

可以先跑不需要模型凭据的 demo。下面这组命令使用 Python 3.12 和基础包安装；文档的完整 benchmark 环境以 Linux 为目标，渲染额外依赖与模型服务另行配置。

```bash
git clone https://github.com/google-research/harness2.git
cd harness2
git checkout 1cfe254e8d25b15f37048c3730134686abe60335
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -e .
harness2-demo --output runs/demo --k 2
python -m unittest discover -s tests -v
```

本文在 macOS、CPython 3.12.12 下运行了这个 demo 的两种模式，观测结果为：

| 检查项 | 结果 |
| --- | --- |
| 两项账本任务 | 2 项完成，0 项失败 |
| `ledger-1` 的采用产物 | parallel 与 sequential 都是 `Total: 85.15` |
| `ledger-2` 的采用产物 | 两种模式都是 `Total: 20.25` |
| 每个任务、每种模式的递归账本 | `R=8`、`P=6` |
| 首次完整 demo 的真实执行总数 | 28 次，两个模式共享基础执行 |
| 确定性编辑器调用数 | 32 次，包含选择与经验提炼 |
| 第二个任务开始前的经验条目 | 两种模式均为 1 |
| 相同命令再次运行 | 两项均 `skipped`，新增执行与编辑调用均为 0 |
| 仓库工作流回归测试 | 5 项通过 |

28 次执行的组成是：每个任务共享 2 次基础执行，再分别为两种模式执行各 6 次，共 14 次；两个任务合计 28 次。

这 [5 项回归测试][tests] 覆盖预算和恢复、完整证据与历史前缀、无效提案重试及费用累加、没有经验时不入库，以及选择失败后不调用 judge。测试还修改了已采用的 harness、删除了产物，确认恢复逻辑会检测到变化并重新处理相应任务。

[`_resume()`][resume] 因而不只是查看 `summary.json` 中有没有成功标记，还会检查采用运行目录、产物可读性、可选的产物完整性，以及 harness 指纹。换了模型或任务范围时，CLI 的配置身份检查会要求使用新的输出根目录，避免把不同实验混进同一批结果。

这里验证的是框架协议和确定性示例。OpenCode、Codex 的真实模型执行、容器环境、文档渲染、网络策略与专业任务质量，都需要在相应 benchmark 环境中另行验证。

## 11. 论文结果与计算成本

作者在 WorkBuddy-Bench、JobBench 和法律工作 benchmark LAB 上报告结果。执行器包括 Gemini 3.5 Flash 与 GLM-5，初始 harness 包括 OpenCode 与 Codex；论文默认编辑器使用 Claude Opus 4.8。主表的单步配置是 `k=1`，追加递归采用 parallel、`k=5`，均报告三次运行的均值与标准差。[论文实验设置与主表][paper-results]

下表摘录三组可核对的均值，省略标准差；完整波动信息见原表。`k=5` 列由原表的 `k=1` 均值加上 “+ Recursion” 增量得到：

| benchmark 与指标 | 执行器 / harness | 基础 | k=1 | k=5 parallel |
| --- | --- | --- | --- | --- |
| WorkBuddy 三领域宏平均 | GLM-5 / OpenCode | 64.2 | 75.7 | 79.6 |
| JobBench Score | Gemini 3.5 Flash / OpenCode | 31.5 | 36.0 | 39.0 |
| LAB Partial，逐标准通过率 | GLM-5 / OpenCode | 59.6% | 71.4% | 78.1% |

这三行说明：在作者的特定配置中，任务内改进与增加探索预算都带来了收益。它们使用不同指标，不能合成一个跨 benchmark 的统一成功率。

解释这些结果时，还有两个条件。其一，默认编辑模型与执行模型不同，不能把全部收益解释为同一个模型在零额外能力下自动变强。其二，主表的 `#Steps` 不能代替整个系统的总成本；执行器、编辑器、选择器与反思都需要计算资源。前面源码中的 `4k/3k` 已经说明，单步改进本身就有额外开销。

![论文 Figure 6 原图：横轴为每个任务消耗的总 token，纵轴为相对基础 harness 的分数增益，蓝色圆点表示 Harness² 在 k 等于 1 和 5 时的成本与收益](/images/harness2-recursive-agent-harnessing/original/total_cost.png)

*图 6：论文 Figure 6，JobBench 与 WorkBuddy-Bench 的计算量和效果比较。来源：[论文原图及说明][paper-cost]；[原始 SVG](/images/harness2-recursive-agent-harnessing/original/total_cost.svg)按原样保留。*

横轴是每个任务消耗的总计算量，以百万 token 为单位，采用对数刻度；纵轴是相对基础 harness 的分数增益。基础点接近零增益，蓝色圆点是 Harness² 的 `k=1`、`k=5`，蓝线标出图中已测配置的 Pareto 前沿。点越靠右，消耗的 token 越多；越靠上，得分提升越大。这里使用 Gemini 3.5 Flash / OpenCode，计算量包含最终交付前的执行与改进开销。

这张图把代价也展示出来了：从 `k=1` 增加到 `k=5`，两个 benchmark 的分数继续提高，token 消耗也随之增加。在作者比较的这些配置中，Harness² 位于经验 Pareto 前沿，意味着没有另一个已测点同时做到更省计算、得分更高。这个结论受模型、任务集和对比配置约束；token 数也不能直接换算成实际费用或墙钟耗时。

作者另外做了组件消融、同模型编辑与执行，以及经验转移实验。这些实验有助于判断方法的各个部分是否起作用，但不构成部署到任意业务都会增益的保证。本文没有复现论文跑分，也不据此给出线上收益或延迟承诺。

## 12. 落到 Agent 工程，最值得保留的设计

Harness² 提供了一套具体的改进对象：有文件、有差异、有对应轨迹，也有采用与放弃的记录。把这套方法用到自己的系统时，可以先保留三个约束。

**先固定可编辑接口。** 把常驻规则、按需流程、确定性脚本与运行时干预分清楚，再决定让编辑器改哪些文件。这样才有办法验证配置能否加载、限制上下文开销，以及回滚到哪个版本。

**让经验描述可检查的修改。** “下次仔细一点”缺少执行含义。更有价值的记录需要指出适用条件、具体组件和行为证据；无法归因时就记录混杂，证据不足时允许不入库。是否采用产物，与是否应把某条经验长期保存，应该分别决定。

**把任务完成检查留给独立证据。** 在 GUI 自动化里，动作返回成功、轨迹更短或者画面看起来合理，都可能与最终业务状态不一致。候选是否改善了定位、输入或恢复，仍然需要当前页面、执行回执与最终产物共同支持。这里是把项目设计迁移到 GUI 场景的工程判断，仓库目前并没有实现一套通用 GUI 执行适配。

Probe 还隐含着一个使用前提：同一任务允许被重复执行，而且候选之间能建立足够可比的环境。生成本地文件通常容易隔离；发邮件、提交订单、支付、修改共享后台数据，都需要可恢复的测试环境或专门的副作用控制。把 `k` 调大之前，先确认试跑本身是否成立。

这个项目最值得继续研究的问题，是如何稳定对应“改了什么”和“实际改变了什么行为”。当前实现已经用文件协议、轨迹对照和经验字段约束这件事；模型归因的可靠性、在线预算，以及带副作用任务的可比执行，仍然决定它适用于哪些实际场景。

## 源码阅读顺序与资料

建议按执行链路阅读，先跑 demo，再进入递归与经验部分：

1. [`demo.py`][demo]：最小任务、真实 Python 执行、确定性编辑器。
2. [`core/spec.py`][adapter]：任务适配协议与不携带分数的执行视图。
3. [`core/schedule.py`][task]：参考执行、模式调度、采用、历史前缀与恢复。
4. [`core/recursion.py`][parallel]：并行与串行的实际阶段安排。
5. [`core/context.py`][context]：证据树如何组织，哪些数据被隔离。
6. [`core/prompts.py`][propose]：提案、组合与经验归因的决策要求。
7. [`core/selection.py`][reflection]、[`core/library.py`][library]：匿名选择、完整记录反思、条目落盘。
8. [`tests/test_workflow.py`][tests]：上述工作流有哪些可执行保证。

项目与实验资料：[GitHub 仓库][repo]、[固定版本][commit]、[论文][paper]、[安装指南][setup]、[实验与网络限制][experiments]。

原始图表出自 Ruiyao Xu 等作者的论文和项目仓库。仓库图按原样转载；论文 SVG 仅等比渲染为 PNG，没有改动数据、标签或图例。论文采用 [CC BY 4.0][paper-license]，仓库许可证为 [Apache-2.0][repo-license]；具体文件、版本和来源见[图表来源说明](/images/harness2-recursive-agent-harnessing/original/SOURCES.md)。

中文补充图的可编辑源文件：[两层递归](/images/harness2-recursive-agent-harnessing/harness2-two-level-recursion.drawio)、[并行与串行](/images/harness2-recursive-agent-harnessing/harness2-parallel-vs-sequential.drawio)、[采用与经验](/images/harness2-recursive-agent-harnessing/harness2-evidence-and-adoption.drawio)。这些图依据本文核查的源码整理。

[repo]: https://github.com/google-research/harness2
[commit]: https://github.com/google-research/harness2/tree/1cfe254e8d25b15f37048c3730134686abe60335
[paper]: https://arxiv.org/abs/2610.14224
[paper-results]: https://arxiv.org/html/2610.14224v1#S3
[demo]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/demo.py#L30
[oc-surface]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/substrate/opencode.py#L35
[cx-surface]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/substrate/codex.py#L36
[surface-prompts]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/prompts.py#L97
[adapter]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/spec.py#L177
[propose]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/prompts.py#L824
[context]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/context.py#L105
[compose]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/prompts.py#L893
[stage]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py#L108
[validate]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/tree.py#L336
[parallel]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py#L343
[sequential]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py#L452
[ledger]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/ledger.py#L26
[selection-pool]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/selection.py#L93
[reflection]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/selection.py#L402
[experience]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/prompts.py#L1105
[library]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/library.py#L106
[task]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/schedule.py#L566
[domain]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/schedule.py#L669
[judge]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/judge.py#L90
[tests]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/tests/test_workflow.py#L31
[resume]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/schedule.py#L350
[setup]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/SETUP.md
[experiments]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/docs/EXPERIMENTS.md
[repo-pipeline]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/harness2_pipeline.png
[repo-components]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/components.png
[repo-recursion]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/harness2_recursion_modes.png
[paper-library]: https://arxiv.org/html/2610.14224v1#S4.F7
[paper-cost]: https://arxiv.org/html/2610.14224v1#S4.F6
[paper-license]: https://arxiv.org/abs/2610.14224
[repo-license]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/LICENSE
