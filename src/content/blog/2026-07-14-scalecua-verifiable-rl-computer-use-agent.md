---
title: "SCALECUA：Computer-Use Agent 扩展的关键不只是 RL，而是可验证任务"
description: "解析 2026 年 SCALECUA：它用 VERIGEN 合成可执行 verifier 的 GUI 任务，再用 Frontier Sampling 和 Visual Context Segmentation 提升在线 RL 效率，在 OSWorld 达到 68.7%、ScienceBoard 达到 54.0%。文章从 GUI Agent、APP 自动化测试和移动端 QA 视角讨论可验证奖励、任务合成、长程轨迹训练和工程边界。"
date: "2026-07-14"
tags: ["GUI Agent", "Computer Use", "RL", "OSWorld", "自动化测试"]
draft: false
featured: false
readingTime: 16
---

> 论文：[SCALECUA: Scaling Computer Use Agents with Verifiable Task Synthesis and Efficient Online RL](https://arxiv.org/abs/2607.11185)  
> arXiv：`2607.11185v1`，2026-07-13  
> 代码与数据：<https://github.com/THUDM/SCALE-CUA>  
> 一句话结论：**这篇论文真正推进的不是“又用 RL 训了一个 GUI Agent”，而是把 Computer-Use Agent 的扩展问题拆成两个更硬的工程问题：任务能不能被程序化验证，在线 RL 能不能把 rollouts 用在模型当前刚好学得动的边界上。对 APP 自动化测试和移动端 QA 来说，最值得借鉴的是这套 verifiable task + deterministic judge 的思路，而不是直接复刻桌面 Ubuntu 环境里的训练配方。**

Computer-use agent 这条线最近已经从“会不会点屏幕”进入了“能不能在真实交互里持续变强”。单步 GUI grounding、截图理解、ReAct 式循环都重要，但只靠这些很难把 agent 做成可迭代系统。原因很简单：GUI 任务是状态ful 的，动作一旦执行，环境会变；奖励又很稀疏，很多任务只有最后完成或没完成。没有可靠的 verifier，RL 很容易变成昂贵的试错；没有高效采样，生成再多任务也会被 easy task 和 impossible task 吃掉算力。

SCALECUA 的切口正好在这里。它提出一套统一框架：先用 **VERIGEN** 在 live OS / Docker 环境中自动合成带可执行 judge 的 GUI 任务，再用 **Frontier Sampling** 把 rollout 分配到模型当前成功率接近学习边界的任务上，最后用 **Visual Context Segmentation** 处理多轮视觉上下文，避免长程轨迹把 rollout 和训练引擎拖慢。

![SCALECUA 总览：VERIGEN 负责在可执行环境里合成带 verifier 的任务，Frontier Sampling 负责把任务采样推向学习边界，Visual Context Segmentation 负责让长程视觉轨迹可以高效进入在线 RL](/images/scalecua-verifiable-rl-computer-use-agent/figure-3-scalecua-overview.png)

这篇论文的结果也很直接：SCALECUA-Qwen3.5-9B 在 **OSWorld 达到 68.7%**，在 **ScienceBoard 达到 54.0%**，作者称其为开源 computer-use agent 的新 SOTA。更重要的是，论文把提升拆开验证：移除 VERIGEN 后 OSWorld 掉到 **43.9%**，移除 Frontier Sampling 后是 **63.7%**，移除 Visual Context Segmentation 后是 **62.2%**。也就是说，收益不是某个 prompt trick，而是任务、采样和训练包装一起作用。

## 论文位置：把 GUI Agent 的 RL 问题拉回“可验证性”

放在 GUIAgent / computer-use agent 的谱系里，SCALECUA 属于 **verifiable RL for desktop computer-use agents**。它不是新的静态 grounding benchmark，也不是纯数据集论文，而是在回答一个更接近系统工程的问题：如果我们想用在线 RL 扩展 CUA，任务、奖励和训练吞吐应该怎么设计？

它和近期几条线的关系可以这样看：

- **OSWorld、WindowsAgentArena、ScienceBoard** 让 agent 在真实软件里完成长程任务，但高质量可验证任务仍然稀缺；
- **GUI-Genesis、C-World、AgentSynth** 关注环境和任务生成，SCALECUA 进一步强调“生成任务必须带可执行 judge”；
- **ComputerRL、EvoCUA、DigiRL、MobileGUI-RL** 把 RL 引入交互式 GUI agent，SCALECUA 重点解决 RLVR 的任务池和采样效率；
- **Visual context / memory / TSR / MemGUI-Agent** 关注长程历史怎样压缩和保留，SCALECUA 的 Visual Context Segmentation 是训练侧的一个具体解法。

这里最关键的判断是：**GUI Agent 的 RL 扩展能力取决于 reward 的可信度，而 reward 的可信度取决于环境状态能否被程序化检查。**

对自动化测试团队来说，这句话并不陌生。传统 E2E 测试也不是靠“看起来像成功”来判定，而是依赖 UI 元素、接口返回、数据库状态、文件差异、日志、埋点和业务规则。GUI Agent 如果要进入 APP 测试，同样不能让 VLM 自己看最后一张截图后说“我觉得完成了”。Agent 可以负责探索和执行，但 oracle 最好尽量确定、可复现、可审计。

## VERIGEN：任务合成的核心是 executable judge

VERIGEN 要解决的是“可验证 GUI 任务太少”。论文里的定义很清楚：一个 verifiable GUI task 不只是自然语言指令，还要配一个 deterministic judge function。这个 judge 可以检查文件系统、浏览器状态、Python 代码返回值或环境中的最终 artifact，用程序给出奖励。

![VERIGEN 任务示例：任务 schema 不只包含 instruction，还包含 setup、环境约束和可执行 judge 所需字段](/images/scalecua-verifiable-rl-computer-use-agent/table-5-verigen-task-example.png)

VERIGEN 的生成流程不是一次性让 LLM 写任务。它引入多角色反馈环：proposer 生成任务和 verifier，judger 做静态语义审查，checker 在 Docker 环境里做动态检查，fix agent 修复不可执行或逻辑不一致的 judge。论文报告，这条管线在 100+ 并行 worker 下产出 **24K+ verifiable tasks**，其中近 **3K high-quality RL tasks** 进入最终 RL 任务池。

![VERIGEN 生成的 Python judge 示例：getter 从环境里读取最终状态，metric 把状态转换成确定性奖励](/images/scalecua-verifiable-rl-computer-use-agent/figure-9-python-judge.png)

这个设计最有价值的地方，是它没有把“任务生成”停留在 instruction rewrite。很多 GUI 数据合成工作会生成看起来合理的自然语言任务，甚至生成轨迹，但如果没有 verifier，后续训练仍然依赖人工、LLM judge 或 benchmark 隐含规则。SCALECUA 把 judge 一起生成出来，并要求它在真实环境中跑通，这就把任务从“文本样本”变成了“可执行测试用例”。

换到 APP 自动化测试，这对应的不是让模型批量写“测试一下登录功能”这种宽泛用例，而是生成一组带可检查 oracle 的任务：

- 初始状态：测试账号、APP 版本、权限、mock 数据、网络条件；
- 操作目标：用户可理解的业务意图，比如完成搜索、下单、编辑资料、切换设置；
- 可执行检查：UI tree / OCR / 后端接口 / 数据库 / 日志 / 埋点 / 文件缓存共同验证；
- 安全边界：支付、发消息、删除数据、改账号等不可逆动作必须隔离或人工确认；
- 失败归因：judge 不只给 0/1，还能标出是 UI 未到位、业务状态未变、环境异常还是动作越权。

这点比“模型会不会多点几个按钮”更重要。没有 verifier，agent 的失败很难沉淀成训练信号；有了 verifier，失败轨迹才可能进入数据飞轮。

## Frontier Sampling：不要把 rollout 浪费在太简单或太难的任务上

在线 RL 的另一个麻烦是采样效率。GRPO 这类方法依赖同一任务多条 rollout 之间的差异来形成 advantage。如果一个任务模型总是成功，或者总是失败，这组 rollout 基本没有学习信号。任务池越大，均匀采样越容易把算力撒到已经掌握或完全学不会的任务上。

SCALECUA 的 Frontier Sampling 做法很朴素：跟踪每个任务的成功率，把采样权重集中在模型当前最有学习价值的区间。论文用高斯核把目标成功率设在接近 0.5 的区域，同时保留一部分探索概率。说白了，它想让模型多练“差一点就会”的任务。

![Frontier Sampling 对比 uniform、DAPO 和 curriculum：它根据任务级成功率动态追踪模型学习边界，而不是按固定难度或统一概率采样](/images/scalecua-verifiable-rl-computer-use-agent/figure-6-frontier-sampling-efficiency.png)

这对测试生成也有启发。一个移动端 agent 测试平台如果积累了大量任务，不应该只按模块或随机顺序重放。更合理的调度应该看任务对当前 agent 的诊断价值：

- 总是通过的任务可以降频，保留为 smoke / regression；
- 总是失败但原因是环境不可用的任务，应该先修环境，不要继续喂给模型；
- 成功率在 30%–70% 摆动的任务，最适合暴露模型当前边界；
- 最近 APP 改版、权限策略变化、WebView 路径变化的任务，应该提高采样；
- 涉及支付、账号、风控等高风险流程的任务，需要单独权限和隔离策略。

工程上真正麻烦的不是“多跑几次”，而是知道哪些任务值得跑、失败能不能解释、结果能不能进入下一轮改进。

## Visual Context Segmentation：长程 GUI 轨迹不能直接整段塞进训练

GUI 任务的轨迹很长，每一步都有截图、文本历史、动作和观察。直接把整条 trajectory 当成一个训练样本，会让序列太长，rollout 引擎和训练引擎都吃不消；如果每一步单独拆成训练样本，又可能丢掉必要的视觉上下文。

SCALECUA 的 Visual Context Segmentation 用滑动窗口保留最近 K 张截图，同时把更早的视觉信息替换成文本摘要，训练损失只落在 assistant response 上。论文的目标不是做新的 memory 模块，而是把多轮视觉轨迹包装成更适合在线 RL 的训练单元。

![Visual Context Segmentation：最近视觉上下文保留在滑动窗口里，过旧截图被移除并用文本连续性承接，训练 mask 只覆盖 assistant response](/images/scalecua-verifiable-rl-computer-use-agent/figure-4-visual-context-segmentation.png)

实验里，这个设计带来 **2.83× end-to-end speedup**。更细的分析显示，K 不是越大越好：在 OSWorld pass@k 上，K=3–5 这类中等窗口反而更合适，说明“保留所有截图”并不等于更强记忆。

![不同滑动窗口大小下的 pass@k：适中的视觉窗口更稳，过短或过长都不是最优](/images/scalecua-verifiable-rl-computer-use-agent/figure-7-passk-window-size.png)

这点对移动端 QA 也很现实。APP 测试轨迹可能跨十几二十步：登录、授权、搜索、筛选、下单、支付、返回、查订单。不是每一张历史截图都值得保留。更有用的是把历史压成任务状态：

- 当前业务子目标是什么；
- 哪些输入值已经填过；
- 哪些页面状态已经确认；
- 哪些后端状态已经变更；
- 哪些异常页曾经出现；
- 下一步 verifier 需要检查什么。

如果只是把完整截图历史塞进上下文，成本高、噪声大，还容易让模型被旧页面误导。比较稳的方向是：近期截图用于 grounding，长期历史变成结构化 task state，关键业务状态由 harness 或后端 verifier 维护。

## 结果：OSWorld 68.7%，ScienceBoard 54.0%，但要看清评测边界

主结果里，SCALECUA-Qwen3.5-9B 在 OSWorld 上达到 **68.7%**。论文强调这是开源单模型里的最好结果，并且超过一些更大的开源模型。Figure 1 也展示了任务数量扩展和 OSWorld 成功率之间的关系：生成的可验证任务从 0K 增加到 20K 时，同一训练管线下表现持续提高。

![OSWorld 总体趋势：SCALECUA 达到 68.7%，并展示生成可验证任务数量扩展对成功率的影响](/images/scalecua-verifiable-rl-computer-use-agent/figure-1-osworld-scaling.png)

![OSWorld 分领域结果：SCALECUA-Qwen3.5-9B 在多个桌面软件任务上取得开源模型中的强结果](/images/scalecua-verifiable-rl-computer-use-agent/table-2-osworld-results.png)

ScienceBoard 更偏专业软件和知识密集任务，包括算法、生化、GIS、天文、文档等场景。SCALECUA-Qwen3.5-9B 在这里达到 **54.0%**，论文称其超过 Claude Opus 4.6 的 52.7%，并在 TeXstudio、Lean 等任务上有明显收益。

![ScienceBoard 结果：SCALECUA 在专业软件任务上达到 54.0%，说明 VERIGEN 不只适用于普通桌面办公场景](/images/scalecua-verifiable-rl-computer-use-agent/table-3-scienceboard-results.png)

这些数字有意义，但不能简单读成“9B 模型已经解决 computer use”。更合理的解读是：**当任务、环境和 verifier 能被组织成在线 RL 闭环时，开源模型可以在特定桌面任务分布上快速逼近甚至超过一部分闭源系统。** 这说明训练闭环很重要，但也说明评测环境、任务分布和 verifier 质量同样决定结果。

论文给的 47 步 case 很能说明问题：agent 从读取桌面状态开始，浏览 gnome-look.org，下载 Orchis GTK theme，用 terminal 解压，再通过 gsettings 应用主题，最终 OSWorld judge 返回 1.0。这类任务比单页点击更接近真实 computer use，因为它跨浏览器、文件系统、终端和系统设置。

![47 步 OSWorld case：模型跨浏览器、文件系统、终端和系统设置完成安装主题任务，最后由 judge 判定成功](/images/scalecua-verifiable-rl-computer-use-agent/figure-2-long-horizon-case.png)

对 APP 自动化测试来说，对应的不是“一个 APP 里点完一个按钮”，而是跨端业务流：从 H5 活动页进 Native 下单，跳支付 SDK，回到订单页，再通过后端状态和客户端日志确认。真正的评测也不该只看最终截图，而应该看每个关键 checkpoint 是否达成。

## 消融：三个组件都在贡献，但 VERIGEN 是地基

消融结果很有信息量。完整 SCALECUA 是 **68.7%**；没有 VERIGEN，也就是回到 base，只有 **43.9%**；没有 Frontier Sampling 是 **63.7%**；没有 Visual Context Segmentation 是 **62.2%**。这说明任务生成带来的收益最大，采样和视觉上下文分段则进一步提高效率和效果。

![SCALECUA 组件消融：移除 VERIGEN、Frontier Sampling、Visual Context Segmentation 都会明显降低 OSWorld 表现；VERIGEN 多角色校验也影响 judge executable rate](/images/scalecua-verifiable-rl-computer-use-agent/table-4-ablation.png)

VERIGEN 内部的 role ablation 也值得看。完整管线的 generated judge executable rate 是 **94.5%**；去掉 LLM Judge Agent 后降到 **62.3%**，去掉 Fix Agent 是 **78.1%**，去掉 Rule Validator 是 **86.2%**。这说明自动生成 verifier 不是让一个模型写段代码就完事，独立审查、动态运行和修复都很关键。

![VERIGEN 分析：相比既有桌面 CUA 方法，它生成更大规模的可验证任务池；trajectory-guided augmentation 能提升 RL 训练 reward](/images/scalecua-verifiable-rl-computer-use-agent/figure-8-verigen-analysis.png)

论文还做了人类审计：对 OSWorld 和 ScienceBoard 各应用域抽样，executable judge 与专家人工标签整体一致率为 **82.5%**。这个数字很重要，因为它提醒我们：可执行 judge 不等于绝对正确。程序化 verifier 可以降低主观性和成本，但仍可能有 false positive / false negative。

![人类-judge 审计：可执行 judge 与专家标签总体一致率为 82.5%，说明 verifier 有效但并非无误](/images/scalecua-verifiable-rl-computer-use-agent/table-6-human-judge-audit.png)

在 QA 场景里，这个边界尤其关键。测试 oracle 写错了，自动化跑得越快，错判传播越快。GUI Agent 平台需要把 verifier 也当成一等资产来测试：做抽样人工复核、保留误判案例、版本化 judge、监控 false positive / false negative，并给高风险业务设置更严格的多信号验证。

## 任务覆盖和数据泄漏：论文做了检查，但仍要谨慎

VERIGEN 生成任务覆盖 OSWorld 的 10 个应用域和 ScienceBoard 的 6 个科学软件域。论文报告 OSWorld 侧总计 **22,322** 个任务，ScienceBoard 侧 **5,529** 个任务。这个规模说明它不是只在几个模板上做 instruction rewrite。

![VERIGEN 任务分布：OSWorld 覆盖 10 个应用域，ScienceBoard 覆盖 6 个科学软件域](/images/scalecua-verifiable-rl-computer-use-agent/figure-10-task-distribution.png)

作者还做了生成任务质量和重叠审计。Table 7 用不同能力模型验证任务是否可解且有区分度；Table 8 检查训练子集与 benchmark task pool 的重复、近重复和 judge 复用。论文报告训练子集没有 full-JSON duplicates，也没有 exact instruction duplicates；OSWorld 侧有少量 evaluator reuse，作者解释为通用 evaluator 模板复用。

![生成任务可解性验证：更强模型在生成任务上通过率更高，说明任务不是纯噪声，也不是对弱模型完全不可达](/images/scalecua-verifiable-rl-computer-use-agent/table-7-generated-task-validation.png)

![训练数据重叠审计：论文检查 full JSON、instruction、objective 和 judge 层面的重复与近重复，试图降低 benchmark 泄漏风险](/images/scalecua-verifiable-rl-computer-use-agent/table-8-overlap-audit.png)

这部分对研究可信度很重要，但也要保留谨慎。GUI 任务的“近重复”不一定只体现在 instruction 文本上。两个任务可能文字不同，但使用同一环境、同一文件模板、同一 UI 路径和同一 judge 逻辑。对 APP 测试来说也一样：不同用例名不代表覆盖了不同风险。更可靠的覆盖统计应该同时看页面、控件、业务状态、后端实体、异常分支和 oracle 类型。

## 对 APP 自动化测试和移动端 QA 的启发

SCALECUA 做的是 Ubuntu desktop CUA，但它对 APP 自动化测试的启发很明确。

**第一，任务生成必须和 oracle 生成绑定。** 只生成自然语言测试任务价值有限。真正能进入训练和回归的是“任务 + 初始状态 + 操作边界 + 可执行检查”。移动端可以把 Appium / UIAutomator / XCUITest / Maestro 的执行能力和后端状态检查结合起来，让 agent 生成或执行任务，但让 verifier 做最终裁判。

**第二，失败轨迹要变成下一轮任务。** VERIGEN 的 trajectory-guided synthesis 会根据 rollout 经验生成更适合训练的任务。APP 测试里也应该这样做：一次失败不只是报告，它可以派生出更小的复现任务、更难的扩展任务、异常页恢复任务和回归用例。

**第三，任务调度要看学习价值，而不是只看覆盖率。** Frontier Sampling 提醒我们，任务池大不等于训练有效。测试平台也应该区分 smoke、稳定回归、边界任务、环境异常任务和高风险任务。对 agent 来说，最有价值的是那些刚好暴露当前能力边界的任务。

**第四，长程历史要结构化。** Visual Context Segmentation 说明视觉历史有窗口效应。移动端 agent 不该无限保留截图，而要把历史压成 task state：已输入字段、已验证子目标、后端状态、跨 App 传递值、异常页和恢复动作。

**第五，verifier 也需要测试。** 论文的人类审计一致率是 82.5%，不是 100%。这对 QA 系统是一个提醒：oracle 本身会错。尤其是订单、支付、账号、权益、风控、Push、IM、地图、直播这类业务，只用 UI 文本判断远远不够，最好组合接口、数据库、日志、埋点和客户端状态。

**第六，GUI 与确定性工具应该混合使用。** SCALECUA 的任务虽然叫 computer use，但很多 verifier 本质上在检查文件、浏览器状态或程序输出。APP 测试也不应让 agent 只靠截图操作：能用 deeplink、mock API、设备命令、日志查询、后端接口确认的地方，应该交给 harness；GUI 操作负责覆盖用户路径和视觉状态。

## 可能被高估的地方

这篇论文很扎实，但几个边界需要看清。

首先，评测环境主要是 **Ubuntu-based desktops**。论文也明确说，Windows 和 macOS 应用栈的泛化留给未来工作。桌面 Linux 任务里的文件系统、终端、LibreOffice、浏览器和科学软件，与企业移动 APP、iOS 权限、Android 厂商 ROM、H5/Hybrid、支付 SDK、风控页不是同一个分布。

其次，每个 episode cap 在 **50 interaction turns**。这覆盖了很多 OSWorld 和 ScienceBoard 任务，但真实业务流程可能更长，尤其是跨 App、跨账号、跨后端状态的移动端任务。超过 50 步后，状态管理、恢复策略和安全门禁会更难。

第三，VERIGEN 依赖 Docker 化、可探测、可重置的环境。很多商业 APP 测试环境没这么干净：账号会过期，短信验证码不可自动化，服务端灰度会变，真实支付不能随便点，第三方 SDK 和风控机制也不一定能 mock。把 VERIGEN 迁移到移动端，首先要补的是环境治理，不是模型训练。

第四，可执行 judge 会带来新的过拟合风险。模型可能学会满足 judge，而不是完成真实用户意图。论文做了重叠审计和人类审计，但长期看仍需要更强的 adversarial oracle review、跨版本验证和业务侧抽样复核。

第五，训练成本和系统复杂度不低。100+ 并行 worker、在线 RL、Docker probe、vLLM rollout、Megatron-LM 训练、GRPO 和多角色 task filtering，不是普通 QA 团队一周内能复刻的系统。更现实的路线是先复用它的方法论：把现有测试任务变成可验证任务池，把失败轨迹资产化，再逐步引入 agent 执行和策略优化。

## 总结

SCALECUA 把 Computer-Use Agent 的扩展问题讲得很清楚：想让 GUI Agent 通过在线 RL 变强，不能只靠更多轨迹或更大的模型。更底层的问题是，任务是否可验证，奖励是否可信，采样是否集中在学习边界，长程视觉轨迹是否能高效训练。

它的三件事对应三层能力：VERIGEN 解决“从哪里来可验证任务”，Frontier Sampling 解决“哪些任务最值得 roll out”，Visual Context Segmentation 解决“长程 GUI 历史怎样进入训练”。这套组合让 9B 级开源模型在 OSWorld 上达到 68.7%，在 ScienceBoard 上达到 54.0%，说明系统级训练闭环确实能把 computer-use agent 往前推一截。

对 APP 自动化测试来说，最值得带走的不是具体桌面任务，也不是某个 RL 超参，而是一个工程判断：**Agent 的能力提升要围绕可验证任务池展开。没有可执行 oracle，探索只是 demo；有了可验证任务、失败回收和任务调度，agent 才可能进入测试生成、执行、评估和改进的闭环。**

## 参考链接

- 论文：<https://arxiv.org/abs/2607.11185>
- PDF：<https://arxiv.org/pdf/2607.11185>
- 代码与数据：<https://github.com/THUDM/SCALE-CUA>
- 相关评测与方向：OSWorld、ScienceBoard、ComputerRL、EvoCUA、GUI-Genesis、DigiRL、MobileGUI-RL
