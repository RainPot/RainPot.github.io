---
title: "Xiaomi-GUI-0：Mobile GUI Agent 真正难的是跑在真机上"
description: "解析 2026 年 Xiaomi-GUI-0 Technical Report：它把 Mobile GUI Agent 的训练、rollout、异常页修复和 RealMobile 评测放进真机闭环，在 RealMobile 上达到 72.0% 成功率、AndroidWorld 上达到 78.9%。文章从移动端 QA 与 APP 自动化测试视角讨论真实设备、异常状态、失败飞轮、自动验证和工程边界。"
date: "2026-07-13"
tags: ["GUI Agent", "Mobile Agent", "Android", "Real Device", "APP 自动化测试"]
draft: false
featured: false
readingTime: 16
---

> 论文：[Xiaomi-GUI-0 Technical Report](https://arxiv.org/abs/2606.31410)  
> arXiv：`2606.31410v2`，2026-07-01  
> 项目主页：<https://seerray-lab.github.io/Xiaomi-GUI-0/>  
> 一句话结论：**这篇技术报告最值得看的地方，不是又做了一个手机 Agent，而是把问题从“模型在 benchmark 上会不会点屏幕”推进到“一个 Mobile GUI Agent 怎样在真实设备、真实账号、真实网络和异常页里稳定跑”。对 APP 自动化测试来说，这个转向很关键：如果训练和评测长期停留在模拟器、离线轨迹和干净页面上，模型迟早会在权限弹窗、登录态、风控、支付认证、WebView 和跨 App 状态里翻车。**

移动端 GUI Agent 这两个月已经很拥挤了。AndroidWorld、MobileForge、MemGUI-Agent、TSR、UI-MOPD、GUI-Owl、UI-TARS 系列都在回答同一个大问题：模型怎样从截图和指令出发，稳定完成手机上的长程任务。

Xiaomi-GUI-0 的切口更工程化。它不满足于离线轨迹或模拟环境，而是把物理手机、平板、车机、沙箱、标注平台、错误修复、SFT、Step RL、Agentic RL 和 RealMobile 评测串成一个闭环。论文里很多细节看起来不像传统模型论文，更像一个移动端自动化平台的技术报告：设备池怎么调度，账号状态怎么维护，失败轨迹怎么回收，验证规则怎么写，异常页面怎么分类。

这正是它有价值的地方。GUI Agent 如果要进入移动端 QA，不只是“看懂按钮并点击”。真正麻烦的是把它放进真实 APP：页面异步加载，账号过期，权限弹窗弹出来，风控要求验证，支付流程需要确认，系统输入法挡住控件，Native 和 H5 来回切，服务端状态还会影响下一屏。一个只在干净 benchmark 上训练出来的 agent，很容易在这些地方失去进展。

![Xiaomi-GUI-0 的混合基础设施：物理设备是主执行环境，沙箱提供可扩展和可复现实验，调度层根据设备、账号和风险状态分配任务](/images/xiaomi-gui-0-real-device-mobile-agent/figure-1-hybrid-infrastructure.png)

## 论文位置：从“会操作手机”走向“能在真机闭环里训练和评测”

放在 GUIAgent 谱系里，Xiaomi-GUI-0 更接近 **real-device mobile agent infrastructure + native GUI model**，而不是单纯的新 benchmark 或新 prompt harness。

它和几个近期方向的关系可以这样看：

- **AndroidWorld、MobileBench-OL、KnowU-Bench** 关注评测环境和任务定义，Xiaomi-GUI-0 进一步强调真实商业 APP、真实账号状态和异常页分布；
- **PhoneWorld / MobileGym / SimuWoB** 用模拟或 mock 环境解决可规模化、可验证问题，Xiaomi-GUI-0 则把真机作为主分布，沙箱只作为辅助；
- **MobileForge、UI-MOPD、UI-TARS-2、DigiRL** 关注交互数据和 RL 训练，Xiaomi-GUI-0 把失败页、人工接管和 teacher takeover 也纳入数据飞轮；
- **Learning from Failure、VeriGUI、StainFlow、VisCritic** 关注失败、动作效果和过程信号，Xiaomi-GUI-0 的对应做法是把错误轨迹变成纠错动作、反思解释和恢复 demonstration。

这篇报告的核心判断很直接：**Mobile GUI Agent 的可用性必须在真实执行分布里训练，也必须在真实执行分布里验证。**

这句话听起来朴素，但对工程团队很重要。很多自动化测试平台失败，不是因为模型完全不会理解界面，而是训练、执行和评测的环境不一致：训练数据来自离线成功轨迹，调试环境是模拟器，评测任务是可重置 benchmark，真正上线却面对活账号、真实网络、权限系统、风控和不断变化的 APP 版本。中间的分布差异越大，benchmark 分数越容易变成幻觉。

## 真机优先的混合基础设施：不是所有任务都适合模拟器

论文把基础设施分成三层：资源层、调度层、执行与采集层。

资源层里，物理设备是主执行环境，覆盖手机、平板和车机场景；沙箱则负责那些虚拟化下比较稳定、适合批量实验的任务。调度层维护每台设备的 readiness profile，包括 ADB serial、设备类型、屏幕分辨率、已安装应用、账号可用性、风控等级等。执行层负责初始化设备、下发动作、截图、记录状态和归档 episode。

这和传统移动端自动化测试很像，但目标不同。传统 Appium / UIAutomator / XCUITest 平台主要追求确定性脚本执行；Xiaomi-GUI-0 的平台要同时服务数据采集、模型 rollout、失败归因、人工维护和后续训练。因此它必须记录更完整的轨迹：任务描述、设备类型、应用和账号状态、截图、动作、时间戳、异常类型和执行状态。

这里真正麻烦的不是“接几台真机”。真机池难在状态管理：

- 账号可能过期、被风控、需要短信或人工验证；
- APP 版本、缓存、登录态和服务端配置会改变页面；
- 权限弹窗、定位、相册、剪贴板、支付认证会打断路径；
- 网络和异步加载让等待策略变得不稳定；
- 同一个任务在手机、平板、车机上的 UI 可能完全不同。

论文采用 Device-Pull 调度，让空闲设备根据当前状态主动取任务，而不是由中心调度器盲目 push。这点对移动端 QA 也有启发：任务分配不能只看“有没有空闲设备”，还要看账号、风险状态、APP 可用性、系统权限、网络和初始页面是否匹配。否则大量失败其实不是业务流程失败，而是环境准备失败。

## 数据不是越多越好，关键是覆盖真实失败分布

Xiaomi-GUI-0 的训练数据分成几类：高频任务数据、高泛化数据、agent 能力增强数据，以及错误驱动的数据飞轮。

高频任务数据来自真实用户指令和专家标注，覆盖常见 APP 功能。高泛化数据则通过 function tree 和 behavior bucket 扩展长尾意图。论文对这部分给了一个完整 pipeline：先把 APP 功能组织成树，再构造行为桶，合成 query，最后通过轨迹生成和清洗得到可训练样本。

![高泛化数据构造流程：从 function tree 到 behavior bucket，再到 query synthesis、trajectory synthesis 和 cleaning](/images/xiaomi-gui-0-real-device-mobile-agent/figure-2-data-construction-pipeline.png)

这个思路比“随机探索 APP”更稳。移动端应用的页面和功能太多，如果没有结构化的功能树，agent 很容易在少数入口附近反复采样，数据看起来很多，覆盖却很窄。function tree 的作用是把 APP 能力拆成可管理的功能空间；behavior bucket 则把类似行为聚在一起，方便生成更有分布感的用户请求。

换到 APP 自动化测试里，它对应的是用例资产的组织方式。很多团队有大量脚本，但脚本不是能力地图：一个页面有哪些入口，哪些状态会影响路径，哪些动作能改变后端状态，哪些断言能验证业务结果，这些信息如果没有结构化，agent 很难从历史用例里学到可迁移能力。

## 错误驱动飞轮：失败轨迹要变成纠错和恢复数据

论文最值得 QA 团队关注的是 error-driven data flywheel。它不是只收集成功轨迹，而是专门围绕真实 rollout 暴露的错误分布构造训练信号。

作者用了两条路径。

第一条是交互式标注。标注员回放失败轨迹，定位关键错误步骤，给出正确动作、错误类别和纠正理由。这样模型学到的不只是“下一步应该点哪里”，还包括“为什么刚才那一步错了”。

第二条是 teacher-model scoring and takeover。学生模型在设备集群上 rollout，teacher 对每一步打分；如果持续低于阈值，比如出现重复动作、执行失败或路径偏离，teacher 临时接管，生成从错误状态恢复到正确路径的 demonstration。

![错误驱动数据飞轮：学生 rollout、teacher 逐步打分，低分触发接管，记录错误步骤、纠正动作、反思原因和恢复轨迹](/images/xiaomi-gui-0-real-device-mobile-agent/figure-5-error-flywheel-recovery.png)

这点和移动端自动化测试的失败处理非常接近。一次 E2E 失败后，平台通常会保存截图、视频、日志和报错，但下一次 agent 未必知道该怎么避免同类问题。Xiaomi-GUI-0 的做法提醒我们：失败材料要进入训练或策略库，而不是只进入报表。

一个面向 APP QA 的 agent 平台，至少应该把失败拆成几类：

- grounding 错误：点错相邻控件、坐标被键盘或状态栏偏移；
- 同步错误：接口未返回、按钮 disabled、页面 loading 未结束；
- 状态错误：登录态失效、账号无权限、购物车/订单状态不对；
- 异常页：权限弹窗、风控验证、支付认证、活动浮层、升级弹窗；
- 跨端错误：Native/H5/Hybrid 切换、WebView DOM 和截图不一致；
- 断言错误：UI 看似完成，但后端状态、埋点或订单状态没更新；
- 恢复失败：反复点击、反复返回、重复输入、无法重新进入目标页。

分类本身不是终点。更重要的是每类失败都要对应可执行修复：等待策略、局部视觉复核、deeplink 恢复、mock 数据重置、后端状态校验、权限预置、人工接管、安全停止。不要把所有问题都塞进 prompt；能由平台确定性解决的，应该沉到 harness 或测试基础设施里。

## 三阶段训练：SFT、Step RL、Agentic RL 分别解决不同问题

训练上，Xiaomi-GUI-0 采用三阶段：SFT、Step RL、Agentic RL。

SFT 建立基础操作能力，让模型学会常见 APP 功能、基础 UI 操作和典型路径。论文报告 SFT 使用约 **120k 条轨迹中的 1.2M GUI step-level samples**，外加 **4.4M grounding samples** 来加强屏幕元素理解。

Step RL 用约 **40k 条轨迹中的 0.4M GUI step-level samples** 做细粒度决策优化，奖励是 cascade reward：格式合法性、动作有效性、目标一致性、以及更高层的 judge 信号按层级检查。它优化的是局部动作选择、状态判断、错误识别和局部纠正。

Agentic RL 则进入交互式 Android 环境，用数千个任务在线生成轨迹。这里关注的是长程规划、状态记忆、反思纠错和恢复执行。论文的训练环境同时包含数百个并行 emulator 和一组物理设备，用 SGLang 做 rollout，RL 框架基于 verl 和 Megatron-Core。

![Agentic RL 在线训练框架：GUI environment、rollout engine、curriculum sampler、reward/verifier 和策略更新共同组成交互训练闭环](/images/xiaomi-gui-0-real-device-mobile-agent/figure-6-agentic-rl-framework.png)

这三个阶段的分工很清楚：SFT 让模型会做，Step RL 让模型每一步更少犯错，Agentic RL 让模型在真实或近真实环境里学会长程恢复。对移动端 QA 来说，这也对应三层能力：

1. **脚本/轨迹模仿能力**：能按常见路径执行；
2. **单步可靠性**：知道当前页面是不是目标状态、动作是否有效；
3. **任务级恢复能力**：偏离路径后能回到可验证进展，而不是一直卡住。

很多 agent 测试方案只做第一层，所以 demo 看起来顺，但线上回归不稳。真实 APP 测试里，第三层往往最难：失败后要不要返回？要不要刷新？要不要重新登录？要不要通过 deeplink 回到业务页？要不要停止并标记环境异常？这些都不是单步 grounding 能解决的。

## RealMobile：把真实 APP 评测做成可诊断任务，而不是只看最终成功

Xiaomi-GUI-0 提出了 RealMobile，一个真机移动端 benchmark。它包含 **100 个任务**，覆盖真实应用、账号状态和异常页面，并按四类能力组织：Foundation、Safety & Reflection、Memory & Knowledge、Complex Reasoning & Planning。

![RealMobile 的应用使用分布：100 个任务覆盖多个高频应用，57% 的任务涉及 2–3 个应用，32% 涉及 4 个及以上应用](/images/xiaomi-gui-0-real-device-mobile-agent/figure-7-realmobile-distribution.png)

论文里有一个数字值得记住：RealMobile 中 **57%** 的任务涉及 **2–3 个应用**，**32%** 涉及 **4 个及以上应用**。这比很多单 APP benchmark 更接近真实手机任务。用户不会只在一个应用里完成全部目标，测试流程也一样：一次下单可能跨登录、商品页、支付、短信、地图、客服和后端状态。

更重要的是 RealMobile 的验证方式。论文没有只让 VLM 看最后截图判断成功，而是把每个任务拆成 sub-goals，使用 XML structure matching、OCR 和 logical semantic rules 组合验证。

![RealMobile 的自动验证示例：XML 结构匹配负责 UI 元素和动作点，逻辑规则负责跨应用一致性和顺序约束](/images/xiaomi-gui-0-real-device-mobile-agent/figure-8-verification-pipeline.png)

这个设计对 APP 自动化测试非常关键。只看最终截图，很容易误判：页面文字对了，但后端状态没更新；点到了按钮，但订单没有提交；搜索结果出现了，但不是目标商品；跨 App 搬运信息时，中间值丢了。论文的做法是把任务拆成可累积得分的子目标，并加入 veto condition：一旦触发明确错误，轨迹直接记 0。

工程上可以进一步扩展：

- UI 层：accessibility tree、OCR、截图差异、控件 bounds；
- 后端层：订单、支付、库存、账号、权益、风控状态；
- 客户端层：activity/viewController、WebView URL、日志、崩溃/ANR；
- 业务层：跨步骤一致性、顺序约束、幂等性和不可逆操作门禁。

这比“让模型自己判断测试是否通过”可靠得多。GUI Agent 可以参与探索和执行，但 oracle 最好尽量程序化、可复现、可审计。

## 实验结果：RealMobile 72.0%，但数字要放在真机分布里读

主结果里，Xiaomi-GUI-0-30B-A3B 在 RealMobile 上达到 **72.0% success / 85.8% progress**，在 AndroidWorld 上达到 **78.9%**。论文说明这些数字是四次运行均值，用来缓解 benchmark 方差。

![主实验结果：Xiaomi-GUI-0-30B-A3B 在 RealMobile 上达到 72.0% success / 85.8% progress，在 AndroidWorld 上达到 78.9%](/images/xiaomi-gui-0-real-device-mobile-agent/table-4-main-results.png)

和开源模型相比，差距很明显。MAI-UI-8B 在 RealMobile 上是 **33.0% success / 50.8% progress**；UI-Venus-1.5-30B-A3B 是 **21.0% / 44.6%**；GUI-Owl-1.5-32B-Thinking 是 **31.0% / 51.7%**。Xiaomi-GUI-0 达到 **72.0% / 85.8%**，说明真机闭环训练确实改变了真实任务上的执行稳定性。

和闭源系统相比，它超过 Gemini 3.1 Flash 的 **58.0%**、Claude Opus 4.7 的 **60.0%** 和 Seed 1.8 的 **65.0%**，但仍低于 Gemini 3.1 Pro 的 **85.0%** 和 Seed 2.0 Pro 的 **80.0%**。这个结果不能简单读成“小模型全面超过大模型”。更合理的判断是：在真实手机任务上，**环境分布对齐、错误数据和训练闭环可以显著补偿模型规模差距**，但知识密集、复杂推理和泛化能力仍会受基础模型能力影响。

分领域结果也说明了这一点。Xiaomi-GUI-0 在 Foundation 上达到 **100.0% success**，Complex Reasoning & Planning 达到 **80.5%**，接近 Gemini 3.1 Pro 的 **82.9%**；但在 Safety & Reflection 上是 **43.8%**，在 Memory & Knowledge 上是 **66.7%**，仍低于最强闭源模型。换句话说，它在真实执行和规划上很强，但安全反思和知识记忆还不是终局。

对移动端 QA 来说，这个结果更像路线提示：如果目标是让 agent 参与稳定回归，单纯换更大模型不够。设备环境、任务验证、失败回收、恢复策略和安全边界都要进系统。否则模型越大，只是更会解释自己为什么失败。

## 两个 case：真实轨迹和自我修正比静态截图更有信息量

论文最后给了两个 case study。第一个展示完整真机执行轨迹：模型从用户指令出发，跨页面完成任务。第二个展示反思和计划修正：模型发现当前路径偏离目标后，重新规划并恢复执行。

![完整真实设备执行轨迹 case：从用户指令开始，经过多步页面操作完成任务](/images/xiaomi-gui-0-real-device-mobile-agent/figure-10-real-device-trajectory.png)

![反思和计划修正 case：agent 在真实交互中识别偏离，调整计划并继续执行](/images/xiaomi-gui-0-real-device-mobile-agent/figure-11-reflection-case.png)

这类轨迹对测试系统很有价值。传统测试报告经常只给最后失败截图，而 agent 调试需要完整过程：它什么时候看错了？什么时候状态已经偏离？有没有尝试恢复？恢复是否引入新风险？如果每条失败都能回放到步骤级，团队才能判断问题属于模型、环境、用例、断言还是业务系统。

一个可用的移动端 agent 测试平台，最好把每次执行都存成可查询 episode：指令、计划、每步截图、accessibility tree、动作、坐标、OCR、后端状态、日志、异常类型、子目标得分、恢复策略和最终判定。这样失败不仅能复现，也能进入下一轮数据构造。

## 对 APP 自动化测试的工程启发

Xiaomi-GUI-0 给移动端 QA 的启发不在于直接复刻一套 64 H100 的训练系统，而在于几个工程判断。

**第一，真机环境不是上线前补测，而应该尽早进入训练和评测闭环。** 模拟器和 mock app 很适合规模化，但它们覆盖不了账号、风控、支付、权限、厂商 ROM、网络和真实业务状态。比较稳的路线是混合：模拟环境做高吞吐和可复现，真机环境定义真实失败分布。

**第二，失败轨迹要资产化。** 每次 agent 失败后，不能只留一张截图。应该沉淀错误步骤、错误类型、正确动作、恢复路径和可验证结果。长期看，这些失败比成功轨迹更能告诉系统哪里脆。

**第三，oracle 必须工程化。** GUI Agent 的输出可以不确定，但测试结论不能全靠模型主观判断。UI tree、OCR、接口、数据库、日志、埋点和业务规则应该组合成可审计 verifier。尤其是支付、订单、账号、风控这类场景，最终截图不是充分证据。

**第四，动作空间要和安全边界一起设计。** 论文使用 tap、swipe、text、navigation 等统一 action space。落到测试平台，还要加上不可逆操作门禁：支付、发消息、删数据、改账号、真实下单都需要隔离账号、mock 环境或人工确认。Agent 越能操作真实 APP，越需要权限和审计。

**第五，恢复策略不应只靠模型“想一想”。** 重启页面、清缓存、deeplink、重置 mock 数据、恢复登录态、切换测试账号、等待接口完成，这些更适合由 harness 提供确定性工具。模型负责判断什么时候需要恢复，平台负责安全执行恢复。

## 可能被高估的地方

这篇报告很完整，但几个边界要看清。

首先，RealMobile 是 in-house benchmark。它比公开静态评测更贴近真实手机任务，但任务、应用、账号和验证规则都由作者体系维护，外部团队很难完全复现。72.0% 这个数字有参考价值，但不能直接等价于任意企业 APP 的成功率。

其次，训练成本很高。论文实验使用 **64 张 H100**，并配套真机池、沙箱、标注平台、teacher takeover 和自动验证系统。大多数 QA 团队不会从零训练一个 30B GUI agent，更现实的是把这些思想迁移到现有模型和测试 harness 上。

第三，真机闭环会引入隐私和合规问题。真实账号、真实应用、真实网络和真实用户请求都可能包含敏感信息。论文提到 de-identified production 失败候选，但工程落地还需要更细的脱敏、权限、审计、数据保留和人工接管规则。

第四，异常页处理不能被误读成“绕过风控”。测试系统可以识别风险状态、终止任务、请求人工处理或切换测试环境，但不应让 agent 自动规避真实安全机制。对支付、验证码、账号验证这类场景，正确行为往往是停下来，而不是继续尝试。

第五，AndroidWorld 的 78.9% 不能说明真实 APP 问题已经解决。公开 benchmark 仍然更可控，而 RealMobile 也只是 100 个任务。真实移动端 QA 会遇到更多设备型号、地区配置、灰度版本、服务端状态和业务边界。

## 总结

Xiaomi-GUI-0 把 Mobile GUI Agent 的问题拉回了工程现场：模型不是只要会看截图、会点按钮就够了，它必须面对真实设备、真实账号、真实网络、真实异常页和可验证业务结果。论文给出的答案是一套真机优先的闭环：物理设备和沙箱混合执行，真实失败进入数据飞轮，SFT / Step RL / Agentic RL 分阶段训练，RealMobile 用子目标和规则验证真实任务。

对 APP 自动化测试来说，这篇报告最有价值的结论是：**Agent 的稳定性不是单个模型能力，而是模型、设备池、状态管理、失败归因、恢复策略和 oracle 共同决定的系统能力。**

如果一个团队想把 GUI Agent 用到移动端 QA，路线不应该是直接让模型“帮我测 APP”。更靠谱的做法是先把测试环境、任务状态、验证规则和失败轨迹整理出来，让 agent 在一个有边界、有恢复、有审计的 harness 里执行。这样它才可能从 demo 里的自动点屏，走向真正可用的测试生成、执行和评估闭环。

## 参考链接

- 论文：<https://arxiv.org/abs/2606.31410>
- PDF：<https://arxiv.org/pdf/2606.31410>
- 项目主页：<https://seerray-lab.github.io/Xiaomi-GUI-0/>
- 相关方向：AndroidWorld、MobileForge、PhoneWorld、UI-MOPD、Learning from Failure、VeriGUI、StainFlow
