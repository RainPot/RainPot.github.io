---
title: "AppDeltaWorld：把移动 GUI 世界模型从「生成下一屏」改成「补一段可达的 delta 代码」"
description: "AppDeltaWorld 用 transition-grounded 的分层 HTML 检索，把 GUI world model 的预测约束在「可达状态族」里做 delta 代码补全，再用 text+code+diffusion 混合渲染下一屏。它在 CMGUIBench-500 上以 73.51 的 overall 略超 GPT-Image-2，把 world model 当成无隐私风险的廉价训练环境去做闭环 SFT 和 test-time RL。拆解它的三段式管线、functional-logic 分数其实落后的隐藏事实、FC/USE 副作用上升的危险信号，以及这些对 APP 自动化测试可搬与要警惕的部分。"
date: "2026-08-13"
tags: ["GUI Agent", "World Model", "Computer Use", "Mobile Agent", "VLM", "Mobile QA"]
draft: false
featured: true
readingTime: 22
---

移动 GUI agent 要变强，绕不开一个补给问题：训练和评测都要轨迹，而真机轨迹对隐私敏感 App、支付/登录这类操作几乎拿不到，模拟器又贵到没法覆盖长尾 App。于是有两条替代路线：搭可执行的模拟环境，或者训一个 **GUI world model**——给它当前屏和一个动作，让它「渲染」出下一屏，agent 就能在里面闭环地试错，不碰真数据。

问题是现有的 GUI world model 都不太好用。文本世界模型只能给语义描述，出不了可训练的视觉数据；纯图像/扩散世界模型（ViMo 那类）画得出大致版式，但密集 UI 文本和小控件一塌糊涂；而且它们普遍不管**动作逻辑**——你点一个不存在的按钮，它照样给你编出一个看似合理的新页面。

[AppDeltaWorld](https://arxiv.org/abs/2608.05891)（Xu et al., 2026-08-06，NTU / 电子科技大学 / 人大等）的切入点很干脆：**别让世界模型自由生成下一屏，让它在「这个 App 里从当前页 + 这个动作真正能到达的页面族」里，检索一份结构参考，然后只补出变化的那段代码。** 预测下一屏这件事，被它改写成了「受动作可达性约束的检索 + delta 代码补全」问题。

这个视角对做 APP 自动化测试的人特别值得看：一个「预测下一屏该长什么样、并且会拒绝非法跳转」的模型，本质上就是一个可达性 oracle + 软断言生成器的雏形。

## 目录

1. 为什么这篇论文值得关注
2. 背景：GUI world model 缺的三样东西
3. 核心思路：transition-grounded 的 delta 代码
4. 方法拆解：三段式管线
5. 训练数据与闭环 SFT 构造
6. 实验结果：世界模型保真度与 agent 提升
7. 对 APP 自动化测试 / Mobile QA 的启发
8. 局限性与点评：被高估的部分
9. 总结
10. 参考链接

## 一、为什么这篇论文值得关注

把它放进 GUI world model 这条正在快速铺开的线里看定位：Code2World、gWorld 走「可渲染代码」，ViMo、MobileDreamer 走「像素/草图扩散」，MobileWorld、Qwen-AgentWorld 走「语言描述」。AppDeltaWorld 的差异点有两个：

- **它不把世界模型只当 next-state predictor，而是当训练环境。** 大部分世界模型论文停在「预测得准不准」，这篇的落点是「用它 rollout 出来的轨迹，经过质检后喂给 agent 做 SFT 和 RL，agent 能不能真的变强」。
- **它用检索约束把「幻觉」变成「拒绝」。** 通过 app 级的动作-转移索引，把目标页面限定在可达集合内；不支持的动作直接判成无效/低置信转移，而不是硬编一个不存在的页面。这正好补齐了前面说的第三样短板——transition logic consistency。

结论先摆在这：作为世界模型，它的 overall 保真度确实做到了 SoTA（略超 GPT-Image-2）；但这个「SoTA」拆开看有水分，agent 侧的提升也伴随明显副作用。后面第八节会细说。

## 二、背景：GUI world model 缺的三样东西

论文用一张对比图把痛点讲清楚了。上半部分是**保真度（fidelity）**：agent 做一串复杂操作时，世界模型应当稳定输出与真机高度一致的页面；下半部分是**转移逻辑一致性（transition logic consistency）**：非法动作应当被世界模型拒绝，而不是幻觉出一个新状态。

![Figure 1：GUI world model 的两类问题——保真度不足（上）与动作转移逻辑不一致（下）。绿色代表合法往返导航应保持页面身份，红色代表非法动作应被拒绝。](/images/appdeltaworld-code-world-model-mobile-gui-agent/figure-1-motivation.png)

作者把「一个好用的 GUI world model」拆成三条硬要求：

1. **Stable Fidelity（稳定保真）**：合法往返导航（进书架再返回）后，页面身份要保持一致，不能越渲越飘。
2. **Hybridization Modality（模态混合）**：纯文本模型给不了视觉训练数据；纯图像模型表达不了密集 UI 文本和精细布局。两者都不够。
3. **Transition Logic Consistency（转移逻辑一致）**：预测的转移必须符合真机交互逻辑，遇到非法动作要能「拒绝」。

这三条其实就是任何想拿来做训练环境的世界模型的验收标准。第 2 条尤其关键，也是这篇选择 **text + code + diffusion 混合**表示的直接动机。

## 三、核心思路：transition-grounded 的 delta 代码

传统做法是「拿当前截图 + 动作，直接生成下一屏的完整 HTML」。问题是长程 rollout 里很容易结构漂移，或者预测出真机里根本到不了的目标状态。

AppDeltaWorld 把 HTML 拆成两级：

- **Level-1 HTML**：可复用的页面结构与布局（骨架）。
- **Level-2 HTML**：补全具体内容、生成完整的下一屏。

生成流程是：先把当前屏定位到一个 **source cluster**（页面族），用 app 专属的转移记忆找出「这个动作能到达的 target clusters」，从中检索一份 Level-1 参考，然后在这份结构参考之上**只生成变化的那段 Level-2 代码**。这样重复访问相似页面时更一致，也不用每次从零重画整个界面。

当前屏先被编码成结构化文本状态：

$$
r_t = \phi_{text}(x_t) = [f_t, d_t, \ell_t, q_t, p_t]
$$

其中 $f_t, d_t, \ell_t, q_t, p_t$ 分别是功能模板、页面描述、区域布局、槽位 schema、页面类型。离线索引先用规则分类器把每个屏归到粗功能类别，再对布局、DOM 签名、语义文本、槽位 schema 各建一套哈希 TF–IDF 向量，加权合成：

$$
z_i = 0.45\, z_i^{layout} + 0.25\, z_i^{dom} + 0.20\, z_i^{sem} + 0.10\, z_i^{slot}
$$

**动作可达性**是这套方法的灵魂。对每个 source cluster $c_t$ 和动作 $m_t$，转移记忆存了候选目标簇。点击/长按的动作目标被量化到一个 6×12 网格，滑动则用起点和终点两个网格。允许的目标集合是：

$$
C_{t+1} = T(c_t, \alpha(m_t), \kappa(m_t))
$$

$\alpha(m_t)$ 是动作类型，$\kappa(m_t)$ 是动作目标键。最终的 Level-1 参考在这个受约束的可达集合里检索得到——**动作到不了的页面，压根不进候选**。这就是「非法动作被拒绝」在工程上的实现方式：不是让模型学会说「不」，而是让检索空间里根本没有那个错误答案。

## 四、方法拆解：三段式管线

整篇的系统图值得逐块看。

![Figure 2：AppDeltaWorld 总览。(A) 把原始移动页面重建成 HTML 训练世界模型；(B) transition-grounded 记忆检索出动作可达的 Level-1 参考，指导混合 delta 代码生成与多模态渲染；(C) 过滤后的闭环 rollout 转成 AppDeltaAgent 的 SFT 数据。](/images/appdeltaworld-code-world-model-mobile-gui-agent/figure-2-overview.png)

**(B) 预测下一屏分三个阶段：**

- **文本阶段**：先预测下一屏的语义文本 $\hat{s}_{t+1}$，作为 Level-1 检索的 target-side query。把「语义下一状态预测」和「HTML 合成」解耦——文本模型擅长的是匹配页面意图、页面类型、可见实体和预期状态变化，让它先干这部分。
- **代码阶段**：以检索到的 Level-1 参考 $h^{(1)}_{i^*}$ 为基底，生成 Level-2 作为一段 delta：

$$
\hat{h}^{(2)}_{t+1} = G_\theta(x_t, m_t, \hat{s}_{t+1}, h^{(1)}_{i^*})
$$

Level-1 提供可复用的布局、控件、DOM 组织，而 $x_t, m_t, \hat{s}_{t+1}$ 决定这套结构在动作后应该怎么变。这种 delta 写法直接对付了自由生成的不稳定，尤其是多个相似候选状态时。

- **视觉阶段**：代码搞不定的图像富集区域（商品页、视频 App 的封面），用文生图补出。Level-2 HTML 里的 image slot 带着文字描述，Qwen-Image 风格的模型据此填充视觉资产，最后用浏览器引擎渲染成截图。作者的观察是：视频类 App 里图像槽占了页面大头，缺了这块世界模型的保真度会明显掉——所以 diffusion 不是锦上添花，是必需。

这套「代码管密集文本和精确布局 / 扩散管视觉丰富度」的分工，是它在视觉质量指标上碾压纯图像模型的根本原因（见第六节）。

## 五、训练数据与闭环 SFT 构造

世界模型的训练数据是 **10 万条 GUI 转移步**，以 CMGUI 为主（95.47%），补充 CAGUI、Magic-RICH、ChiM-Nav。所有页面都用 Claude-4.8-Opus 和 Gemini-3.1-Pro **逆向工程成可渲染代码**，并打上 Level-1 / Level-2 标签区分结构和组件。action model 的训练数据则是 GUI-Owl（10% 采样，48.18%）+ AppDelta（自己构造，28.38%）+ OpenMobile（23.44%）。

**闭环 SFT 数据怎么造（Algorithm 1）**：从 GUI-Owl 和 OpenMobile 取真实任务种子，让 action policy 在 AppDeltaWorld 环境里跑 rollout——策略预测动作，世界模型渲染下一屏，渲染出的 PNG 再喂回策略做下一步，形成闭环合成轨迹。关键是**质量过滤**：

- 动作描述和动作坐标必须一致；
- 连续重复动作不接受；
- 最后一步必须是**主动 termination**，而不是跑到 step 上限才停。

只有满足这些的轨迹才进 SFT 集合。作者坦承：**只有 1/10 的数据通过了质检**。失败主因三类——任务进度判断失败导致打转、链路步数增加后页面质量骤降、以及规定步数内没完成任务。

这套过滤规则，几乎是任何轨迹录制/生成管线都能直接抄的最低门槛，第七节会展开。

## 六、实验结果：世界模型保真度与 agent 提升

### 6.1 世界模型保真度（CMGUIBench-500）

评测沿用 Code2World：functional-logic 分数 $S_{ad}$ / $S_{id}$（Gemini-3-Flash 当裁判），visual-quality 分数 $S_{ele}$ / $S_{lay}$，外加 SigLIP、DINOv2。

![Table 2：CMGUIBench-500 主结果。AppDeltaWorld overall 73.51 略超 GPT-Image-2（72.34），但功能逻辑分 Sad/Sid 反而落后于所有扩散模型和多数代码模型，赢主要靠视觉质量 Sele/Slay。](/images/appdeltaworld-code-world-model-mobile-gui-agent/table-2-cmguibench-fidelity.png)

这张表要拆开读，别只看 overall：

- **AppDeltaWorld overall 73.51**，超过 GPT-Image-2（72.34）、Gemini-3.1-Pro-Image（71.57）、Code2World-8B（56.64）、ViMo（43.44），也比它自己的基座 Qwen3-8B（50.53）高出 22.98 分（相对 +45.5%）。
- **真正的领先在视觉质量**：$S_{ele}$ / $S_{lay}$ 达到 56.26 / 57.43，把 GPT-Image-2 的 44.00 / 41.70 甩开一大截——代码 + 扩散确实把密集文本和精细布局做出来了。
- **但功能逻辑分它是落后的**：$S_{ad}$ / $S_{id}$ 只有 79.69 / 77.00，GPT-Image-2 是 91.73 / 83.40，几乎所有扩散模型和一半代码模型都比它高。SigLIP/DINOv2（全局构图相似度）也不占优。

换句话说，「AppDeltaWorld 保真度 SoTA」这个说法成立，但成立的方式是**结构布局强、功能逻辑弱**，overall 领先靠的是加权口径。作者自己也在正文承认，人工评估里 GPT-Image-2 的 element alignment 比 AppDeltaWorld 更好。

消融把两个组件的分工讲得很清楚：

![Table 4：AppDeltaWorld 消融。去掉 diffusion，视觉质量 Sele/Slay 从 56/57 掉到 50/50；去掉 RAG，功能逻辑 Sad/Sid 从 79.69/77 掉到 65.16/69.4。](/images/appdeltaworld-code-world-model-mobile-gui-agent/table-4-ablation.png)

- **去掉 diffusion**：overall 73.51 → 70.91，主要掉在 $S_{ele}$ / $S_{lay}$——扩散负责视觉完整度和细粒度布局。
- **去掉 RAG**：overall 掉到 67.46，$S_{ad}$ / $S_{id}$ 从 79.69 / 77.00 骤降到 65.16 / 69.40——检索约束是转移一致性的支柱。
- **两个都去掉**：65.68，最低。

一句话：RAG 保功能逻辑，diffusion 保视觉质量，缺一个都掉。

### 6.2 作为训练环境：AndroidLens 静态评测

把世界模型 rollout 的数据喂给 AppDeltaAgent-8B 做 SFT，在 AndroidLens 上测静态动作预测（AMS = Action Matching Score，ATP = Average Task Progress）。

![Table 3：AndroidLens 结果。AppDeltaAgent-8B 在所有语言和指令粒度切分上 AMS 最高，高层指令（HL）的 ATP 提升尤其明显。](/images/appdeltaworld-code-world-model-mobile-gui-agent/table-3-androidlens.png)

相对 Qwen3-VL-8B 基座：Total-LL 的 AMS/ATP 从 80.33/34.96 提到 90.28/46.63（ATP 相对 +33.4%），Total-HL 从 78.08/23.30 提到 82.53/33.05（ATP 相对 +41.8%）。中英文任务都一致提升，且**高层指令上的优势更大**——说明动作条件下的后继状态，对长程决策的监督价值高于纯静态 grounding。

但提升来自哪里，Figure 4 给了一个很诚实的归因：

![Figure 4：按动作类型的准确率。提升集中在 wait/type/swipe/stop 这类工具型和探索型动作，click 只微涨，home 反而掉了 21.7。坐标定位不是提升来源。](/images/appdeltaworld-code-world-model-mobile-gui-agent/figure-4-action-type.png)

- 低层指令：**wait 从 14.2 飙到 73.0（+58.8）**、type 77.7→89.4（+11.7），而 click 只从 91.8→95.9（+4.1）；**home 动作反而从 45.1 掉到 23.4（−21.7）**。
- 高层指令：swipe 41.3→58.4（+17.1）、stop 43.7→59.3（+15.6）。

结论很重要：**AppDeltaAgent 的提升不来自坐标定位**，而来自 action-type 决策、文本输入、页面探索和停止时机。反过来说，世界模型渲染的页面**坐标其实和真机对不齐**（作者明确承认 element positions 不完全对齐），它教会 agent 的是「高层交互经验」，不是「精确点哪里」。home 动作掉分也提示：合成经验在某些系统级动作上会带偏。

### 6.3 作为训练环境：MobileGym / MobileWorld 闭环执行

![Table 5：MobileGym 结果。AppDeltaAgent-8B 的 SR 从 10.2 提到 14.1，但 FC（False Complete）从 14.1 飙到 36.0、USE（Unexpected Side Effects）从 5.6 飙到 19.7。](/images/appdeltaworld-code-world-model-mobile-gui-agent/table-5-mobilegym.png)

MobileGym 上，AppDeltaAgent-8B 的 SR 14.1（基座 10.2，相对 +38.2%），PR 22.0→26.4，L1（66.2→83.8）和 L2（13.4→19.5）提升最明显。但**诊断指标暴露了代价**：False Complete 从 14.1 涨到 36.0，Unexpected Side Effects 从 5.6 涨到 19.7。也就是说，SFT 之后 agent 更敢「声称完成」、也更容易搞出意外副作用。这在 QA 语境下是刺眼的信号——false-complete 是最坏的一类假阳性（详见第八节）。

![Table 6：MobileWorld（真机执行）结果。AppDeltaAgent-8B 的 GUI-only SR 从 9.4 提到 14.9，但 Overall SR 未报告，且与 GPT-5 + UI-Ins-7B（54.0）差距巨大。](/images/appdeltaworld-code-world-model-mobile-gui-agent/table-6-mobileworld.png)

MobileWorld 是真机执行环境。AppDeltaAgent-8B 的 GUI-only SR 14.9（基座 9.4，相对 +58.5%），平均步数从 24.8 增加到 30.1。合成 rollout 的收益在真机上没消失，但要注意它的 Overall SR 一栏是「–」（没报），而且离 GPT-5 + UI-Ins-7B 的 54.0 还有量级差距。

### 6.4 作为 RL 环境：test-time RL

![Figure 5：基于世界模型的 test-time RL。self-score 方案下 Step-48 在飞猪/美团/京东/淘宝上 AMS 分别 +1.51/+3.25/+3.02/+5.06，reward 在 60 步内从 68 升到 76。](/images/appdeltaworld-code-world-model-mobile-gui-agent/figure-5-test-time-rl.png)

作者试了两种不碰真机的 RL：

- **Self-score RL**：策略 rollout 8 个动作，世界模型预测并渲染下一屏，策略自评动作一致性与指令进度得 reward。Step-48 带来 1.51~5.06 的 AMS 提升，能做 app 专属的策略适配。
- **Clustering reward RL**（无 LLM 裁判、无标注）：8 指令 × 8 rollout，对预测状态按 0.60 视觉 + 0.40 文本相似度聚类，落在唯一最大簇（≥2 成员）才给 reward 1。

第二种更像 proof-of-concept：consensus reward 平均只有 0.412，获胜簇平均只有 3.295 / 8 支持，**23.5% 的组根本没有唯一获胜者**。作者直说：当前的稠密视觉-文本状态表示，还不足以让「语义等价的后继状态」聚成可靠的簇——所以 consensus 目前当不了强独立 reward。

### 6.5 数据 scaling

![Figure 7：SFT 数据消融与 AppDeltaWorld 数据 scaling。ADW-only 会掉点，必须和 public 数据混用；数据加到 20K 后饱和，约 75% 的收益在 12K 就拿到了。](/images/appdeltaworld-code-world-model-mobile-gui-agent/figure-7-data-scaling.png)

- **只用 public 数据**：Total-LL/HL ATP 比基座 +5.83/+4.87。
- **public + AppDeltaWorld（Full）**：Total-LL ATP 40.8→46.6，Total-HL 28.2→33.1。
- **只用 ADW（ADW-only）**：反而比基座 **−1.16/−1.15**——世界模型在基础交互模式上有偏，不能单独用。
- **scaling**：0K→28K 单调提升但边际递减，约 75% 收益在 12K 拿到，20K 后饱和。合成数据的多样性被世界模型自身经验封顶，靠指令增广扩不下去。

## 七、对 APP 自动化测试 / Mobile QA 的启发

这篇的工程价值不在于复刻它的模型，而在于它把几个测试工程里一直缺的机制，用世界模型的形式做了出来。可迁移的部分：

- **Level-1 / Level-2 分层 = 骨架 vs 内容的结构化 diff。** 回归测试里最烦的是「内容变了」和「结构回归了」混在一起报警。把页面拆成 Level-1（结构/骨架）和 Level-2（动态内容）分别比对：Level-1 变了才是结构性回归，Level-2 变了大概率只是数据刷新。这和 Page Object Model、DOM 结构化 diff 是一个思路，能压掉大量误报。

- **transition-grounded 约束 = 可达性 oracle。** 用例生成和探索式测试最大的浪费是尝试不可达跳转。离线用 app 的 `action → 目标页面族` 转移图约束探索空间——「当前页 + 这个手势」只允许落到有限的可达页面集合，非法路径直接剪掉。对应到 UIAutomator/Appium 的爬取式探索，可以先建这张转移图再驱动。

- **用 code-based world model 做「预演/软断言」，而不是当被测系统。** 作者已经证明渲染页面的坐标不可信，所以**别拿它做视觉定位断言**。合理用法是：让它预测「下一屏应该出现哪些文本、控件、页面类型」，作为软 oracle；真机执行完再做一致性校验。断言的硬信号仍然要来自真机业务态（DB / 日志 / 网络 / SharedPreferences / plist）。

- **质检管线可以直接搬。** parse-valid + blank-screen check + 连续重复动作检测 + **必须主动 termination（而非跑到 step 上限）**，这套是任何轨迹录制/生成的最低门槛。尤其最后一条，能过滤掉大量「超时才停」的伪完成轨迹——很多团队的自动化用例恰恰栽在「跑到超时算通过」上。

- **盯紧 FC / USE，别只看 SR。** 这是最该记住的一条。用合成轨迹训练出来的 agent，SR 涨了 3.9 个点，但 False Complete 翻了一倍多、Side Effects 翻了三倍多。迁移到 QA：如果用合成数据训测试 agent，必须单独监控假完成率和副作用率，并用真机业务态交叉验证 agent 自报的「完成」——否则你得到的是一个更会「谎报通过」的测试机器人。

- **成本要设闸。** 世界模型生成一步要 8309 tokens（Table 2 里最高，比 GPT-5.4 还贵），且 rollout 只有 1/10 能过质检。放进 CI 必须设 step/token 上限和「无法判定」出口，别指望它无上限跑。

## 八、局限性与点评：被高估的部分

**真正贡献（三点）：**

1. **把「预测下一屏」重构成「受动作可达性约束的 delta 代码补全」**，用检索空间的裁剪把幻觉转成拒绝——这是对 transition logic consistency 最实在的工程解法，比「让模型学会说不」可靠。
2. **text + code + diffusion 的分工明确且被消融验证**：代码管密集文本和精细布局，扩散管视觉富集区，视觉质量指标上确实碾压纯图像模型。
3. **把世界模型当训练环境而非 next-state predictor**，配一套可直接复用的质检管线，跑通了 SFT + test-time RL 的完整链路。

**被高估 / 要警惕的部分：**

1. **overall 保真度 SoTA 是加权口径的胜利。** 拆开看，功能逻辑分 $S_{ad}$ / $S_{id}$ 落后于所有扩散模型和多数代码模型，领先全靠视觉质量。「世界模型更保真」这个结论要限定成「结构布局更保真、功能判定更弱」。
2. **agent 侧的提升伴随危险副作用。** MobileGym 上 FC 14.1→36.0、USE 5.6→19.7，AndroidLens 上 home 动作 −21.7。合成经验在提升 SR 的同时，教会了 agent 更多「假完成」和「乱动」。
3. **提升不来自 grounding。** 世界模型的页面坐标和真机对不齐，agent 学到的是高层交互经验。这限制了它对 grounding-bound 任务（精确点击小控件、拖拽）的价值。
4. **RL 部分偏 PoC。** clustering reward 的 consensus 只有 0.412、23.5% 的组无唯一获胜者，说明用世界模型状态做无标注 reward 现在还不可靠；self-score RL 的提升也只有个位数 AMS。
5. **合成数据分布被生成器封顶。** ADW-only 掉点、20K 后饱和，是合成数据的老问题——多样性上限就是世界模型自己的经验上限，指令增广突破不了。
6. **成本与产出比不高。** 8309 tokens/step + 1/10 通过率，作为「廉价替代真机」这个卖点，廉价程度要打个折。

放进领域谱系：AppDeltaWorld 和本站此前拆过的 [Scaling GUI Agents with Visual State Transitions](/blog/2026-07-28-scaling-gui-agents-visual-state-transitions/)、[VisCritic](/blog/2026-07-03-viscritic-visual-process-reward-gui-agent/) 属于同一个大问题——「GUI world model / 状态转移该用什么表示」——但走的是不同分支：前两者押视觉状态，AppDeltaWorld 押代码 delta + 混合渲染。这篇的贡献是给「代码路线」加上了动作可达性约束和 diffusion 视觉补偿；它没解决的，是功能逻辑保真、坐标对齐和无标注 reward 这三个硬骨头。

## 九、总结

AppDeltaWorld 最有价值的一句话是：**GUI world model 不该自由生成下一屏，而该在动作可达的状态族里补一段 delta 代码。** 这个约束把幻觉问题从「模型自律」变成了「检索空间裁剪」，是可复制的工程思路。它把世界模型当训练环境跑通了 SFT + test-time RL 的完整链路，视觉质量确实做上去了。

但它的 overall SoTA 有加权水分，功能逻辑保真其实落后；agent 提升伴随 FC/USE 副作用上升，且不来自 grounding；无标注 reward 还不可靠。对做 APP 自动化测试的人，值得搬的是它的**分层结构 diff、可达性约束、质检管线**，值得警惕的是**别把它当视觉断言源，也别只看 SR 不看假完成率**。

## 十、参考链接

- 论文：[AppDeltaWorld: Transition-Grounded Delta Code World Model for Mobile GUI Agents (arXiv:2608.05891)](https://arxiv.org/abs/2608.05891)
- 数据集：Hugging Face `Chinese-GUI-worldmodel`
- 评测代码：`AppDeltaWorld-Eval`
- 相关工作对照：
  - Code2World: A GUI World Model via Renderable Code Generation (arXiv:2602.09856)
  - ViMo: A Generative Visual GUI World Model for App Agents (arXiv:2504.13936)
  - MobileDreamer: Generative Sketch World Model for GUI Agent (arXiv:2601.04035)
  - Qwen-AgentWorld: Language World Models for General Agents (arXiv:2606.24597)
- 本站相关拆解：[Scaling GUI Agents with Visual State Transitions](/blog/2026-07-28-scaling-gui-agents-visual-state-transitions/)、[VisCritic](/blog/2026-07-03-viscritic-visual-process-reward-gui-agent/)
