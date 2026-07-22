---
title: "SEE：移动 GUI Agent 缺的不是更多短轨迹，而是可解释的长程交互图"
description: "解析 2026 年论文 SEE：Structure-aware Exploring & Exploiting for Long-horizon GUI Agent Trajectory Synthesis。它用 UI transition graph 把移动 App 探索、反思清洗和长程轨迹合成拆开，生成平均 14.8 步、24.63 个元素/屏的高复杂度数据，并讨论它对 APP 自动化测试、移动端 QA、轨迹生成和过程 oracle 的启发。"
date: "2026-07-22"
tags: ["GUI Agent", "Mobile Agent", "Data Synthesis", "APP 自动化测试", "Trajectory Evaluation"]
draft: false
featured: false
readingTime: 15
---

> 论文：[SEE: Structure-aware Exploring & Exploiting for Long-horizon GUI Agent Trajectory Synthesis](https://arxiv.org/abs/2607.18046)  
> arXiv：`2607.18046v1`，2026-07-20  
> 关键词：GUI Agent、Data Synthesis、MLLM、Smartphone Control  
> 一句话结论：**SEE 的价值不在于又造了一个 mobile GUI 数据集，而在于把“先探索 App 结构，再按结构合成长程任务”做成了一条可解释流水线。对 APP 自动化测试和移动端 QA 来说，它最值得借鉴的是 transition graph、step-aligned supervision 和 reflection-based graph refinement，而不是直接相信合成轨迹天然等价于真实业务用例。**

移动 GUI Agent 这两个月的论文有一个明显转向：大家不再只问“模型能不能点准”，而是在问“训练和评测用的轨迹到底够不够像真实 App”。SEE 切中的就是这个问题。

真实 App 里的任务很少是单屏、单按钮、一次点击。更常见的是：先登录或切换账号，再进入二级页面，处理权限弹窗或服务协议，筛选内容，填写表单，回到上一层确认状态，最后触发一个有副作用的动作。对 agent 来说，这不是简单的视觉定位问题，而是长程状态转移、目标分解和动作后果验证问题。

SEE 的判断很直接：如果训练数据大多来自短轨迹、低复杂度页面和 happy path，模型即使在静态 grounding benchmark 上分数不错，换到真实移动 App 也会在密集元素、相似入口、弹窗中断和深层页面上掉链子。

![SEE 把数据目标放到长轨迹、高页面复杂度区域：相较很多公开数据集，它强调热门真实 App、多层指令、长路径和密集 UI 元素](/images/see-structure-aware-gui-trajectory-synthesis/figure-1-dataset-positioning.png)

Figure 1 给出了这篇论文的基本立场：公开 GUI 数据集往往集中在“短轨迹”或“低复杂度页面”，而 SEE 试图覆盖长程、高复杂度的移动 App 交互。这个定位对 APP 自动化测试很熟悉——真实回归用例最容易失败的，通常不是首页上显眼的按钮，而是跨页面、跨状态、带前置条件的业务流。

## SEE 的核心思路：先建图，再合成轨迹

SEE 全名是 **Structure-aware Exploring & Exploiting**。它把 GUI 轨迹合成拆成两件事：

1. **Exploring**：在 App 中探索，构建 screen-element transition graph；
2. **Exploiting**：在这个图上选择目标节点、组织 subgoals，再用图搜索生成可执行长程轨迹。

这个拆法比“让 LLM 一步一步在线生成轨迹”更像工程系统。在线生成的好处是灵活，但缺点也明显：每条轨迹都要重新看屏、重新推理、重新试错，成本高，而且很容易陷入重复路径。SEE 先把可达状态和转移关系固化成图，再基于图组合任务，至少让数据生成过程有了可复查的结构。

![SEE 总览：探索阶段构建 screen / element / transition graph；合成阶段从图中生成 subgoal 序列，并通过图算法找到可执行路径](/images/see-structure-aware-gui-trajectory-synthesis/figure-2-see-overview.png)

Figure 2 是整篇论文最关键的图。左边是 transition graph：screen node 表示页面状态，element node 表示可交互元素，edge 表示包含关系或一次动作造成的页面转移。右边是 trajectory synthesis：先根据节点语义生成多目标任务，再用图算法找可行路径。

这对移动端 QA 有一个很实用的启发：**测试生成不一定要从“自然语言用例”直接跳到“动作序列”。中间最好有一层 App 状态图。** 有了状态图，才能知道哪些页面可达、哪些路径依赖前置状态、哪些转移容易失败、哪些循环是无意义的。

传统 Appium、Maestro、UIAutomator 或 XCUITest 脚本常常把路径写死在代码里。维护时最麻烦的是 App 一改版，脚本不知道自己错在“入口没了”“页面状态变了”“弹窗挡住了”还是“业务数据不满足前置条件”。SEE 这种显式 graph 表达，至少给失败归因留下了结构位置。

## 探索阶段：不是随机点，而是带视觉语义和历史惩罚的探路

SEE 的探索阶段不是简单随机点击。论文把每个屏幕解析成候选 UI 元素，再结合视觉特征、语义描述、layout prior 和短期历史，选择更值得探索的元素。执行动作后，它会观察新状态，把 screen node、element node 和 transition edge 写入图中。

![SEE 的探索过程：解析候选 UI 元素、选择动作、执行后观察结果，并把 screen / element / transition 写回图结构](/images/see-structure-aware-gui-trajectory-synthesis/figure-3-graph-exploration.png)

Figure 3 里有两个细节值得看。

第一，SEE 不只记录“点了哪个坐标”，而是把元素语义、页面语义和转移说明一起存下来。后续生成低层指令时，可以复用这些语义，不必每次都重新解释截图。

第二，它显式处理 reflection。论文会在动作执行后检查观测结果是否符合局部动作上下文，用反思标签帮助清洗 transition graph。Table 7 显示，在 small scale 下，加入 reflection 后 incorrect edge rate 从 **27.1** 降到 **9.1**，correct edge rate 从 **72.1** 升到 **90.3**；medium scale 下 incorrect edge rate 从 **29.6** 降到 **11.1**，correct edge rate 从 **68.7** 升到 **86.6**。

![Reflection 对 transition graph 质量的影响：错误边比例明显下降，正确边比例上升](/images/see-structure-aware-gui-trajectory-synthesis/table-7-reflection-quality.png)

这点放到 APP 自动化测试里非常关键。探索系统如果只追求覆盖率，很容易把偶发弹窗、加载失败、脏数据状态、网络抖动都当成“正常路径”写进图里。后面用这张图生成用例，等于把噪声系统化。SEE 的 reflection 还不是完整 QA oracle，但它提醒了一个原则：**自动探索必须同时做图构建和图清洗。**

## 数据集统计：14.8 步不是噱头，关键是复杂度和多层监督

SEE-Train 包含 **47K** 条轨迹，不需要人工轨迹标注，平均 **14.8** 步，覆盖 **3237** 个任务；SEE-Test 包含 **5K** 条轨迹，平均 **12.9** 步，覆盖 **419** 个任务。论文还强调三层监督：high-level task instruction、median-level subgoal sequence、low-level step description。

![Table 1：SEE 与其他 GUI 数据集在规模、人工标注、平均步数、轨迹数和任务指令层级上的对比](/images/see-structure-aware-gui-trajectory-synthesis/table-1-dataset-comparison.png)

![Table 2：SEE 轨迹的 subgoal 数量分布及对应平均步数](/images/see-structure-aware-gui-trajectory-synthesis/table-2-trajectory-subgoals.png)

![Table 3：SEE 的平均每屏元素数高于多个已有 GUI 数据集，页面复杂度更高](/images/see-structure-aware-gui-trajectory-synthesis/table-3-page-complexity.png)

Table 1 到 Table 3 说明了它和已有数据的差异：

- Android Control：88K，人工标注，平均 **5.5** 步；
- AMEX：37K，人工标注，平均 **12.8** 步；
- AndroidLab：6K，人工标注，平均 **8.6** 步；
- UI-GENIE-Agent-16K：16K，非人工轨迹标注，平均 **7.1** 步；
- OS-Genesis：16K，非人工轨迹标注，平均 **6.4** 步；
- SEE-Train：47K，非人工轨迹标注，平均 **14.8** 步。

页面复杂度也不低。SEE 的平均交互元素数是 **24.63 / screen**，高于 AndroidLAB 的 **13.95**、AndroidControl 的 **13.83**、AMEX 的 **16.60**、OS-Genesis 的 **14.47**。

这里不要只看“步数更长”。长轨迹如果只是重复滑动或绕路，并不一定更有训练价值。SEE 更值得关注的是它把长轨迹和 subgoal 结构绑定起来：论文统计中，**4-6 个 subgoals** 的 episode 占 **64.04%**，平均 **14.51** 步；**大于等于 7 个 subgoals** 的 episode 占 **23.09%**，平均 **20.16** 步。这比单纯拼接点击序列更接近真实移动任务。

![SEE 覆盖多类热门移动 App 与多种指令类型，包括 navigation、settings、search、booking、shopping、login、payment 等](/images/see-structure-aware-gui-trajectory-synthesis/figure-4-coverage-instructions.png)

Figure 4 展示了 App 类别和 instruction composition。它覆盖 social、shopping、video、navigation、settings、search、booking、login、payment 等移动场景。对 QA 团队来说，这些类别不只是数据标签，而对应具体风险：登录态、支付状态、权限设置、地图定位、搜索排序、商品库存、内容推荐和 WebView 跳转，都会影响自动化执行的稳定性。

## 主结果：SEE-Test 暴露的瓶颈还是 grounding

SEE 用多个 GUI agent 在 SEE-Test 上做 benchmark，包括 Qwen2.5-VL、UI-Genie、GUI-Owl、OS-Genesis、OS-Atlas 和 Qwen3-VL。结果里最明显的现象是：很多模型 action type 做得还可以，但 grounding 明显拖后腿。

![SEE-Test 主结果：Qwen3-VL 在 SEE-Train 上微调后，SR 从 62.61% 提升到 77.29%，Grounding 从 60.79% 提升到 69.91%](/images/see-structure-aware-gui-trajectory-synthesis/table-4-see-test-benchmark.png)

Table 4 里，Qwen3-VL 的 base 结果是 **62.61% SR / 60.79% Grounding / 93.04% Type**；在 SEE-Train 上训练后，提升到 **77.29% SR / 69.91% Grounding / 97.87% Type**。这个提升说明 SEE 的轨迹监督确实能帮助模型适应长程、密集元素的移动交互。

但另一个信号更重要：Type Accuracy 远高于 Grounding Accuracy。也就是说，模型经常知道应该 `tap`、`swipe`、`back` 或 `type`，却找不准具体目标。对于移动端自动化，这就是典型失败模式：策略层看起来会做，执行层点错一个相似按钮，整条用例就偏航。

![微调和检索上下文的影响：SEE-Train 微调带来主要收益，额外 retrieved context 还能进一步提高 Grounding](/images/see-structure-aware-gui-trajectory-synthesis/table-5-finetuning-context.png)

Table 5 进一步说明了数据的可复用性。Qwen3-VL base 是 **62.61% SR**，加 retrieved context 到 **64.39%**；在 SEE-Train 上微调后到 **77.29%**，再加 context 到 **77.96%**。Grounding 从 **60.79%** 到 **69.91%**，加 context 后到 **71.85%**。

这对工程落地的启发是：内部 App 的 agent 不一定一开始就做大规模训练。可以先把探索轨迹、页面状态、动作说明和成功路径沉淀成 retrieval memory，让 agent 在相似页面上参考已有路径；当轨迹库稳定后，再考虑 SFT / LoRA / GRPO 之类训练。SEE 的结果也支持这个分层路线：context 有用，但训练能把一部分模式内化。

## 跨 benchmark 迁移：有收益，但别忽略视觉域差异

SEE 还在 AndroidControl 上做 cross-benchmark transfer。这个实验比只在 SEE-Test 上看分数更重要，因为它测试的是合成数据学到的交互知识能不能迁移。

![AndroidControl 迁移结果：SEE-Train 对 high-level setting 的 SR 提升更明显，但部分模型的 Grounding 可能因视觉域差异下降](/images/see-structure-aware-gui-trajectory-synthesis/table-6-androidcontrol-transfer.png)

Table 6 里几个数字值得记：

- UI-Genie 7B 在 AndroidControl-High 上，SR 从 **74.2** 到 **75.7**；
- Qwen2.5-VL 7B 在 AndroidControl-High 上，SR 从 **60.1** 到 **65.9**；
- Qwen3-VL 4B 在 AndroidControl-High 上，SR 从 **60.1** 到 **67.8**；
- Qwen3-VL 4B 在 AndroidControl-Low 上，SR 从 **77.7** 到 **79.2**。

收益更集中在 high-level setting，这和 SEE 的 subgoal supervision 逻辑一致：当任务描述更粗时，模型更需要学会拆解和保持进度。

不过论文也提到，Grounding Accuracy 有时会下降，可能来自 SEE 和 AndroidControl 的视觉域差异。这一点不能轻描淡写。移动 App 的视觉风格、控件密度、文案、图标、WebView 容器、底部 tab、动态列表都在变。一个数据集让模型学到“怎么做任务”，不等于它总能在另一个 App 风格里找准同一个元素。

换到企业移动 QA，这意味着内部轨迹库要尽量覆盖真实 App 版本、主题、语言、设备尺寸和业务状态。只靠合成数据做泛化，很容易在 UI 细节上失真。

## 对 APP 自动化测试的启发

SEE 最值得落地的不是某个具体分数，而是它把移动 GUI agent 数据生产拆成了几个可工程化模块。

**第一，把 App 探索结果保存成状态图，而不是只保存脚本。** 传统自动化脚本记录的是“怎么走”；状态图记录的是“有哪些页面、哪些元素、哪些转移、哪些路径可达”。后者更适合做用例生成、失败归因和覆盖率分析。

**第二，用 subgoal 组织长程任务。** 很多移动业务流不适合只用最终目标描述，比如“完成一次退款申请”中间可能包含订单筛选、详情页、客服入口、原因选择、图片上传、确认提交。把任务拆成中层 subgoals，可以让 agent 的执行更可观察，也方便 QA 在中间插入断言。

**第三，step-level supervision 要包含动作后果。** SEE 在 transition edge 上保存 refined textual explanation，后续低层指令可以引用“执行这个动作后预期进入什么状态”。这比只保存 `tap(x,y)` 更有用。实际测试系统里，这可以扩展成：点击前 UI 状态、点击动作、点击后 UI 状态、网络请求、日志、后端状态和崩溃/ANR 信号。

**第四，自动探索必须有 reflection / oracle。** 没有清洗的状态图会污染后续用例生成。至少要判断：这个转移是否稳定、是否由弹窗/脏数据/网络异常造成、是否可复现、是否有不可逆副作用、是否需要人工确认。

**第五，GUI agent 和现有测试框架应该互补。** SEE 这种方法可以生成候选路径和结构化任务，但真正执行时仍然需要 Appium、UIAutomator、XCUITest、Maestro、视觉回归、deeplink、mock API 和后端校验。GUI agent 负责探索和补充长尾路径，传统自动化负责稳定回归和可审计执行。

## 可能被高估的部分

SEE 有价值，但它也有几个边界。

首先，论文的轨迹来自合成流程，并不等于真实用户任务分布。热门 App 和多类别覆盖能缓解这个问题，但真实业务用例还包含账号权限、灰度配置、后端数据、支付沙箱、风控拦截、地理位置和设备状态。只靠屏幕图结构，很难完整表达这些外部条件。

其次，reflection 依赖多模态 LLM auditor。Table 7 的提升很明显，但 auditor 的偏差、prompt 稳定性、误判样例和人工一致性仍然需要更多公开细节。QA 系统里如果用 LLM 判断图边正确性，最好再叠加确定性信号：页面 object tree、network event、日志、数据库状态、截图 diff 和业务断言。

第三，SEE 的 success rate 仍然受 grounding 限制。即便 Qwen3-VL 在 SEE-Train 上微调后达到 **77.29% SR**，Grounding 也只有 **69.91%**。这说明密集移动页面上的元素选择仍然是瓶颈。真实 App 里还有小控件、广告位、浮层、WebView、骨架屏、输入法遮挡、滑动惯性和设备差异，难度只会更高。

第四，跨 benchmark 迁移不是单向提升。Table 6 里部分 Grounding 指标下降，提醒我们：数据合成可以教会流程结构，但视觉域对齐仍然要单独处理。工程上不能把“训练后 SR 涨了”简单解释成“所有 App 都会更稳”。

## 总结

SEE 把 GUI Agent 数据合成从“让模型多跑几条轨迹”推进到“先构建可解释的 App transition graph，再基于图合成长程、多层监督轨迹”。这一步很重要，因为真实移动任务的难点本来就在状态转移、路径依赖、密集元素和失败恢复。

对移动端 QA 来说，它的启发可以落到一个很实际的方向：用 agent 自动探索真实 App，沉淀 screen / element / transition graph；再基于图生成候选长程用例；执行时用 Appium、UIAutomator、XCUITest、Maestro、日志、网络和后端状态做验证；最后把失败原因写回图里，形成可持续维护的测试资产。

这个方法有用，但边界也清楚：合成轨迹不是业务真相，LLM reflection 不是可靠 oracle，长程任务也不能只靠视觉截图闭环。SEE 更像是把“轨迹生成”这件事变得结构化、可复查、可扩展，而不是一次性解决移动 GUI 自动化。

## 参考链接

- 论文：<https://arxiv.org/abs/2607.18046>
- PDF：<https://arxiv.org/pdf/2607.18046>
