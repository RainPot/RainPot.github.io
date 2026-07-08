---
title: "UI-MOPD：跨桌面和手机训练 GUI Agent，不能只把数据混在一起"
description: "解析 arXiv 2026 论文 UI-MOPD：Multi-Platform On-Policy Distillation for Continual GUI Agent Learning。文章从 GUIAgent 与移动端 QA 视角讨论 Uni-GUI 数据集、多教师 on-policy 蒸馏、OSWorld/MobileWorld 结果，以及跨平台 APP 自动化测试的工程边界。"
date: "2026-07-08"
tags: ["GUI Agent", "Computer Use", "Mobile Agent", "Continual Learning", "APP 自动化测试"]
draft: false
featured: false
readingTime: 13
---

> 论文：[UI-MOPD: Multi-Platform On-Policy Distillation for Continual GUI Agent Learning](https://arxiv.org/abs/2607.04425)  
> arXiv：`2607.04425v1`，2026-07-05  
> 作者：Niu Lian, Alan Chen, Zhehao Yu, Chengzhen Duan, Fazhan Liu, Hui Liu, Pei Fu, Jian Luan, Yaowei Wang, Shu-Tao Xia, Jinpeng Wang  
> 一句话结论：**这篇论文把 GUI Agent 的跨平台训练问题讲得比较清楚：桌面和手机不是两份同质数据，直接 mixed SFT 或模型合并很容易把点击、滑动、窗口、文件、输入法这些平台习惯搅在一起。UI-MOPD 的价值不在于给出一个“全平台通吃”的终局模型，而在于用平台路由的多教师 on-policy 蒸馏，把桌面 teacher 和移动端 teacher 的行为边界留在训练过程中。对 APP 自动化测试来说，这比单纯堆轨迹更接近真实落地问题。**

GUI Agent 研究正在从单平台走向多平台。前两年大家更关心模型能不能在 Web、Android、桌面中的某一个环境里跑通任务；现在问题开始变成：同一个 agent 能不能在不同 GUI 习惯之间迁移，还不把已有能力忘掉。

这个问题在移动端 QA 里非常具体。Android 原生页面、iOS 页面、H5、Hybrid 容器、桌面后台系统、Web 管理台，看起来都是“看屏幕然后点控件”，但动作习惯完全不同：手机靠 tap、swipe、返回键和软键盘；桌面有鼠标、快捷键、窗口焦点、文件系统和菜单栏；Web 有 DOM、URL、异步加载和浏览器状态。把这些轨迹直接混到一个 SFT 数据集里，模型可能学到的不是“跨平台能力”，而是一套平均化、互相干扰的动作模式。

UI-MOPD 讨论的正是这个点。论文提出 Uni-GUI 数据集和 UI-MOPD 训练方法，目标是在 desktop 和 mobile 两类环境之间训练一个共享 GUI agent，同时尽量保留各自的平台行为。

![Figure 1：论文用 model merge、mixed SFT 和 MOPD 对比说明问题。直接合并参数或混合数据，会把桌面和移动端动作约定压成平均策略；UI-MOPD 则在 on-policy rollout 时按平台选择对应 teacher。](/images/ui-mopd-multiplatform-gui-agent/figure-1-motivation.png)

## 这篇论文解决的不是“多收点数据”这么简单

论文把跨平台 GUI Agent 的难点拆成两层。

第一层是数据。高质量、可执行、跨平台的 GUI 轨迹并不多。很多公开轨迹存在动作不兼容、状态和动作对不齐、任务粒度不一致、执行失败但仍被保留下来等问题。对训练 GUI agent 来说，这些噪声不是小瑕疵。一个错误坐标、一段和截图不匹配的 reasoning、一次失败轨迹被当成成功，都可能把模型往错误动作格式上带。

第二层是训练。桌面和移动端虽然都属于 GUI，但平台约定差别很大。桌面任务常见鼠标点击、拖拽、热键、文件保存、窗口切换；移动端则更依赖触摸、滚动、返回、输入法和应用间跳转。直接 mixed SFT 会让模型在同一个参数空间里同时拟合两类行为；模型合并也容易出现参数层面的折中。论文把这种现象叫作 behavioral pattern mixing、platform-specific capability degradation 和 catastrophic forgetting。

换到工程里，这和把 Appium 脚本、Maestro flow、Web Selenium trace、桌面 RPA trace 全部转成同一种“点击屏幕”语料再训练很像。看上去数据量变大了，但模型可能反而更不稳定：该用返回键时去找关闭按钮，该点坐标时输出文本选择器，该等待页面刷新时连续点击。

## UI-MOPD：用平台路由保留 teacher 的行为边界

UI-MOPD 的训练分两阶段。

第一阶段，作者先基于 Uni-GUI 轨迹分别做 SFT，得到 desktop teacher 和 mobile teacher。也就是说，桌面和移动端先各自学出比较清楚的平台行为。

第二阶段，训练一个共享 student。关键不是把两个 teacher 的输出静态蒸馏给 student，而是让 student 在当前策略下做 on-policy rollout，然后根据当前环境选择对应 teacher，用 reverse-KL 之类的约束把 student 拉回该平台的合理行为分布。桌面 rollout 由 desktop teacher 约束，移动端 rollout 由 mobile teacher 约束。

![Figure 2：UI-MOPD 训练流程。Stage 1 先用 Uni-GUI 训练桌面和移动端 teacher；Stage 2 让共享 student 在环境中 rollout，并通过 platform-conditioned routing 接收对应 teacher 的 reverse-KL 约束和规则化 reward。](/images/ui-mopd-multiplatform-gui-agent/figure-2-training-pipeline.png)

这里真正有用的设计是 **platform-conditioned teacher routing**。它没有假设“跨平台 GUI 行为天然可以平均”。相反，它承认桌面和手机有各自的动作先验，再把这些先验作为在线优化时的行为锚点。

这点对移动端自动化测试很重要。如果一个统一 agent 同时服务 Android、iOS、H5 和桌面管理台，它最好不要只有一个模糊的“GUI 操作风格”。更稳的系统应该知道自己当前在哪个平台、可用哪些动作、哪些状态验证手段更可靠：Android 可以结合 UIAutomator hierarchy、adb、activity 状态和截图；iOS 可以结合 XCUITest accessibility、系统弹窗处理和截图；H5/WebView 还要看 DOM、URL、网络请求和 JS 状态。平台路由不一定只体现在模型 teacher 上，也可以体现在工具选择、动作 schema、oracle 和回滚策略上。

## Uni-GUI：数据价值在于清洗和统一 harness，而不只是规模

论文构造了 Uni-GUI，一个跨 desktop 和 mobile 的 GUI 交互数据集。Appendix 里给出的规模是约 **160K steps、11.5K trajectories**，由自采集轨迹和清洗后的 OpenCUA、OpenMobile 轨迹组成。其中 desktop 侧约 95K 自采集步骤和 13K 公开清洗步骤，mobile 侧约 17K 自采集步骤和 35K 公开清洗步骤。

更值得看的是数据管线，而不是这个数字本身。作者用统一 harness 做 query generation、trajectory collection、trajectory cleaning 和 post-processing。query 不是自由生成，而是从目标环境支持的功能点出发，减少不可执行任务；trajectory cleaning 会过滤 malformed step、unsupported action space、environment-query mismatch 和 unsuccessful trajectories；post-processing 还会统一 reasoning 结构，并重新标注可 grounding 动作的 bounding box。

![Figure 4：Unified Cross-Platform Data Collection Harness。它把 query 生成、轨迹采集、轨迹清洗和后处理串起来，重点是过滤不可执行或不兼容轨迹，而不是简单把多平台 trace 拼接。](/images/ui-mopd-multiplatform-gui-agent/figure-4-data-harness.png)

这套流程对 QA 团队很有借鉴意义。很多团队其实已经有大量自动化资产：Appium 用例、UIAutomator 选择器、XCUITest 脚本、Maestro flow、人工测试步骤、Bug 复现录屏、线上埋点和截图。但这些资产不能直接喂给 GUI agent。至少要先做几件事：

1. **统一动作空间**：区分 click、scroll、input、back、home、wait、open_app、hotkey、file 操作等，不要把所有行为都压成自然语言。
2. **验证轨迹是否真的成功**：只靠模型或脚本说“完成”不够，最好有 UI 终态、接口状态、数据库状态、日志或截图 oracle。
3. **保留平台特有信息**：Android 的 activity/package/resource-id，iOS 的 accessibility label，H5 的 DOM/URL，Hybrid 的 native-WebView 边界，都应该进入轨迹元数据。
4. **清理不可复现步骤**：账号态、推荐流、灰度实验、权限弹窗、地区和语言差异，会让同一条轨迹第二天就失效。

说白了，Uni-GUI 的重点不是“又一个大数据集”，而是提醒我们：跨平台 agent 数据首先要可执行、可对齐、可清洗、可验证。

## 主要结果：UI-MOPD 在 OSWorld 和 MobileWorld 上更均衡

论文用 OSWorld 评估桌面 GUI 任务执行，用 MobileWorld 评估移动端任务执行。主结果里，UI-MOPD 达到 **38.2% OSWorld** 和 **12.0% MobileWorld**。

![Table 1：UI-MOPD 在 OSWorld 和 MobileWorld 上取得相对均衡的结果。相比 Mixed-SFT、weight averaging 和 TIES merging，MOPD 尤其改善了 MobileWorld 侧的表现。](/images/ui-mopd-multiplatform-gui-agent/table-1-main-results.png)

几个对比值得单独拎出来看。

- Qwen3-VL-8B-Thinking 是 **33.9% / 7.7%**，UI-MOPD 提升到 **38.2% / 12.0%**。
- Mixed-SFT 是 **35.0% / 6.4%**，桌面略升，但移动端反而低于 base。
- Weight Averaging 是 **36.5% / 6.8%**，TIES Merging 是 **36.8% / 0%**，说明静态模型合并在移动端可能非常脆弱。
- UI-MOPD 虽然不是所有单平台指标都超过 teacher，但它在一个 8B student 上同时保住了两侧能力。

这个结果的工程含义比较直接：跨平台能力不是把两个模型平均一下，也不是把两类轨迹混训一下就会自然出现。移动端尤其容易受损，因为手机交互的动作格式、界面密度、返回逻辑、输入法和滚动节奏都和桌面不同。

论文的 teacher-student 分析也支持这个判断。平台专用 32B teacher 在单平台上更强：desktop teacher 的 OSWorld 是 **46.3%**，mobile teacher 的 MobileWorld 是 **16.2%**。但把 8B 模型只在 OSWorld 上 SFT 后，MobileWorld 掉到 **0%**；只在 MobileWorld 上 SFT 后，MobileWorld 到 **12.8%**，但桌面没有 UI-MOPD 均衡。

![Table 2：teacher-student 分析显示，单平台 SFT 很容易让另一侧退化；UI-MOPD 的目标不是超过所有 teacher，而是把平台专用能力蒸馏到一个共享 8B student 中。](/images/ui-mopd-multiplatform-gui-agent/table-2-teacher-student.png)

这组数字也提醒我们不要误读论文。MobileWorld **12.0%** 仍然不高，远不到“移动端自动化测试可以放心交给 agent”的程度。它更像是说明：在同样受限的 student 规模下，平台路由蒸馏比混合训练更不容易把移动端能力毁掉。

## 静态 grounding 没有明显被牺牲，这是一个好信号

多平台训练还有一个风险：交互成功率上去了，但单步 GUI grounding 或静态理解能力被破坏。论文额外评估 AndroidControl⋆、ScreenSpot-Pro、ScreenSpotV2 和 OSWorld-G。

![Table 3：UI-MOPD 在 AndroidControl⋆ 上从 78.73% 到 80.05%，在 ScreenSpot-Pro、ScreenSpotV2 和 OSWorld-G 上基本保住 base 的 grounding 能力；TIES merging 则出现明显下降。](/images/ui-mopd-multiplatform-gui-agent/table-7-grounding-results.png)

细粒度结果里，UI-MOPD 在 AndroidControl⋆ 的 action type accuracy、target grounding、ancestor grounding 和 overall accuracy 都略高于 base；ScreenSpot-Pro、ScreenSpotV2 大体接近 base；OSWorld-G overall 从 **52.13%** 到 **52.84%**。相比之下，TIES merging 在多个 grounding benchmark 上下降更明显。

这点对 APP 自动化测试很关键。一个 agent 不能只看最终 task success。测试执行里大量失败来自单步层面：点错控件、滚动方向错、输入框没聚焦、弹窗没处理、状态没刷新、WebView 和 native 控件树不一致。若跨平台训练让 grounding 退化，即使长程 benchmark 偶尔跑分变好，也不一定能落地。

论文这里的证据还算正向：MOPD 没有明显牺牲静态 GUI 能力。但也要注意，AndroidControl⋆ 是作者抽取的 subset，静态评估不能替代真实 App 回归场景里的多设备、多语言、多账号态、多网络状态验证。

## Case study：能跑通局部流程，但别把它当成稳定 QA 工具

论文给了移动端和桌面端 case study。移动端例子是一个邮件/社交类任务，模型需要理解指令、进入应用、选择附件或输入回复，再完成动作。为了让博客里看清主要动作序列，我这里放的是论文 Figure 3 的上半部分裁剪；完整图包含更多后续步骤和结构化 reasoning。

![Figure 3 上半部分：UI-MOPD 的移动端任务执行示例。图里能看到从应用入口、列表、撰写界面到附件选择的动作链。完整论文图还包含后续结构化 CoT 和动作序列。](/images/ui-mopd-multiplatform-gui-agent/figure-3-mobile-case-top.png)

桌面例子则是 LibreOffice Calc 到 Writer 的数据迁移，并保存成 `price.docx`。这类任务对桌面 agent 来说比单纯网页点击难得多：要处理窗口、菜单、复制粘贴、文件保存和格式保持。

![Figure 5：UI-MOPD 的桌面任务执行示例。任务涉及 LibreOffice Calc、Writer、复制粘贴和保存文件，暴露了桌面 GUI 中窗口焦点、菜单点击和文件路径这类长程状态问题。](/images/ui-mopd-multiplatform-gui-agent/figure-5-desktop-case.png)

这些 case study 可以说明模型学到了一些实际交互行为，但不能证明它已经适合作为稳定测试执行器。真实 QA 里，一个任务“看起来完成”不够。比如移动端发帖或回复任务，需要确认网络请求成功、服务端状态更新、页面重新拉取后仍存在；文件保存任务要检查文件路径、文件内容、格式、编码和权限。GUI agent 的截图轨迹只能覆盖一部分证据。

## 对 APP 自动化测试的启发

这篇论文对移动端 QA 的启发，我理解主要有四点。

**第一，跨平台 agent 要显式建模平台，而不是假装平台不存在。**  
Android、iOS、H5、Hybrid、桌面后台和 Web 控制台可以共享高层任务理解，但不应共享一套无差别动作习惯。工程系统里至少要有 platform router：决定当前用 Appium、UIAutomator、XCUITest、Maestro、浏览器 DOM、视觉点击、adb、接口 mock 还是后端校验。

**第二，多平台训练要防止“能力平均化”。**  
Mixed SFT 的问题不是没用，而是它很容易把不同平台的动作约定混在一起。QA 场景里也一样：如果把 Android 返回键、iOS 手势、H5 DOM click、桌面快捷键都转成一锅自然语言步骤，agent 可能学到的是不稳定折中。更好的做法是保留动作 schema、平台元数据和 teacher/validator 分工。

**第三，轨迹清洗比轨迹数量更重要。**  
APP 测试数据里最危险的是“表面完整但其实失败”的轨迹。比如验证码跳过了、权限弹窗状态不一致、测试账号没有订单、推荐流不同、接口返回灰度内容、Hybrid 页面加载慢。若这些轨迹被当成成功样本训练，模型会学到错误恢复路径。UI-MOPD 的 harness 思路可以迁移：先生成可执行 query，再采集，再按子任务和终态过滤。

**第四，benchmark success rate 需要和 oracle 设计一起看。**  
OSWorld 和 MobileWorld 结果有参考价值，但 QA 落地不能只看任务成功率。真正上线时要报告 step 成功率、重试次数、平均耗时、误点击率、危险动作拦截率、截图/控件树一致性、后端状态校验通过率，以及失败能否 replay。否则 agent 成功一次不代表可用于回归测试。

## 边界和疑问

UI-MOPD 的方向很务实，但边界也明显。

首先，训练成本很高。论文实验使用 **64 NVIDIA H100 GPUs**，teacher 是 Qwen3-VL-32B-Thinking，student 是 Qwen3-VL-8B-Thinking，还要配合 verl、Megatron-Core 和 SGLang 做 rollout。普通 QA 团队很难完整复现这套训练流程。更现实的做法可能是复用它的思想：平台路由、teacher 分工、轨迹清洗、规则 reward 和 action schema，而不是从零训练一个同规模模型。

其次，评估平台仍然有限。论文主要看 desktop 和 mobile，没有直接覆盖 iOS、复杂 Hybrid、真实商业 App 的账号态、支付态、权限系统、推送通知、地图/相机/相册等高变动场景。MobileWorld 的成功率也仍然偏低，说明跨平台训练还没有解决移动端长程任务可靠性。

再次，规则 reward 依赖动作可解析、目标 bbox、文本匹配、滚动方向等结构化信息。这对 benchmark 很合理，但真实 APP 里很多正确性来自业务语义：券是否实际核销、订单是否进入售后状态、推送是否送达、埋点是否上报、风控是否触发。这些不能只靠 GUI bbox 判断。

最后，平台路由本身也会出错。Hybrid 页面、嵌入式 WebView、系统权限弹窗、第三方登录 SDK，经常让一个任务在多个平台语义之间切换。工程系统不能只在任务开始时路由一次，还要在执行过程中动态识别当前上下文。

## 结论

UI-MOPD 的核心贡献不是证明“一个模型已经能稳定操作所有 GUI”，而是把跨平台 GUI Agent 训练里的一个真实问题讲清楚了：桌面和移动端不是可以随便混合的同类轨迹，平台行为需要被保留下来，并在 on-policy 学习时被持续约束。

对 APP 自动化测试来说，这篇论文最值得借鉴的是三件事：用统一 harness 清洗可执行轨迹；用平台路由保留 Android/iOS/H5/桌面等不同动作先验；用规则 reward 和终态校验约束 agent 不要只学会“看起来像在操作”。如果未来要把 GUI Agent 接进回归、探索测试或线上问题复现，这些工程层面的边界，比单次 benchmark 提升几个点更重要。
