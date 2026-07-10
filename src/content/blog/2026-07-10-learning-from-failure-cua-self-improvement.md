---
title: "Learning from Failure：GUI Agent 的失败轨迹，不该只当垃圾丢掉"
description: "解析 Stanford/Tsinghua 2026 论文 Learning from Failure：它把 computer-use agent 的自改进从只收集成功轨迹，推进到利用失败轨迹诊断 grounding、循环、知识和工具能力问题，并在 OSWorld 上把 OpenCUA-72B 从 42.3% 提升到 48.9%。文章从移动端 QA 与 APP 自动化测试视角讨论其贡献、证据和工程边界。"
date: "2026-07-10"
tags: ["GUI Agent", "Computer Use", "Self-Improvement", "OSWorld", "APP 自动化测试"]
draft: false
featured: false
readingTime: 15
---

> 论文：[Learning from Failure: Inference-Time Self-Improvement for Computer-Use Agents](https://arxiv.org/abs/2606.31270)  
> arXiv：`2606.31270v1`，2026-06-30  
> 代码：<https://github.com/snow10072740/Learning_from_Failure>  
> 一句话结论：**这篇论文真正有价值的地方，不是给 OSWorld 又刷了 6.6 个百分点，而是把 GUI Agent 训练和评测里长期浪费掉的失败轨迹重新变成资产：失败不只是“没完成任务”，它还能暴露 grounding、重复动作、知识缺口和工具选择问题。对 APP 自动化测试来说，这个思路很直接：回归测试里的失败录像、截图、日志、网络请求和设备状态，不应该只进报表，还应该进入下一轮 agent 策略修正。**

GUI Agent 研究里，很多自改进流程默认偏爱成功轨迹。Agent 在可验证环境里跑任务，成功的轨迹留下来做 SFT、DPO 或 RL 数据；失败的轨迹通常被丢掉，最多做一点人工错误分析。

这件事在论文实验里是模型训练问题，换到工程里就是测试平台的日常问题：一条移动端 E2E 用例失败后，我们经常知道“失败了”，却没有把失败变成系统能力。截图存了，视频存了，Appium 日志存了，后端 mock 状态也存了，但下一次 agent 还是可能卡在同一个权限弹窗、同一个 WebView 跳转、同一个搜索框键盘遮挡、同一个列表定位误差上。

Learning from Failure 切入的正是这条缝。它不重新训练模型，而是在推理时把失败轨迹交给 LLM 分析，归纳出可执行的策略补丁，再把这些补丁接回 agent 的执行流程。论文在 OSWorld 上用 OpenCUA-72B 做主实验，成功率从 **42.3%** 提到 **48.9%**，绝对提升 **6.6 个百分点**；小集 ablation 里，四类策略合起来把 30-step 设置下的性能从 **41.67** 提到 **52.74**。

![成功轨迹循环与失败轨迹循环的区别：前者把成功 rollout 用于继续训练，后者把失败 rollout 交给 LLM 分析并转成推理时改进](/images/learning-from-failure-cua-self-improvement/figure-1-self-improving-loops.png)

上图把论文位置说得很清楚。过去的 successful-case loop 是“环境验证 → 收集成功轨迹 → 微调模型”；这篇论文补了一条 failure-case loop：“环境验证 → 收集失败轨迹 → LLM 分析和改进 → 更新 agent 行为”。它没有否定成功轨迹训练，而是指出：既然可验证环境已经花成本搭起来了，失败轨迹也不该浪费。

## 这篇论文在 GUIAgent 谱系里的位置

放在近期 GUIAgent / computer-use agent 谱系里，这篇论文不是新的 grounding 模型，也不是新的 benchmark。它更像是 **agent harness 与失败闭环** 方向的工作。

- 和 **OpenCUA、UI-TARS、Aguvis、GUI-Owl** 这类模型论文相比，它不主要改变模型权重，而是改变执行时策略；
- 和 **OSWorld、WindowsWorld、MacArena、AndroidWorld** 这类环境/评测论文相比，它把可验证环境产生的失败结果进一步用起来；
- 和 **StainFlow、VeriGUI、VisCritic** 这类过程验证工作相比，它更关注“失败之后怎样修 agent”，而不是只给每一步打分；
- 和移动端的 **UI-Voyager、SE-GA、MobileForge、MemGUI-Agent** 相比，它的场景主要是 OSWorld 桌面任务，但失败闭环的工程含义能迁移到 Android/iOS 自动化测试。

这篇论文真正推进的是一个很务实的能力轴：**把失败从终态指标变成可复用的调试输入。**

这点比“又多一个 agent self-evolve”更值得关注。因为 GUI Agent 在真实应用里最常见的问题不是完全不会做任务，而是在几个重复模式上反复翻车：点错小控件、看不懂弹窗、卡在同一个页面、不会用系统能力绕开 GUI、缺少软件操作知识。失败轨迹恰好保存了这些模式。

## 方法：让 LLM 从失败轨迹里提炼推理时补丁

论文的整体流程可以拆成四步。

1. 让基础 agent 在可验证环境里 rollout，收集失败轨迹；
2. 把任务指令、动作历史、思考过程、屏幕状态等交给 LLM 做失败诊断；
3. 让 LLM 提出 inference-time solution，并生成可接入 agent harness 的代码补丁；
4. 人类做轻量检查后，把补丁接回 agent，再跑下一轮失败收集。

![Failure-case loop 的四轮策略：Visual Search、Terminal Execution、Knowledge Support、Repetition Warning 分别对应 grounding、能力缺口、知识缺口和重复循环](/images/learning-from-failure-cua-self-improvement/figure-2-failure-case-loop.png)

Figure 2 里有一个值得工程团队关注的细节：作者不是一次性让 LLM 产出一堆散乱建议，而是按轮次处理最突出的失败模式。第一轮处理 grounding error，第二轮处理 terminal execution 这类能力缺口，第三轮补知识支持，第四轮加重复检测。每一轮策略都进入 agent 的推理时流程，后续 rollout 再暴露新的失败。

这比单纯写几条 prompt 更像一个测试平台里的迭代机制：先看失败分布，再修最主要的失败类；修完后重新跑，观察失败是否转移。对移动端 QA 来说，这种节奏很重要。一个 APP agent 如果一开始大量失败来自权限弹窗和键盘遮挡，就不应该急着讨论复杂业务推理；先把系统弹窗、输入法、等待和返回栈处理稳，再看更高层的业务 oracle。

## 四类补丁：不是模型变聪明，而是 harness 更会兜底

论文最终得到四类推理时策略。它们看起来不神秘，但正因为不神秘，才更像可以落地的工程改动。

![Table 1：四类 inference-time 策略的 ablation。OpenCUA-72B 小集 baseline 为 41.67，Full Method 达到 52.74](/images/learning-from-failure-cua-self-improvement/table-1-ablation-strategies.png)

Table 1 显示，在 OSWorld small set 上，OpenCUA-72B 30-step baseline 是 **41.67**。单独加 Visual Search 到 **47.22**，Terminal Execution 到 **47.19**，Knowledge Support 到 **44.44**，Repetition Detection 到 **44.40**；四者组合达到 **52.74**。这组结果说明，提升并不只来自某一个 trick，而是几个常见失败面被同时覆盖后，执行链路整体更稳。

### 1. Visual Search：点击后要能重新看局部区域

GUI Agent 的 grounding 错误经常发生在很小的控件上。论文里的例子是 GIMP 亮度调整：agent 想点 down arrow，却把坐标落到了 up arrow 附近。Visual Search 的做法是，在 click、moveto、dragto 这类空间动作之后，以目标点为中心截一个局部放大图，并用红圈标出原始动作位置，让模型检查自己是不是点对了。

![Figure 3：Visual Search 用局部放大图修正坐标；Terminal Execution 则把适合命令行完成的文件路径任务从 GUI 操作切到终端](/images/learning-from-failure-cua-self-improvement/figure-3-visual-search-terminal.png)

这点对 APP 自动化测试很有启发。很多移动端 UI 的失败不是“模型不知道要点搜索按钮”，而是：

- 搜索按钮和清空按钮挨得太近；
- 列表 item 高度变化，旧坐标点到相邻卡片；
- WebView 内部缩放、状态栏、键盘弹起改变了坐标系；
- 弹窗上的主按钮和次按钮视觉相似；
- 图片、直播、地图、IM 等场景里控件缺少稳定 accessibility id。

传统 Appium / UIAutomator / XCUITest 会优先用结构化选择器，但真实业务里总有无法稳定定位的区域。这里的工程做法不是完全相信第一次点击，而是在高风险点击前后加局部视觉复核：目标控件是否在红圈附近、点击后页面状态是否变化、是否误触了相邻按钮。说白了，这是给 GUI Agent 加一个轻量版“点前/点后截图断言”。

### 2. Terminal Execution：有些任务不该硬走 GUI

论文第二个策略是 Terminal Execution。Figure 3b 的例子是查找 `secret.docx` 的文件路径并复制到剪贴板。纯 GUI 操作要打开文件管理器、搜索、定位、复制路径，很容易卡住；终端里几条命令就能完成。

这在 desktop computer-use 里很自然，但迁移到移动端 QA 时要换一种理解：**不是所有动作都必须由 agent 点屏完成。**

APP 自动化测试本来就是混合系统。GUI 用来覆盖用户可见流程，后端 API、数据库、mock、deeplink、日志、设备命令则用来做确定性控制。比如：

- 用 deeplink 直达某个业务页，而不是从首页点十几步；
- 用 mock API 准备订单、优惠券、账户余额、风控状态；
- 用 ADB / simctl 控制定位、网络、权限、剪贴板、安装包；
- 用日志和网络请求确认支付 SDK 回调，而不是只看页面文字；
- 对 H5/Hybrid 页面，必要时结合 DOM 或 WebView debug 信息。

如果 agent 只被允许“像人一样点屏幕”，它会很通用，但也很慢、很脆。更稳的策略是：GUI 负责用户路径和视觉状态，确定性通道负责环境准备、状态校验和安全操作。论文的 Terminal Execution 其实是在提醒我们：computer-use agent 应该学会选择执行通道，而不是执着于 GUI primitive。

### 3. Knowledge Support：软件手册和热键知识应该进系统

第三类策略是 Knowledge Support，包括搜索引擎和软件手册。论文里的例子一个是解决 `conda: command not found`，另一个是 LibreOffice 里用 `Ctrl+D` 批量填充单元格，绕开低效的复制粘贴循环。

![Figure 4：Knowledge Support 通过搜索或软件手册补齐 agent 不知道的命令、热键和应用操作知识](/images/learning-from-failure-cua-self-improvement/figure-4-knowledge-support.png)

对 APP 测试平台来说，这里对应的不是“让模型随便上网查”，而是建立可控的测试知识库：

- 页面对象、业务流程、异常弹窗、权限弹窗说明；
- 各端差异：Android、iOS、H5、Hybrid、平板、深色模式；
- 稳定入口：deeplink、scheme、测试账号、mock 场景；
- 断言规则：页面 UI、业务状态、接口响应、埋点、日志、崩溃/ANR；
- 历史失败案例：哪个页面容易键盘遮挡，哪个列表需要等待接口完成。

这和 VISUALSKILL 的多模态 skill 思路也能接上：知识库不应只有文字步骤，还应该包含关键页面截图、状态对照图和失败样例。区别在于，Learning from Failure 更强调这些知识从失败轨迹中增量长出来，而不是一次性人工整理完整。

### 4. Repetition Warning：卡住时要触发恢复模式

GUI Agent 很容易陷入重复动作：反复点击同一个按钮、反复等待同一个状态、反复输入又清空。论文的 Repetition Warning 用滑动窗口检查最近的 thought、action 和 screen-state trace，发现重复后提醒 agent 切换策略。

![Figure 5：当 agent 在同一屏幕状态上连续无效尝试时，Repetition Warning 触发 recovery mode，促使它改用替代方案](/images/learning-from-failure-cua-self-improvement/figure-5-repetition-warning.png)

移动端自动化里，这类问题非常常见：

- 页面没加载完，agent 一直点空白区域；
- toast 或弹窗消失太快，agent 没抓到状态；
- 网络慢导致按钮 disabled，agent 连续点击；
- 列表滚动方向错了，越找越远；
- 登录态失效后，agent 还按原业务路径执行；
- WebView 卡住，返回栈和 Native 页面状态不一致。

这里真正麻烦的不是检测“动作重复”本身，而是定义什么叫“没有进展”。在测试系统里，进展不应只靠截图相似度判断，还可以看 activity/viewController、accessibility tree、接口请求、日志、数据库状态、业务事件和崩溃信号。一个更可靠的 GUI Agent harness 应该把这些信号统一成 progress checkpoint：如果连续几步没有通过 checkpoint，就进入恢复策略，例如等待、返回、重启页面、刷新数据、切换 deeplink、请求人工确认。

## 失败分布：低级问题被压下去后，高级问题会浮出来

论文还给了一张失败模式分布图。作者说，早期失败主要集中在 action loop、coordinate precision、UI recognition 和 multi-step planning；四轮策略之后，低层的循环、grounding 和缺少恢复机制有所缓解，剩下更多是任务误解、CAPTCHA、UI recognition、多步规划等更高层问题。

![Figure 6：失败模式分布从低层 grounding/循环/恢复问题，逐渐转向任务理解、视觉识别和多步规划问题](/images/learning-from-failure-cua-self-improvement/figure-6-failure-mode-distribution.png)

这个结论要谨慎读。Figure 6 的比例不是严格互斥，论文也说明 success 部分主要是示意，不应当按精确统计图理解。但它表达的现象很合理：当你把点错、卡住、不会查资料这些低层问题修掉后，系统会暴露更难的问题——任务到底怎么理解、业务规则怎么判断、跨页面状态怎么维护。

对 APP 自动化测试来说，这其实是好消息。一个 agent 平台如果连权限弹窗、等待、键盘遮挡、重复点击都处理不好，就很难讨论复杂业务断言。工程路线应该分层：先把低层执行稳定性和恢复机制做稳，再逐步处理业务理解、oracle 设计和跨端差异。

## 实验结果：OSWorld 提升明显，但不要把它读成通用自治能力

主结果在 OSWorld 上。OpenCUA-72B baseline 是 **42.3 ± 2.6**，加上论文的失败驱动补丁后达到 **48.9 ± 1.2**。相对 proprietary 和 open-source baselines，这个数字已经很强。论文还报告推理开销约增加 **8%**，交互步数减少约 **15%**，说明它不是靠无限增加思考轮次硬堆出来的。

![Table 2：OSWorld 主结果。OpenCUA-72B 从 42.3 ± 2.6 提升到 48.9 ± 1.2；OpenCUA-32B 和 GUI-Owl-32B 也有提升](/images/learning-from-failure-cua-self-improvement/table-2-osworld-results.png)

Table 2 还有两个小点值得看。

第一，OpenCUA-32B 从 **34.5** 到 **38.2**，GUI-Owl-32B 从 **19.0** 到 **21.3**。这说明补丁不是只对 72B 模型有效，但更强的模型确实更能吃到策略收益。原因也不难理解：Visual Search、Knowledge Support、Repetition Warning 这些策略都需要模型理解反馈并调整计划；基础模型太弱时，给它更多信息也可能用不好。

第二，OSWorld 仍然只是一个 benchmark。它覆盖文件管理、网页浏览、软件操作等桌面任务，能提供可验证反馈，很适合研究失败闭环。但它不等于真实企业桌面，也不等于移动端 APP 测试。特别是移动端会多出权限模型、设备状态、系统弹窗、WebView、推送、支付 SDK、地图/相册/摄像头、厂商 ROM 差异、账号和风控状态。论文方法可迁移，数字不能直接迁移。

跨 benchmark 结果也值得一看。论文把 OSWorld 挖出来的失败补丁迁移到 OmniACT、AndroidControl、ScreenSpotPro、WebVoyager，均有提升：AndroidControl 从 **28.37 ± 0.13** 到 **36.23 ± 0.22**，WebVoyager 从 **23.80** 到 **27.90**，ScreenSpotPro 从 **27.50 ± 0.35** 到 **30.74 ± 0.27**，OmniACT 从 **4.77 ± 0.02** 到 **6.90 ± 0.10**。

![Table 3：OSWorld 中挖出的失败补丁迁移到 OmniACT、AndroidControl、ScreenSpotPro、WebVoyager 后仍有提升](/images/learning-from-failure-cua-self-improvement/table-3-cross-benchmark-results.png)

这组迁移结果说明，OSWorld 里的某些失败模式确实有通用性：看错位置、重复操作、缺知识、不会选更合适的工具，这些问题在 Web、Mobile、Desktop 都会出现。但也要注意，迁移的是策略，不是业务能力。AndroidControl 的提升不代表 agent 已经懂真实 App 的业务规则；它只是更会处理一些通用交互失败。

## 对 APP 自动化测试的启发：失败归因要进入 agent loop

这篇论文最适合迁移到移动端 QA 的不是某段代码，而是失败资产化的流程。

一个面向 APP 自动化测试的 GUI Agent 平台，可以把失败闭环拆成几层。

**第一层：失败轨迹标准化。** 每次失败不只保存最后一张截图，而要保存完整 trajectory：任务意图、每步截图、accessibility tree、动作、等待时间、Appium/UIAutomator/XCUITest 日志、网络请求、后端 mock 状态、崩溃/ANR、设备信息、系统弹窗和输入法状态。

**第二层：失败模式分类。** 先不要追求一次性自动修复所有问题。可以先分几类：grounding 错误、等待/同步错误、权限弹窗、键盘遮挡、WebView/Native 切换、登录态/数据态错误、重复动作、业务断言失败、环境准备失败、不可复现失败。分类本身就能帮助团队知道瓶颈在哪里。

**第三层：策略补丁库。** 每类失败对应 harness 级策略：局部放大复核、点击前后状态校验、重复检测、智能等待、deeplink 恢复、mock 数据重置、接口校验、视觉断言、人工确认、安全权限门禁。不要把所有修复都塞进 prompt；能用确定性工具修的，就放到工具层。

**第四层：回归验证。** 每个补丁必须回到一组固定失败案例上验证。否则 agent 很容易从一个问题修到另一个问题：例如更激进的重试可能提升短期成功率，也可能掩盖真实 bug；更强的 deeplink 可能绕开了用户真实路径；更宽松的视觉断言可能把 UI 回归误判为通过。

这套流程和传统自动化并不冲突。Appium、Maestro、UIAutomator、XCUITest 仍然负责可确定的执行和选择器能力；GUI Agent 负责处理非结构化页面、探索路径、异常恢复和语义判断；失败闭环则把两边的信号组织起来，让系统越跑越知道自己常在哪里翻车。

## 可能被高估的地方

这篇论文方向很实用，但几个边界不能忽略。

第一，补丁生成仍有人工轻量验证。论文不是完全自动让 LLM 改 agent 代码并上线。工程上更应该如此：agent harness 的补丁可能改变权限、工具选择和恢复策略，不能没有 review 就进生产测试链路。

第二，OSWorld 的可验证性是前提。失败闭环依赖环境能判断任务是否成功。真实 APP 测试里，很多业务 oracle 并不天然存在，必须自己建设：UI 状态、后端状态、账务状态、消息状态、埋点、日志、截图差异和人工审核。没有 oracle，失败轨迹很难可靠转成改进信号。

第三，策略可能带来 benchmark-specific bias。比如 OSWorld 中 Terminal Execution 很有效，不代表所有场景都应优先走命令行。移动端测试里，绕过 GUI 准备状态是合理的，但如果测试目标本身就是用户路径，就不能用 deeplink 或接口直接跳过关键流程。

第四，推理时补丁不是训练。它能增强当前 agent 的执行策略，但不等于模型真正学会了新能力。对于高频、稳定、可泛化的失败模式，最终还是可能需要沉淀为训练数据、规则库、工具 API 或平台能力。

第五，安全边界要单独设计。Terminal、搜索、软件手册、自动代码补丁这些能力在研究环境里很方便，在企业测试环境里会触及凭证、隐私、数据改写和外网访问。移动端 QA 平台如果引入类似机制，必须有最小权限、测试账号隔离、敏感动作审批、审计日志和可回放轨迹。

## 总结

Learning from Failure 的核心判断很朴素：GUI Agent 的失败轨迹不是废料，而是系统最便宜、最真实的调试数据。论文用 OSWorld 证明了这件事有实际收益：OpenCUA-72B 从 **42.3%** 提升到 **48.9%**，并且不需要额外训练，只在推理时接入 Visual Search、Terminal Execution、Knowledge Support 和 Repetition Warning 这类策略。

对 APP 自动化测试来说，它给出的工程启发更重要：别把 agent 失败只当作日报里的红叉。每一次失败都应该进入可检索、可分类、可复现、可修复的闭环。截图、轨迹、日志、网络、后端状态、设备状态和业务 oracle 都是下一轮 agent 变稳的材料。

更现实的落点不是“让一个模型自动修好所有测试”，而是把 GUI Agent 放进一个有失败归因、有策略补丁、有回归验证、有权限边界的测试系统里。这样它才可能从会点屏幕，走向能稳定参与移动端 QA 的生成、执行和评估闭环。

## 参考链接

- 论文：<https://arxiv.org/abs/2606.31270>
- PDF：<https://arxiv.org/pdf/2606.31270>
- 代码：<https://github.com/snow10072740/Learning_from_Failure>
- 对比基准：OSWorld、AndroidControl、ScreenSpotPro、WebVoyager、OmniACT
