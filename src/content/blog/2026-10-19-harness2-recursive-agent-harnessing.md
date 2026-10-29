---
title: "Harness² 源码深度拆解：Agent 如何从执行证据中改进运行配置"
description: "抛开单纯的模型权重与 Prompt 迷信，深入源码解析 google-research/harness2 的两层递归、八类可编辑组件、经验入库、盲选与评测隔离，并探讨其对 GUI Agent 与移动端自动化测试的启示。"
date: "2026-10-19"
tags: ["AI Agent", "Agent Harness", "源码拆解", "自我改进", "Agent Memory", "评测"]
draft: false
featured: false
readingTime: 25
---

同一个大模型，换一份系统提示词、一个工具使用流程，或者一段数据处理脚本，在复杂任务上的结果往往天差地别。在 Agent 工程实践中，这种差异反复出现：**模型能力只是天花板，围绕模型组织的执行配置（Harness），才是决定其能否在特定业务中落地的底盘。**

这层配置通常包括 Prompt、工具指导、记忆、Skills、子代理、脚本和运行时插件。在以往的工程中，Harness 调优是高度依赖人工的“苦力活”。Google Research 开源的 [Harness² (Recursive Agent Harnessing)][repo] 把这套改进过程做成了**可执行的代码框架**：保持模型权重不变，让 Agent 在当前任务上自主提出 Harness 修改、在沙盒中试跑并获取差异证据，最后把验证有效的修改沉淀为跨任务经验。

本文基于 `google-research/harness2` 源码（[`1cfe254e`][commit]），沿着其核心的 `Propose-Probe-Compose` 执行链路，从代码架构、运行开销与设计哲学的维度进行深度拆解，并探讨其在 APP 自动化测试与 GUI Agent 领域的落地价值。

![Harness² 总体链路：蓝色区域依次执行基础任务、提出修改、试跑并组合配置，右侧更新后续任务的改进经验](/images/harness2-recursive-agent-harnessing/original/harness2_pipeline.png)
*图 1：Harness² 的总体链路。蓝色框内是单次任务内的自我改进循环，右侧则是跨任务的经验沉淀。来源：[assets/harness2_pipeline.png][repo-pipeline]*

## 1. 从一个直观的代码 Bug 开始：负数为什么漏算了？

要理解 Harness² 是怎么工作的，最快的方式是看源码中自带的 `harness2/demo.py` 账本计算例子。

假设任务要求 Agent 对 CSV 中所有带符号的金额求和。
输入的账本源文件包含：
```text
100.25
-20.10
5.00
```
Agent 携带的“基础配置”中有一段用于辅助计算的 Python 脚本，其关键代码如下：
```python
# 初始缺陷脚本
total = sum((amount for amount in amounts if amount > 0), Decimal(0))
```
显然，这个脚本带有一个 `if amount > 0` 的过滤条件，导致结果输出 `105.25`，而正确结果应该是 `85.15`。

在传统的纯 Prompt 反思体系下，模型可能会输出一句空洞的：“我下次会注意把负数也加进去”。但这无法影响下一次独立的 Python 脚本调用。

而在 Harness² 的工作流中：
1. **提出差异 (Propose)**：系统识别到基础执行的错误，提议修改这段 Python 脚本，移除正数过滤条件，并生成针对代码文件的 `harness.diff`。
2. **带入试跑 (Probe)**：框架将修改后的文件部署到沙盒中执行。
3. **组合确证 (Compose)**：系统获取到了**新的标准输出确实变成了 `85.15`** 这一执行证据。从而正式采纳了这个 Harness 修改。

这个例子深刻揭示了 Harness² 的核心逻辑：**修改的是会影响下一次执行的实体文件（代码、规则文本），观察的是这些文件改变后引发的真实系统行为。** 一句反思，只有落实到配置上并经过试跑验证，才有价值。

## 2. 八类核心组件：让大模型接管“执行边界”

如果只允许修改 System Prompt，Agent 的改进上限是非常低的。Harness² 在 `substrate/opencode.py` 中，将 Agent 运行时的上下文和工具抽象成了一棵**可被大模型随时编辑的文件树**。

![八类可编辑组件](/images/harness2-recursive-agent-harnessing/original/components.png)
*图 2：八类组件按运行时职责分布，覆盖从上下文构建、工具接口到中间件与子代编排的全流程。来源：[assets/components.png][repo-components]*

项目明确定义了这八类组件对应的物理文件及其职责：

| 组件 | OpenCode 映射路径 | 影响的核心行为与生命周期 |
| :--- | :--- | :--- |
| **系统提示词** | `systemprompt.md` | 基础角色设定，常驻上下文。 |
| **行为规则** | `guardrails.md` | 持续生效的约束条件与纪律（如：不能随意删除数据库）。 |
| **长期记忆** | `LongTermMEMORY.md` | 执行时读取的业务领域知识，作为外部挂载内容。 |
| **工具指导** | `tool_descriptions/tool_guidance.md` | 规定何时、以及怎样编排使用现有工具，影响工具循环。 |
| **子代理** | `sub_agents/<name>/AGENT.md` | 复杂任务的可委派角色及职责说明。 |
| **Skills** | `skills/<name>/SKILL.md` | 按需加载的独立流程与操作知识，节约主进程上下文。 |
| **脚本** | `scripts/<name>.py` | 确定性的计算与辅助逻辑（如数据清洗），由代码而非 LLM 生成内容接管。 |
| **运行时插件** | `plugin/<name>.ts` | 拦截工具调用，进行中间件级别的校验或数据改写。 |

**字符预算与硬约束限制**：
看代码可以发现，在 `OPENCODE_SURFACE` 中，常驻文本（如 prompt、guardrails）的预算上限被严格限制在 **24,000 个字符**，而适配 Codex 的版本则设为 **8,000 个字符**。
为什么要有这个限制？因为框架鼓励 Agent 把复杂的逻辑抽离成按需加载的 Skill 或独立执行的 Python Script，而不是一味地往 Prompt 里塞垃圾信息导致“注意力丢失”。

在正式执行前，`tree.validate()` 会进行严格的确定性检查，比如：脚本是否能编译？技能触发条件是否存在语法错误？是否存在路径逃逸？如果组件修改不合法，在拿到错误后重试一次，若依然失败，则回滚退回当前配置。

## 3. 深入 Propose-Probe-Compose 源码逻辑

打开 `core/prompts.py` 和 `core/recursion.py`，我们可以看到“改进”并非单轮对话，而是有着极其严格的实验证据链。

### 3.1 Context 构建：只给模型看“局部证据”
`context.build()` 会为编辑会话准备一棵严谨的证据树，包含参考执行 `rollouts/`、产物清单 `deliverables/`，以及当前各种提案的目录 `pool/<label>/`。
为了防止 Token 溢出，代码中对交付物的展示做了限制（`proposer_deliverables="names"`），只让模型看到修改带来了哪些文件的变化，而非把全部产物文本塞入。

### 3.2 两种视角的 Propose
模型从两个正交视角提交修改：
- **INV（通用行为视角）**：比如“遇到复杂元素应该先打印 DOM 树”，针对上下文管理、工具编排的跨任务通病。
- **DOM（领域视角）**：针对当前特定业务的习惯，例如“在这个报销系统中，货币符号前有空格”。

源码中规定的优先级极其实用：**先找执行轨迹中的分歧 -> 再找反复报错的具体错误 -> 最后考虑可能存在的风险。** 这避免了大模型一上来就无中生有地制定大而空的“最佳实践”。

### 3.3 Compose 阶段：证据支撑，而非盲信
当不同视角的候选配置在沙盒中试跑（Probe）后，会来到 `Compose` 阶段。
在 `prompts.py` 的 `compose()` 提示词中有一句堪称灵魂的准则：
> *"Agreement is support, not independent proof."*

意思是，如果两份试跑都生成了正确的文件，这只是提供支持，你需要对比它们的执行轨迹。如果某个候选虽然没报错，但轨迹中丢失了某个必要的安全校验步骤，Composer 需要识别出这种“退化风险”，甚至选择拒绝组合，回退到原始 Harness。

## 4. 探索成本：Parallel 与 Sequential 模式的调度

如何在庞大的配置空间里搜索？`core/recursion.py` 设计了由参数 `k` 控制的两种探索模式：

![并行与串行递归](/images/harness2-recursive-agent-harnessing/original/harness2_recursion_modes.png)
*图 3：Parallel（并行）从同一基础展开候选池；Sequential（串行）则是步步递进，将前轮修改带入后轮。来源：[assets/harness2_recursion_modes.png][repo-recursion]*

**1. Parallel (扩大探索宽度)**
- 从基础配置出发，提出 `k` 个 INV 候选与 `k` 个 DOM 候选。
- 得到 `2k` 份独立的试跑证据。
- 发起 `k` 个相互独立的组合会话，并再次执行，最终选择出最优的配置。
这种方式避免了陷入死胡同，适用于一次性横向寻找最优解。

**2. Sequential (沿着配置深度挖掘)**
- 连续执行 `k` 轮。第二轮的起点是第一轮的产物 `c1`，而不是公共基础配置。
- 最终候选池包含 `c1` 到 `ck` 的所有中间产物。
这种方式类似于梯度下降，适用于需要剥洋葱般层层递进解决的深水区任务。

在 `core/ledger.py` 中我们可以看到清晰的数学开销：
一次任务的真实执行次数 $R = 4k$，改进计算阶段 $P = 3k$。
也就是说，如果设 $k=5$，为了完成 1 次任务，Agent 会在背后默默启动多达 20 次的沙盒执行、15 次的配置编辑与组合分析。这是一个典型的**用算力（Scaling Inference Compute）换取业务成功率**的策略。

## 5. 跨任务记忆与严格的“评测隔离” (Benchmark Isolation)

在单次任务里调优后，最关键的一步是把局部经验泛化到后续任务。
在 `core/selection.py` 中，采用哪份最终产物是**匿名盲选**的，选择器甚至不知道各个产物对应的 Harness 来源。

### 采用与提炼的双轨制
选中某个输出，只代表它通过了当前测试。但“经验库入库”却极为严苛。
`core/library.py` 和 `reflect_adoption()` 会检查完整的任务内修改记录。反思模型必须结构化地输出以下字段：
- `cue`：情境触发词。
- `lesson`：具体的 Harness 修改动作。
- `evidence`：具体哪一段执行行为的对照支撑了这条经验。
- `confidence`：信心度。

如果由于多个组件混杂修改，无法归因出到底是哪行代码起了作用，模型必须如实标记为 `confounded`。如果证据不充分，框架甚至会返回 `NO_ENTRY` 拒绝入库。

![跨任务迁移效果](/images/harness2-recursive-agent-harnessing/original/library_transfer.png)
*图 4：经验库跨任务转移的效果验证。来源：论文 Figure 7。*

### 坚守网络防线，杜绝“评测泄露”
整个系统被设计成不向 Agent 暴露 Benchmark 的 Judge 分数和参考答案。
源码里的 `RunView` 视图主动过滤了得分；`core/judge.py` 被设定为仅在所有选择完毕后，通过独立的离线命令调用 `score()`。
这个细节非常重要，它保证了 Harness² 所取得的提升（如图 4 所示）是来自于真实的业务验证，而不是大模型靠阅读答案“作弊”得来的。

## 6. 核心落地思考：对 APP 自动化测试与 Mobile QA 的颠覆

在深入拆解完 Harness² 的源码后，作为 GUI Agent 和自动化测试从业者，我认为它提供的思路恰好击中了当前 UI 自动化的核心痛点——**脆弱性**与**重构成本高昂**。

如果你用当前的 VLM Agent 做移动端自动化，最大的噩梦莫过于：今天写好的 Agent，明天因为 App 弹了一个营销弹窗，或者页面加载慢了 2 秒，整个任务就直接 Crash。

Harness² 带来了怎样的降维打击？

1. **从“空洞的 Prompt 安抚”转向“稳定的防御脚本”**
   当 Agent 发现自己由于广告弹窗导致点击不到目标元素时，以往的做法是把“遇到非预期弹窗先点击右上角关闭”这句话塞进系统提示词。但在 Harness² 架构下，DOM 视角的编辑器（Proposer）会在失败后直接在 `guardrails.md` 里增加明确的触发规则，甚至直接生成一个前置的 Python/JS 检查脚本 (`check_and_close_popup.py`)。大模型把脏活累活交给了确定性的代码。
2. **利用试跑（Probe）对抗页面漂移**
   GUI 测试的最大痛点是元素定位符 (XPath/ID) 的过期。通过 Parallel 模式，Agent 在一次失败后，可以并行尝试 5 种不同的定位修改方案（有的基于文本，有的基于视觉 OCR，有的基于相对坐标），在沙盒里分别试跑 `2k` 次。哪种定位策略没有报错且进入了下一级页面，就采纳哪种策略。整个**定位自愈 (Self-Healing)** 过程不再需要人工介入代码库。
3. **基于验证结果沉淀领域知识库**
   例如对于小红书、淘宝等不同特征的流式内容瀑布流，Agent 可以在不断滑动加载的过程中，将判断“到底滑动到底没有”的经验总结入库（`EXPERIENCE.md`）。在后续测试另一款具备相似瀑布流的 App 时，Agent 会在启动初期的基线配置中自动挂载相关经验，极大地缩短冷启动试错时间。

## 总结

Harness² 是对当前“Prompt Engineering 万能论”的一次严肃拨乱反正。
它通过极其严谨的代码组织（八大组件表面）、科学的验证链路（Propose-Probe-Compose）以及克制的经验抽象（Evidence-based Library），赋予了 Agent 真正在工程侧**自己修改自己代码与配置**的能力。

尽管这种 `4k` 倍的算力花销在当前线上实时系统（Online Serving）中显得极其昂贵，但如果在**离线测试、RPA 重构、CI/CD 自动化检测**等对延迟不敏感的场景里使用，它将有望颠覆目前手工维护自动化脚本的工作流。

---
*本文代码拆解基于 google-research/harness2 仓库的 [1cfe254e][commit] 版本。引用图表按原样保留自原始项目或由论文 SVG 等比渲染（依据 Apache-2.0 及 CC BY 4.0 协议，详情见 [SOURCES.md](/images/harness2-recursive-agent-harnessing/original/SOURCES.md)）。*

[repo]: https://github.com/google-research/harness2
[commit]: https://github.com/google-research/harness2/tree/1cfe254e8d25b15f37048c3730134686abe60335
[repo-pipeline]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/harness2_pipeline.png
[repo-components]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/components.png
[repo-recursion]: https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/assets/harness2_recursion_modes.png
