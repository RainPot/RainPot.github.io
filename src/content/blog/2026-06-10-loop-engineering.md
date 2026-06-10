---
title: "Loop Engineering：把提示词变成可验证的自治回路"
description: "全网搜索 Loop Engineering 之后，我对这个概念的理解：它不是替代 prompt engineering，而是把触发、上下文、工具、验证、状态和停止条件工程化，让 AI Agent 可以在边界内持续推进任务。"
date: "2026-06-10"
tags: ["Loop Engineering", "AI Agent", "Agent Harness", "Context Engineering"]
draft: false
featured: true
readingTime: 14
---

过去几年我们一直在学怎么写提示词。后来大家发现，提示词写得再漂亮，如果上下文错了、工具不好用、没有测试、没有状态记录，Agent 还是会在长任务里迷路。

这两天英文圈开始密集讨论 **Loop Engineering**。我搜了一圈 Addy Osmani、Mem0、Lushbinary、DataScienceDojo、Anthropic、Martin Fowler 以及 ReAct / Reflexion 这些相关材料后，觉得这个词虽然有 buzzword 味道，但背后确实指向一个越来越重要的工程问题：

**我们不只是提示 Agent，而是在设计一个系统，让系统决定什么时候提示 Agent、提示什么、给它哪些上下文、允许它碰哪些工具、怎么判断它真的完成，以及什么时候必须停下来。**

这篇文章不想把它讲玄。我的结论很直接：Loop Engineering 不是一种新模型，也不是“让 AI 自己无限循环”。它是 Agent 工程里更外层的一套控制系统设计。

## 一句话定义

我会这样定义 Loop Engineering：

> Loop Engineering 是设计、实现和调优 AI Agent 外层控制回路的工程实践。它关注触发器、目标规格、上下文与记忆、工具权限、验证信号、状态持久化、停止条件和人工关口，而不是只关注单次 prompt 写得好不好。

这个定义里有三个关键词。

第一，**外层控制回路**。Agent 自己内部已经有感知、思考、行动、观察的循环，ReAct 早在 2022 年就把 reasoning 和 acting 交织起来讲清楚了。Loop Engineering 站在更外面，设计的是“系统怎么反复驱动 Agent”。

第二，**验证信号**。没有验收，loop 只是重复运行；有了可验证目标，它才知道什么时候该继续、什么时候该停。

第三，**状态持久化**。长任务不会都塞在一次上下文里，必须有进度文件、任务板、测试结果、记忆或日志，让下一轮知道前面发生过什么。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="Loop Engineering 在 AI Agent 工程栈中的位置" src="/images/loop-engineering/concept-stack.svg" style="width: 760px; max-width: none; margin: 0;" />
</div>

这张图想表达的是：Prompt Engineering 仍然有用，但它优化的是一次输入；Context Engineering 优化一次调用看到什么；Harness Engineering 优化单个 Agent 的运行时；Loop Engineering 则关心一个跨回合系统如何自我推进。

## 它为什么现在冒出来

Loop Engineering 不是凭空冒出来的新概念，它更像几个已有方向合流之后，被重新命名了。

ReAct 证明了模型可以在推理和行动之间反复切换：思考下一步，调用工具，观察结果，再调整计划。Reflexion 往前走了一步，让 Agent 根据反馈写下反思，把经验放进 episodic memory，下一轮再用。

到了工程侧，Anthropic 的 Agent 文章把工作流和 Agent 分开：工作流走预定义代码路径，Agent 则动态决定工具和步骤。Martin Fowler 站在 harness engineering 的角度，把约束拆成 feedforward 和 feedback，也就是行动前的引导和行动后的传感器。

所以 Loop Engineering 的新意不在“循环”二字。循环早就有了。它真正强调的是：当 Agent 可以自己跑很多轮、跨很多上下文窗口、接入真实工具之后，我们要像设计生产系统一样设计它的控制面。

换句话说，过去我们在问：

```text
我下一句应该怎么提示模型？
```

现在更有价值的问题变成：

```text
谁来发现工作？
谁来拆任务？
谁来运行 Agent？
谁来验收结果？
状态写到哪里？
失败几次必须停止？
哪些动作必须交还给人？
```

这个问题一旦成立，Loop Engineering 就不只是一个名词了。它变成了 Agent 产品化必经的一层。

## 一个 loop 到底长什么样

一个最小可用的 loop，不需要一上来就多 Agent、自动发 PR、自动部署。它至少要有下面这些控制点。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="Loop Engineering 的闭环控制点" src="/images/loop-engineering/control-loop.svg" style="width: 760px; max-width: none; margin: 0;" />
</div>

图里最重要的箭头有两条。

第一条是顶部主路径：触发器发现任务，目标规格定义完成态，上下文与记忆提供背景，Agent 执行，产出候选结果。

第二条是底部回路：候选结果先进入验收器。未通过就写入状态账本，经过停止器判断是否继续；通过也不代表自动发布，涉及高风险动作时还要经过人工关口。

所以 loop 和普通自动化脚本的区别在这里：脚本按固定步骤走完；loop 会观察结果、更新状态、决定下一步，并在必要时重试或退出。

## 六个设计原语

我理解的 Loop Engineering，核心就是把六个原语设计清楚。

| 原语 | 要回答的问题 | 常见实现 |
| --- | --- | --- |
| 触发器 | 什么情况下启动？ | cron、PR 事件、CI 失败、人工 `/goal` |
| 目标规格 | 什么叫完成？ | 测试通过、lint clean、验收清单、rubric |
| 上下文 | 每轮应该读什么？ | AGENTS.md、设计文档、issue、进度文件、最近日志 |
| 执行边界 | Agent 能碰什么？ | 工具白名单、沙箱、worktree、只读子 Agent |
| 验证器 | 谁证明结果可用？ | 单测、E2E、静态检查、LLM judge、人工抽检 |
| 状态与停止 | 下一轮怎么接上？何时停？ | progress.md、任务板、预算、轮数上限、无进展检测 |

这里最容易被低估的是“目标规格”。如果目标只是“把这个功能做好”，那 loop 会不断把自己的模糊理解当作完成标准。Anthropic 在长任务 Agent 文章里提到，他们会让初始化 Agent 先写出功能清单，并把每项都标成未通过。后续 Agent 每轮只做一个功能，并且只有认真测试后才能改状态。

这件事很朴素，但很关键：**先写完成态，再让 Agent 干活。**

## 最佳实践

### 1. 从无聊、重复、可验证的任务开始

适合 loop 的任务通常有三个特征：

- 输入来源稳定，比如 CI 失败、issue 队列、日志报警、每日数据报表。
- 完成标准明确，比如测试过、链接可访问、数字对得上、报告生成成功。
- 失败代价可控，比如只生成草稿、只开 PR、不直接改生产数据。

不适合的任务也很明显：目标含糊、业务判断重、需要强审美、外部副作用大、错误成本高。比如“每天自动重构核心架构并合并到主分支”这种，就不是工程成熟，而是把风险包装成自动化。

### 2. 把 done 写成机器能检查的东西

Loop 的停止条件不能只写“模型觉得完成”。更好的写法是：

```text
完成条件：
1. npm test -- --run 通过
2. npm run build 通过
3. 新文章页面里两张图 naturalWidth > 0
4. 人工确认后才 push
```

如果任务天然主观，可以把主观判断拆成 rubric，再用 LLM judge 或人工抽检补上，但不要把主观 judge 放在唯一验收位。能用确定性检查的地方，先用确定性检查。

### 3. Maker 和 Checker 分开

Addy Osmani 文章里反复强调的一点是：写代码的 Agent 不应该独自判定自己完成。这个判断很符合日常工程经验。人写 PR 也需要 reviewer，Agent 更需要。

常见拆法是：

| 角色 | 负责什么 | 权限建议 |
| --- | --- | --- |
| Explorer | 找上下文、读资料、列风险 | 只读 |
| Maker | 实现变更、产出草稿 | 限定工作区写 |
| Checker | 对照规格验收、跑测试、找遗漏 | 优先只读，必要时可建议修复 |
| Human | 合并、发布、付费、删改真实数据 | 最终确认 |

拆角色不是为了热闹，而是为了减少自证循环。Checker 的 prompt、工具和模型可以和 Maker 不同，目标是制造一点有用的摩擦。

### 4. 状态要落盘，不要只在对话里

长 loop 最怕下一轮“重新发明昨天的结论”。状态最好写到 Agent 每轮都能稳定读取的地方，例如：

- `progress.md`：记录已做、未做、失败原因、下一步。
- `task-state.json`：机器可读，适合更新 pass/fail。
- issue / Linear / Jira：适合团队协作。
- git commit 和分支：适合代码任务追踪。
- eval 报告：适合比较不同 prompt、模型和策略。

状态文件的粒度不要太散。我的经验是，能被下一轮直接拿来决策的状态才值得写；纯流水账会污染上下文。

### 5. 每个 loop 都要有保险丝

一个能自己继续的系统，也必须能自己停下来。最小保险丝至少包括：

- 最大轮数。
- 单轮超时。
- token 或成本预算。
- 同一工具连续失败上限。
- 无进展检测，比如文件、测试、任务状态都没有变化。
- 高风险动作人工确认，比如部署、删库、发邮件、花钱、改权限。

DataScienceDojo 的文章里有个很实在的提醒：没有停止条件时，loop 会跑到预算耗尽。这个说法听起来像玩笑，但长任务 Agent 真的很容易把“继续尝试”误当成“持续进展”。

### 6. 先把观测补齐，再谈自治

Loop 一旦跑起来，你要能回答：

- 它为什么启动？
- 它用了哪些上下文？
- 它调用了哪些工具？
- 它改了什么？
- 验收为什么通过或失败？
- 这轮花了多少 token、多少钱、多久？
- 和上一轮相比有没有进展？

这些信息最好形成 trace、日志或报告。没有观测的 loop 很危险，因为它失败时你只会看到一个结果，不知道中间哪一步开始跑偏。

## 一个最小落地模板

如果要在团队里试一个很小的 Loop Engineering 实践，我会从“每日 CI 失败巡检”开始。

```text
触发器：每天 09:30，或 CI 失败事件触发
输入：昨天失败的 workflow、最近提交、相关 issue
上下文：项目 AGENTS.md、测试运行说明、已知 flaky 列表
动作：总结失败类型，去重，给每类失败生成修复建议
验收：链接可访问，失败日志引用存在，建议对应到具体文件或命令
输出：只生成 Markdown 报告或 issue 草稿
停止：最多处理 20 条失败，最多重试 2 次，不能 push
人工关口：是否开修复 PR，由工程师决定
```

这个 loop 不酷，但很适合作为起点。因为它输入稳定、输出低风险、验证容易、价值清楚，而且不会一上来碰生产环境。

等这个 loop 稳了，再逐步增加能力：让它给简单失败开草稿 PR；让 Checker 子 Agent 只读审查；让人批准后再推送分支。每一步都能评估收益和风险，而不是一次性把自治程度拉满。

## 容易误会的地方

**误会一：Loop Engineering 会取代 Prompt Engineering。**

不会。Loop 里每个节点仍然由 prompt 驱动。差 prompt 放进 loop，只会更稳定地制造差结果。区别只是优化单位变了：从“单句提示”变成“控制系统”。

**误会二：Loop 越自动越高级。**

不一定。自动化程度越高，错误传播越快。真正高级的是边界清楚、验收可靠、状态透明、人工关口放在对的位置。

**误会三：多 Agent 天然更好。**

也不一定。多 Agent 会带来 token 成本、协调成本和审查成本。简单任务用一个 Agent 加确定性检查，往往比三四个 Agent 互相讨论更稳。

**误会四：只要有记忆，loop 就能长期变聪明。**

记忆是双刃剑。Mem0 的文章强调 memory-first design，是因为长 loop 确实需要记住偏好、历史和已尝试方案。但错误记忆、过期记忆和噪声记忆同样会把 loop 带偏。记忆要可检索、可更新、可删除，最好还能标注来源。

## 我的判断

如果只看名字，Loop Engineering 很像又一个 AI 行业流行词。但如果把它放到 ReAct、Reflexion、context engineering、harness engineering、agent evals、long-running agents 这条线上看，它其实是在给一个真实趋势命名：

**AI 编程和 AI 办公的交互单位，正在从一次对话，变成一个可运行、可观测、可验证的持续系统。**

这会改变工程师的工作重心。以前我们亲手推进每一步，现在我们要设计“推进每一步的机制”。以前我们写 prompt，现在我们还要写验收、状态、权限和退出条件。

我不认为人会因此从 loop 里消失。恰恰相反，越是能自动跑的 loop，越需要工程师对目标、边界和质量负责。Loop Engineering 最好的用法不是逃离理解，而是把重复劳动交给系统，把人的注意力留给判断、设计和最终责任。

## 继续阅读

- [Addy Osmani: Loop Engineering](https://addyosmani.com/blog/loop-engineering/)
- [Mem0: Loop Engineering for AI Agents: Memory-First Design](https://mem0.ai/blog/loop-engineering-for-ai-agents-memory-first-design)
- [Lushbinary: Loop Engineering: Designing Systems That Prompt AI Agents](https://lushbinary.com/blog/loop-engineering-ai-coding-agents-guide/)
- [DataScienceDojo: Agentic Loops, From ReAct to Loop Engineering](https://datasciencedojo.com/blog/agentic-loops-explained-from-react-to-loop-engineering-2026-guide/)
- [Anthropic: Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Martin Fowler: Harness Engineering for Coding Agent Users](https://martinfowler.com/articles/harness-engineering.html)
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)
