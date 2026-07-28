---
title: "State Transition Pretraining：给 GUI Agent 补一条“便宜但结构化”的预训练轴"
description: "解析 Scaling GUI Agents with Visual State Transitions（STP）：用 (s_t, a_t, s_t+1) 三元组做联合正向/逆向动力学预训练，在 AgentNetBench、AndroidControl、GUIOdyssey 上稳定提升轨迹微调效果，并讨论它对 macOS 研发效率工具与 GUI 自动化训练管线的启发与局限。"
date: "2026-07-28"
tags: ["GUI Agent", "Computer Use", "VLM", "State Transition", "Pretraining", "World Model"]
draft: false
featured: false
readingTime: 18
---

> 论文：[Scaling GUI Agents with Visual State Transitions](https://arxiv.org/abs/2607.24112)
> arXiv：`2607.24112v1`，2026-07-27 提交
> 作者：Xiangyan Liu, Kaixin Li, Haonan Wang, Biao Wu, Meng Fang, Longxu Dou, Chao Du, Michael Qizhe Shieh, Tianyu Pang
> 机构：新加坡国立大学（NUS）、Sea AI Lab、悉尼科技大学（UTS）、利物浦大学
> 代码：[https://github.com/xyliugo/gui-state-transition-pretraining](https://github.com/xyliugo/gui-state-transition-pretraining)
> 一句话结论：**STP 没有提出新的 benchmark 或新的 agent 架构，它做的是把“轨迹微调”这一件事拆开一半：先用便宜、无需任务标注的 (s_t, a_t, s_t+1) 状态转移数据，联合训练正向动力学（预测下一状态）和逆向动力学（预测触发动作），给模型一个更好的初始化，再叠加常规的任务轨迹微调。效果稳定但幅度克制（多数场景 1-6 个百分点），胜在成本低、可与现有轨迹微调管线正交叠加。**

## 目录

1. 为什么这篇论文值得关注
2. 背景与问题定义
3. 核心思路：正向动力学 + 逆向动力学
4. 方法设计拆解
5. 实验设置与主结果
6. 消融实验：哪些设计选择真正重要
7. 对 macOS 研发效率工具和 GUI 自动化的启发
8. 局限性与专家点评
9. 总结
10. 参考链接

## 1. 为什么这篇论文值得关注

站在 GUIAgent / computer-use agent 领域的视角看，过去一年围绕"如何训练 GUI agent"大致分成三条主线：

- **轨迹监督微调（SFT）**：用人工标注或半自动生成的多步轨迹（截图 + 任务指令 + 动作序列）直接训练模型完成 `pθ(a_t | u, s_t, h_t)` 这个条件动作分布。
- **强化学习 / 过程奖励**：在交互式环境（AndroidWorld、OSWorld 等）中用 rollout + reward model / verifier 驱动策略优化。
- **合成数据与自进化**：用模型自身或辅助模型生成更多轨迹、更多任务指令，缓解数据稀缺问题。

这三条线有一个共同的隐藏假设：**动作预测这个单一目标，同时承担了视觉定位（grounding）、动力学建模（action 会造成什么视觉变化）和任务规划（如何完成指令）三件事**。论文把这一点明确指出为 SFT 的核心痛点之一：`L_SFT = -Σ log pθ(a_t | u, s_t, h_t)` 这个损失函数把三种能力耦合在一起，既降低了优化效率，也让每一条轨迹标注变得更"贵"——因为标注者/生成流程必须同时保证任务指令的正确性和动作序列的正确性。

STP 的切入点很直接：**动力学建模这部分能力，其实不需要任务指令就能学。** 给定连续两帧截图 `s_t` 和 `s_t+1`，以及它们之间发生的动作 `a_t`，模型完全可以在不知道"用户到底想干什么"的前提下，学会"这个动作会让界面变成什么样"（正向动力学）和"这两帧之间发生了什么动作"（逆向动力学）。而这种 `(s_t, a_t, s_t+1)` 三元组，可以直接从已有的轨迹数据集里拆解出来，不需要额外标注,也可以在未来通过自动化环境探索大规模采集。

这个思路不是全新的——UI-Oceanus、DeFI、Falcon-UI 等前序工作都探索过动力学建模或指令无关预训练，论文自己在 Related Work 里也如实承认了这一点。STP 的增量贡献在于：**用一个原生支持图文双向生成的统一多模态模型（UMM），把正向和逆向动力学联合训练在同一组参数里**，而不是像 DeFI 那样用两个独立模型分别训练，也不是像 UI-Oceanus 那样用文本化的状态差异代替直接的视觉预测。

## 2. 背景与问题定义

论文把 GUI 控制形式化为一个基于视觉状态的序贯决策问题：给定任务指令 `u`，在第 `t` 步，agent 观察当前截图 `s_t` 和交互历史 `h_t = {(s_1,a_1),...,(s_{t-1},a_{t-1})}`，预测动作 `a_t`。动作 `a_t` 不是单纯的离散标签，而是包含自然语言描述和可执行 GUI 命令（例如 PyAutoGUI 代码）的结构化文本输出。标准做法是在专家轨迹上做监督微调，最大化 `pθ(a_t | u, s_t, h_t)` 的对数似然。

论文指出这条路径面临两个扩展性障碍：

- **数据稀缺**：高质量多步轨迹标注昂贵，现有方法要么严重依赖人工标注（AndroidControl、GUIOdyssey、AgentNet 等），要么用纯合成方法但引入噪声。
- **学习目标耦合**：单一的下一动作预测目标，同时隐式承担视觉定位、动力学建模和任务规划三种能力，让优化变得低效。

STP 的定位是：不替代轨迹微调，而是在它之前加一个"便宜的"预训练阶段，专门学习动力学部分，缓解上面第二个障碍，同时因为不需要任务级标注，也间接缓解第一个障碍（因为转移数据比完整轨迹标注便宜得多）。

## 3. 核心思路：正向动力学 + 逆向动力学

STP 阶段用两个联合优化的目标：

```text
L_inv = -log pθ(a_t | s_t, s_{t+1})          # 逆向动力学：从状态变化推断动作
L_fwd = L_gen(s_{t+1}; s_t, a_t, θ)          # 正向动力学：从状态+动作预测下一状态
```

**正向动力学**：输入当前截图和动作，让模型生成下一状态截图。这是一个 image-text-to-image 任务。论文引用近期研究指出，这种生成式训练即使目标是"生成图片"，也能隐式监督模型的感知和理解组件，提升其表征质量。直觉上，这迫使模型建立"动作 → 视觉状态变化"的因果关系，比如点击后下拉菜单会出现、输入框内容会更新——本质上是给模型装了一个内部的 GUI 世界模型。

**逆向动力学**：输入两帧连续截图，让模型预测中间发生的动作。这是一个 image-image-to-text 任务。要完成这个任务，模型必须精确定位交互发生的位置，并从背景噪声中过滤出真正由动作引起的视觉变化（比如区分某个按钮和周围相似元素，或检测到文本框内容的微小更新）。这直接锻炼的是 grounding 能力和细粒度、动作相关的视觉特征提取。

![Figure 3：正向动力学建模 (s_t, a_t) → s_{t+1}，逆向动力学建模 (s_t, s_{t+1}) → a_t，两者共享同一个统一多模态模型的参数](/images/scaling-gui-agents-visual-state-transitions/figure-3-forward-inverse-dynamics.png)

这张图是理解 STP 机制的关键。两个方向的箭头分别对应两个训练目标，但都作用在同一组模型参数上，因此两个目标可以相互提供监督信号：正向目标教会模型"知道会发生什么"，逆向目标教会模型"知道是什么导致的"，二者组合起来比单独任何一个都更完整。

训练目标是联合损失 `L_pre = L_fwd + λL_inv`。刻意排除任务指令，让模型先专注学习"基础 GUI 能力"，再进入常规的任务级轨迹微调阶段去融合指令理解和规划能力。

## 4. 方法设计拆解

### 数据从哪来

论文没有采集新数据，而是把现有的三个轨迹数据集拆解成状态转移三元组：

- **AgentNet**（桌面场景，Windows & macOS）：18K 条轨迹拆解出 **320K** 条转移。
- **AndroidControl**（移动场景）：12K 条轨迹拆解出 **67K** 条转移。
- **GUIOdyssey**（移动场景）：7K 条轨迹拆解出 **95K** 条转移。

![Figure 2：三种 GUI 控制来源（AgentNet、AndroidControl、GUIOdyssey）的状态转移数据示例，每条样本包含前后两帧截图和中间的动作描述+可执行代码](/images/scaling-gui-agents-visual-state-transitions/figure-2-transition-data-examples.png)

这张图值得留意的一点是：状态转移数据保留了动作的自然语言描述和结构化代码（比如 `pyautogui.write(...)` 或 JSON 格式的 `{"action_type":"click","x":0.920,"y":0.904}`），但完全不含"任务是什么"这一层信息。也正因为剥离了任务指令，即便原始轨迹标注中任务描述本身有噪声，转移数据仍然可靠——这是论文强调的一个关键优势：**局部状态变化的标注比任务级指令标注更"干净"**。

### 骨干模型的选择理由

论文选用 **BAGEL**（一个原生支持文本+图像双向生成的统一多模态模型，MoT 架构，7B 激活参数 / 约 14B 总参数）作为骨干，而不是 Show-o（1.3B）、Harmon（1.5B）、OpenUni（3.6B）等更小的开源 UMM。理由很务实：正向动力学需要图像生成能力，逆向动力学需要图文理解能力，BAGEL 的架构（独立的理解专家 ViT 和生成专家 VAE，共享注意力层）天然匹配这两个任务格式，而更大的参数规模能让研究者更干净地隔离出 STP 本身的效果，而不是被骨干能力不足所干扰。

这里需要注意一个工程现实：**STP 的完整方案要求骨干具备原生图像生成能力**。这不是所有 GUI agent 常用的 VLM 骨干（比如纯理解型的 Qwen2.5-VL）都具备的。论文在 Limitations 里也承认，在没有图像生成能力的标准 VLM 骨干上，只能用逆向动力学这一半目标，是一种受限设置。

## 5. 实验设置与主结果

实验覆盖桌面和移动两类场景。桌面用 AgentNetBench 评测（coordinate SR / content SR / function SR / average SR），移动用 AndroidControl 和 GUIOdyssey（action type 准确率 / grounding 准确率 / step SR）。核心对比是同一套微调 pipeline 下"有无 STP 初始化"的差异：**FT w/o STP** vs **FT w/ STP**，其余训练配置完全一致，从而把变量隔离到 STP 这一步。

![Figure 1：STP 同时改善训练优化过程（左图 cross-entropy loss 下降更快、达到的验证集平均 SR 更高）和最终下游性能（右图四个子图对比不同微调数据规模下 w/o STP 与 w STP 的最终结果）](/images/scaling-gui-agents-visual-state-transitions/figure-1-overview.png)

Figure 1 是全篇最重要的总览图。左图显示，在完全相同的 2K AgentNet Win&Mac 轨迹上微调时，带 STP 初始化的模型收敛更快、cross-entropy loss 更低，同时对应的 AgentNetBench 平均 SR 显著更高。右图则把四个不同微调数据规模场景（2K/18K AgentNet trajectory、2K/1K 移动端 trajectory）的最终结果并排展示，所有场景都是 w STP > w/o STP。

### 桌面场景：AgentNetBench 三组对比

![Table 1：AgentNetBench 上三组不同微调场景的主结果对比，红色表示提升、蓝色表示下降](/images/scaling-gui-agents-visual-state-transitions/table-1-agentnetbench-results.png)

具体数字：

- **Group 1a**（320K 转移预训练 + 2K Win&Mac 轨迹微调）：average SR 从 64.9% 提升到 **67.2%**（+2.3），coordinate SR 从 65.4% 到 68.0%（+2.6），content SR 从 49.5% 到 52.5%（+3.0），function SR 从 65.0% 到 69.1%（+4.1）。
- **Group 1b**（同样的 320K 转移预训练，但迁移到 5K Ubuntu 轨迹微调，跨发行版/跨环境）：average SR 从 56.9% 提升到 **63.1%**（+6.2），是所有分组里增益最大的一组，但 function SR 反而从 75.3% 降到 73.2%（-2.1）。
- **Group 1c**（320K 转移预训练 + 18K Win&Mac 轨迹微调，微调数据量大 9 倍）：average SR 从 67.1% 提升到 **69.5%**（+2.4），说明即便微调数据本身已经很充分，STP 依然有增量价值，不会被"更多轨迹数据"完全替代。

论文特别强调 Group 1b 的意义：**STP 在 Win&Mac 数据上预训练，却能帮助 Ubuntu 轨迹微调**，这说明动力学建模学到的是某种跨环境可迁移的通用能力（比如识别点击导致的状态变化模式），而不是单纯记住了特定操作系统的界面元素。不过 function SR 的下降也提示，这种迁移不是没有代价的——在语义层面的动作理解（function 相关判断）上，跨系统预训练可能带来一定干扰。

### 移动场景：AndroidControl 与 GUIOdyssey

![Table 2：AndroidControl-High 和 GUIOdyssey 上的主结果对比，同样标注了红蓝色的变化方向](/images/scaling-gui-agents-visual-state-transitions/table-2-androidcontrol-guiodyssey-results.png)

- **AndroidControl**（Group 2，67K 转移预训练 + 3K 轨迹微调）：step SR 从 71.1% 提升到 **72.0%**（+0.9），action type 准确率从 86.3% 到 87.1%（+0.8），grounding 准确率从 68.2% 到 69.5%（+1.3）。
- **GUIOdyssey**（Group 3，95K 转移预训练 + 1K 轨迹微调）：step SR 从 76.8% 提升到 **77.4%**（+0.6），grounding 准确率从 78.8% 到 80.4%（+1.6），action type 准确率几乎持平（91.3% → 91.5%）。

移动场景的增益明显小于桌面场景（0.6-1.6 个百分点 vs 桌面的 2.3-6.2 个百分点）。论文给出的解释是：移动数据集任务复杂度更低，且骨干模型（BAGEL）的预训练语料中移动端 UI 分布的暴露程度可能已经比较充分，导致 STP 能补的"增量空间"更小。这个解释和 Figure 4 左图的训练动态是自洽的——下一节详细展开。

## 6. 消融实验：哪些设计选择真正重要

![Figure 4：左图对比三个数据集微调时的 cross-entropy loss 曲线，移动数据集（AndroidControl、GUIOdyssey）收敛明显快于桌面数据集（AgentNet），暗示任务复杂度更低、STP 可填补的空间更小；右图对比同等 192K 转移预算下轨迹级采样与步骤级采样的效果，二者几乎一致](/images/scaling-gui-agents-visual-state-transitions/figure-4-training-dynamics.png)

Figure 4 左图直接支撑了上一节"移动场景增益更小"的解释：AndroidControl 和 GUIOdyssey 的 loss 曲线下降得比 AgentNet 快得多，说明这两个任务本身更容易被模型学会，STP 能提供的额外优化空间自然有限。

右图的对比更有工程意义：在同等 192K 转移预算下，**轨迹级采样**（从约 11K 条轨迹里拆解出 192K 转移）和**步骤级采样**（直接从 320K AgentNet Win&Mac 转移池中随机抽 192K 条独立转移）得到的效果几乎相同（66.85% vs 66.45% average SR）。这个结论虽然差距很小，但意义不小：**它说明 STP 的效果主要由转移数量驱动，而不是依赖轨迹内部的连贯结构**，为未来通过自动化探索（不依赖完整轨迹标注）大规模采集独立转移提供了合理性支撑。

![Figure 5：消融不同预训练目标组合（inverse-only / forward-only / inverse+reconstruction / inverse+forward）在三种微调场景下的效果，红色虚线是不做 STP 的基线](/images/scaling-gui-agents-visual-state-transitions/figure-5-ablation-objectives.png)

这组消融回答了"两个目标是否都必要"的问题：

- **联合 inverse+forward 在所有三个场景下都优于单目标预训练**，是最稳健的选择。
- 单目标的表现不稳定：桌面场景下 inverse-only 和 forward-only 都能超过 fine-tune-only 基线，但在 AndroidControl 上 forward-only 反而比基线下降 0.6%，inverse-only 只有 +0.3% 的边际提升。
- 论文还对比了 **inverse+reconstruction**（用"详细描述这张图片"这种静态图文重建任务代替 forward dynamics）：inverse+forward 稳定优于 inverse+reconstruction，因为重建任务只强化静态视觉理解，不需要建模动作的效果，而 forward dynamics 显式学习 `(s_t,a_t)→s_{t+1}` 的因果转移，提供了更"动作感知"的监督信号。

![Figure 6：左图对比不同预训练策略（无 STP / 全模型 STP / 仅 ViT 编码器 STP）随训练步数变化的 loss 与 SR；右图对比不同预训练数据规模下的 loss 与最优 SR](/images/scaling-gui-agents-visual-state-transitions/figure-6-ablation-encoder-scale.png)

Figure 6 左图揭示了一个反直觉但工程上很重要的结论：**只微调 ViT 视觉理解编码器（冻结语言模型部分）做 STP，早期确实比完全不做 STP 要好一点，但增益很快见顶**；只有让语言模型组件也参与联合优化，才能获得持续的提升。论文由此得出结论：**仅仅改善视觉表征不足以支撑 GUI 控制能力，语言模型必须与视觉编码器协同优化才能真正吸收动力学监督信号**。这对"是否可以用轻量级视觉适配层做 STP 从而省算力"这个想法泼了一盆冷水——至少在本文的实验设置下不成立。

右图则是标准的数据规模缩放曲线：随着预训练转移数据从 48K 扩展到 320K，AgentNetBench 上的最优平均 SR 持续上升，同时相同微调步数下的 cross-entropy loss 持续下降，说明更多转移数据带来更好的初始化。论文强调这是一种"正交的缩放轴"：即使微调数据预算固定不变，扩大转移语料依然能带来收益，而转移数据的采集成本明显低于完整轨迹标注。

论文也给出了成本核算：在最大配置（320K AgentNet 转移）下，STP 大约只多花一个 epoch 的联合动力学训练时间，且不需要任何额外标注；这个开销可以在所有从同一个 STP checkpoint 出发的下游微调任务里分摊。

## 7. 对 macOS 研发效率工具和 GUI 自动化的启发

站在做 macOS 研发效率工具、GUI 自动化测试或 computer-use agent 训练管线的角度，这篇论文的价值不在于"能不能立刻套用它的确切数字"，而在于它验证的一种**数据分层与训练分阶段**的思路：

1. **转移数据比完整轨迹数据"便宜"，值得单独沉淀成资产。** 如果你已经有 GUI 自动化的执行日志（无论是回归测试、探索测试还是真实用户操作留痕），即便这些日志没有明确的"任务指令"标签，只要能拆出连续两帧截图+中间动作，就已经具备了训练动力学模型的原始素材。这意味着企业内部大量"无标注但有截图和操作记录"的自动化执行数据，理论上可以被利用起来，而不需要重新组织成完整的任务级标注。

2. **动力学预训练是轨迹微调的补充，而不是替代。** 论文的 Table 1/2 全部是"w/o STP vs w STP"在相同微调配置下的对比，没有一组是"只用 STP、不做轨迹微调"。工程实践上应该把它当作一个可选的预训练阶段插入现有 pipeline，而不是期待它单独解决任务规划问题。

3. **跨环境迁移的证据（Win&Mac 预训练 → Ubuntu 微调 +6.2%）值得关注，但不要过度泛化。** 这提示动力学层面的知识（"点击会造成什么视觉变化"）可能比语义层面的知识更容易跨平台迁移。如果要做跨 macOS / Windows / Linux 的统一 GUI agent，动力学预训练阶段或许可以共享，而任务规划/指令跟随阶段仍需要各平台的针对性数据。

4. **"步骤级采样效果不输轨迹级采样"这个消融结论，直接支持自动化探索采集转移数据的可行性。** 对于想做自动化 UI 探索来生产训练数据的团队，这意味着不必坚持采集完整的、语义连贯的用户任务轨迹，独立的随机探索步骤同样有价值，工程门槛更低。

5. **警惕"只调视觉编码器"的省算力捷径。** 如果你的团队考虑用 LoRA 或轻量适配层只微调视觉部分来"蹭"动力学预训练的收益，Figure 6 左图的结果提示这条路径的天花板很低，语言模型部分必须联合参与才能吃到完整收益。

6. **图像生成能力是硬性前提，选型时要提前确认。** 如果计划复现完整的 STP（正向+逆向），骨干模型必须原生支持图像生成（UMM 架构），这排除了大量当前主流的纯理解型 VLM。如果团队的技术栈是基于 Qwen2.5-VL、InternVL 这类纯理解模型，只能采用受限版本（仅逆向动力学），预期收益也会相应打折。

## 8. 局限性与专家点评

### 真正贡献

- 把"用未标注状态转移做预训练"这件事，通过统一多模态模型做成了**正向+逆向动力学联合优化**的干净实现，而不是像此前工作那样分开训练两个模型或退化成纯文本状态差异建模。
- 在桌面（AgentNet/AgentNetBench）和移动（AndroidControl、GUIOdyssey）两类场景、多种微调数据规模下，STP 表现出**方向一致的正向收益**，不是单点结果，具备一定说服力。
- 给出了几个对后续工作有指导意义的消融结论：联合目标优于单目标、语言模型必须参与优化、转移数据的采样粒度（轨迹级 vs 步骤级）影响不大、数据规模持续带来收益。

### 可能被高估的部分

- **增益幅度整体偏小，尤其在移动场景（0.6-1.6 个百分点）。** 考虑到评测本身用温度采样、多次取平均，这个量级的提升需要更多独立实验或显著性检验支撑其稳健性，论文目前没有报告方差或置信区间。
- **对比的"参考模型"（GPT-4o、OpenCUA-7B、UI-TARS-7B）明确声明不可直接比较**，这是诚实的做法，但也意味着读者无法从本文直接判断 STP 训练出的模型和当前最强开源/闭源 GUI agent 之间的真实差距，论文的贡献边界严格限定在"控制变量对比"层面，不是"刷榜"层面。
- **转移数据本质上仍然来自人工标注的轨迹数据集拆解**，Limitations 部分也坦承了这一点：还没有在大规模自动化采集的转移数据上验证过效果是否保持。步骤级 vs 轨迹级采样的消融是在"同一个转移池内部"做的对比，并不等价于验证了"完全独立于人工轨迹标注的自动化探索数据"同样有效。
- **BAGEL 是一个相对少见的、原生支持图像生成的 7B/14B UMM**，选择它虽然有明确的架构理由，但也意味着复现门槛较高，多数团队常用的纯理解型 VLM 无法直接套用完整方案。

### 可复现 / 可落地建议

- 如果手头有能拆出 `(s_t, a_t, s_t+1)` 三元组的执行日志，优先尝试**仅逆向动力学**（在纯理解型 VLM 上可行、成本低），把它当作一个廉价的 grounding 增强预训练，再评估是否值得为正向动力学换用/微调一个支持图像生成的骨干。
- 复现前建议先用小规模数据验证收益方向是否一致，而不是直接照搬论文的绝对数字，尤其是移动场景增益本身就很小，容易被自己的实验噪声掩盖。
- 若考虑扩展到自动化探索采集转移数据，可以先用论文验证过的"步骤级采样效果不输轨迹级"作为设计依据，把工程重心放在探索覆盖率和转移质量过滤上，而不是执着于生成语义连贯的完整任务轨迹。
- 评估时建议同时报告消融维度（预训练目标组合、更新哪些模型组件、数据规模），而不是只看单一"w/ STP vs w/o STP"的最终数字,这样能更准确判断收益来源。

## 9. 总结

State Transition Pretraining 提供了一个务实且低成本的视角：**GUI agent 训练不必把所有能力都压缩进"轨迹微调"这一个阶段**。通过把动力学建模拆解成正向、逆向两个可以从未标注转移数据中学习的子任务，并用统一多模态模型联合优化，论文在桌面和移动多个场景下取得了方向一致但幅度克制的收益。它的核心价值不在于刷新某个 benchmark 的最高分，而在于验证了"转移数据是一种被低估的、比完整轨迹标注更便宜的监督信号"，并且给出了几条对工程实践有直接指导意义的消融结论：联合优化优于单目标、语言模型必须参与、采样粒度影响很小、数据规模持续带来收益。对于任何已经在积累 GUI 自动化执行日志、又苦于任务级标注成本的团队，这是一个值得关注但不必神话的方向——收益存在，但幅度需要用自己的数据重新验证。

## 10. 参考链接

- 论文 abs：[https://arxiv.org/abs/2607.24112](https://arxiv.org/abs/2607.24112)
- 论文 PDF：[https://arxiv.org/pdf/2607.24112](https://arxiv.org/pdf/2607.24112)
- 代码仓库：[https://github.com/xyliugo/gui-state-transition-pretraining](https://github.com/xyliugo/gui-state-transition-pretraining)
- BAGEL（骨干 UMM）：[https://github.com/bytedance-seed/BAGEL](https://github.com/bytedance-seed/BAGEL)
- AgentNet / AgentNetBench / OpenCUA：Wang et al., 2025c
- AndroidControl：Li et al., 2024
- GUIOdyssey：Lu et al., 2025c
