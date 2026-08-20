---
title: "LLM-as-a-Verifier：把评委那一个分数换成整条 logits 分布，验证成了第四条 scaling 轴"
description: "同一个模型、同一个 prompt，只是不再取 argmax 而是对打分 token 的整个分布求期望——Terminal-Bench 上 27% 的平局率归零，query-optimize 案例里 88/100 的打平变成 77/100 的正确排序。拆解 LLM-as-a-Verifier 的三条 scaling 轴、A-T 字母量表和 prefill 读 logprob 的实现细节、Probabilistic Pivot Tournament，以及它被高估的地方：三条轴都很快饱和、PPT 在 N=5 时并不省钱、进度追踪的成功/失败相关性只差 0.079。"
date: "2026-08-20"
tags: ["Verifier", "Test-Time Scaling", "Reward Model", "Agent Evaluation", "LLM-as-a-Judge"]
draft: false
featured: true
readingTime: 26
---

先看一个数字：在 Terminal-Bench V2 上，把整个榜单的轨迹汇到一起，只要有一个「永远挑对」的 oracle 来选，成功率是 **98.9%**。而实际榜首的单次成功率（pass@1）是 84.7%。

模型早就能做对这些题了——它只是**不知道自己哪一次做对了**。这 14 个点的差距不在生成能力上，全在「选择」这一步。

![Figure 5：Terminal-Bench V2 上的 oracle pass@k 曲线。单次采样 84.7%，采样数增加后 oracle 上界一路爬到 98.9%，而 pass@1 基本走平——说明差距全部积压在「从 k 条里挑对一条」这个环节。](/images/llm-as-a-verifier/figure-5-oracle-pass-at-k.png)

[LLM-as-a-Verifier](https://arxiv.org/abs/2607.05391)（Kwok et al., Stanford / UC Berkeley / NVIDIA，2026-07）就是冲着这个缺口去的。它的核心动作小到有点不像一篇论文的主张：**不要取 argmax**。让模型照常输出一个打分 token，但不去读它最终吐出来的那个字符，而是把这个位置上所有候选打分 token 的 logprob（模型给每个候选 token 的置信度，概率取对数）全取出来，按各自概率加权平均。

就这一步，把 Terminal-Bench 上 27% 的平局率打到了 0。

这篇值得拆的点不在榜单：它把「验证」摆到了和 pre-training、post-training、test-time compute 并列的位置上，当成第四条可以独立加算力的轴，还给出了三个能拧的旋钮。至于这条轴到底有多长，论文自己的图就已经透露了答案，后面会说。

![Figure 1：LLM-as-a-Verifier 在四个 benchmark 上的总体表现——Terminal-Bench V2 86.5%、SWE-Bench Verified 78.2%、RoboRewardBench 87.4%、MedAgentBench 73.3%，横跨代码、机器人、医疗三个域，且全程不做任何训练。](/images/llm-as-a-verifier/figure-1-overall-performance.png)

## 目录

1. 问题：judge 的分数为什么不够用
2. 方法：一个公式，三条 scaling 轴
3. 实现拆解：A-T 字母量表和 prefill 读 logprob 的把戏
4. Probabilistic Pivot Tournament：把 O(N²) 压到 O(Nk)
5. 工程细节：prefix cache 从 5.2% 拉到 78.4%
6. 实验结果：涨在哪，涨了多少
7. 副产物：连续分数当进度条
8. 当 RL 的 dense reward
9. 专家点评：真正贡献 / 被高估的部分 / 代码与论文的出入
10. 对 APP 自动化测试 / Mobile QA 的启发
11. 总结
12. 参考链接

## 一、问题：judge 的分数为什么不够用

标准的 LLM-as-a-Judge 做法是：让模型在 1–5 或 1–10 的量表上打个分，只取概率最高的那个 token（argmax）当结果。问题在于这个动作把一个连续的内部信念**压成了一个整数**。

论文里的 `query-optimize` 案例把这笔账算得很清楚。任务是把一条慢 SQL 优化成等价的快查询，两条候选轨迹都产出了更快的查询，区别在验证环节：

- 正确的那条：老老实实等原查询在标准库上跑完整整 5 分钟，然后把两边输出做 diff；
- 失败的那条：**压根没在原库上验证等价性**，自己新建了一个库。

Gemini 2.5 Flash 其实看出来了这个区别。但它在推理里的表述是「slightly cleaner」「marginally more direct」这种带着对冲的措辞——**信念是有差异的，只是差异很小**。于是离散量表一压，结果见下表。先交代两个符号：$\varphi$ 把分数档映成奖励标量，$p_\theta(v_g)$ 是模型给第 $g$ 档的概率。judge 只读概率最高的那一档（argmax），verifier 对所有档做加权平均：

| 方法 | 奖励 | 正确排前 | 打平 | 排后 |
|---|---|---|---|---|
| Judge（离散，G=5） | $\varphi(\arg\max_g p_\theta(v_g))$ | 12/100 | **88/100** | 0/100 |
| Verifier（连续，G=5） | $\sum_{g=1}^{5} p_\theta(v_g)\varphi(v_g)$ | 69/100 | 0/100 | 31/100 |
| Verifier（连续，G=20） | $\sum_{g=1}^{20} p_\theta(v_g)\varphi(v_g)$ | **77/100** | 0/100 | 23/100 |

100 次重复评估，离散 judge 有 **88 次打成平手**。同一个模型、同一个 5 分量表，只是改成对分布求期望——平局全消，69 次排对。粒度再拉到 20，77 次排对。

这张表是全篇最直接的证据：信息一直都在模型里，只是被 argmax 这一步扔掉了。

![Table 2：query-optimize 案例上 judge 与 verifier 的对比。离散 1–5 量表在 100 次重复评估里打平 88 次；对同一个 5 点分布求期望后平局归零、正确排序 69 次；粒度提到 G=20 进一步到 77 次。](/images/llm-as-a-verifier/table-2-judges-vs-verifiers.png)

## 二、方法：一个公式，三条 scaling 轴

设 $V_{\text{score}} = \{v_1, \dots, v_G\}$ 是一组有序的打分 token。给定任务 $x$、评测准则 $c$（criterion，判断时依据的那条标准）、轨迹 $\tau$，奖励定义成：

$$
R(x, \tau) = \frac{1}{CK} \sum_{c=1}^{C} \sum_{k=1}^{K} \sum_{g=1}^{G} p_{\theta}(v_g \mid x, c, \tau)\,\varphi(v_g)
$$

其中 $\varphi$ 把打分 token 映到标量。三个求和号正好就是三条可以独立加算力的轴：

- **$G$ 打分粒度**：量表有多少档。内层求和。
- **$K$ 重复评估**：同一对轨迹评几遍取平均。中层求和。
- **$C$ 评测准则分解**：把「这条轨迹对不对」拆成几个更好回答的子问题。外层求和。

论文的论证是这三条轴各自治不同的病，因此互补：

| 轴 | 治的问题 | 机制 |
|---|---|---|
| $G$ 粒度 | 分辨率不足、平局 | 给解码器更细的空间投射内部信念 |
| $K$ 重复 | 单次评估的方差 | Monte Carlo 估计，方差按 $\mathcal{O}(1/K)$ 收缩，偏置不变 |
| $C$ 分解 | 评分准则（rubric）本身是有偏的代理指标 | 复合问题会让 verifier 抓住 prompt 里最显眼的那个因子 |

$C$ 这条轴最实用。长程 agentic 任务里问「这条轨迹对不对」其实混了好几个逻辑上独立的判断，论文对代码 agent 拆成三个：

- **Specification**：是否满足任务的具体要求（确切路径、安装位置、输出格式、命名、显式约束）；
- **Output Match**：最后那条验证命令的实际 stdout，和任务描述要求的输出**逐字符**比对；
- **Error Signal**：轨迹里（尤其后段）有没有未被修掉的报错、traceback、非零退出码、编译失败。

![Figure 4：三条轴上的验证准确率。粒度从 G=1 的 73.1% 到 G=20 的 77.5%；重复评估从 K=1 的 74.7% 到 K=16 的 77.5%；单评测准则 75.2%–76.4%，三评测准则集成到 78.3%。注意三条曲线都在很早就开始走平。](/images/llm-as-a-verifier/figure-4-verification-scaling.png)

![Figure 2：统一验证框架总览。Uncertainty（对 logits 求概率）× Granularity（细粒度打分 token）× Repetition（多信号聚合）× Decomposition（拆成更简单的因子），输入可以是文本/图像/视频，输出接到 test-time scaling、progress tracking、reinforcement learning 三个下游。](/images/llm-as-a-verifier/figure-2-unified-verification-framework.png)

## 三、实现拆解：A-T 字母量表和 prefill 读 logprob 的把戏

论文正文的 prompt 写的是 `INTEGER_1_TO_20`，然后在脚注里轻描淡写地补了一句「实际实现用字母量表而非数字」。这句话背后是两个绕不过去的工程约束，代码里看得很清楚。

**第一个约束：多位数字没法在单个 token 位置上读分布。** 「20」在多数分词器（tokenizer）里是一到两个 token，「17」和「1」的第一个 token 可能相同。要在**一个** token 位置上拿到 20 个互斥选项的完整分布，选项必须都是单 token——于是有了 A–T。`fine_grained_reward.py` 里的映射是 $\varphi(\text{A}) = 20$ 递减到 $\varphi(\text{T}) = 1$，大小写都收：

```python
GRANULARITY = 20
SCALE = {
    "valid_tokens": {
        **{chr(65 + i): float(GRANULARITY - i) for i in range(GRANULARITY)},
        **{chr(97 + i): float(GRANULARITY - i) for i in range(GRANULARITY)},
    },
}
```

**第二个约束：开源模型不肯乖乖吐出 score 标签。** 代码里的解法分两步——先让模型自由分析，把 `<score_A>` 之前的分析文本截下来，然后**把标签自己 prefill（预先填好助手回复的开头）进去**，只解码 1 个 token，同时用 structured outputs 把这个位置约束在 20 个字母上：

```python
response = client.chat.completions.create(
    messages=messages + [{"role": "assistant", "content": prefix}],
    max_tokens=1, logprobs=True, top_logprobs=top_logprobs,
    extra_body={"add_generation_prompt": False,
                "continue_final_message": True,
                "structured_outputs": {"choice": letters}},
)
```

约束到 20 个字母之后，返回的 top-logprobs 就是**在量表上重新归一化过的分布**——正好是公式里要的 $p_\theta(v_g \mid x, c, \tau)$。DeepSeek 走另一条路（它自己会吐标签，也没有 prefill 参数），所以代码里给客户端打了 `_llm_verifier_deepseek` 标记分流。

这类实现细节里藏着不少踩坑记录，比如 `_find_tag_logprobs` 要取**最后一个**匹配（模型会在分析中途复述格式）、有的 tokenizer 会把 `>` 和字母融成一个 token（`>A`）、Qwen VL 会把概率质量压在带前导空格的字母上（所以 `letters` 列表里空格版和无空格版都放了）。这些都是真跑过大规模评测才会遇到的东西。

## 四、Probabilistic Pivot Tournament：把 O(N²) 压到 O(Nk)

有了成对奖励，选 best-of-N 的朴素做法是 round-robin（两两都打），跑完 $\binom{N}{2}$ 对，$\mathcal{O}(N^2)$。PPT 的做法是让每个候选只跟一小撮「标杆」候选（pivot）比。

![Figure 6：Probabilistic Pivot Tournament 的五阶段流程——候选池 → 随机哈密顿环打分 → 按环上得分选 top-k 做 pivot → 非 pivot 对 pivot、pivot 对 pivot 打分 → 聚合归一化选出胜者。](/images/llm-as-a-verifier/figure-6-probabilistic-pivot-tournament.png)

整个算法的精髓在第二步的**环**。采一个均匀随机的哈密顿环，只打 $N$ 对相邻的：

```python
def ring_cycle(n, rng):
    perm = list(range(n))
    rng.shuffle(perm)
    return [(perm[t], perm[(t + 1) % n]) for t in range(n)]
```

环的妙处是：**每个候选恰好在 A 位出现一次、在 B 位出现一次**。LLM 对「先看到的那个」有系统性偏好，这个偏好在环上求期望时自动抵消。用 $N$ 次比较同时拿到两个东西——一个粗排，和一个去掉了位置偏置的粗排。

然后按环上的平均偏好 $w_i / c_i$ 取 top-$k$ 当 pivot，剩下的候选只跟 pivot 比。成对偏好用 Bradley-Terry 模型（把两个候选的奖励差，映成「谁更优」的概率）从连续奖励转过来：

$$
P(\tau_i \succ \tau_j \mid x) = \frac{1}{1 + \exp\!\big(-(R(x,\tau_i) - R(x,\tau_j))\big)}
$$

总比较次数 $N + k(N-k) + \binom{k}{2}$。最后按 $w_i / c_i$ 取 argmax——**除以 $c_i$ 这步是必要的**，pivot 参与的比较天然比非 pivot 多，不归一化就有偏。

在 $N=20$ 的设定下（89 个任务，Terminus-2 harness），这套确实省钱：

| 方法 | 查询对数 | 准确率 |
|---|---|---|
| pass@1 | — | 52.64% |
| V1（3N 预算） | 4,200 | 65.62% |
| PPT $k$=3 | 4,723 | 66.17% |
| PPT $k$=5 | 6,609 | 66.27% |
| PPT $k$=9 | 9,630 | 67.13% |
| 全量 round-robin | 13,111 | 67.42% |

$k$=9 用 73% 的预算拿到 99.6% 的 round-robin 精度。

![Table 9：PPT 的预算-精度权衡。随 pivot 数增加准确率稳步上升，在明显更低的预算下逼近全量 round-robin。](/images/llm-as-a-verifier/table-9-ppt-budget-accuracy.png)

## 五、工程细节：prefix cache 从 5.2% 拉到 78.4%

这部分论文里没有，只在仓库的 0.2.0 更新日志里，但它是能不能真跑起来的关键。

Terminal-Bench 2.1 上每个验证 prompt 要塞**两整条轨迹，约 80k token**，而且要按评测准则 × 重复次数反复评。硬算的话 token 量根本撑不住。两个动作解决：

**1. 评测准则放在 prompt 尾部。** `build_prompt` 的注释写得很直白——任务、两条轨迹、评分量表全在前面，只有评测准则在最后变化。于是不同评测准则之间共享一个巨大的前缀：

```python
# Everything not specific to the criterion (task, both trajectories, rating
# scale) comes first; only the criterion varies at the tail.
# Keep criterion-specific text strictly at the end when editing.
```

**2. 先预热再扇出（fan-out 并发放量）。** 后端的 prefix cache 只在请求**返回后**才建立。所以调度时按 `(task, slotA, slotB)` 分组，每个不同前缀先跑一个请求跑完，剩下的再并发压上去：

```python
seen = set()
warm, rest = [], []
for job in jobs:
    prefix = job[7]
    if prefix in seen: rest.append(job)
    else: seen.add(prefix); warm.append(job)
run_phase(warm)
run_phase(rest)
```

两招合起来把命中率从 **5.2% 拉到 78.4%**，未命中的输入 token 少了约 3.4×。而且仓库带了 token 记账（`llm_verifier.token_usage()`），命中率是**实测**不是估的：

```
Verifier tokens (4,320 verifier calls)
  input                          272,551,552
    cached input                 214,712,320  (78.8% hit rate)
    uncached input                57,839,232
  output                          32,441,600
    reasoning                     26,102,144
```

跑一遍这个规模的验证是 **2.7 亿输入 token**——这个数字后面算成本时要用。

## 六、实验结果：涨在哪，涨了多少

主实验统一配置：$G$=20、$K$=8、三评测准则分解，训练无关，四个 benchmark 同一套框架不做任何域内微调。下表最后一列「headroom」指 Pass@1 到 Oracle 之间的距离，也就是「理论上还能再涨多少」：

| Benchmark | Pass@1 | Oracle | LLM-as-a-Verifier | 消化的 headroom |
|---|---|---|---|---|
| Terminal-Bench V2（GPT-5.5 Bo5, Capy） | 83.1% | 92.1% | **86.5%** | 38% |
| SWE-Bench Verified（Opus 4.5 / G3 Flash / M2.5 Bo3） | 76.1% | 84.4% | **78.2%** | 25% |
| MedAgentBench（Opus 4.8 Bo5, AgentBench） | 70.2% | 75.0% | **73.3%** | 65% |

![Table 3：各 benchmark 的基线模型准确率（左）与 Pass@1 / Oracle / 本方法（右）。三个域上都稳定超过 Pass@1，并吃掉相当一部分 oracle headroom。](/images/llm-as-a-verifier/table-3-per-benchmark-gains.png)

这张表左半边的基线准确率，论文脚注里交代了是**从 Terminal-Bench V2 和 SWE-Bench 官方 leaderboard 上摘的**，不是作者自己复跑的。这个口径后面算算力时要用。

![Table 8：跨 agent harness 的泛化。换掉生成轨迹的 harness 后增益依然成立，说明方法吃的不是某一套 harness 的特定格式。](/images/llm-as-a-verifier/table-8-harness-generalization.png)

SWE-Bench 那一行的设定值得单独说：候选池是**异构**的——Claude Opus 4.5、Gemini 3 Flash、MiniMax M2.5 各出一条。也就是说 verifier 在跨模型家族的候选之间做选择，而且选出来的组合（78.2%）比其中任何单个模型都高（76.8 / 75.8 / 75.8）。这是个比同模型 Bo5（Best-of-5，采 5 条轨迹挑最好）更有意思的结论：**verifier 可以当模型路由（router）用**。

**机器人域是最硬的一块**。RoboRewardBench 上输入是多帧视频，用 Qwen 3.6 35B 当 VLM verifier，零样本：

| 方法 | 偏好准确率 |
|---|---|
| LLM-as-a-Judge（离散，同一个 VLM） | 70.8% |
| TOPReward | 74.7% |
| Robometer-4B（~100 万对比较训练） | 78.8% |
| RoboReward-8B（~4.5 万 episode 训练） | 81.4% |
| **LLM-as-a-Verifier** | **87.4%** |

零样本打过在机器人数据上专门训练的 reward model 6 个点。而同一个 VLM 用离散 judge 只有 70.8%——**16.6 个点的差距全部来自「读分布而不是取 argmax」**。这是全文最强的单点证据，比代码域那几个点有说服力得多，因为它排除了「换了个更强的模型」这个混淆项。

![Table 4：RoboRewardBench 上的偏好准确率对比。零样本的 LLM-as-a-Verifier（87.4%）超过在机器人数据上专门训练的 RoboReward-8B（81.4%）与 Robometer-4B（78.8%），而同一个 VLM 走离散 judge 只有 70.8%。](/images/llm-as-a-verifier/table-4-roborewardbench-preference.png)

![Table 5：RoboRewardBench 上与人工标注的平均绝对误差。连续奖励 + K=8 把 MAE（平均绝对误差）从 1.11 降到 0.72。](/images/llm-as-a-verifier/table-5-roborewardbench-mae.png)

![Figure 10：机器人域上重复评估次数与偏好准确率的关系。连续 verifier 的曲线起点就高于离散 judge 的终点——$K$ 加到多少都补不上「取 argmax」丢掉的信息。](/images/llm-as-a-verifier/figure-10-repeated-evaluations-robotics.png)

**仓库里还有一个论文没写的结果**：Terminal-Bench 2.1 上让 `deepseek-v4-flash` 既当生成器又当**自己的** verifier。

| 配置 | Pass@1 | Verifier | Oracle |
|---|---|---|---|
| Best-of-3 | 79.4% | 86.5% ± 1.1% | 92.1% |
| Best-of-5 | 78.7% | **88.0% ± 0.6%** | 96.6% |

自验证涨 9.3 个点，消化一半 headroom。这比主实验里那些「用 Gemini 2.5 Flash 验 GPT-5.5」的跨模型配置更有工程价值——**不用引入第二个模型供应商**。可惜它只在 README 里，没进论文，也就没经过审稿。

**同一个奖励还能当 ORM（Outcome Reward Model，结果奖励模型）和 PRM（Process Reward Model，过程奖励模型）用**，这两组结果在附录里，但比主表更能说明方法的适用面。

当 ORM（只看最终结果，Best-of-N 里挑）时，相对 base model 的绝对提升是 SWE-Bench Lite +9.5、AIME +18.5、HMMT +21.3。这里的关键是**预算列**：pointwise（逐条单独打分）judge 花 $N$、V1 的 pairwise（成对比较）方案花 3 倍 $N$，本方法花 2 倍 $N$。也就是说在更小的验证预算下超过了 V1——不过要老实说，HMMT 上是 73.3 打平 73.3，只是预算更省。

![Table 11：作为 ORM 的 pass@1。Base / pointwise judge（$N$ 预算）/ pairwise V1（3 倍 $N$ 预算）/ 本方法（2 倍 $N$ 预算）的四行对比。AIME 从 71.5 到 90.0 是最大的一跳；HMMT 与 V1 打平在 73.3，胜在预算。](/images/llm-as-a-verifier/table-11-orm-pass-at-1.png)

当 PRM（每一步都验，从 $k$ 个候选动作里挑）时，pass@1 随每步采样数单调上升：TauBench 48.7 → 55.7（$k$=1 到 $k$=9），Terminal-Bench 49.8 → 54.3。注意这条曲线的形状和前面三条轴一样——$k$=3 就吃掉了大半增益，后面 6 档只换来 1.7 个点。

![Table 10：作为 PRM，pass@1 随每步采样动作数 $k$ 单调上升。TauBench（Gemini 2.5 Flash）48.7→55.7，Terminal-Bench（Gemini 3 Flash）49.8→54.3。同样是早期陡、后期平。](/images/llm-as-a-verifier/table-10-prm-scaling.png)

逐步验证对 agent 落地其实比 Best-of-N 更有意义——**Best-of-N 要等整条轨迹跑完才知道选哪条，逐步验证能在第 3 步就掐掉走偏的分支**。代价是验证调用次数从 $\mathcal{O}(N)$ 变成 $\mathcal{O}(\text{步数} \times k)$。

## 七、副产物：连续分数当进度条

同一个奖励可以只喂前缀 $\tau_{1:t}$，得到一条逐步的进度曲线。论文用 Value-Order Correlation（步骤序号与分数的 Spearman 相关）来量化：

![Figure 8：pytorch-model-cli 任务上两条 Terminus-2 轨迹的进度曲线。成功那条沿着 Read model.py → 装 g++ → 装 CPU-only torch → 改 hidden_dim → DONE 单调上升；失败那条多装了 torchvision 撑爆磁盘、撞上编译错误，分数全程压在低位。](/images/llm-as-a-verifier/figure-8-code-progress-correlation.png)

机器人域的 VOC 差距拉得很开：LLM-as-a-Verifier 0.966，RoboReward-8B 0.877，Robometer-4B 0.780，TOPReward 0.565。TOPReward 的问题论文里点破了——它会几乎立刻饱和到 $P(\text{True})=1.0$，然后就**失去了区分中段进度的能力**。对分布求期望天然不会这样。

![Table 7：RoboRewardBench 500 条轨迹上的 Value-Order Correlation。饱和型 reward model（TOPReward 0.565）与连续期望奖励（0.966）之间差了 0.4——中段分辨率是拉开差距的地方。](/images/llm-as-a-verifier/table-7-voc-roborewardbench.png)

仓库把这个能力做成了在线接口，`ProgressTracker` 只喂到当前步，看不到未来：

```python
tracker = llm_verifier.ProgressTracker(problem, n_evaluations=4)
score = tracker.update('Read the problem statement')            # 0.00002
score = tracker.update('Wrote def rev(s): return s')            # 0.00013
score = tracker.update('Changed to def rev(s): return s[::-1]') # 0.73938
score = tracker.update('Tested: rev("abc") returned "cba"')     # 0.98604
if score < 0.05:      # 早停一条没救的 rollout
    ...
```

进度 prompt 里的**反作弊校准规则**是整个仓库里最值得抄走的东西，它把「怎么判断 agent 是真做完了还是在自我感觉良好」写成了可执行的 rubric。先注意一个容易卡住的点：**进度量表的方向和第三节成对奖励那边是反的**——A = 0%、T = 100%（源码注释专门标注了 inverted relative to the pairwise reward scale），否则下文会读不通：

- 「努力、探索、步数、听起来很自信的叙述**都不是进度**。跑了 20 条命令还没产出正确输出的，该给接近 A 的分。」
- 「**默认怀疑**。隐藏的 grader 你看不到。没有真实验证步骤的结果不该超过 ~K（中段 uncertain 区），就算看起来验证过了也很少该超过 ~R（后段 leans-YES 区）。」
- 「把 agent 的散文式声明（『done!』『all tests pass』）当成**零证据**。」

还有一条对齐了失败模式的期望形态：走对路的分数从 A（0%）涨向 T（100%）；**认死了一个错方案的应该在错误产物落地后走平**；出现回退的应该下降。

## 八、当 RL 的稠密奖励（dense reward）

进度信号还能顺手解决信用分配（credit assignment）问题——一条长轨迹里到底哪一步对最终成功有贡献。两个设定：

- **off-policy（离线策略，训练样本来自旧的 rollout）**：$\pi_0$ VLA（Vision-Language-Action）模型在 LIBERO ketchup 任务上用 DSRL-SAC 微调，rollout 结束后查 verifier 拿逐步进度 $\rho_t$，按 $r_t = r_t^{\text{env}} + \lambda \rho_t$（环境奖励 + 进度奖励）给 replay buffer 里的样本重新打标签（relabel）。样本效率 **≈1.8×**，最终成功率 0.76 vs 0.69。
- **on-policy（在线策略）**：Qwen3-8B 在 MATH 上跑 GRPO。这里的动机很具体——**训练早期整组回答全错，group-relative advantage（同一批回答内部的相对优势）塌成 0，没有梯度**。用 verifier 给推理过程本身打一个连续偏好分，即使最终答案都一样也能区分推理质量。样本效率 ≈1.1×。

![Figure 9：RL 样本效率。左：LIBERO 上 π₀ + DSRL-SAC，dense verifier reward 用约 1.8× 更少的环境步达到同等成功率，最终成功率也更高。右：MATH 上 Qwen3-8B + GRPO，提升约 1.1×。](/images/llm-as-a-verifier/figure-9-rl-sample-efficiency.png)

1.8× 那个数字有说服力（机器人环境步数是真金白银），1.1× 就比较边缘了——论文自己写的是「a smaller but consistent gain」，态度还算诚实。

## 九、专家点评

### 真正的贡献

**一、把「LLM 内部有连续信念，只是被 argmax 扔了」这件事量化到了可复现的程度。** 88/100 → 0/100 的平局率变化，和机器人域上同一个 VLM 从 70.8% 到 87.4% 的跳变，是两个干净的对照实验。这个洞察不新（form-filling / probability-based evaluator 那条线早就有），但把它推到长程 agentic 轨迹上、并且证明能零样本打过专门训练的 reward model，是实打实的推进。

**二、ring pass 这个设计。** 用 $N$ 次比较同时完成粗排和位置去偏，比「每对都正反各评一次」省一半，也比随便挑 anchor 讲得通。这是全篇最优雅的一小步。

**三、prefix cache 那套工程。** 评测准则放尾部 + 预热再扇出，5.2% → 78.4%。这类东西通常不会写进论文，但它决定了方法能不能真跑在 80k token 的轨迹上。仓库还带实测 token 记账，成本可以直接复算。

### 被高估的部分

**一、「scaling 轴」这个框架名不副实——论文自己的图就在说这件事。** 看 Figure 4 的实际数字：粒度 $G$ 从 1 到 20，73.1% → 77.5%，但 $G$=8 就已经 75.9%，后面 12 档只换来 1.6 个点；重复评估 $K$ 从 1 到 16，74.7% → 77.5%，$K$=4 时已经 76.1%；评测准则分解从最好的单评测准则 76.4% 到集成 78.3%，1.9 个点。三条轴都在很早就压平，天花板齐刷刷卡在 78% 附近。

![Table 12：重复评估 $K$ 对准确率与平局率的影响，离散 judge 与连续 verifier 分列两组。连续那一栏平局率从头到尾是 0，准确率随 $K$ 的爬升幅度则很有限——加 16 倍算力换 2.8 个点。](/images/llm-as-a-verifier/table-12-repeated-evaluations-k.png)

把它跟 pre-training scaling 并列（Figure 3 就是这么画的）是过度推销。**这是三个收益递减的调参旋钮，不是一条 scaling law。** 论文在 4.2 节承认了 $K$ 的边际递减（「correlated biases on harder examples」），但没有把同样的诚实用在整体叙事上。

![Figure 3：论文的四范式流转图——Pre-training Scaling → Post-training Scaling → Test-time Scaling → Verification Scaling。摆成并列的四个阶段，是这篇论文叙事上最激进的一步，也是最该打折看的一步。](/images/llm-as-a-verifier/figure-3-scaling-paradigms.png)

**二、SNR 的因果链站不住。** 论文用信噪比解释粒度为什么有用，$G$=1 → 20 时 SNR 从 0.775 涨到 0.799。这是 **3% 的相对增幅**，却要拿来解释 4.4 个点的准确率提升。文中只说了「准确率是 SNR 的单调函数」，没给推导也没给拟合。

![Table 1：SNR 的定义式与 $G \in \{1, 4, 16, 20\}$ 下的实测值。整条 20 倍粒度提升换来的 SNR 变化是 0.775 → 0.799，用它去解释 4.4 个点的准确率提升，中间缺一整段论证。](/images/llm-as-a-verifier/table-1-signal-to-noise-ratio.png)

真实机制更可能就是简单的「平局被打破了」——从 Figure 7 看，judge 在 $K$=1 时 26.7% 平局，verifier 是 0%，光是把平局按真实倾向拆开就能解释大部分增益。SNR 这一节像是事后补的理论包装。

![Figure 7：连续 verifier 与离散 judge 在 $K \in \{1, 4, 16\}$ 下的对比。右图的平局率是关键——judge 在 $K$=1 时 26.7% 打平，连续 verifier 全程 0.0%。这张图比 SNR 那一节更能解释增益从哪来。](/images/llm-as-a-verifier/figure-7-verifier-vs-judge.png)

**三、榜单对比的算力口径不对等。** Terminal-Bench V2 上「86.5% 新 SOTA」是 GPT-5.5 跑 5 条轨迹 + 验证得到的，对比对象是榜单上的**单次**成绩（GPT-5.5 + NexAU-AHE 84.7%）。生成侧就贵了 5×，验证侧还要再叠 2.7 亿 input token。论文老实报了 Pass@1 83.1% 当自己的基线（这点要肯定），但「setting a new state of the art」的措辞放在一个算力高一个数量级的配置上，是在借榜单的话术。**公平的读法是：+3.4 个点，代价是 5× 生成 + 验证开销。**

**四、20 级粒度是名义粒度，语义档位只有 8 个。** 这条要读代码才能发现。`SCALE` 的量表说明是这么分的：

```
A = clearly and completely succeeded ...
B-D = succeeded with only minor issues
E-G = above average, mostly correct
H-J = uncertain, leans toward success
K-M = uncertain, leans toward failure
N-P = below average, significant issues
Q-S = failed with some partial progress
T = clearly and completely failed
```

**8 个语义档，摊到 20 个字母上。** 模型完全没有被告知 B 和 C 和 D 该怎么区分。所以 $G$=20 里真正承载语义的是 8 档，剩下的分辨率靠「模型在同一档内部的字母偏好」这种没有语义依据的东西，最后由期望运算平滑掉。进度追踪那边更极端——A / B-G / H-M / N-S / T，**5 档摊到 20 个字母**。

这解释了为什么 $G$ 这条轴在 8 附近就开始饱和：那大概就是语义档位数本身。论文把「粒度」当成一个纯数值旋钮来 scaling，但没检查这个旋钮的有效行程。

**五、PPT 在论文的主实验配置下并不省钱。** 比较次数是 $N + k(N-k) + \binom{k}{2}$。代入主实验的配置：

- Terminal-Bench / MedAgentBench，$N$=5、$k$=2（仓库默认）：$N + k(N-k) + \binom{k}{2} = 12$ 对，而全量 round-robin 是 $\binom{N}{2} = 10$ 对；
- SWE-Bench，$N$=3、$k$=2：同一个式子给出 6 对，round-robin 只要 $\binom{N}{2} = 3$ 对。

去掉环上与 pivot 轮重复的有向对之后，实际 API 调用会少几次，但量级就是这样：**在 $N$=3 和 $N$=5 这两个产出所有头条数字的配置上，PPT 的成本和全量 round-robin 持平甚至更贵。** 它真正的预算优势只在 Table 9 的 $N$=20 上体现（6,609 vs 13,111 对）。

也就是说，论文的第二项贡献（cost-efficient ranking）和第一组结果（四个 benchmark SOTA）**几乎没有交集**。这不算造假——PPT 在 $N$ 大时确实有效——但读者很容易以为头条成绩是靠 PPT 省下来的。

**六、进度追踪的判别力被 Figure 8 的漂亮曲线掩盖了。** Table 6 的数字是：成功轨迹 VOC 0.848，失败轨迹 0.769，**gap 只有 0.079**。

![Table 6：按轨迹最终成败分组的 Value-Order Correlation。表里自带一行 `Success − Failed (gap)`，值是 0.079——论文把它当成「失败轨迹相关性更弱」的证据，但 0.769 本身就是一个很强的单调相关。](/images/llm-as-a-verifier/table-6-value-order-correlation.png)

论文的措辞是失败 rollout「correlation 更弱，说明进度有限或不一致」。但 0.769 本身是一个相当高的单调相关——意思是**失败的轨迹上，verifier 分数也在稳步往上爬**。那么 VOC 就不是一个能用来早停的信号。

真正有判别力的是**分数的绝对水平**（Figure 8 里失败那条全程压在低位），而这恰恰是论文**没有系统评估**的东西。仓库的 `ProgressTracker` 示例写着 `if score < 0.05`，但这个阈值从哪来、在多大误报率（FPR）下能抓住多少漏报（FNR）、跨任务稳不稳，全文没有一条 ROC 或 PR（精确率-召回率）曲线。Figure 8 是**单任务、单对轨迹**的案例图。

要拿这个做真机早停，阈值得自己重新标。

### 代码与论文的出入

拆代码时对出了三处，都不致命，但复现时会撞上：

**一、主实验的 $K$ 对不上。** 论文 5 节写「$K$=8 repeated evaluations」，但 `benchmarks.py` 里的默认是 `n_evaluations: int = 4`，`select()` 的签名默认也是 4，`terminal_bench_2.1` 那条更是 `n_evaluations=2`。按仓库脚本跑出来的不是论文配置。

**二、Algorithm 1 减了环上的对，代码没减。** 论文伪代码第 13 行明确写了 $\mathcal{E}_{\text{piv}} \leftarrow \{\dots\} \setminus \mathcal{E}_{\text{ring}}$，但 `pivot_round_pairs()` 里没有这个差集：

```python
pairs = [(i, p) for i in non_pivots for p in pivots]
pairs += list(combinations(sorted(pivots), 2))
return pairs
```

而 `select()` 里是 `accumulate(ring, ...)` 之后再 `accumulate(pr_pairs, ...)`。环上那些恰好也是「非 pivot → pivot」的有向对会被**计入 $w_i, c_i$ 两次**。因为最后除以 $c_i$，影响被摊薄了，但这不是论文描述的算法。

**三、静默降级成 0.5。** `on_error="tie"`（默认）把失败的 verifier 调用记成 0.5/0.5；`extract_score` 找不到 logprob 时也返回 0.5。两处都合理，但都不出声。跑大规模复现时如果后端在限流，你会得到一批看起来正常、实则全是平局的分数。建议复现时先用 `on_error="raise"` 跑一小批确认链路通了再切回来。

另外 `compare()` 的 `n_evaluations` 默认是 1，也就是**单次有向调用、完全不做位置去偏**——docstring 里诚实标注了这点，但 quickstart 的示例代码直接这么用，容易误导。

## 十、对 APP 自动化测试 / Mobile QA 的启发

这篇的方法论对移动端自动化测试是高度可搬的，因为 mobile QA 的核心痛点恰好就是**判定标准（test oracle）太弱**：断言要么写死成脆弱的元素匹配，要么只能靠人工看录屏。

**一、把二元断言换成连续可疑度，用来排人工复核队列。** 现在的回归测试结果是 pass/fail 两档，中间那一大坨「跑完了但不确定对不对」的 case 只能全量人工过。改成让一个 VLM verifier 对「这次执行是否满足用例意图」给 0–1 的连续分，然后**按分数排序复核队列**——这比二元断言的信息量高得多。query-optimize 那个案例的教训直接适用：让模型打 1–5 分，你会得到一堆 5 分；读分布，你会得到可排序的怀疑度。

**二、评测准则分解直接对应移动端的三层断言。** 论文对代码 agent 的拆法（Specification / Output Match / Error Signal）几乎可以一对一映射：

| 论文评测准则 | 移动端对应 | 观测源 |
|---|---|---|
| Specification Adherence | 用例意图是否达成（到了目标页、单提交成功、状态变更） | UI 层级 / 业务态 |
| Output Match | 关键界面元素与预期**逐字段**比对（金额、订单号、文案） | 截图 + UI dump / 接口返回 |
| Error Signal | crash / ANR / 未捕获异常 / 网络 5xx / 权限拒绝 | logcat / crash 上报 / 抓包 |

分开问三次比合起来问一次准（78.3% vs 76.4%），而且**归因清楚**——失败时你知道是没走到还是走到了但数据不对还是路上报错了。这对自动化测试比一个总分有用得多。

**三、仓库里那句「以终端输出为金标准（ground truth）」的提示，值得刻在每个 LLM 裁判的 prompt 里。** `criteria/terminal_bench.md` 开头是：

> **IMPORTANT:** Focus on TERMINAL OUTPUT as ground truth. Do NOT trust the agent's self-assessment or claims of success. Agents often claim success when the terminal shows errors.

移动端的对应版本：**只信设备上可观测的东西**（UI dump、截图、logcat、抓包、埋点），**不信 agent 自己说「我点成功了」**。GUI agent 的自我报告乐观偏差是所有做过 mobile agent 评测的人都撞过的墙，这条 prompt 是廉价且有效的对冲。

配合进度 prompt 里那三条反作弊规则（努力不是进度 / 默认怀疑 / 散文声明是零证据），基本可以直接组装出一份 mobile QA 的 LLM oracle rubric。

**四、prefix cache 那套优化在移动端收益更大。** Terminal-Bench 的轨迹约 80k token，而移动端轨迹要带**截图序列 + UI 层级 XML**，单条轻松更长。把评测准则放 prompt 尾部、任务和轨迹放前面、先预热一个请求再扇出——这个改动几乎零成本，命中率的提升是数量级的。做 GUI agent 评测流水线的话这是必抄项。

**五、早停能省真机机时，但阈值必须自己标。** `ProgressTracker` 的在线接口对真机测试很有吸引力——一个用例跑到第 15 步已经明显走偏，早停能省下后面几分钟的设备占用。但前面说了，论文没给早停的判别力曲线，成功/失败的 VOC 只差 0.079。落地路径应该是：先拿一批已知成败的历史轨迹离线跑分，画出自己场景的 ROC，选一个能接受的 FPR 再上线。**不要直接抄 `score < 0.05`。**

**六、成本要先算清楚。** 2.7 亿 input token 跑一轮验证，这个量级在移动端会更高（图像 token）。落地时的取舍顺序建议是：先上 $C$（评测准则分解，成本线性但收益最明确），再上 $K$（$K$=2 就足以抵消位置偏置，往上收益递减快），$G$ 反正是免费的（同一次调用里读 logprob）。$N$ 的选择要算清生成侧成本——异构候选池（不同模型各出一条）比同模型多采几条更划算，SWE-Bench 那一行就是证据。

**七、位置偏置这个坑要记住。** 两条候选轨迹做成对比较时，LLM 对 A 位有系统偏好。最省的对冲是 $K$=2 且第二次交换 slot（仓库就是这么做的：`swap = rep % 2 == 1`）。如果你只评一次，那你测的一部分是「哪条被放在前面」。

## 十一、总结

这篇论文的技术内核可以压缩成一句话：**LLM 打分时的内部信念是连续的，取 argmax 会把它扔掉，别扔。** 证据链最硬的两处是 query-optimize 上 88/100 的平局率归零，和 RoboRewardBench 上同一个 VLM 从 70.8% 到 87.4% 的跳变——后者尤其干净，因为它把「换更强模型」这个混淆项排除掉了。

但「验证是第四条 scaling 轴」这个包装要打折看。三条轴的实测曲线都在 $G$≈8、$K$≈4 附近走平，天花板卡在 78%；20 级粒度里只有 8 个语义档；PPT 的省钱效果在论文自己的主实验配置（$N$=3/5）下并不存在，只在 $N$=20 时成立；进度追踪的成功/失败 VOC 只差 0.079，用来早停需要自己重标阈值。这是一套**收益递减但确实有效的调参旋钮**，不是一条 scaling law。

对做 APP 自动化测试的人，最值得搬的不是那几个榜单数字，而是三样东西：**评测准则分解的三层结构**（规格 / 输出 / 错误信号）、**「只信可观测输出、不信 agent 自述」的 ground truth note**，以及 **prefix cache 那套把长轨迹验证跑起来的工程手法**。这三样都不需要复现论文，明天就能用。

## 十二、参考链接

- 论文：[LLM-as-a-Verifier: A General-Purpose Verification Framework](https://arxiv.org/abs/2607.05391)（arXiv:2607.05391v2, 2026-07-07）
- 代码：[github.com/llm-as-a-verifier/llm-as-a-verifier](https://github.com/llm-as-a-verifier/llm-as-a-verifier)（MIT，`pip install llm-verifier`）
- 文档与主页：[llm-as-a-verifier.com](https://llm-as-a-verifier.com)
- Claude Code 插件 TurboAgent（LLM API 代理 + 可视化）：[github.com/llm-as-a-verifier/TurboAgent](https://github.com/llm-as-a-verifier/TurboAgent)
- 关键源码入口：`llm_verifier/fine_grained_reward.py`（奖励与 logprob 提取）、`llm_verifier/pivot_tournament.py`（PPT）、`llm_verifier/progress.py`（进度追踪与反作弊 rubric）、`criteria/terminal_bench.md`（评测准则分解范例）
</content>
</invoke>
