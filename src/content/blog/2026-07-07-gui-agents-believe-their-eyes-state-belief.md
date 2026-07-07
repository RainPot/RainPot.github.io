---
title: "GUI Agent 真的相信屏幕吗：像素、DOM 与状态信念之间的错位"
description: "解析 arXiv 2026 论文 Do GUI Agents Believe Their Eyes?：作者用 310 个真实 web、mobile、desktop 探针诊断多模态 GUI agent 的状态信念到底来自截图还是 DOM/accessibility 等结构化通道，并讨论它对 APP 自动化测试与移动端 QA 的工程启发。"
date: "2026-07-07"
tags: ["GUI Agent", "Computer Use", "GUI Grounding", "APP 自动化测试", "Evaluation"]
draft: false
featured: false
readingTime: 14
---

> 论文：[Do GUI Agents Believe Their Eyes? Diagnosing State-Belief Reliance on Pixels versus Structure](https://arxiv.org/abs/2607.04334)  
> arXiv：`2607.04334v1`，2026-07-05  
> 作者：Guijia Zhang, Harry Yang  
> 一句话结论：**这篇论文不是在问 GUI agent 能不能读懂截图，而是在问它读懂截图以后，最终相信的是截图，还是 DOM / accessibility tree 这类结构化通道。结果很警醒：文本状态冲突时，多数模型会在“截图看对了”的前提下，把状态信念交给结构化文本。对移动端 QA 来说，这意味着控件树、OCR、截图和动作通道之间必须做一致性校验，不能把任何单一通道当成默认真相。**

很多 GUI Agent 系统都会同时给模型两种观察：一张截图，以及一段结构化界面信息，比如 DOM、accessibility tree、控件列表或带索引的元素文本。工程上这样做很自然：截图保留真实视觉状态，结构化信息方便定位、点击和输入。问题在于，这两个通道并不总是一致。

在真实 APP 或 WebView 里，控件树可能滞后，列表复用可能留下旧文本，H5 页面渲染和 native accessibility 同步可能有延迟，A/B 实验、国际化文案、弹窗遮挡也会让“屏幕上看到的东西”和“结构里写的东西”不一致。过去评测通常只看任务成功率、grounding 准确率或最终截图是否达标，很少追问一个更底层的问题：**agent 当前相信的界面状态，究竟是从像素来的，还是从结构化通道复制来的？**

这篇论文把这个问题单独拎出来，定义为 visual state reliance，并提出核心指标 Perception-Fusion Gap（pfg）：模型在 image-only 条件下能正确读出屏幕状态，但在截图 + 结构同时输入且二者冲突时，最终回答却跟随结构化通道的比例。

![Figure 1 展示论文的核心诊断场景：截图里的按钮文本是 Reservations，但被编辑后的 DOM 写成 Budget Truck；模型单看截图能答对，融合输入时却跟随结构化文本。](/images/gui-agents-believe-their-eyes-state-belief/figure-1-core-scenario.png)

## 它测的不是“看见没有”，而是“相信谁”

论文的关键设计是 paired intervention。每个 probe 都来自真实 web、mobile 或 desktop 数据，不用模型生成题目，也不用模型 judge 打分。作者对同一个界面构造几种条件：只给截图、只给结构、截图和结构一致、截图和结构冲突。这样才能把“视觉感知能力”和“多通道融合后的状态信念”拆开。

Table 1 把干预方式讲得很清楚：同一个任务只改一个通道，其他内容尽量保持不变。对 GUI Agent 评测来说，这个设计比单纯看最终成功率更有诊断价值。因为最终失败可能来自规划、点击、等待、环境 reset、oracle 等很多环节；而这里直接测的是 agent 在行动前形成的状态信念。

![Table 1：paired interventions 的设计。论文通过单通道编辑把 perception failure 和 fusion failure 区分开。](/images/gui-agents-believe-their-eyes-state-belief/table-1-paired-interventions.png)

数据规模不算大，但很有针对性：310 个 probes，覆盖 web-text、mobile-widget、stale-reference、mobile visible controls 和 desktop-graphic 等类型。headline 分析主要使用三个可靠冲突族；人工审计部分报告两位标注者 raw agreement 为 0.85，Cohen's κ=0.83。也就是说，作者没有把“结构冲突”做成随意的合成噪声，而是尽量保证像素侧真值可判定。

## 主要结果：文本状态最容易被结构化通道“劫持”

Table 2 是这篇论文最值得看的结果。Web-text 任务里，五个来自三家 vendor 的模型 image-only 准确率都接近天花板：例如 gpt-5.4 的 Accimg 是 0.93，gpt-4o 是 0.92，Qwen2.5-VL-7B 是 0.86，InternVL3-8B 是 0.89。也就是说，它们不是看不懂截图上的文字。

但一旦截图和结构化文本冲突，pfg 都是正的，而且范围从 0.30 到 0.75。换句话说，模型明明能从截图读对，却在融合输入时把一部分状态信念交给了 DOM / 结构化文本。

![Figure 2 和 Table 2：模型 image-only 感知接近天花板，但 Perception-Fusion Gap 仍然明显为正，说明问题不只是 OCR 或视觉识别失败。](/images/gui-agents-believe-their-eyes-state-belief/figure-2-perception-fusion-gap.png)

![Table 2：Web-text 结果。不同模型的结构跟随程度不同，但五个模型都出现了 perceive-correctly-yet-defer 的现象。](/images/gui-agents-believe-their-eyes-state-belief/table-2-web-text-results.png)

Figure 3 进一步说明，这个现象不是所有界面状态都一样严重。文本类状态最容易被结构化通道带偏；非文本身份，比如图标、控件类型、widget identity，在强模型上更偏向像素。这个差异对 APP 测试很重要：很多业务断言恰好是文本状态——订单状态、按钮文案、金额、优惠、错误提示、tab 选中态。如果 agent 在这些地方默认相信 accessibility 文本或 DOM 文本，就可能把“屏幕实际显示”误判成“结构里声称”。

![Figure 3：不同界面家族的 pixel-following rate。文本冲突更容易触发结构跟随，非文本 identity 在强模型上相对更依赖像素。](/images/gui-agents-believe-their-eyes-state-belief/figure-3-pixel-following-family.png)

## 动作通道也会改变风险：坐标动作比索引动作更不容易被结构文本带跑

论文里一个很有工程味的发现是：问题不只在模型，也在动作接口。

Table 3 比较了专门的 GUI agent。UGround、Aguvis 这类 coordinate-emitting agents 在冲突条件下更能保持视觉 grounding；而 OS-Atlas 这类使用结构化 index 输出动作的 agent 更容易被 hijack，表现接近通用 VLM。作者的解释很直接：当动作接口要求模型输出元素 id、index 或结构化节点时，模型更有动力相信结构；当动作落点必须回到屏幕坐标时，视觉通道的约束更强。

![Table 3：专门 GUI agent 的分化。坐标输出的 agent 更视觉化，结构索引输出的 agent 更容易跟随被编辑的结构通道。](/images/gui-agents-believe-their-eyes-state-belief/table-3-specialized-gui-agents.png)

这点对自动化测试框架尤其现实。Appium、UIAutomator、XCUITest 天然偏控件树和 selector；视觉测试、OCR 和截图 diff 偏像素；GUI agent 往往想把两者结合起来。论文提醒我们：混合不是把信息全塞给模型就结束了，动作接口本身会塑造模型的信任偏好。

如果一个 mobile agent 总是通过 `click(index)` 或 `tap(element_id)` 执行动作，它可能在文本状态冲突时更相信控件树；如果完全用坐标，又会丢掉 selector 的稳定性和可解释性。更稳的工程方案不是二选一，而是让动作前后都做跨通道校验：结构候选能提高定位效率，但关键状态仍要用截图/OCR/视觉检查确认；点击后还要验证页面、日志、网络或业务状态是否真的变化。

## 论文还证明：错的信念会传到真实动作

这篇论文没有停在离线问答。作者在 AndroidWorld 和 MiniWoB++ 两个 live agent 环境里做 belief-to-action 测试，构造屏幕像素和元素列表语义冲突，然后执行模型选择的 tap。Table 15 汇总了结果：结构冲突会让 agent 点击结构化通道命名的元素，并带来真实任务失败。

![Table 15：belief-to-action 实验显示，冲突不只是回答错误，还会传播到 AndroidWorld 和 MiniWoB++ 的真实点击动作。](/images/gui-agents-believe-their-eyes-state-belief/table-15-live-action-conflict.png)

Appendix 里的 Table 17 也很有意思：在同一批 web-text click 任务里，按模型 stated belief 分组，跟随结构信念的一组 wrong-click rate 明显更高。也就是说，错误不是简单来自“元素列表被污染所以怎么点都错”，而是先形成了错误状态信念，再把这个信念转成动作。

![Table 16 和 Table 17：一致性 gate 能降低结构跟随；同一个点击任务里，跟随结构信念的样本更容易点错。](/images/gui-agents-believe-their-eyes-state-belief/table-16-17-consistency-and-action-interface.png)

作者还测试了一个 training-free consistency gate：当检测到截图和结构不一致时，重新 grounding 或调整信任策略。Figure 4 显示，这个 gate 能显著降低 text-swap 的 structure-following，同时对一致条件的错误率影响很小。不过论文也很谨慎：这不是完整防御，只是诊断后的启发式修复。真实环境里，截图也可能被遮挡、压缩、模糊或被恶意视觉元素干扰；结构也可能比截图更可靠，比如屏幕外节点、可访问性标签、隐藏但可操作的控件。关键是系统要知道自己在相信哪个通道，而不是默认融合后就是真相。

![Figure 4：training-free consistency gate 能减少结构通道劫持，但作者把它定位为诊断性修复，而不是完整防御。](/images/gui-agents-believe-their-eyes-state-belief/figure-4-consistency-gate.png)

Figure 5 给了两个真实 structure-swap probe。它们看起来不像极端攻击样本，更像日常 GUI 系统会遇到的同步问题：屏幕上显示一个值，结构化通道里却是另一个值。对移动端 QA 来说，这类问题并不陌生，尤其在 RecyclerView 复用、Hybrid 容器、异步接口刷新、埋点延迟和无障碍树更新不及时的时候。

![Figure 5：两个真实 structure-swap probe。论文强调这些冲突来自真实界面，而不是模型生成的玩具样本。](/images/gui-agents-believe-their-eyes-state-belief/figure-5-real-structure-swap-probes.png)

## 对 APP 自动化测试的启发

这篇论文最直接的工程启发，是把 GUI agent 的 observation 设计从“多通道越多越好”改成“多通道必须可校验”。在 APP E2E 测试里，截图、OCR、accessibility tree、DOM、接口返回、日志、数据库状态都可能提供证据，但它们的时效性和可信度不同。

第一，关键业务状态不能只看控件树。比如支付按钮是否置灰、优惠是否生效、订单状态是否变更、错误提示是否出现，这些都应该至少用截图/OCR 或视觉断言做一次交叉确认。控件树适合定位和加速，但不应该天然拥有最高真值优先级。

第二，动作接口要保留 provenance。一次 `tap(element_id=42)` 最好记录当时的截图 crop、元素文本、bounds、OCR 结果、accessibility 属性、页面时间戳和后端状态。失败时才能判断是视觉误读、selector 漂移、结构滞后、等待不足，还是业务 oracle 本身错了。

第三，等待策略要纳入信任模型。很多移动端失败不是因为模型不会点，而是因为它在页面还没稳定时读到了旧结构或旧截图。传统自动化里常见的 explicit wait、idle detection、网络请求等待、动画完成检查，在 GUI agent 时代仍然重要，只是需要和视觉状态信念结合起来。

第四，对 H5 / Hybrid / 小程序类页面要特别小心。它们经常同时存在 native accessibility、Web DOM、canvas 渲染、OCR 文本和截图视觉状态。论文里的 pixel-vs-structure 冲突，在这些场景里会更常见。

## 真正贡献与边界

这篇论文真正推进的不是某个 benchmark 分数，而是给 GUI Agent 增加了一个可测的诊断维度：**状态信念来源**。过去我们常说 agent “看懂了屏幕”或“点错了控件”，但这两个描述中间缺了一层：它到底相信了哪个界面状态。Perception-Fusion Gap 把这层拆出来，能帮助研究者和工程团队定位多通道融合里的隐性风险。

可能被高估的部分也要说清楚。首先，310 个 probes 更像诊断集，不是覆盖所有 APP 场景的大规模 benchmark。其次，论文主要围绕结构化文本冲突展开，对动态视频、复杂手势、跨应用状态、网络和业务后端 oracle 的覆盖有限。第三，consistency gate 是有用的 baseline，但不能替代完整的执行验证和回滚机制。

如果要落到移动端 QA 系统里，最值得复现的不是整套论文实验，而是三件事：

1. 为内部 APP 构造 pixel-vs-tree 冲突探针，覆盖 RecyclerView、WebView、弹窗、异步刷新和国际化文案。
2. 在 agent 轨迹里记录每一步状态信念来自截图、OCR、控件树还是接口返回，并在冲突时降低自动执行权限。
3. 把最终断言从“模型说完成了”改成多源 verifier：UI 状态、业务接口、日志、数据库/mock 数据、崩溃/ANR 和截图证据一起判断。

GUI Agent 要在真实 APP 自动化里可靠工作，不能只会“看屏幕”和“点控件”。它还要知道：当屏幕、DOM、accessibility tree 和业务状态互相打架时，哪一个证据更可信，什么时候应该等待，什么时候应该拒绝执行，什么时候应该把不确定性暴露给测试框架。这个问题比单点 grounding 分数更接近工程落地的核心。