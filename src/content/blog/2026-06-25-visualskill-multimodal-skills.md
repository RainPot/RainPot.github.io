---
title: "VISUALSKILL 论文解析：GUI Agent 的技能库为什么不能只剩文字"
description: "从 GUIAgent 与移动端 QA 视角解析 VISUALSKILL：它把应用级技能库从 text-only 文档推进到按需加载的图文混合知识，并用 matched text-only control 证明 UI 图像本身能帮助元素定位和中间状态验证。"
date: "2026-06-25"
tags: ["GUI Agent", "Computer Use", "Multimodal Skill", "MCP", "APP 自动化测试"]
draft: false
featured: false
readingTime: 16
---

> 论文：[VISUALSKILL: Multimodal Skills for Computer-Use Agents](https://arxiv.org/abs/2606.18448)  
> arXiv：`2606.18448v1`，2026-06  
> 代码：[XMHZZ2018/VisualSkills](https://github.com/XMHZZ2018/VisualSkills)  
> 作者：Ziyan Jiang, Li An, Yujian Liu, Jiabao Ji, Qiucheng Wu, Jacob Andreas, Yang Zhang, Shiyu Chang  
> 机构：UC Santa Barbara, MIT CSAIL, MIT-IBM Watson AI Lab  
> 一句话结论：**VISUALSKILL 真正推进的不是“给 Agent 多塞一份说明书”，而是把 GUI 任务里的视觉知识重新放回技能库：菜单长什么样、弹窗打开后处于什么状态、哪个按钮在页脚，这些信息只靠文字描述会丢失。对 APP 自动化测试来说，它提醒我们：可复用知识库不应只有步骤文本，还要包含关键界面截图、状态对照图和断言证据。**

GUI Agent 论文里，最近很多工作都在讨论更强的 grounding、更长的上下文、更像真实手机或桌面的 benchmark。VISUALSKILL 切入的位置稍微不同：它问的是，Agent 已经能读文件、调工具、执行鼠标键盘动作了，为什么还会在一个陌生软件里反复点错菜单、看不懂弹窗、做完一步却不知道当前状态是否正确？

论文的判断很直接：很多 computer-use agent 的“技能库”还是 text-only。也就是说，应用知识被整理成 Markdown、函数说明、菜单路径和操作步骤。但 GUI 本身不是纯文本界面。图标、布局、工具栏位置、弹窗状态、选中/禁用控件、下拉菜单展开后的层级，这些信息被改写成文字后，Agent 其实失去了一部分执行所需的 grounding 证据。

![VISUALSKILL 的动机图：text-only skill 很难精确描述图标、布局和需要关注的操作区域](/images/visualskill-multimodal-skills/figure-1-motivation.png)

这张图重要的地方在于，它没有把问题归因到“模型不够聪明”。相反，它指出 skill artifact 的表达方式本身有问题：当一个任务依赖图标、位置和界面状态时，纯文字说明容易把清楚的视觉线索变成含糊的自然语言。换到移动端 QA 里也一样，“点击右上角更多按钮后选择分享”这句话不一定够用；不同 App 的更多按钮、分享入口、底部 sheet 和权限弹窗长得并不一样。

## 这篇论文在 GUIAgent 谱系中的位置

放在 GUIAgent / computer-use agent 的谱系里，VISUALSKILL 不是一个新的静态 GUI grounding 数据集，也不是一个完整替代 OSWorld、AndroidWorld、VisualWebArena 的 benchmark。它更接近 **技能记忆与运行时知识加载** 方向：当 Agent 面对某个具体应用时，怎样把这个应用的过程知识、界面截图和状态提示组织成可复用资产，并在执行过程中按需取用。

和几个相邻方向相比，它的位置比较清楚：

- **相对 GUI grounding**：ScreenSpot、GUI-Actor、UI-AGILE 等工作主要回答“目标元素在哪里”。VISUALSKILL 关心的是 grounding 之前的应用知识：Agent 是否知道应该打开哪个菜单、弹窗正常状态长什么样、操作后应看到什么确认信号。
- **相对 OSWorld / CUA-World / OSExpert-Eval**：这些环境评测的是真实或接近真实的软件任务成功率。VISUALSKILL 使用 CUA-World 和 OSExpert-Eval 做验证，但贡献不在 benchmark 本身，而在 skill artifact 的组织方式。
- **相对 AndroidWorld / mobile agent**：论文实验集中在桌面软件，如 LibreOffice、GIMP、Tableau、QGIS、OpenToonz。不过方法对移动端并不陌生：一个 App 一个技能库、按主题加载图文指南、用真实探索补齐文档缺口，这些都可以迁移到 Android/iOS/H5/Hybrid 自动化流程。
- **相对 SaaS-Bench / VisualWebArena**：Web/SaaS 场景常有 DOM、ARIA、URL 和 API 结构可用；VISUALSKILL 更偏截图和图文知识。它对无法稳定拿到结构化 UI 树的原生 App、桌面软件、复杂 WebView 更有启发。

这篇论文真正推进的是一个细节但很关键的能力轴：**技能库不只是给 Agent 读的说明文本，还应该是可以在执行时被视觉引用、被状态对齐、被反复加载的多模态工作手册。**

## 方法：一个应用一套图文技能，执行时按主题加载

VISUALSKILL 的结构不复杂，但设计比较克制。它为每个目标应用建立一个 skill。这个 skill 不是一个巨大的 prompt，而是两层结构：

- `SKILL.md`：中心索引，列出有哪些 topic，每个 topic 什么时候用；
- per-topic guide：每个主题自己的文字说明 `p_t` 和一组 UI figures `F_t`。

Agent 开始任务时只读 `SKILL.md`，需要某个主题时再调用 `load_topic(topic)`。这个 `load_topic` 通过 MCP tool 返回图文混合内容，而不是让 Agent 自己在文件系统里读 Markdown、再单独读取图片。

![VISUALSKILL 的两阶段构建流水线：先从官方文档抽取主题和图，再通过 live UI exploration 补齐真实界面截图与失败区域](/images/visualskill-multimodal-skills/figure-2-pipeline.png)

这张流程图是论文方法的核心。Stage 1 从官方文档、PDF 或 HTML manual 里抽 topic、正文和厂商自带截图；Stage 2 则让 LLM-controlled explorer 操作真实应用，分成 free explorer 和 trajectory-targeted explorer 两种方式。前者扫应用空闲窗口里的区域，后者回看失败 rollout，专门补 Agent 看错或点错的界面区域。最后，多模态 skill 和 text-only control 从同一批源材料生成，区别只在是否保留 figures。

这个设计对工程落地很有价值。很多自动化系统里，“知识库”往往来自文档沉淀；但 App 和桌面软件真正容易翻车的点，常常不在文档主流程里，而在运行时的低频弹窗、状态变化、控件禁用、下拉菜单展开和错误提示。VISUALSKILL 把 live exploration 放进构建流程，等于承认：只读官方文档不够，必须从真实界面里采集状态证据。

## 为什么 MCP 加载方式是关键，不只是实现细节

论文里一个容易被忽略的点是：多模态技能库不只是“有图片”，还要“图片能在正确时机到达 Agent”。作者比较了直接 `Read` 文件和 `load_topic` MCP tool 两种加载方式。

结果很明显：Direct Read 虽然也能访问同一份 skill folder，但 Agent 平均每个任务只加载 **0.8 张图**，最后一次查 skill 的中位步骤是 **1.5**；MCP tool 则能做到 **100% load rate**、平均每个任务 **7.9 张图**、最后一次查 skill 的中位步骤是 **10.4**。对应的 CUA-World VisualSkill 分数也从 Writer `0.236` 到 `0.276`，OpenToonz `0.246` 到 `0.274`，QGIS `0.695` 到 `0.726`。

| 加载方式 | Load rate | Figures / task | Last @ step | Writer | OpenToonz | QGIS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Direct Read | 92.6% | 0.8 | 1.5 | 0.236 | 0.246 | 0.695 |
| MCP tool | 100% | 7.9 | 10.4 | 0.276 | 0.274 | 0.726 |

这张表来自论文 Table 2。它说明一个现实问题：如果图像需要 Agent 额外发起读取，很多图最后不会被看见；如果图文被封装成一次 topic 查询，Agent 才更可能在中途反复参考。对 APP 自动化测试平台来说，这一点可以直接迁移：测试知识库、Page Object、视觉断言截图、异常弹窗样例，不应散落在文件夹里等模型自己找，而应该作为“当前步骤可用证据”随任务上下文按需返回。

## 实验结果：多模态 skill 的收益主要来自 Stage 2 后的真实界面补丁

VISUALSKILL 的实验设置有一个值得肯定的地方：它没有只拿“有图版本”去比“没知识库版本”，而是构造了 matched text-only control。也就是说，text-only 版本和 multimodal 版本来自同样的 source content、同样的 topic 结构、同一轮 LLM 生成，系统性差异只在是否保留 UI figures。

![Table 1 主结果：Stage 2 VisualSkill 在 CUA-World 与 OSExpert-Eval 上相对 no-skill 和 matched text-only control 都有提升](/images/visualskill-multimodal-skills/table-1-main-results.png)

这张表是论文最关键的证据。177 个任务上，No-skill baseline 的 All Avg 是 **0.303**；Stage 1 文档派生的 VisualSkill 到 **0.363**；Stage 2 加入 UI explorer 后的 VisualSkill 到 **0.456**。更重要的是，Stage 2 VisualSkill 比 Stage 2 text-only control 的 **0.373** 高 **8.3 个绝对点**。这说明收益不只是“多了一份文档”，而是 UI figures 本身在执行中提供了额外信息。

不过这组结果也要小心看。Stage 1 的多模态收益其实不大，All Avg 只从 text-only 的 **0.344** 到 VisualSkill 的 **0.363**。论文自己的解释也合理：官方文档里的很多内容是菜单路径、字段名、快捷键和流程步骤，文字本来就能描述清楚；真正拉开差距的是 Stage 2，把 live UI exploration 捕获到的弹窗、状态和界面截图补进 skill 后，图像才变得更有价值。

这点对移动端 QA 很重要：如果知识库只收产品 PRD、接口说明或人工测试用例，保留图片的收益可能有限；如果知识库同时收集真实设备上的页面状态、权限弹窗、WebView 中间态、键盘遮挡、网络错误页、支付 SDK 返回页，视觉证据才会真正改变执行效果。

## 关键案例：图像帮助 Agent 做状态验证，而不只是找按钮

论文最有说服力的地方不是平均分，而是失败案例。Figure 13 展示了一个维护保存设置的任务。Text-only skill 下，Agent 点击了对话框标题栏附近的位置，导致 LibreOffice 关闭；Multimodal skill 则因为拿到了参考截图，能把 Save 按钮定位到对话框底部。

![Text-only skill 的失败案例：Agent 把点击落到标题栏区域，导致 LibreOffice 关闭](/images/visualskill-multimodal-skills/figure-13-save-fail.png)

这张失败图说明，文字里的“点击 Save”并不等于 Agent 知道 Save 在哪里。尤其在桌面软件和移动 App 里，同一个动作名可能出现在顶部栏、底部栏、弹窗按钮、菜单项、toast 或二级页面中。没有视觉参照，模型很容易把语义上相关、空间上错误的位置当成目标。

![Multimodal skill 的修正案例：参考截图把正确的 Save 按钮固定在对话框页脚区域](/images/visualskill-multimodal-skills/figure-13-save-worker.png)

这张修正图更接近 APP 自动化测试里真正需要的东西：不是让模型“知道 Save 是保存”，而是让它知道当前弹窗里哪个区域才是应点击的确认按钮，并且点击后应该看到什么状态。对移动端来说，同类问题包括底部 sheet 的确认按钮、权限弹窗的允许按钮、支付页返回后的订单状态、WebView 内外导航栏冲突等。

## 可能被高估的部分

VISUALSKILL 的贡献很清楚，但也不能把结论放大成“所有 GUI Agent 都应该先做图文技能库”。几个边界需要保留。

第一，实验应用主要是桌面生产力软件和专业工具，任务来自 CUA-World 与 OSExpert-Eval。它们有长流程、复杂 UI 和较稳定的软件界面，很适合展示 skill 的价值。但移动 App 的界面漂移、AB 实验、广告弹窗、登录态、Push、系统权限、WebView 与 Native 混合，比桌面软件更不稳定。方法可以迁移，结果不能直接外推。

第二，技能构建成本不低。Stage 2 需要 live UI exploration，还要从失败 rollout 里找 misread regions。论文证明了它有效，但没有把这件事变成“零成本自动生成”。在真实 QA 平台里，谁来维护技能库、多久刷新一次、版本如何和 App build 对齐，都会影响收益。

第三，benchmark 里的 verifier 仍然决定了结论的可信度。论文使用各 benchmark 自带 verifier，不额外引入新 oracle，这是合理选择；但如果 verifier 更关注最终状态，而不充分记录过程风险，那么一些中间误操作、隐私暴露或危险副作用可能仍然被低估。

第四，MCP tool 的收益一部分来自更好的加载机制。它证明了多模态内容需要合适的递送方式，但也意味着对比结果不只是在比较“有没有图”，还和 Agent 是否愿意持续查阅技能有关。实际系统里，如果调度策略、上下文预算或工具调用成本不同，收益会变化。

## 对 APP 自动化测试 / 移动端 QA 的启发

VISUALSKILL 对移动端 QA 最直接的启发，是把“测试知识库”从文本用例升级成图文状态手册。

传统自动化里，我们常有几类资产：Appium / UIAutomator / XCUITest 选择器、Maestro flow、Page Object、接口 mock、人工测试步骤、历史 bug 截图。GUI Agent 接进来后，不能简单把这些都转成 prompt。更稳的做法是按 App、模块、页面、业务流程组织成 topic：登录、搜索、下单、支付、消息、设置、权限、WebView、异常页。每个 topic 里同时放：

- 标准路径的操作步骤；
- 关键页面截图和控件区域；
- 弹窗、键盘、toast、loading、错误态的状态对照；
- 操作后的断言证据，比如 UI 状态、后端状态、日志、网络请求、数据库或 mock server 记录；
- 常见失败和恢复方式。

真正麻烦的不是把这些内容存起来，而是让 Agent 在执行到某个步骤时能拿到合适的 topic。VISUALSKILL 的 `SKILL.md + load_topic` 结构可以借鉴：先给 Agent 一个轻量索引，让它知道有哪些模块可查；具体执行时再按需加载图文证据，避免把所有截图和说明一次性塞进上下文。

落到 Android / iOS / H5 / Hybrid 流程里，还可以进一步做几件事：

- 对稳定控件，优先使用 Appium、UIAutomator、XCUITest、Maestro 或 deeplink；对不稳定视觉区域，再让 VLM 参考图像技能；
- 对关键状态，不只做截图相似度，还结合 accessibility tree、网络日志、后端状态和崩溃/ANR 信号；
- 对容易漂移的页面，比如首页 feed、活动页、支付 SDK、第三方登录，给技能库加版本号和刷新策略；
- 对高风险动作，比如删除、支付、发消息、改资料，要求额外的过程检查和人工确认，而不是只靠最终页面判断。

说白了，VISUALSKILL 不会替代现有自动化框架。它更像是给 GUI Agent 增加一层“可看的 Page Object”：既有步骤，也有界面证据；既能指导点击，也能帮助确认状态。

## 结论

VISUALSKILL 值得关注的地方，不在于它把分数从 `0.303` 提到 `0.456` 这一个数字，而在于它把 GUI Agent 的外部知识从 text-only skill 往 multimodal skill 推了一步。这个方向很务实：很多 GUI 错误不是模型完全不会推理，而是它缺少当前软件的视觉参照和状态记忆。

对 APP 自动化测试来说，这篇论文给出的工程判断也比较清楚：如果希望 GUI Agent 真正在回归、探索测试和长流程执行里可用，知识库不能只保存自然语言步骤。页面截图、弹窗状态、控件位置、操作前后对照、断言证据和失败案例，都应该成为一等资产，并且通过合适的工具接口在执行过程中按需返回。

边界也同样清楚：图文技能库需要维护，需要和 App 版本绑定，也需要可靠 verifier 支撑。没有这些，图片可能只是更大的上下文负担；有了这些，它才可能变成移动端 QA 里真正可复用的执行和评估基础设施。

## 参考链接

- 论文：[VISUALSKILL: Multimodal Skills for Computer-Use Agents](https://arxiv.org/abs/2606.18448)
- 代码：[XMHZZ2018/VisualSkills](https://github.com/XMHZZ2018/VisualSkills)
- 相关基准：[CUA-World](https://arxiv.org/abs/2601.06328)、OSExpert-Eval（论文中使用的 computer-use benchmark）
- 对比方向：OSWorld、AndroidWorld、VisualWebArena、SaaS-Bench、GUI grounding 与 mobile GUI agent 相关工作
