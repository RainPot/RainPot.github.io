---
title: "Gated Hindsight Distillation：下一帧截图知道「该点什么」，把它做成离线 GUI Agent 的免费老师"
description: "GHD 把成功轨迹里被丢掉的「下一帧截图」捡回来当训练期特权信息：参数共享的 teacher 多看一帧，只在 student 出错、且 teacher 能靠这一帧把动作纠正回演示动作时，才做 token 级蒸馏。它在 AndroidWorld/AndroidLab 上稳定超过 SFT 和 GRPO，最反直觉的是——只给 teacher 下一帧、不给参考答案，反而比给全了更强。拆解它的门控、动态采样和「prior vs posterior」重述，以及哪些结论要打折看。"
date: "2026-08-14"
tags: ["GUI Agent", "Reinforcement Learning", "Distillation", "Mobile Agent", "VLM"]
draft: false
featured: true
readingTime: 19
---

离线训练 GUI agent，业界现在基本是一套固定动作：拿一批成功的交互轨迹，切成「当前屏幕 + 历史 → 下一个动作」这样的 prefix-action 对，做 SFT，再上 GRPO 那一路强化学习。这套流程有个几乎没人提的问题——**它把每条轨迹里的「下一帧截图」随手扔了**。而恰恰是这一帧，藏着「为什么要这么做」的证据。

[Gated Hindsight Distillation (GHD)](https://arxiv.org/abs/2608.06065)（Li et al., 2026-08-06）做的就是这一件事：把被丢弃的下一帧截图捡回来，当作**训练期才有的特权信息**，让一个「多看一帧」的 teacher 去纠正一个「只能看当前帧」的 student。做法很轻，效果不轻——在 AndroidWorld 和 AndroidLab 上稳定压过 SFT 和 GRPO。

这篇值得拆的原因不在「又涨了几个点」，而在它把一个大家都默认的训练范式挑了个刺：**动作要从过去预测，但解释这个动作的证据往往只出现在未来**。这个错位一旦看清，解法几乎是顺出来的。

## 目录

1. 问题：被丢掉的「下一帧」和 supervision gap
2. 核心重述：把「该做什么」换成「一定做过什么」
3. 方法拆解：三个零件（teacher 多看一眼 / 门控 / 动态采样）
4. 实验：涨了多少，涨在哪
5. 最反直觉的结论：只给下一帧，比给参考答案更强
6. 和同类「用未来」的方法比
7. 给工程 / APP 自动化的可搬与要警惕
8. 局限：哪些结论要打折看
9. 总结
10. 参考链接

## 一、问题：被丢掉的「下一帧」和 supervision gap

先看论文举的例子：你要在某个 App 里打开 **Soft Wrap** 这个设置。它藏在菜单里，当前屏幕上摆着 Edit、View 等好几个看着都像的入口，演示数据告诉你「点了 Edit」。但从当前这一帧，模型根本看不出为什么要点 Edit——**这个因果关系要等点完、菜单弹出来的下一帧才暴露**。

![Figure 1：监督信号的缺口。模仿学习只监督「预测的动作」（比如 Tap System），几乎不给「为什么点这里」任何直接信号；而构成这个理由的证据，往往要等下一帧才出现，所以标准模仿目标很难学会有根据的动作推理。](/images/gated-hindsight-distillation-mobile-gui-agents/figure-1-supervision-gap.png)

论文把这个现象抽象成两句话，很准：

1. **目标不监督推理**。GRPO 那一套把轨迹切成 prefix-action 对，优化的只是「复现演示动作」，从不把「为什么这个动作对」当成训练目标。于是模型可能动作碰对了，理由却是一通看似合理、实则没接地的胡话。
2. **就算想监督推理，输入里也没证据**。prefix 里只有过去，而很多动作的合理性证据只出现在下一帧。把下一帧丢掉，等于把「能推出正确理由的那块信息」一起丢了。

作者把这两点合并成一个判断：**这是「动作从过去预测、证据只出现在未来」的未来依赖问题（future-dependence）**。它不是数据不够，也不是 RL 信号太稀疏，而是监督目标和输入信息两头都缺。

## 二、核心重述：把「该做什么」换成「一定做过什么」

GHD 的起点是一句几乎可以当格言的重述：

> 条件在下一帧上，难预测问题就变成了易推断问题。

- 「**我该做什么**」是从先验 $p(z \mid s)$ 里求答案，模型不确定、容易错；
- 「**我一定做过什么**」是从后验 $p(z \mid s, s')$ 里求答案，答案几乎被钉死了：结果已经摆在下一帧上，推理只需要把「结果」和「目标」连起来。

从后验里长出来的推理，正好补上了前面说的缺口——它把「为什么」显式地写了出来，写出来就能当监督目标；一旦被监督学会，下次再遇到同样的歧义，模型自己就能解。这个转换不依赖任何新数据：**成功轨迹里 $o_{t+1}$ 本来就在那，只是以前被扔了**。

所以 GHD 不预测未来，也不在推理时用什么世界模型或验证器。它只把「已经发生的下一帧」当训练期的免费信号，训出一个仍然只吃 prefix 的策略。推理时，future 和 teacher 全部消失。

## 三、方法拆解：三个零件

整体结构一句话：**参数共享的 teacher 多看一帧，重新给 student 的 rollout 打分；一个门控决定哪些分数留下；蒸馏只发生在「student 错了、teacher 纠正回来了」的那一小撮样本上。**

![Figure 2：GHD 总览。给定一条成功轨迹，student 只看交互 prefix（历史 + 当前帧），参数共享的 teacher 额外多看一眼真实发生的下一帧 $o_{t+1}$，在这个特权上下文里重新给 student 的 rollout 打分；门控只保留「student 动作失败、且 teacher 的位置级纠正能复现演示动作」的蒸馏。推理时只用 prefix 条件下的 student。](/images/gated-hindsight-distillation-mobile-gui-agents/figure-2-overview.png)

拆开看是三个零件，每个都在防一个具体的坑。

**零件一：teacher 多看一眼，但和 student 共用参数。**

student 吃 $x_t$（prefix），teacher 吃 $\tilde{x}_t = (x_t, o_{t+1})$。训练时把 student 采样出来的每个响应 token 拼进两个上下文，teacher 用 teacher-forcing + stop-gradient 重新算一遍 token 分布：

$$
\pi_S^j = \pi_\theta(\cdot \mid x_t, y_{<j}),\qquad \pi_T^j = \mathrm{sg}\!\left[\pi_\theta(\cdot \mid \tilde{x}_t, y_{<j})\right]
$$

关键细节是**两个分布都条件在同一个（可能不完美的）student prefix $y_{<j}$ 上**。也就是说 teacher 不是自己重新编一条「正确答案」，而是沿着 student 自己的 rollout 逐 token 给密集纠正。梯度只从 $\pi_S$ 走，teacher 只是免费的对照信号。

蒸馏目标用的是 SDPO 风格的广义 Jensen–Shannon 散度 $D^{(\alpha)}(\pi_T \|\pi_S)$，取 $\alpha=0.5$，效率上只在 top-$K=100$ 个 token 加一个「剩余词表」桶上算。

**零件二：门控——不是每次纠正都收。**

特权上下文只有在「能给出可验证的纠正」时才有用，否则就是把噪声灌进 student。所以蒸馏前面加了个二值门控 $M(y)$，两个条件**同时**满足才保留：

$$
M(y) = \mathbf{1}\!\big[R(y) < \tau_\mathrm{succ}\big]\;\mathbf{1}\!\big[\mathrm{match}_\delta(\hat a_T, a_t^\star)\big]
$$

- 第一项：**student 必须失败**（$R(y) < \tau_\mathrm{succ}$，$\tau_\mathrm{succ}=1.45$）。已经会的不蒸，蒸的是「这一帧能教会你的那部分」。
- 第二项：**teacher 的位置级 top-1 预测必须能复现演示动作**。具体做法是不额外生成一条 teacher 轨迹，而是对 student 响应的每个位置取 teacher 的 top-1 token，拼起来解析出动作 $\hat a_T$，和演示动作 $a_t^\star$ 比对——动作名一致，click/long_press/swipe 的每个坐标在归一化网格上误差 $\delta=20$ 以内，文本动作要精确匹配或过编辑相似度，离散参数要完全一致。

这个门控的精妙在于：式 (5) 和式 (8) 用的是同一个 teacher 分布、同一个 student prefix，所以**门控直接验证的，就是蒸馏要用的那个信号**。蒸馏目标和「要不要蒸」的判断，共享同一套 teacher，不存在「teacher 说一套、门控验另一套」的错位。

**零件三：动态采样——保证每个 batch 里有东西可蒸。**

可能某个 batch 里根本没有「student 失败且 teacher 能纠正」的样本，蒸馏就空转了。所以同一个 prompt 最多重试三次 rollout-group，每次之后先跑门控、不更新模型，第一次出现被接受的响应就停；三次都没有就保留最后一次。平均下来每次 batch 用 2.69 次尝试，换来更密集的有用监督。

最后合进 GRPO 一起训：

$$
\mathcal{L} = \mathcal{L}_{\mathrm{GRPO}} + \lambda\,\mathcal{L}_{\mathrm{GHD}},\qquad \lambda = 0.1
$$

GRPO 负责从奖励里学「对不对」，GHD 负责在「student 错了、teacher 能纠正」的窄窗里灌 token 级、未来接地的监督。两者互补，不是替代。

顺带说一下这里面的 verifier（RL 和门控共用同一个）：动作类型对不上直接给 0，类型对上再看参数——坐标用 $s_\mathrm{coord}(\hat p, p^\star) = \max(1 - \frac{\|\hat p - p^\star\|_2}{\sqrt{2}\cdot 1000}, 0)$，文本用编辑相似度，离散参数要精确。最终 $R(y) = \tfrac12 \mathrm{type} + \tfrac12 \mathrm{value} + \tfrac12 \mathrm{format}$，落在 $[0, 1.5]$。

## 四、实验：涨了多少，涨在哪

实验在两个移动 GUI 基准上做：**AndroidWorld** 和 **AndroidLab**，底座是 Qwen2.5-VL-7B 和 Qwen3-VL-8B，先按 OpenMobile 的配方训 SFT（截图缩到 420×896，省约 3× 视觉 token，代价是 SFT 起点比官方 OpenMobile 略低）。关键设定：rollout 组 $G=8$、温度 1.0、最大 512 token、lr 1e-6（无 warmup）、训 200 步。

先看和已公开系统的对比（Table 1）：在 open-data 模型里，GHD 在两个规模上都拿到最好的平均 Pass@1——7B 平均 47.9，8B 平均 60.3。但这个表各家数据、分辨率、算法都不同，作者自己都标注「只说明有竞争力，不是隔离 GHD 的贡献」。真正干净的是后面的对照。

**消融（Table 2，AndroidWorld，7B）**是最能说明问题的一张表，从 GRPO 一路加零件：

| 方法 | RL | Gate | DS | HSD(下一帧) | Pass@1 ↑ | Δ vs GRPO |
| --- | --- | --- | --- | --- | --- | --- |
| GRPO | ✓ | | | | 47.13 | — |
| + Gate | ✓ | ✓ | | | 47.84 | +0.71 |
| + DS | ✓ | ✓ | ✓ | | 49.56 | +2.43 |
| GHD | ✓ | ✓ | ✓ | ✓ | 52.73 | +5.60 |

门控 +0.71，动态采样再 +2.43，而**引入下一帧直接 +3.17，是最大的一跳**。这张表把「涨分到底来自哪」拆得明明白白：主要的增益来自「未来接地的 token 级监督」，不是来自多采样、也不是来自蒸馏这个形式本身。

**对照实验（Table 3）**用同一份数据、同一个评测环境、GRPO 和 GHD 同初始化，把 GHD 的贡献单独隔出来：

| 底座 | 方法 | AW Pass@1 ↑ | AL Pass@1 ↑ |
| --- | --- | --- | --- |
| Qwen2.5-VL-7B | SFT | 46.55 | 29.71 |
| | GRPO | 47.13 ± 0.65 | 31.93 ± 1.12 |
| | **GHD** | **52.73 ± 1.51** | **43.10 ± 0.66** |
| Qwen3-VL-8B | SFT | 59.05 | 39.13 |
| | GRPO | 61.35 ± 1.08 | 37.43 ± 0.42 |
| | **GHD** | **66.47 ± 0.68** | **54.11 ± 1.11** |

两个底座、两个基准上 GHD 都稳定赢过 SFT 和 GRPO。值得注意的细节：8B 在 AndroidLab 上 GRPO 反而比 SFT 掉了一点（37.43 vs 39.13），而 GHD 把它拉到 54.11——**这说明在稀疏奖励、长链路任务上，纯 GRPO 的价值信号不够用，而「下一帧」恰好补的就是这块**。分 App 看（Table 7），GHD 在 9 个 AndroidLab App 里赢了 7 个，涨得最猛的是 Bluecoins（26.67→60.00）和 Contacts（33.33→66.67）这种「要记住前置步骤」的场景；例外是 Calendar 和 Zoom（后者只有 5 个任务，样本太少）。

## 五、最反直觉的结论：只给下一帧，比给参考答案更强

作者做了一组「teacher 到底该知道什么」的实验（Table 4，8B，AndroidWorld，从 SFT 的 59.05 出发），结论有点反常识：

| Teacher 的特权信息 | 动作 $a_t^\star$ | 推理 $r_t^\star$ | 下一帧 $o_{t+1}$ | Pass@1 ↑ | Δ vs SFT |
| --- | --- | --- | --- | --- | --- |
| SFT（基线） | | | | 59.05 | — |
| +Action | ✓ | | | 58.62 | −0.43 |
| +Reasoning | ✓ | ✓ | | 60.34 | +1.29 |
| Full | ✓ | ✓ | ✓ | 64.67 | +5.62 |
| **Ours（只给下一帧）** | | | ✓ | **66.47** | **+7.42** |

只给参考答案（动作）**没用**（−0.43）；加上推理也只有 +1.29；给全了是 +5.62；而**只给下一帧截图、不给任何参考答案，反而是最强的 +7.42**。

为什么「知道答案」还不如「看到结果」？论文给了两个解释，我觉得都站得住：

1. **下一帧携带了参考答案里没有的信息**——它揭示的是动作的**真实效果**，让 teacher 的解释接在界面转移上，而不是复读一个标签。
2. **只给下一帧还能顺手过滤噪声数据**。离线轨迹很多是 reject-sampling 合成出来的，会混进一些和用户指令跑偏的多余步骤。这些步骤如果给参考答案，teacher 可能靠「照抄动作」蒙过门控；但下一帧对这种动作给不出任何理由，于是被拒掉。

还有一个转移机制的问题（Figure 3）：把特权信息蒸馏给学生，用「token 级分布匹配（distillation）」还是「让 teacher 生成一条纠正序列再当 MLE 目标（STaR 式）」？结论是 distillation 在三种特权信号下都赢过 STaR——token 级匹配沿着 student 自己的 rollout 给细粒度监督，而 STaR 只给一条 off-policy 的「标准答案」，信息量差一截。两者叠加出最优：**下一帧 + 分布蒸馏**。

## 六、和同类「用未来」的方法比

「下一帧有用」这个判断，其实已经有人在做，GHD 的和它们的差异点很关键：

- **GUI world model**（如 [AppDeltaWorld](/blog/2026-08-13-appdeltaworld-code-world-model-mobile-gui-agent) 那一路）学的是「预测动作之后的 UI 状态」，让 agent 靠 lookahead 规划；**action-effect verification**（[VeriGUI](/blog/2026-06-05-verigui-action-effect-verification) 那一路）在推理时检查真实下一屏来发现并回收失败动作。这两类都要在**测试期**消耗未来状态——要么预测、要么在线验证，得付推理成本。
- **GUI-Shift** 用「当前帧 + 未来帧 → 推断第一个动作」的逆动力学辅助任务，从状态转移里学 affordance。

GHD 和它们都正交：**它从不预测未来，也不在推理时用未来**。它只把成功演示里「已经发生的下一帧」当训练信号，训出一个不携带任何 world model 或 verifier 的纯 prefix 策略。论文专门做了对照（Table 6，7B）：同样从 GRPO 出发，加 GUI-Shift 式辅助任务只 +0.28，GHD 是 +5.60。作者的判断很直接——**未来观测最有效的用法，是把它转成对「当前决策」的定向监督，而不是练一个和主任务若即若离的辅助目标**。

## 七、给工程 / APP 自动化的可搬与要警惕

抛开「又涨了几个点」，这篇最值钱的是一套可以直接抄的思路：

**可搬的：**

- 「下一帧当特权老师」几乎是白捡的。离线轨迹里 $o_{t+1}$ 本来就有，GHD 没有新增任何数据、没有新增推理模块，纯粹是把以前扔掉的信息接进了训练目标。任何做 GUI agent 后训练、手里有成功轨迹的团队都能试。
- **门控是防「灌错」的关键**。student 失败 + teacher 可验证纠正，两个条件缺一不可。它把蒸馏缩到一个「这一帧确实能教点东西」的窄窗里，避免 teacher 的胡话污染 student。这个「只在可验证纠正时蒸馏」的判断，比蒸馏本身更值得抄。
- **把「难预测」重构成「易推断」是个通用杠杆**。很多训练信号稀的问题，都可以想想：有没有一个后验视角，让原本要靠运气采样到的正确答案，变成「看一眼结果就几乎唯一确定」的答案。

**要警惕的：**

- 它训的是**难样本子集**（把 SFT 一步能做对的样本滤掉，27,360 → 约 6~7 千条）。所以它的增益有一部分建立在「SFT 已经会的那部分不用再教」之上，不代表在冷启动、数据很少的场景下同样成立。
- 8B 在 AndroidLab 上 GRPO 掉分、GHD 拉回来的现象，说明**增益和任务类型强相关**——长链路、有隐式前置条件的任务吃这套最狠，简单点击类任务可能收益很小。
- 结果带方差（±0.4~1.5），结论是「稳定优于 GRPO」而非「碾压」，别把它读成点石成金。

## 八、局限：哪些结论要打折看

作者自己没回避的几处，读的时候心里要有数：

1. **SFT 起点偏低**。为了省视觉 token 把截图压到 420×896，官方 OpenMobile 的 SFT 分数它没追平。也就是说 GHD 是在一个「还有空间」的底座上补分，换到已经榨得差不多的强底座上，增量未必一样大。
2. **动态采样的 wall-clock 结论不可控**。论文说开启动态采样「没明显增加端到端训练时长」，但自己也标注这是在非独占租用实例上跑出来的观察，不是受控的系统对比——别把这句话当基准。
3. **只在两个基准、两个底座上验证**。而且都是 Android 移动场景，桌面 / Web 的 Computer Use 是否同样成立，论文没碰。
4. 「只给下一帧比给参考答案强」这个结论虽然漂亮，但它的解释（过滤噪声轨迹）是**推断**，不是消融出来的直接证据。

这些都不是硬伤，但决定了这篇的定位：**一个干净、好复现、值得马上试的训练技巧**，而不是一个全面刷榜的方法。

## 九、总结

GHD 把一个被忽视的训练事实讲清楚了：GUI agent 要从过去预测动作，但「为什么这么点」的证据往往只出现在下一帧。它的应对极简——训练期让 teacher 多看一帧，用门控保证只蒸「可验证纠正」的那部分，训完只留 prefix-only 的 student。效果上稳定压过 SFT 和 GRPO，而且最反直觉的发现是**「看到结果」比「知道答案」更值钱**。

落到工程里，我最想带走的其实是那句话：**别急着预测未来，先看看「已经发生的下一帧」是不是已经被你当垃圾丢了。** 很多被随手丢弃的中间状态，可能正是最便宜、最有信息量的监督。

## 参考链接

- 论文：The Next Screenshot Knows: Gated Hindsight Distillation for Mobile GUI Agents — [arXiv:2608.06065](https://arxiv.org/abs/2608.06065)（[HTML 全文](https://arxiv.org/html/2608.06065v1)）
- 文中涉及的同类工作：GUI-Shift、OpenMobile、AndroidWorld、AndroidLab、UI-Venus、ScaleCUA、SDPO（Reinforcement Learning via Self-Distillation）
- 本博客相关拆解：[AppDeltaWorld 代码世界模型](/blog/2026-08-13-appdeltaworld-code-world-model-mobile-gui-agent)、[VeriGUI 动作-效果验证](/blog/2026-06-05-verigui-action-effect-verification)
