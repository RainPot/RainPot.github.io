---
title: "重构 Agent 的外围大脑：Google Harness² 源码核心创新点拆解"
description: "抛开单纯的模型权重与 Prompt 迷信，Google Research 开源的 Harness² 提供了一种让 Agent 依据执行证据自动升级脚本、规则与工具流的框架。本文深入源码，拆解其 Propose-Probe-Compose 闭环与八大组件机制。"
date: "2026-10-19"
tags: ["AI Agent", "Agent Harness", "源码拆解", "自我改进", "Agent Memory", "评测"]
draft: false
featured: false
readingTime: 12
---

在构建智能体（Agent）的过程中，我们常常发现：同一个底层大模型，搭配不同的提示词模板、工具调用流程或后处理脚本，其在复杂任务上的表现会天差地别。这层围绕模型组织的“执行配置”——业内常称为 **Harness**，是决定 Agent 落地能力的真正护城河。

在传统的 Agent 工程里，Harness 的调优通常是人工的“苦力活”：工程师们翻阅失败的执行日志（Trace），猜测模型哪里理解错了，然后去改写 Prompt、增加一个新工具或是修补一段 Python 脚本，再次跑测。

为了打破这种人工干预的瓶颈，Google Research 提出了 [Harness² (Recursive Agent Harnessing)][paper]，并开源了其[核心框架代码][repo]。该框架的出发点非常纯粹：**不碰模型权重，完全通过“提议修改 - 试跑获取证据 - 采纳有效经验”的递归机制，让 Agent 学会自动改进自己的执行配置。**

本文基于 `google-research/harness2` 源码（[`1cfe254e`][commit]），从开发者视角剖析它的代码设计与主要创新点。

## 1. 核心创新一：不止于想，基于“执行证据”的 Propose-Probe-Compose 闭环

大模型在“自我反思（Self-Reflection）”时常常会遇到“幻觉”：它可能提出了一个听起来很合理的改进，但实际运行起来却由于 API 错误或者依赖问题而彻底崩溃。Harness² 最核心的创新在于它的 **Propose-Probe-Compose 闭环**：一切改进必须经过试跑（Probe）拿到实际的执行证据。

![Harness² 整体流程图：依次执行基础任务、提出修改、试跑验证并最终组合有效经验](/images/harness2-recursive-agent-harnessing/original/harness2_pipeline.png)
*图 1：Harness² 总体链路。通过试跑拿到真实证据后，再更新后续任务使用的改进经验。来源：[assets/harness2_pipeline.png][repo-pipeline]*

在源码 `core/recursion.py` 的调度中，一次改进并非简单的 LLM 问答，而是严谨的实验流：

1. **Propose（提出候选）**：框架分别从**通用视角 (INV)** 和**领域视角 (DOM)** 对当前的 Harness 提出修改建议。例如，针对一个算错账的任务，INV 视角可能会指出“模型缺少多步规划”，而 DOM 视角可能会发现“金额过滤脚本漏掉了负数”。
2. **Probe（试跑验证）**：框架将这些修改后的组件（可能是一段 Python 脚本，也可能是一个系统规则）真正投入执行环境试跑，生成包含了系统标准输出与错误日志的真实 `rollout.md`。
3. **Compose（组合生效）**：组合器（Composer）不是盲目相信提案，而是要对比基础执行和候选执行的 Diff 与结果。源码中的提示词明确警告：`Agreement is support, not independent proof.`（输出的一致性只提供支持，不是独立证明）。

这个基于“执行证据”的回路，解决了 Agent 自我改进中最致命的“越改越差”问题。

## 2. 核心创新二：八类可编辑组件，把执行边界交还给系统

只让 Agent 改系统提示词（System Prompt）是远远不够的。复杂业务任务往往需要长篇的领域知识、确定性的计算脚本，甚至是在工具循环（Tool Loop）中进行干预。

Harness² 设计了八类可被动态编辑的组件接口：

![八类可编辑组件图解：从 Context 到 Orchestration，全方位覆盖 Agent 执行周期](/images/harness2-recursive-agent-harnessing/original/components.png)
*图 2：八大组件职责图解。组件所处位置决定了其生命周期及上下文占用。来源：[assets/components.png][repo-components]*

从源码 `substrate/opencode.py` 来看，Harness² 把配置映射成了真实的文件树结构。Agent 可以按需编辑：
- **系统提示词 (`systemprompt.md`)**：决定基础角色。
- **行为规则 (`guardrails.md`)**：持续生效的约束条件。
- **长期记忆 (`LongTermMEMORY.md`)**：执行时读取的领域知识。
- **工具指导 (`tool_guidance.md`)**：给模型讲解如何使用现存工具。
- **子代理 (`AGENT.md`)**：可委派角色及其职责。
- **按需技能 (`SKILL.md`)**：模块化的工作流，按需加载，节省主上下文。
- **脚本 (`scripts/*.py`)**：确定性极强的逻辑处理（如数据格式化），这是大模型最容易犯错却最适合用代码接管的地方。
- **运行时插件 (`plugin/*.ts`)**：在工具调用过程中做 AOP 拦截。

这就使得“改进”不仅停留在语义层面，更能下沉到代码逻辑与系统架构层面。例如，在项目中一个自带的 Demo 里，求和任务因为初始的 Python 脚本带有 `if amount > 0` 导致负数被漏算。Harness² 通过 Propose 修改这段代码并 Probe 后，发现输出数字终于对了，从而采纳了新的脚本。这种对**可执行代码**的自我修正是纯 Prompt 反思无法企及的。

## 3. 核心创新三：两种递归搜索策略（Parallel 扩展与 Sequential 深入）

在算力预算充裕时，如何更好地在广阔的“配置修改空间”中探索？Harness² 在 `core/recursion.py` 中实现了两种不同的递归探索模式：

![并行与串行递归模式](/images/harness2-recursive-agent-harnessing/original/harness2_recursion_modes.png)
*图 3：Parallel（并行展开）与 Sequential（串行深挖）机制对比。来源：[assets/harness2_recursion_modes.png][repo-recursion]*

- **Parallel 模式（扩大探索宽度）**：基于初始状态 $H_0$，同时并行孵化多个独立的修改提案（`k` 份 INV 和 `k` 份 DOM），所有候选各自试跑后，Composer 从整个候选池里择优组合。这种方式不容易陷入局部最优。
- **Sequential 模式（单线深入）**：类似梯度下降，每一次组合得到新配置 $C_1$ 后，将其作为起点再进行下一轮改进生成 $C_2$。适用于任务特别复杂、需要分步递进修正的场景。

这种工程设计将 Agent 改进过程抽象成了可控的树搜索过程，研究者可以依据任务特性和算力花销（Token 成本）自由调节探索广度与深度。

## 4. 核心创新四：跨任务记忆沉淀与严苛的评测隔离

Harness² 并不只着眼于单次任务的通过率，它还有一个 `Library` 机制，用于跨任务迁移经验。

在执行结束后，通过 `core/selection.py` 与 `core/library.py` 的协同，系统会通过匿名盲选从候选池挑选最终输出（隔绝了参考执行的偏差）。随后，反思模块开始提炼经验，要求填入 `cue`（情境）、`lesson`（修改动作）和最重要的 `evidence`（行为依据）。只有满足完整的归因链条，这段修改后的组件才会被收入经验库。

在执行新任务时，系统不再像某些框架那样盲目继承上一轮的脏状态，而是重新从公共基础配置启动，再通过检索 `INDEX.md` 选择性加载适用的修改。这种设计极大减轻了“专用补丁不断累积导致上下文灾难”的问题。

![经验库带来的分数增益对比图](/images/harness2-recursive-agent-harnessing/original/library_transfer.png)
*图 4：经验库的作用。不使用参考执行反馈直接修改（左）效果极差，但有了跨任务的经验库介入后，性能有显著回升。来源：论文 Figure 7。*

同时，为防止 Agent 为了刷榜而在迭代中直接“白嫖” Benchmark 的标准答案，Harness² 的代码架构做了严格的隔离：
改进链路坚决不读入 Benchmark Judge 的分数和答案。成功与否的判断，只能基于 `BenchmarkAdapter` 提供的工具返回、应用状态和输出产物本身。这也是评价一个 Agent 是否具备真实业务落地价值的硬标准。

## 5. 落地启示：对 APP 自动化测试与 Mobile QA 的价值

跳出论文的 Benchmark 刷榜语境，站在 **APP 自动化测试与 Mobile QA** 领域专家的视角来看，Harness² 提供了一套极具杀伤力的工程范式。

当前的 GUI Agent（如各种 UIAutomator 包装项目或视觉 VLM 测试工具）在实际企业落地的最大痛点是**脆弱性**：弹窗稍有变化、网络加载多等了 2 秒、或者元素的层级变深了，基于固定 Prompt 的 Agent 就会频繁中断。如果按照 Harness² 的思路来重构 QA 基础设施：

1. **从口头约束转向“脚本与插件沉淀”**：面对一个顽固的“动态弹窗干扰”问题，不要只是告诉大模型“你要关闭弹窗”，而是让 Agent 在试错后，将识别并关闭弹窗的逻辑沉淀为一段稳定的前置 `Script` 或是封装成专门的 `Skill` 配置文件。
2. **基于“执行截屏与回放（Trace）”的盲选演进**：在自动化用例执行失败时，框架并行提出多种恢复策略（比如尝试点击页面其他空白处、尝试执行滚动、尝试重启 App）。全部 Probe 之后，比较哪个策略确实让 UI 恢复了可用状态，并把这条策略永久加入对应 App 的 `guardrails.md` 中。
3. **彻底抛弃断言（Assertion）焦虑**：测试工程师无需再手工编写极其脆弱的控件树断言，Agent 通过历次任务积攒的领域知识（Domain Library），能自己生成并迭代最适合当前页面的状态检查规则。

## 总结

Google 的 Harness² 没有在模型结构上炫技，而是下了一步务实的工程好棋：**让机器去干预自己运行时环境的源代码与配置体系**。用“修改配置 - 取证 - 确立因果”的科学实验循环，代替了不可靠的纯 Prompt 自我开导。

无论是开发通用智能体还是专门领域的测试自动化引擎，Harness² 中的八类组件抽象与 Propose-Probe-Compose 闭环，都值得被纳入下一代 Agent 架构的基础设计中。

---

*参考资料与源码约定：本文代码核查时间为 2026 年 10 月 19 日，版本 [`1cfe254e`][commit]。论文：[Harness²: Recursive Agent Harnessing for an Open World][paper]。图表版权归原作者所有，并依据相关协议引用（具体见[SOURCES.md](/images/harness2-recursive-agent-harnessing/original/SOURCES.md)）。*

[repo]: https://github.com/google-research/harness2
[commit]: https://github.com/google-research/harness2/tree/1cfe254e8d25b15f37048c3730134686abe60335
[paper]: https://arxiv.org/abs/2610.14224
[repo-pipeline]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/harness2_pipeline.png
[repo-components]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/components.png
[repo-recursion]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/harness2_recursion_modes.png
