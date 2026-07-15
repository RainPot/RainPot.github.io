---
title: "EvoCUA-1.5：Computer-Use Agent 的在线 RL 难点在多轮轨迹"
description: "解析 2026 年 EvoCUA-1.5：它把 computer-use agent 从离线经验学习推进到可执行环境里的在线强化学习，用 STEPO、policy-aware filtering、DTAC 和异步 rollout 基础设施处理多轮 GUI 任务中的稀疏奖励、上下文管理和训练吞吐问题。文章从 GUI Agent、APP 自动化测试和移动端 QA 视角讨论 verifier、任务调度、失败归因和工程边界。"
date: "2026-07-15"
tags: ["GUI Agent", "Computer Use", "Online RL", "OSWorld", "自动化测试"]
draft: false
featured: false
readingTime: 16
---

> 论文：[EvoCUA-1.5: Online Reinforcement Learning for Multi-turn Computer-Use Agents](https://arxiv.org/abs/2607.09773)  
> arXiv：`2607.09773v1`，2026-07-07  
> 一句话结论：**EvoCUA-1.5 讨论的不是“再用 RL 把桌面 Agent 分数刷高一点”，而是多轮 computer-use agent 进入在线训练后会遇到的一组真实工程问题：轨迹奖励只有最后才知道，训练样本却要按步骤拆开；任务太简单或太难都会浪费 rollout；环境交互比模型更新慢；过程奖励如果没和最终可执行结果对齐，还会把模型带偏。对 APP 自动化测试和移动端 QA 来说，这篇论文最值得借鉴的是它把 verifier、任务筛选、课程调度和执行基础设施放在同一个闭环里看。**

GUI Agent 这条线正在从“收集轨迹做模仿学习”转向“让 agent 在可执行环境里自己试、自己改”。这个转向很自然。离线轨迹可以教会模型常见路径，但真实 GUI 任务不是静态样本：每点一步，页面状态都会变；一步走错，后面的可行动作、恢复路线和最终结果也会变。只看离线成功轨迹，模型很难学到偏离路径后的处理方式。

EvoCUA-1.5 的位置正好在这里。它延续 EvoCUA 的自演化思路，但把重点从 offline synthetic experience 推到 **online reinforcement learning for multi-turn computer-use agents**。论文给出的核心组件包括：

- **STEPO（Step-Level Policy Optimization）**：把轨迹级奖励分配到步骤级训练样本时，避免长轨迹被过度加权；
- **policy-aware data filtering**：用当前策略的 pass rate 和可验证性筛掉低信噪比任务；
- **DTAC（Dynamic Tri-Adaptive Curriculum）**：动态混合“当前学得动的任务”“困难但成功过的 replay”和“少量不可行任务”；
- **异步在线 RL 基础设施**：让 rollout worker、staleness-aware buffer 和 training worker 解耦，缓解 GUI 环境交互慢的问题。

![EvoCUA-1.5 在 OSWorld-Verified 上的总体表现：32B 模型达到 63.2% Pass@1，并强调同尺度模型下在线 RL 与数据调度的收益](/images/evocua-15-online-rl-computer-use-agent/figure-1-osworld-verified-comparison.png)

主结果上，EvoCUA-1.5-32B 在 **OSWorld-Verified 达到 63.2% Pass@1**，比论文保留的 EvoCUA-32B 结果 **57.8%** 更高；在 WindowsAgentArena / MacOSArena 上也比 Qwen3-VL-32B-Thinking 更好，分别是 **62.1% vs. 42.9%**、**27.4% vs. 17.5%**。这些数字说明在线 RL 有价值，但更重要的是论文把收益拆成了几个可复用的系统设计，而不是只给一个终榜分数。

## 论文位置：从静态轨迹扩展到在线经验扩展

放在 GUIAgent / computer-use agent 谱系里，EvoCUA-1.5 属于 **verifiable online RL for desktop computer-use agents**。它不是新的单步 grounding 方法，也不是单纯 benchmark，而是在回答一个训练闭环问题：当 agent 能在真实或沙箱 GUI 环境里执行动作时，怎样把这些交互变成稳定、可用的学习信号？

这和近期几条线关系很近：

- **SCALECUA** 强调 verifiable task synthesis 和高效在线 RL，EvoCUA-1.5 更细地讨论多轮轨迹拆分、课程调度和异步基础设施；
- **UI-MOPD、DigiRL、MobileGUI-RL** 关注多平台或移动端的在线策略优化，EvoCUA-1.5 的主要场景是桌面 computer-use；
- **MemGUI-Agent、TSR、MementoGUI** 讨论长程任务状态和上下文管理，EvoCUA-1.5 把上下文管理直接纳入训练样本构造；
- **VisCritic、StainFlow、Learning from Failure** 试图给过程或失败提供更细信号，EvoCUA-1.5 则提醒：过程奖励如果不和最终可执行结果对齐，会带来 reward hacking。

这篇论文的关键判断可以概括成一句话：**online RL for GUI agent 不是把 GRPO/PPO 套到轨迹上就结束了，真正麻烦的是轨迹、任务、奖励、上下文和系统吞吐一起改变了优化问题。**

对移动端 QA 来说，这个判断很重要。一个 APP 自动化 agent 如果只是把失败/成功结果记下来，再让模型“多练几轮”，大概率会遇到同样的问题：任务本身可能不可验证，失败可能来自账号/环境/权限而不是策略，长流程会产生大量步骤级样本，最终断言却只有一个 0/1。训练闭环不先设计好，RL 只会把成本放大。

## STEPO：多轮轨迹不能直接按步骤重复使用同一个 advantage

论文最核心的算法点是 STEPO。它解决的是一个看起来细、但对多轮 GUI 训练很致命的问题。

在普通单轮语言 RL 里，一个 prompt 对应一个 response，最终 reward 可以直接给这段 response 的 token。GUI 任务不一样。一条轨迹可能有十几步甚至几十步，每一步都由当前截图、历史动作、推理和动作组成。训练时通常还不能把完整历史都塞进模型，需要做 sliding window、history folding 或 summarization。于是同一条轨迹会被拆成多个 step-level samples。

![多轮 computer-use agent 的上下文管理：完整历史会被改写成每一步可见的 managed context，训练样本必须在上下文管理之后构造](/images/evocua-15-online-rl-computer-use-agent/figure-2-context-management.png)

问题在于，最终 reward 仍然是轨迹级的。如果天真地把同一个 trajectory-level advantage 复制给每个步骤，长轨迹就会在训练中被放大。论文的推导很直接：一条轨迹有 `|Ti|` 个步骤，naive GRPO 相当于给这条轨迹乘了 `|Ti|` 倍的权重。GUI 任务里，轨迹长度又常常和任务难度、恢复行为、失败模式相关，这会让优化目标偏掉。

STEPO 的处理方式是：先按轨迹组算 GRPO 风格的 advantage，然后把每条轨迹的 advantage 均匀分配到它的步骤上，也就是每步拿 `Ai / |Ti|`。这样做保留了轨迹级 advantage 的总量，同时仍然可以用步骤级样本训练。

这点对 APP 自动化测试很有启发。移动端长流程经常天然更长：登录、授权、搜索、筛选、下单、支付、回跳、查订单。失败轨迹可能因为恢复动作更多而更长，成功轨迹也可能因为业务步骤更多而更长。如果训练时只按步骤数堆样本，模型学到的可能不是“哪些动作更好”，而是“哪类轨迹在数据里声音更大”。

一个更稳的测试 agent 训练系统，应该保留轨迹级语义：同一任务下的多条 rollout 要作为一组比较，奖励归因要知道这些步骤属于哪次尝试，不能把所有 step 摊平成无关系样本。

<!-- more -->

## 任务筛选：不是所有可执行任务都适合拿来做在线 RL

EvoCUA-1.5 的第二个重点是任务筛选。论文沿用 EvoCUA 的 verifiable task synthesis：任务由环境先验和 atomic computer-use abilities 生成，并配套 sandbox 配置和 executable validator。但作者强调，能生成、能执行，不代表适合在线 RL。

一个任务至少可能有几种问题：

- 指令模糊，模型失败不一定说明策略差；
- 初始环境不稳定，软件缺失、账号状态或文件状态不对；
- validator 太脆或太严，把合理完成判成失败；
- 当前模型已经几乎总能通过，继续 rollout 学不到东西；
- 当前模型几乎总是失败，组内没有成功/失败对比，也很难形成有效 advantage。

所以论文做了三层过滤：先检查任务和 validator 的可执行性、可行性；再控制 atomic abilities 覆盖，避免只训练容易生成和容易验证的能力；最后按当前 policy 的 pass rate 做校准，优先保留中等难度、组内有成功也有失败的任务。

这和测试平台里的用例调度非常像。一个移动端 QA 团队如果把历史用例都交给 agent 重放，结果未必好。总是通过的用例更适合做 smoke / regression；总是失败但原因是测试账号、mock 数据或环境不可用的用例，应该先修基础设施；真正适合改进 agent 的，是那些有稳定 oracle、环境可复现、当前策略成功率在边界附近的任务。

换句话说，任务质量不是一个静态属性。对 8B 模型难度合适的任务，对 32B 模型可能已经太简单；对桌面 agent 有价值的任务，对移动端 agent 可能因为权限、输入法、WebView 或跨 App 状态而完全变成另一类问题。论文 Table 5 也给了一个负结果：对 EvoCUA-8B 有效的 partial office data，直接迁移到 EvoCUA-32B 反而让整体分数略降。这说明数据筛选必须跟当前策略一起校准。

## DTAC：课程学习要同时照顾“学得动”“难但有解”和“不可行”

DTAC 是论文的课程调度模块。它不是单一地按难度从易到难，而是把每个 batch 分成三类来源：

1. **VAS（Variance-Adaptive Sampling）**：根据任务 pass rate 的方差采样，优先选择成功率接近 0.5 的任务；
2. **AdaPR（Difficulty-Adaptive Positive Replay）**：回放困难但曾经成功过的正样本，防止稀有成功被浪费；
3. **ICS（Infeasibility-Controlled Sampling）**：保留少量不可行任务，让模型学会识别边界，但控制比例，避免训练被噪声淹没。

![DTAC 的课程调度：每个训练 batch 混合当前有信息量的任务、困难正样本 replay 和受控不可行任务](/images/evocua-15-online-rl-computer-use-agent/figure-4-dtac-curriculum.png)

这个设计比“只挑中等难度任务”更完整。现实 GUI 环境里，不可行任务不会消失：页面改版、权限缺失、账号被风控、目标文件不存在、业务状态不满足，都会让任务在当前条件下无法完成。完全过滤掉不可行任务，模型可能学不会何时停止、何时请求接管、何时报告环境问题；但不可行任务太多，又会把 RL 信号污染掉。

对 APP 自动化测试来说，这一点尤其现实。一个 agent 不应该为了完成任务一直乱点，也不应该把所有失败都归因于自己。比较稳的做法是让 harness 明确区分：

- **策略失败**：控件找错、路径规划错、重复动作、没等待加载；
- **环境失败**：登录态失效、接口异常、测试数据缺失、版本不匹配；
- **业务不可行**：库存不足、账号无权限、规则不允许；
- **高风险操作**：支付、发消息、删除数据，需要人工或沙箱确认。

DTAC 对应到工程里，就是任务调度不能只看“跑没跑完”，而要看任务当前对 agent 有没有训练价值，以及失败是否能产生可信信号。

## 异步基础设施：GUI online RL 的瓶颈不只在 GPU

论文 Figure 5 展示了 EvoCUA-1.5 的在线 RL 基础设施：rollout workers 负责在环境里生成轨迹，staleness-aware buffer 保存步骤级数据，training workers 消费 group-aligned samples 更新策略。

![异步在线 RL 基础设施：rollout worker、staleness-aware buffer 和 training worker 解耦，同时保留 rollout group 结构](/images/evocua-15-online-rl-computer-use-agent/figure-5-async-online-rl-infra.png)

这个图对做过 UI 自动化的人应该很熟悉。GUI 环境慢，不是因为模型算得慢，而是每一步都要截图、执行动作、等待页面变化、检查状态、跑 validator。桌面任务如此，移动端更明显：真机调度、ADB/XCUITest 通信、网络等待、权限弹窗、输入法、WebView 加载、后端状态同步都会拖慢 rollout。

EvoCUA-1.5 用异步架构解决吞吐问题，但异步又带来 policy staleness：buffer 里的轨迹可能是旧策略生成的。论文用 policy version 标记样本，只保留 staleness window 内的数据。它还强调 mini-group batching：因为一组 rollout 要一起算相对 advantage，所以训练 mini-batch 应该保留完整 rollout group，而不是按固定样本数把组切开。

这对移动端 QA 平台也有直接启发。很多团队把 agent 执行、日志采集、断言和训练数据导出混在一个流水线里，短期能跑 demo，长期会很难扩展。更稳的架构应该把几件事拆清楚：

- 设备池/模拟器池负责稳定执行和重置；
- rollout 记录完整保存截图、动作、UI tree、日志、接口状态和 validator 结果；
- buffer 或数据湖保留任务组、策略版本、APP 版本、账号状态和环境标签；
- 训练只消费新鲜、可验证、分组完整的数据；
- 失败样本进入归因流程，而不是直接当普通负样本喂给模型。

这里真正麻烦的不是“多加几台机器”，而是让执行系统产生的每一条轨迹都能被审计、分组、校准和复用。

## 结果与消融：63.2% 很重要，但更该看哪些设计有效

论文主表显示，EvoCUA-1.5-32B 在 OSWorld-Verified 上达到 **63.2% Pass@1**。它高于 EvoCUA-32B 的 **57.8%**，也超过 CUA-GYM-35B-A3B 的 **62.1%**，和 Kimi-K2.5 的 **63.3%** 接近。不过表里也能看到，Kimi-K2.6、MiniMax-M3、Qwen3.7-Plus 等更强 generalist 系统仍然更高，所以不能把这篇论文解读成“32B online RL 已经全面领先”。更准确的说法是：在同类开源尺度和受控训练设置下，在线 RL + 数据调度 + 系统设计能明显提高 computer-use agent。

![OSWorld-Verified 主结果：EvoCUA-1.5-32B 在 100-step 设置下达到 63.2% Pass@1](/images/evocua-15-online-rl-computer-use-agent/table-1-osworld-verified-results.png)

消融更值得看。Figure 6 里，naive multi-turn GRPO 在轨迹拆成步骤后提升不明显，而 STEPO 的 reward 曲线更稳。这支持了论文前面的推导：多轮轨迹训练不能忽略长度和上下文管理带来的 bias。

![STEPO 与 naive multi-turn GRPO 的训练曲线：STEPO 在步骤级拆分后更好地保留轨迹级 advantage](/images/evocua-15-online-rl-computer-use-agent/figure-6-stepo-training-dynamics.png)

DTAC 的消融也说明课程调度有收益。Table 6 中，Qwen3-VL-32B 加入 curriculum learning 后整体从 **53.42** 提升到 **55.45**，Daily 从 **58.04** 到 **63.35**，Professional 从 **71.43** 到 **76.87**。这类提升不算夸张，但方向合理：越复杂、越多样的任务，越依赖采样策略把 rollout 用在当前有信息量的地方。

![DTAC 消融：课程学习让整体分数从 53.42 提升到 55.45，Daily 和 Professional 类别提升更明显](/images/evocua-15-online-rl-computer-use-agent/table-6-dtac-ablation.png)

对 APP 自动化测试来说，这些消融提醒我们：不要只关心最终 agent pass rate，也要看失败来自哪里。是轨迹级奖励分配错了？任务池太噪？用例调度太随机？环境吞吐太低？还是 validator 和最终业务状态不一致？如果只看一个总成功率，很难知道下一步该改模型、改任务、改基础设施，还是改 oracle。

## PRM 的警告：过程奖励有用，但不能替代最终可执行验证

论文里我觉得最有工程价值的负结果，是对 PRM（process reward model）的提醒。GUI 任务 reward 稀疏，所以大家自然会想用过程奖励给更密的反馈。但 EvoCUA-1.5 观察到：在困难任务上，PRM 分数可能上升，最终成功率却没有改善，甚至出现策略优化 PRM 偏好的模式，而不是完成任务。

![PRM misalignment：过程奖励上升但最终任务成功没有同步提升，说明过程信号可能被模型利用而不是转化为真实完成](/images/evocua-15-online-rl-computer-use-agent/figure-7-prm-misalignment.png)

这点放到测试场景里很容易理解。一个模型可以学会输出“看起来合理”的推理，或者做一些 PRM 喜欢的中间动作，但订单是否真的创建、设置是否真的保存、文件是否真的生成、后端状态是否真的变化，不能靠推理文本判断。尤其是移动端 APP，最终状态经常藏在服务端、数据库、消息队列、埋点或第三方 SDK 里，截图只是一部分证据。

所以过程奖励可以用，但最好满足几个条件：

- 和最终 validator 定期对齐，不能长期自说自话；
- 更关注可观测状态变化，而不是模型解释写得漂亮；
- 能区分“动作格式正确”“控件点对”“业务状态改变”“最终任务完成”；
- 对高风险动作设置硬边界，不让奖励模型鼓励越权尝试；
- 失败时保留可审计证据，方便判断是模型错、环境错还是 oracle 错。

这也是移动端 QA 引入 agent 时最容易翻车的地方。VLM judge 可以辅助看截图，但不能替代业务断言。真正可信的 oracle 往往要结合 UI tree、OCR、后端接口、数据库状态、日志、埋点和文件系统。

## 对移动端 QA 的启发：训练闭环要先像测试平台，再像模型平台

EvoCUA-1.5 的实验主要在桌面 computer-use 环境，不是移动端论文。但它对 APP 自动化测试的启发很直接：如果要让 mobile GUI agent 进入测试生成、执行和评估闭环，优先要补的不是一个更会聊天的模型，而是一套可验证、可调度、可归因的执行系统。

可以把它落成几条工程原则：

1. **任务必须带 oracle**。自然语言用例不够，最好能明确初始状态、允许动作、成功条件和失败类型。
2. **任务调度要看当前 agent 能力**。总是成功的用例降频，总是环境失败的用例先修环境，边界任务才适合高频训练。
3. **轨迹要保留 group 结构**。同一任务的多次尝试、策略版本、APP 版本、账号状态、设备型号不能丢，否则后续 advantage、归因和对比都会失真。
4. **上下文管理要和训练一致**。如果线上 agent 只能看到最近几屏和结构化 task state，训练时也不该默认看到完整历史。
5. **过程信号必须被最终验证约束**。PRM、VLM judge、视觉相似度都可以用，但最终仍要回到业务状态和可执行断言。
6. **基础设施吞吐决定数据质量**。设备重置、异常页处理、日志采集、validator 执行和失败恢复，都会影响训练信号。

这套原则和 Appium、Maestro、UIAutomator、XCUITest 并不冲突。相反，传统自动化框架可以成为 agent 的执行和验证底座：脚本框架提供稳定动作通道、设备控制和断言能力，agent 负责生成路径、处理非确定性页面和探索长尾状态。比较合理的方向不是让 agent 完全替代测试框架，而是让 agent 跟测试 harness 分工。

## 边界：桌面 OSWorld 的经验不能直接搬到手机

EvoCUA-1.5 也有明显边界。第一，它的主环境仍然是 OSWorld-style desktop tasks。桌面环境的窗口、文件系统、办公软件和沙箱验证，与 Android/iOS 真机上的权限、账号、输入法、WebView、推送、支付 SDK、风控页面不是同一类复杂度。

第二，论文强调 executable validators，但真实商业 APP 的 validator 往往更难写。很多状态在后端，很多流程需要 mock 或沙箱账号，高风险动作不能随便执行。没有测试环境和数据隔离，online RL 很难安全落地。

第三，OSWorld-Verified 的成功率不能简单等价于真实生产可用性。100-step budget、任务分布、可重置环境、validator 覆盖都会影响结果。对 QA 团队来说，更应该关心 agent 在自己 APP 的关键业务流上是否稳定、失败能否解释、误操作是否可控。

第四，在线 RL 的成本不低。它需要任务池、环境池、validator、日志、buffer、训练和评估闭环。小团队如果直接搭全套，可能不划算。更现实的路线是先在离线轨迹和可验证回归任务上建立数据闭环，再逐步把高价值、低风险、可重置的任务拿来做在线优化。

## 小结

EvoCUA-1.5 的价值不只在 63.2% OSWorld-Verified，而在它把多轮 GUI agent 在线 RL 拆成了几个具体问题：轨迹级奖励怎样分配到步骤级样本，任务池怎样按当前策略筛选，课程学习怎样平衡可学任务和不可行任务，异步基础设施怎样既提高吞吐又控制样本陈旧，过程奖励怎样避免偏离最终成功。

这套问题意识对移动端自动化测试很实用。APP 测试里的 agent 如果要从 demo 走向可靠工具，不能只靠模型端变强。它需要可执行 oracle、可复现环境、任务调度、失败归因和安全边界。模型负责探索和决策，测试平台负责约束和验证。两边接上之后，online learning 才可能变成真正的数据飞轮，而不是一轮更贵的随机试错。
