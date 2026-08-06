---
title: "SeedRealtime 不是 CUA 基模，但它把 GUI Agent 的 0.15 Hz 盲采样摆上了台面"
description: "字节 Seed 8 月 5 日发布 SeedRealtime，原生音视频全双工大模型，豆包 App 全量上线。官方页面里「屏幕」「GUI」「agent」出现次数都是 0，唯一的量化说法是一句没有样本量、没有基线、没有盲测的「节奏问题减少一半」。把这次发布放进全双工的技术谱系里，再对照 CUA 那条 6.51 秒的观测-动作间隙和 567 毫秒的响应窗，能看清一件更值得讨论的事：连续感知在语音侧已经量产，在 computer use 侧连一个会因为反应慢而判失败的 benchmark 都还没有。"
date: "2026-08-06"
tags: ["GUI Agent", "Computer Use", "Full-Duplex", "Streaming Perception", "Multimodal", "Mobile QA"]
draft: false
featured: false
readingTime: 24
---

8 月 5 日字节 Seed 发布 SeedRealtime，原生音视频全双工大模型，同日在豆包 App 全量上线。发布之后的一两天里，中文技术社区出现了一种说法：这是字节的 CUA（computer-use agent）基座模型。

这个说法大概率来自英文版博客的一处翻译。ResNet 论文那个 demo，中文原文写的是模型「在快速翻页的过程中持续观看画面」，英文版译作 "it keeps watching the **screen** as the pages flip quickly"。「画面」在这里指的是摄像头拍到的画面——用户举着手机翻一篇论文——译成 screen 之后，读起来就成了模型在盯着屏幕。

官方中文页面里，「屏幕」出现 0 次，「摄像头」0 次，「GUI」0 次，「智能体」0 次，「Agent」0 次，「Computer Use」0 次。英文页 `agent` 0 次、`computer` 0 次。**SeedRealtime 和 computer-use agent 之间不存在任何官方连接，把它当成 CUA 基模是个误会。**

但这次发布对 CUA 领域仍然有讨论价值，只是价值不在它宣称了什么，而在它顺手暴露了一件事：**「持续感知世界、自己决定什么时候开口」这套东西，在语音侧已经做到了上亿 DAU 应用的默认开启；而在 computer use 侧，agent 至今还在用「截图→思考→动作」的回合制轮询，并且整个领域连一个会因为反应太慢而判任务失败的 benchmark 都没有。**

![左侧是传统回合制流式交互：视频与音频被切成离散的轮次，模型在一个轮次里接收完整输入、生成完整输出，两个轮次之间存在明确的边界与等待；右侧是全双工流式交互，视频帧与音频块连续进入，模型的理解与生成在同一条时间轴上并行推进，输出可以在输入尚未结束时开始，也可以被新进来的输入打断。这张图定义了本文讨论的全部分歧所在——CUA 目前整体处在左边，而语音多模态已经整体迁移到了右边](/images/seedrealtime-full-duplex-cua/fig-turnbased-to-fullduplex.png)

## 官方到底说了什么，以及没说什么

先把可引用的事实钉住，因为后面所有判断都建立在这上面。

关于 VAD（语音活动检测），官方博客全文只有两句。第一句描述行业现状：「端到端模型虽更流畅，但不少方案仍依赖外置 VAD 判断轮次，本质上仍接近一问一答的半双工交互。」第二句描述自己：「轮次判断不再交给外部 VAD 规则，而由 SeedRealtime 基于多模态信息持续决策：该接话时不迟疑，该沉默时不打断。」

注意措辞。官方说的是「不再交给外部 VAD 规则」，**没有说去掉了 VAD 模块，也没有说不用 VAD**。项目主页那段博客正文里没有的「技术实现」里，VAD 一词根本没出现，全段只有三个技术词：「连续音视频分块输入」「流式生成输出」「高效量化与推理优化」。没有一个配置参数。

唯一的量化说法是这一句：「端到端人工评测结果显示，相比级联模型，SeedRealtime 的音视频对话节奏问题减少了一半。」

这句话里，样本量未披露，评测员人数未披露，是否盲测未披露，「节奏问题」的操作化定义未披露，对比基线是谁——全文只有「级联模型」四个字。参数量、首响延迟、端到端延迟、任何公开 benchmark 分数、API 计划、开源计划，全部没有。中英文页面加起来，`%` 出现 0 次，「毫秒」「ms」0 次，`benchmark`、`SOTA`、`准确率` 各 0 次。没有技术报告，没有 arXiv 条目，没有模型卡；arXiv API 检索 `all:SeedRealtime` 返回 0 条。Seed 博客列表页会区分「模型发布」和「研究成果」两个分类，SeedRealtime 只有前者。

**这不是一篇技术披露，是一篇体验向的产品公告。**

更能说明问题的是纵向对比。同一个团队 2026 年 4 月 9 日发布纯语音的 Seeduplex 时，官方博客给了一整排数字：判停 MOS 提高 8%、对话流畅度 MOS 提升 12%、判停延迟降低约 250ms、AI 抢话比例相对减少 40%、打断响应延迟缩短约 300ms、整体通话满意度绝对值提升 8.34%，还附了两张对比评测图和一条「人人对话」基准线。**四个月后，同一团队做了更难的音视频版本，公开的数字从六个变成了一个，而且那一个还没有方法学。**

这个方向不对。领域里正在发生的事情是，模型越强、落地越广，技术披露反而越薄——因为披露的收益（学术声誉）在下降，成本（竞品对齐、监管口径、内部对齐）在上升。作为读者能做的只有一件事：**把「厂商自评、方法未披露」这个限定语，硬性绑定在每一次引用「减少一半」的场合。**

## 全双工不是一个开关，是一条有层级的谱系

「全双工」这个词现在被用得很松。严格讲它是一条谱系，从单工、半双工、伪全双工（时分复用，本质上还是轮流，只是切换得快）到真全双工。真全双工的判据不是「能同时说和听」，而是**认知层面的并行**：模型在生成的同时，其内部状态仍在被新输入持续更新，并且这种更新能反过来改变正在进行的生成。

近期的综述工作把实现路径分成 L0 到 L3 四层。L0 是模块级——外挂一个 VAD 或打断检测器，主模型本身还是轮次制；L1 是隐状态级——把输入流编码进隐状态，让模型在生成时也能感知；L2 是 token 级——输入和输出在同一个 token 序列里交错，模型每一步都同时消费输入 token 和产出输出 token；L3 是表征级的完全统一，目前还没有系统真正做到。

SeedRealtime 说自己「不再交给外部 VAD 规则」，按字面理解至少是 L1 起步。但没有架构图、没有 token 布局、没有推理配置，**它到底落在 L1 还是 L2，从公开信息里无法判定**。这不是吹毛求疵——L1 和 L2 在打断延迟和上下文成本上差着一个量级，工程选型时这是第一个要问的问题。

![Moshi 的整体架构。左侧用户音频经 Mimi 神经音频编解码器（24kHz 输入、12.5Hz token 流）编码进入 RQ-Transformer：Helium 时序骨干处理跨步的时间上下文，Depth Transformer 在每一步内部生成语义与声学 token。关键在中间那三条并列的流——User's audio input、Moshi's audio output、Inner Monologue（时间对齐的文本 token）在同一条时间轴上多流并行建模，模型在生成自己音频的每一步都同时在消费用户的音频。这是 2024 年就已公开的 L2 级 token 级全双工，也是判断后来所有全双工系统「新在哪里」的基准线](/images/seedrealtime-full-duplex-cua/fig-moshi-overview.png)

Moshi 这张图值得放在最前面，因为它划定了一条时间线：**token 级全双工的技术可行性在 2024 年就被公开证明了。** SeedRealtime 的新意不可能是「证明这件事能做」，只能是「证明这件事能在什么规模、什么成本下做」。这个区分很重要，下面还会回到。

![MiniCPM-o 4.5 的端到端全模态架构。自下而上：视频流与音频流经多模态编码器变成交错的 V/A 嵌入，进入 Full-Duplex Omnimodal LLM；LLM 每一步的输出既有 token 也有 hidden state，token 分三类——Silent Token（图中 sl，表示这一步选择不说话）、Speak Token（sp，表示开始/继续说话）、Text Token（实际内容）；hidden state 直接喂给 Interleaved Speech Token Decoder 和 Streaming Flow Matching Decoder 产出音频。横轴是真实的 0.0 到 4.0 秒时间轴。这张图把「说不说话」明确建模成了一个每步都要做的 token 级决策，而不是外挂模块的二值门控——这正是「不再交给外部 VAD 规则」在架构上应该长的样子](/images/seedrealtime-full-duplex-cua/fig-omnimodal-architecture.png)

Silent/Speak token 这个设计是理解全双工的关键。传统 VAD 是一个纯声学的二值门：有人声/没人声。它表达不了「我听见了，但现在不该我说话」这种状态——而这恰好是人类对话里最常见的状态。把它变成 token 级决策之后，「保持沉默」成了模型主动选择的一个动作，可以被训练、被奖励、被上下文影响。SeedRealtime demo 里那两个「不被背景对话带偏」的场景（大兴机场同伴闲聊、亲子英语里爸爸在接电话），要做对，靠的就是这一层能力。

![DuplexOmni 的双层架构。下层是 Interaction Layer，以固定的高频节奏持续消费输入流并输出轻量的控制决策（是否接话、是否打断、是否保持沉默）；上层是 Thinking Layer，只在被 Interaction Layer 唤醒时才做重推理并生成内容。两层共享表征但运行在不同的时间尺度上。这个「高频轻决策 + 低频重推理」的分层，是全双工在算力上唯一可行的形态——如果每一帧都跑完整推理，成本会直接压垮部署](/images/seedrealtime-full-duplex-cua/fig-duplexomni-two-layer.png)

这个双层结构后面还会用到——它是本文认为最值得搬进 CUA 的东西。

## 字节自己五个月前就把话说完了

SeedRealtime 这次没有技术披露，但字节并非从来没披露过。Seed1.8 的模型卡（arXiv:2603.20633）比 SeedRealtime 早五个月，里面把连续感知这套东西讲得清清楚楚。

![Seed1.8 模型卡 Figure 9：流式视频交互的示意。模型以 1 FPS 持续消费视频流，同时进行生成。图中三种状态图标分别代表：说话气泡（正在输出）、思考脸（在看但选择不响应）、灯泡（被视觉事件触发的主动响应）。原文明确写着模型「processes a continuous video stream at 1 FPS while simultaneously generating responses」，并且「the model's response generation could be preempted」——生成过程可以被新进来的帧打断。这三件事——连续流式、视觉事件触发的主动响应、生成可被抢占——正是 SeedRealtime 官方博客用自然语言描述的那三条能力，只不过这里有图、有帧率、有明确的抢占语义](/images/seedrealtime-full-duplex-cua/fig-seed18-streaming-loop.png)

把这张图和 SeedRealtime 的三大能力（音视频联合理解、主动的交互能力、流畅的交互节奏）对一遍，会发现是一一对应的。**SeedRealtime 在能力叙事上没有超出 Seed1.8 模型卡已经公开的范围，超出的部分在于它是一个产品，跑在豆包里，默认开启。**

![Seed1.8 在公开视频理解 benchmark 上的成绩，对比 Gemini 2.5 Pro / Gemini-3-Pro / Seed-1.5-VL。注意最下面 Streaming 分组的最后两行：StreamingBench† 68.0→84.4，OmniMMI† 49.5→53.0，其中 † 号在表头注释里明确定义为「evaluated in a proactive manner」——以主动响应的方式评测。也就是说，字节不仅有主动流式能力，还有对应的评测口径和分数。这两行数字的存在，让「全双工音视频没有 benchmark 可跑」这个说法很难成立](/images/seedrealtime-full-duplex-cua/table-seed18-streaming-bench.png)

这张表把问题挑明了：**评测口径是现成的，字节自己五个月前就用过，SeedRealtime 一个都没跑。**

## CUA 的问题不是「半双工」，是 0.15 Hz 的盲采样

现在把视线转到 computer use。

有一种流行的类比是「CUA 现在处于半双工阶段，等它变成全双工就好了」。这个类比是错的，而且错得会误导技术选型。半双工至少还是双向的，只是不能同时。CUA 的实际状态更接近**单向的低频盲采样**：agent 截一张图，然后闭上眼睛，在这期间世界继续变化，等它睁眼时看到的是一个新世界，但它刚刚做的决策是基于旧世界的。

用采样率来量化更直观。OSWorld-Human 的测量显示，CUA 端到端任务时间里 75% 到 94% 花在 LLM 调用上。一次「截图→推理→动作」的完整回合在真实任务里普遍要 5 到 7 秒。**换算成采样率大约是 0.15 Hz。**

0.15 Hz 意味着什么？意味着任何变化周期短于 13 秒的 UI 现象，在采样意义上都是混叠的——agent 不是看不清，是**在原理上无法把它和别的东西区分开**。一个 3 秒后自动消失的 toast、一个 2 秒的加载态、一个 5 秒后过期的验证码提示，对 0.15 Hz 的采样器来说都不是「难看清的东西」，而是「不存在的东西」。

![TOCTOU 论文 Table 1：CUA 观测-动作间隙的实测数据。在真实 OSWorld 环境上测得的平均观测到动作间隙为 6.51 秒。这个数字不是模拟、不是理论上界，是跑真实任务量出来的。6.51 秒的间隙意味着 agent 每一次点击，点的都是 6.51 秒前那一帧屏幕上的坐标](/images/seedrealtime-full-duplex-cua/table-observation-action-gap.png)

![TOCTOU 漏洞窗口的时间轴。T_obs（0.0s）agent 截取屏幕 I；T_trigger（1.0s）攻击者注入一次 UI 状态变更；T_verify（约 6.4s）中间件 PUSV 重新校验 UI 状态；T_act（6.5s）物理点击 (x,y) 被派发。中间那段被标为 THE TOCTOU VULNERABILITY WINDOW 的红色区间，就是 agent 闭着眼睛的那 6.51 秒。这篇论文关心的是安全——攻击者可以在窗口内把按钮换掉；但同一个窗口在没有攻击者的情况下同样存在，只不过换按钮的是应用自己](/images/seedrealtime-full-duplex-cua/fig-toctou-window-timeline.png)

安全研究把这个间隙叫 TOCTOU（time-of-check to time-of-use）漏洞窗口，这是个准确的命名。但对做自动化测试的人来说，更重要的是这个窗口在**没有攻击者**的日常场景里同样存在：弹窗、异步加载、动画过渡、A/B 实验的动态渲染，都会在这 6.51 秒里改变屏幕。agent 点空、点错、点到刚刚移位的元素，大部分不是 grounding 精度问题，是这个窗口的问题。

这一点在本站之前几篇里反复出现过：[LivingScreen](/blog/2026-06-15-livingscreen-dynamic-gui-agent-benchmark/) 用动态界面把静态 benchmark 上的高分打回原形，[VeriGUI](/blog/2026-06-05-verigui-action-effect-verification/) 测到 72.3% 的失败与超时相关。**这些现象一直被分散归因到「grounding 不准」「模型能力不足」上，但它们共享同一个根因：采样率太低。**

## 567 毫秒：反应式循环在结构上打不过的那条线

如果 6.51 秒只是「慢」，那加钱换更快的模型就能解决。问题在于有一条线，反应式循环在结构上就跨不过去。

![反应式 agent 循环的关键路径分解。从环境事件发生，到 agent 观测、编码、推理、解码、动作派发、环境生效，每一段都有不可压缩的成本。图中标出的 600ms 争议窗口是这条关键路径在最优情况下的量级——低于这个窗口的响应需求，反应式循环无法满足，不是因为模型不够聪明，是因为路径上的每一段都需要时间](/images/seedrealtime-full-duplex-cua/fig-reactive-critical-path.png)

![真实世界中有文档依据的响应窗口，对数横轴。从左到右：BIOS 快速启动的 F2/DEL 按键窗口、街霸三代的格挡帧、Android 双击间隔、Windows 双击默认阈值、Android 长按阈值、Android Toast SHORT/LONG、Flutter SnackBar、MUTCD 行人绿灯间隔、Material 3 snackbar、Bootstrap 5 toast、Windows 11 横幅、GRUB 菜单、iOS 通知横幅、ALKS 接管、WCAG 2.2.1 响应下限、TOTP 时间步、Duo Push 审批、OpenSSH LoginGraceTime。竖直虚线是实测的反应式 p50：567ms 和 730ms。阴影带以下，反应式循环在结构上被排除；带内，胜负未定；比带高出一个数量级，才算充裕。落在阴影带左侧和带内的那一整批——双击、长按、Toast、SnackBar——恰好是移动端 UI 里最常见的瞬时反馈](/images/seedrealtime-full-duplex-cua/fig-response-windows-logscale.png)

这张图值得对着自己的产品逐条看一遍。它把「agent 反应慢」从一句主观抱怨，变成了一份可以核对的清单。**Android Toast SHORT 大约 2 秒、Flutter SnackBar 默认 4 秒、Windows 双击默认 500 毫秒——这些都不是极端情况，是移动端和桌面端每天都在发生的默认配置。反应式 p50 落在 567 到 730 毫秒，意味着双击这类交互在结构上就做不到，Toast 这类瞬时反馈则处在胜负未定的地带。**

对 mobile QA 来说这条线有个直接推论：**如果你的自动化用例需要断言一个 Toast 或 SnackBar 出现过，用「截图→判断」的轮询做法在原理上就是不可靠的，通过率高低取决于运气而不是实现质量。** 这类断言必须走事件通道，不能走视觉通道。

## 但连续感知不是唯一出路，甚至现在不是最优出路

到这里，很自然的结论是「所以 CUA 需要 SeedRealtime 那样的连续感知」。这个结论下得太快了。

本站上个月写过的 [StateAct](/blog/2026-07-29-stateact-program-state-grounding/) 给出了一条完全相反的路：**它不是让 agent 看得更勤，而是把主循环从屏幕上整个搬走了。** 状态可寻址的操作走代码和 API，混合型按需委派，只有纯渲染型才回落到视觉。结果是 OSWorld 2.0 上 20.6% 提到 26.9%，成本从 72 美元降到 7.8 美元——**准确率和成本同时改善，后者是九分之一。**

这个对比必须摆出来：在今天的技术条件下，「不看屏幕」的收益远大于「看得更勤」。原因不难理解——连续感知把 token 成本和显存占用推高一到两个数量级，换来的是对少数瞬时事件的感知能力；而绕开屏幕直接读状态，同时省掉了感知成本和感知误差。

那么连续感知的地盘在哪里？恰好在 StateAct 交白卷的地方：**人机协同任务上 StateAct 是 0.0%，纯渲染型任务它也只能回落到视觉。** 这两类任务的共同点是「状态不在程序里，只在屏幕上或在人的行为里」——视频会议、游戏、绘图软件、真实用户在旁边操作的协同场景。这才是连续感知真正不可替代的区间，而不是「所有 GUI 任务」。

顺带说一个 CUA 相对语音的**结构性优势**，这个优势经常被忽略：**GUI 有事件总线，语音没有。** Android 的 AccessibilityService 能收到 `TYPE_WINDOW_CONTENT_CHANGED`，Web 有 DOM MutationObserver，桌面有 accessibility 事件，还有 logcat。这意味着 CUA 完全可以做**中断驱动**而不是轮询驱动——屏幕变了系统会主动告诉你，不需要每 6.51 秒去问一次。语音信号里不存在这种结构化通知，只能靠模型自己从连续波形里判断。

**照搬语音侧的「1 FPS 连续感知」到 GUI，是把一个有中断的系统硬做成轮询，方向是退化的。** 正确的做法是用事件总线做触发，用连续感知补事件总线覆盖不到的部分（Canvas、WebGL、视频、自绘控件）。

## 显存账：为什么 Gemini Live 的音视频会话只有两分钟

连续感知的成本不是抽象概念，可以算。

Google 的 Live API 文档里，纯音频会话上限 15 分钟，**音视频会话上限 2 分钟**。这个数字看着奇怪，但用上下文窗口一除就合理了：32k 上下文，音视频合计每秒约 290 token，32000 ÷ 290 ≈ 110 秒。OpenAI 的 gpt-realtime 干脆不支持视频输入——按每帧约 765 token 粗算，32k 上下文只够 42 秒，做不成产品。

再算 GUI 场景。一个 7B 级视觉模型以 1 FPS 处理屏幕流，KV cache 的增长量级在每小时几十 GiB。而 OSWorld 2.0 的任务中位数长度是 1.6 小时。**这两个数字放在一起，「CUA 全程 1 FPS 连续感知」在当前架构下不是贵不贵的问题，是根本跑不完的问题。**

（以上除 Live API 的 15 分钟/2 分钟是官方文档明示外，其余为按公开参数做的量级粗算，用于判断可行性数量级，不宜当作精确值引用。）

这笔账决定了 CUA 的连续感知只能是**选择性的**：在关键窗口期打开，平时关闭。而「什么时候算关键窗口期」，正好是全双工模型已经在解决的问题——它每一步都在决定「现在该不该说话」，CUA 需要的是每一步决定「现在该不该看」。**同一个决策形式，换一个动作空间。**

## 「没有 benchmark」是站不住的

SeedRealtime 没给分数，一种常见的辩护是「全双工音视频本来就没有成熟 benchmark」。这个辩护经不起查。

![Full-Duplex-Bench 的四个评测维度。分别覆盖：暂停处理（用户说话中间的停顿，模型该不该接）、背景噪声鲁棒性（无关人声不应触发响应）、用户打断（模型正在说话时被打断后的行为）、以及回话响应（该接话时的及时性）。每个维度都有明确的时间判据——比如轮次切换允许不超过 0.4 秒的重叠，超过即计为 BARGE_IN。这套判据把「对话节奏好不好」这种主观感受，拆成了可以自动测量的时间量](/images/seedrealtime-full-duplex-cua/fig-fullduplex-bench-dimensions.png)

Full-Duplex-Bench 已经出到 v2/v3，此外还有 Omni-DuplexEval、OmniPro、OmniInteract 等一批面向全模态实时交互的评测集。把 SeedRealtime 那 7 个 demo 场景逐个对过去：认人辨声对应多说话人归属，背景对话不被带偏对应背景噪声鲁棒性，看展主动提醒对应视觉事件触发的主动响应，快速翻页叫停对应流式时序定位——**每一个都有现成的公开评测维度可以对应。**

而且字节自己就有过分数：Seed1.8 模型卡里的 StreamingBench† 84.4 和 OmniMMI† 53.0，† 号定义就是「以主动方式评测」。

所以准确的表述不是「没有 benchmark」，是「**有 benchmark，但这次没跑，或者跑了没公布**」。这两件事的性质完全不同。在没有第三方复现渠道（无 API、无开源、无权重）的情况下，「减少一半」这句话目前既不可验证也不可证伪——它只能作为产品宣传来读。

## 三个可以现在就搬的机制

抛开 SeedRealtime 本身，全双工这条线上有三个机制对 CUA 是直接可搬的，而且都不需要重训基座。

**第一个是感知/决策/反应的三路解耦。**

![Dispider 的解耦式架构。左侧视频流同时进入三个模块：Perception 持续做轻量的视觉编码，Decision 在每个时刻判断「现在该不该响应」，Reaction 只在被 Decision 触发时才启动重推理生成回答。三者异步运行、互不阻塞——感知不会因为反应在生成而停下，反应也不需要每帧都跑。这是把「持续看」和「持续想」这两件成本差着数量级的事情拆开的标准做法](/images/seedrealtime-full-duplex-cua/fig-dispider-decoupled.png)

这个结构和前面 DuplexOmni 的双层设计是同一个思想的两种实现。搬到 CUA 上，对应的是：一个轻量的屏幕变化检测器持续跑（可以是像素差分、可以是 accessibility 事件订阅、可以是小模型），一个决策器判断这次变化值不值得惊动主模型，只有值得的时候才发起一次完整的 VLM 调用。**这套东西不需要模型支持全双工，是纯工程实现，今天就能做。**

**第二个是把「时机」变成可训练目标，而不是可标注标签。**

响应时机的标注是个死结——「模型应该在第几帧开口」这个问题，人类标注者之间的一致性都很差。MMDuet2 那条线的做法是绕开绝对标注，用成对偏好加 GRPO：不问「正确时机是哪一帧」，只问「这两个时机哪个更好」。评价指标用 PAUC 而不是精确匹配。**「精确时机无法标注，但相对好坏可以判断」——这个转换适用于任何时机类问题，包括 CUA 里「什么时候该重新截图」「什么时候该验证上一步动作生效了」。**

**第三个是零参数的触发判据。**

![LiveStar 的 SVeD（Streaming Verification Decoding）推理框架。左侧是机制细节：新帧进来后，先用 VLM 前向一次（跳过 decoder 层）拿到 logits，计算输出困惑度，与 α 乘以解码阈值做比较——高于阈值才真正启动 decoder 生成，否则输出 Silent 并把当前帧换进上下文。右侧是实际效果：21 帧的视频流里只在第 1、6、17 帧触发了 caption 生成，其余全部判为 Silent。整个判据不引入任何新参数、不需要额外训练，只用模型自己的困惑度当置信信号](/images/seedrealtime-full-duplex-cua/fig-livestar-sved.png)

SVeD 这个思路在 CUA 上有一个非常自然的对应：**动作后验证。** 本站写过的 [VeriGUI](/blog/2026-06-05-verigui-action-effect-verification/) 和 [IRA](/blog/2026-07-30-ira-environment-state-verification/) 都在做「动作有没有真的生效」的判定，通常的做法是再调一次 LLM 去比对前后截图。SVeD 提示的是另一条路：**用主模型自己对新截图的困惑度当信号——如果动作生效了，新截图应该是「预期之内」的，困惑度低；如果困惑度突然升高，说明发生了预期之外的事，这时候才值得花一次完整的验证调用。** 省掉的是绝大多数「一切正常」情况下的验证开销。

## 对 APP 自动化测试 / Mobile QA 的落点

**瞬时 UI 的断言必须走事件通道。** 前面那张响应窗对数图给出了硬判据：Toast、SnackBar、双击间隔这些落在 567ms 线附近或以下的现象，用截图轮询去断言，通过率取决于运气。Android 侧应该订阅 AccessibilityService 的 `TYPE_WINDOW_CONTENT_CHANGED`，iOS 侧用 XCUITest 的 expectation 机制，Web 侧用 MutationObserver。**把「有没有出现过」这个问题从视觉判定改成事件记录判定，这是一次性的架构改动，收益是这一整类用例从不稳定变成稳定。**

**观测-动作间隙应该被当成一个要监控的指标。** 6.51 秒这个数字是 OSWorld 上量出来的，你自己的 pipeline 上是多少，大概率没人量过。落盘时给每个动作记两个时间戳（截图时刻、动作派发时刻），差值做成分布。这个分布的 p95 直接决定了哪些用例天然不可靠。本站之前在 [TSR](/blog/2026-07-06-tsr-task-state-representation-mobile-gui-agent/) 那篇里讨论过状态表示的落盘结构，时间戳应该是其中的必备字段。

**优先做「不看屏幕」，而不是「看得更勤」。** StateAct 的九分之一成本摆在那里。对 APP 测试来说，能通过 UIAutomator dump、accessibility tree、深链、debug 接口、后端 API 拿到的状态，就不要用视觉去认。**视觉是最后的回落手段，不是默认手段。** 这个优先级如果搞反了，后面所有优化都是在给一个错误的架构提速。

**连续感知只在明确的窗口里开。** 显存账已经说明全程流式跑不完长任务。可行的形态是：默认走事件驱动，只在已知的高风险窗口（提交后的加载期、支付回调、动画过渡、需要断言瞬时反馈的步骤）里临时提高采样率。窗口的划定应该来自失败数据，不是拍脑袋。

**别把「响应及时性」当成免费的。** 目前 OSWorld、AndroidWorld、OSWorld 2.0 这些主流 benchmark，环境都会等 agent——你想多久就多久，没有超时惩罚。这意味着「反应慢」这个缺陷在现有评测体系里**完全不可见**。如果你的产品场景对时效敏感，必须自己造这个考题：在测试环境里加入会过期的元素，把「错过窗口」记为失败。**在没有人测量这件事之前，任何关于「实时性提升」的宣称都无法被检验，包括 SeedRealtime 那句「减少一半」。**

## 局限与判断

**真正的贡献**：SeedRealtime 最实在的价值是一个规模化信号——**音视频全双工从技术可行走到了默认开启、免费、全量上线于一个上亿 DAU 的应用。** 这件事本身有分量，因为它意味着延迟、成本、稳定性这三道工程关卡被逐个过掉了，而不只是 demo 跑通。技术可行性早在 2024 年就由 Moshi 和 VideoLLM-online 证明过，SeedRealtime 证明的是别的东西：这套东西的单位成本已经低到可以对所有用户默认开启。对判断「连续感知什么时候能进入 CUA 生产环境」，这是一个真实的时间锚点。另外，「轮次判断不交给外部 VAD 规则、而由模型基于多模态信息持续决策」这个产品级验证，间接支持了一个对 CUA 同样成立的判断：**二值门控表达不了「感知到但不行动」这个状态，把它变成模型的一个可学习决策是对的方向。**

**可能被高估的部分**：这次发布在证据强度上非常薄。唯一的量化说法「节奏问题减少一半」是厂商自评的人工评测，样本量、评测员、盲测设计、基线身份、「节奏问题」的定义全部未披露，且发布方同时是评测方。没有技术报告、没有参数量、没有延迟数字、没有任何公开 benchmark、没有 API 也没有开源，第三方无法复现、无法证伪。相对同团队 4 月 Seeduplex 那篇给了六个量化指标和两张评测图，这次是明显的披露退步。更需要警惕的是概念上的滑移：**官方从未提及 GUI、屏幕、computer use 或 agent 操作界面，英文版把「画面」译成 screen 是翻译产物，不能拿来当作它面向屏幕理解的证据。** 本文所有关于 CUA 的推论都是外部延伸，官方没有任何背书。至于「全双工能救 CUA」这个更大的叙事，前面的显存账和 StateAct 的九分之一成本已经说明，它至少在当前不成立——**连续感知是补丁，不是主线。**

**可复现、可落地的建议**：不要等模型侧。前面三个机制里，Dispider 式的三路解耦是纯工程实现，今天就能在现有 CUA pipeline 外面套一层；SVeD 式的困惑度触发只需要模型返回 logprobs，成本近似为零，值得在动作验证环节先试。评测侧建议做一件小事但影响很大：在自己的回归环境里加入会过期的 UI 元素，把「错过窗口」记为失败，然后重跑现有用例集——这个数字大概率会很难看，但它是目前主流 benchmark 全都不测、而生产环境天天在发生的失败模式。至于 SeedRealtime 本身，在没有 API 和技术报告之前，能做的只有把豆包 App 装上手动体验，任何基于官方文案的量化引用都应该带上「厂商自评、方法未披露」的限定。

## 小结

SeedRealtime 是一次产品发布，不是一次技术披露。把它当成 CUA 基模是误会，误会的源头可能只是英文版一处把「画面」译成 screen 的翻译。

但顺着这次发布往下看，能看清 CUA 领域一个被长期忽略的结构性问题：**agent 的采样率大约是 0.15 Hz，观测到动作的平均间隙实测 6.51 秒，而移动端和桌面端大量默认 UI 反馈的存在时长在 500 毫秒到 4 秒之间。** 这不是精度问题，是采样定理层面的问题——低于采样率的现象，agent 不是看不清，是原理上无法分辨。

真正让人不安的不是这个间隙有多大，而是**没有任何主流 benchmark 在测它**。OSWorld、AndroidWorld、OSWorld 2.0 的环境都会耐心等待 agent，「反应慢」这个缺陷在现有评价体系里根本不产生扣分。一个不被测量的缺陷，在工程上等于不存在——直到它在生产环境里以「用例不稳定」「偶发失败」「重跑就好了」的形式反复出现。

SeedRealtime 那句无法验证的「减少一半」，和 CUA 领域这个无人测量的响应窗，其实是同一件事的两面：**当一个能力既没有公开的测量方法、也没有独立的验证渠道时，关于它的所有进展宣称都只能当作宣传来读。** 语音侧至少已经有 Full-Duplex-Bench 这样的公开判据在推动这件事往回走，CUA 侧连判据都还没有。

## 参考链接

- 官方发布：[SeedRealtime 音视频全双工大模型发布](https://seed.bytedance.com/zh/blog/seedrealtime-audio-visual-full-duplex-llm-released-toward-omni-modal-natural-interaction)（字节跳动 Seed，2026-08-05，无技术报告与 arXiv 条目）
- 同团队前作：[Seeduplex 全双工语音大模型发布](https://seed.bytedance.com/zh/blog/seed-%E5%85%A8%E5%8F%8C%E5%B7%A5%E8%AF%AD%E9%9F%B3%E5%A4%A7%E6%A8%A1%E5%9E%8B%E5%8F%91%E5%B8%83-%E6%87%82%E5%80%BE%E5%90%AC-%E6%8A%97%E5%B9%B2%E6%89%B0-%E8%B5%B0%E5%90%91%E6%9B%B4%E8%87%AA%E7%84%B6%E7%9A%84%E4%BA%A4%E4%BA%92)（2026-04-09，含六项量化指标，可作披露程度的对照）
- 模型卡：[Seed1.8](https://arxiv.org/abs/2603.20633)（含 1 FPS 流式交互 Figure 9、StreamingBench†/OmniMMI† 主动式评测分数）
- [Moshi: a speech-text foundation model for real-time dialogue](https://arxiv.org/abs/2410.00037)（Kyutai，token 级全双工的基准线）
- [MiniCPM-o 4.5](https://arxiv.org/abs/2604.27393)（Silent/Speak token 的全模态全双工架构）
- [DuplexOmni](https://arxiv.org/abs/2606.09186)（交互层 + 思考层的双时间尺度分层）
- [Full-Duplex-Bench](https://arxiv.org/abs/2503.04721)（暂停处理 / 背景噪声 / 用户打断 / 回话响应四维判据）
- [Dispider](https://arxiv.org/abs/2501.03218)（感知 / 决策 / 反应三路解耦）
- [LiveStar](https://arxiv.org/abs/2511.05299)（SVeD：零参数的困惑度触发判据）
- TOCTOU 攻击面与观测-动作间隙实测：[arXiv:2604.18860](https://arxiv.org/abs/2604.18860)
- 反应式关键路径与响应窗分析：[arXiv:2607.28399](https://arxiv.org/abs/2607.28399)
- [OSWorld-Human](https://arxiv.org/abs/2506.16042)（LLM 调用占端到端任务时间 75%–94%）
- 本站相关文章：[StateAct：把 GUI Agent 的主循环从屏幕搬到程序状态](/blog/2026-07-29-stateact-program-state-grounding/)
- 本站相关文章：[OSWorld 2.0：把 Computer-Use Agent 的考卷从 30 步换成 318 步之后](/blog/2026-07-23-osworld2-long-horizon-computer-use-benchmark/)
- 本站相关文章：[LivingScreen：动态界面下的 GUI Agent 评测](/blog/2026-06-15-livingscreen-dynamic-gui-agent-benchmark/)
- 本站相关文章：[VeriGUI：动作效果验证与 72.3% 的超时相关失败](/blog/2026-06-05-verigui-action-effect-verification/)
- 本站相关文章：[TSR：移动端 GUI Agent 的任务状态表示](/blog/2026-07-06-tsr-task-state-representation-mobile-gui-agent/)
- 本站相关文章：[IRA：环境状态验证](/blog/2026-07-30-ira-environment-state-verification/)
