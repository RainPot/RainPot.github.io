---
title: "近两个月 GUI Agent 论文全景（2026 夏）：Mobile 主线上的观察空间革命、安全攻击面与榜单换代"
description: "窗口 2026-06-15 至 2026-08-20。以 Mobile GUI Agent 为主线、CUA 为参照系，梳理约 70 篇论文与主要榜单底层数据：Qwen-CUA-Max 在 OSWorld-Verified 拿 87.6、在 OSWorld 2.0 二元完成率只有 21.2 的 66 分差是全篇的钥匙；移动端基准两个月完成一次换代，AndroidWorld 97.4 十个月无人刷新而 AndroidLens 长程任务只有 12.7；安全攻击面成为移动端最拥挤的新赛道；观察空间从「整屏截图点像素」迁往程序状态、无障碍树与代码世界模型。"
date: "2026-08-20"
tags: ["GUI Agent", "Computer Use", "Mobile Agent", "Research", "Survey"]
draft: false
featured: true
readingTime: 27
---

## 目录

1. 一个数字定调：66 分差的两个世界
2. 语料口径与检索方法
3. 主线一：两个月里被拆掉的七个默认假设
4. 主线二：移动端榜单的四次换代
5. 主线三：全平台榜单的真实水位
6. 主线四：安全攻击面，移动端最拥挤的新赛道
7. 主线五：判定器成为被研究的对象
8. 主线六：移动端训练侧的三个新变量
9. 哪些方向还值得做
10. 对 APP 自动化测试 / Mobile QA 的启发
11. 附：两个月论文清单

## 1. 一个数字定调：66 分差的两个世界

同一个模型，同一个团队，同一篇技术报告里的两个数字：Qwen-CUA-Max（参数量过万亿的 MoE）在 OSWorld-Verified 上自报 87.6，在 OSWorld 2.0 的二元完成率上只有 21.2（[Qwen-CUA, arXiv:2608.02352](https://arxiv.org/abs/2608.02352)）。差 66 个百分点。

这两个数字测的不是同一个东西。OSWorld-Verified 是 361 个短程桌面任务，平均三十来次工具调用；OSWorld 2.0 是 108 个长程真实工作流，平均 318 次调用、人类中位完成时间 1.6 小时。前者测「会不会做」，后者测「能不能连续做对三百步」。

把 2026-06-15 到 2026-08-20 这两个月的论文放在一起看，几乎所有的变化都发生在这 66 分差里。短程榜单已经打到接近满分且涨不动了，而长程、跨应用、真机、对抗环境下的能力缺口，正在重新定义整个领域的研究议程：

- **观察空间在换**。StateAct 把主回路从截图换成程序状态，OSWorld 2.0 二元完成从 20.6 拉到 26.9、成本降到约九分之一；ComponentBench 里同一个 GPT-5 mini，无障碍树观察 83.1%、纯像素坐标只有 48.9%。
- **移动端在换代**。AndroidWorld 97.4 已经十个月无人刷新，AndroidDaily 冲到 97.5，而 AndroidLens 的 571 个长程任务上最好成绩只有 12.7。
- **安全攻击面在扩大**。移动端两个月里出现了环境注入（MobileWorldSafety）、多步注入（StepJack）、隐形低危害注入（Invisible Ink）、自合成攻击链（SynChain）、用户内容注入（MIRAGE）五套新的攻击基准，所有被测 agent 的攻击成功率都不低于 23%。
- **判定器本身成了研究对象**。OSReward 发现 VLM 裁判系统性偏松，How Benchmarks Mis-Score 审计出 15.3% 的 FAIL 判定是错的——给 RL 用的奖励信号，自己的错误率比大多数任务的成功率还高。

下面按这四条主线展开。

## 2. 语料口径与检索方法

先交代口径，避免「全景」变成营销词。本文语料由三部分组成：

1. **RainPot 逐日精读语料**：2026-06-15 至 2026-08-20 期间的 40 余篇单篇精读（LivingScreen、SaaS-Bench、AndroidDaily、MobileForge、MemGUI-Agent、SeerGuard、OSWorld 2.0、StateAct、IRA、Qwen-UI-Agent、CUADebug、SeedRealtime、AppDeltaWorld、Gated Hindsight Distillation、LLM-as-a-Verifier 等）；
2. **GUI Agents Paper List**（OSU-NLP-Group）窗口内条目，以及 **arXiv API 按「mobile GUI agent」「computer-use agent」检索**的约 60 篇补充，两者去重后新增约 30 篇（ComponentBench、MobileWorldSafety、Act2Intention、StepReflect、CoAdapt-GUI、Qwen-CUA、Echoverse、SeekJudge、HyMobileAgent 等）；
3. **榜单底层数据文件**：OSWorld-Verified 的 xlsx、OSWorld 2.0 的 official-results.json、AndroidWorld/WebArena 的官方表格、grounding 榜单 JSON——论文自报数字一律标注「自报」。

这是一份策展样本，不是全量快照。分类是多标签的：一篇 SeerGuard 既是安全工作也是世界模型工作，一篇 AndroidDaily 既是基准工作也是判定器工作。文中所有分数都注明口径，读的时候请先看口径再看数字。

先看整体注意力的流动：同一行看某个方向两个月里是否持续有新工作，同一列看该时间段研究注意力集中在哪几行。评测与环境从六月的高产期退潮，训练数据与 RL 在七月中旬达到密度峰值，八月的新增量集中在世界模型、失败归因与实时性——而移动端真机部署（最后一行）是唯一一个两个月里每个时间窗都有新论文的方向。

![GUI Agent 近两个月方向演进时间线](/images/guiagent-two-month-trends/trend-timeline.png)

## 3. 主线一：两个月里被拆掉的七个默认假设

如果只允许从这两个月里带走一张图，带这张：GUI Agent 领域的七个默认假设在两个月内被逐条拆掉，而它们指向同一个结论——**把「看整屏截图、点像素坐标」当成主回路，是一个被系统性高估的工程选择**。

![七个被拆掉的默认假设](/images/guiagent-two-month-trends/assumption-teardown.png)

按时间顺序过一遍：

- **06-15，「屏幕会静止等 agent 看清」被拆**。LivingScreen（arXiv:2606.04701）的动态屏幕基准上人类成功率 94.0，最好的模型只有 69.3；Seed-1.8 把 25.1% 的回合花在「观看」上，最动态的那层达到 53.1%——模型不是在做任务，是在盯屏幕等它停。
- **07-02，「视觉记忆加得越多越好」被拆**。Naive Visual Memory（arXiv:2606.14106）把整屏历史塞进上下文，认知失败确实从 82.6 降到 75.0，但隐藏操作盲区从 67.1 恶化到 78.8，grounding 失败从 27.5 恶化到 36.1。记忆是双刃剑，加错了方向。
- **07-07，「agent 的状态信念来自它看到的画面」被拆**。GUI Agents Believe Their Eyes（arXiv:2607.04334）：截图本身读得挺对（gpt-5.4 达 0.93），但截图与结构化文本冲突时，0.30~0.75 的信念倒向结构化文本，跨三家厂商五个模型成立。视觉输入在权重上其实是「二等公民」。
- **07-16，「手机上的事必须靠点屏幕完成」被拆**。PalmClaw（arXiv:2607.13027）改走原生 device tools 路线，日常任务成功率 97.1%，且每个调用带显式参数边界、可审计。
- **07-29，「截图应该待在主回路里」被拆**。StateAct（arXiv:2607.22798）把主回路换成程序状态，GUI 子代理只在 108 个任务中的 28 个里出场、只占主代理步数的 1.1%；注意它的纯代码变体只有 45.9 的部分完成度、低于截图基线 54.8——结论不是「视觉没用」，是「视觉不该独占主回路」。
- **07-31，「GUI 是唯一的动作空间」被拆**。Qwen-UI-Agent（arXiv:2607.28227）在 OSWorld-Verified 上 CLI 动作占 40.7%、出现在 92.0% 的任务里；换到 OSWorld 2.0 这两个数字升到 55.1% 和 98.2%——任务越长，agent 越依赖绕开 GUI。
- **08-18，「观察空间只是实现细节」被拆**。ComponentBench（arXiv:2608.18307，COLM 2026）在同一套 harness 里只换观察和动作空间：GPT-5 mini 无障碍树观察 83.1%，纯像素坐标 48.9%，相差 34.2 个百分点。观察空间不是实现细节，是一等自变量。

这七条合起来构成两个月里最大的方法论迁移：**领域正在从「视觉为主、结构为辅」翻转到「结构为主、视觉兜底」**。移动端因为有无障碍树、View Hierarchy、adb、deeplink 这些现成的结构化通道，是这条迁移线上受益最快的平台。

## 4. 主线二：移动端榜单的四次换代

Mobile 是用户最关心的方向，也是换代速度最快的方向：一套移动端基准从发布到饱和大约 12 到 18 个月，被替换的原因不是任务不够多，而是任务不够长、跨应用不够多、判定不够细。

![移动端基准四次换代](/images/guiagent-two-month-trends/mobile-benchmark-generations.png)

### 第一代（2023-2024）：已停更或废弃

AITW 的在线子集 87.9（与离线 step-acc 两套口径不可比）、AndroidLab 47.7（榜单自 2025-12 停更）、MobileAgentBench 49（仓库已失效）、AITZ 只有 50 个 episode 的抽样预实验。这一代的共同特征：开源可插桩 App、模拟器、终态快照判分、十余步的单一意图。

### 第二代（2024-2025）：已饱和

AndroidWorld 97.4——注意这是**该分数 10 个月无人刷新**的 97.4，且三方并列全部自报、无独立验证；官方榜单首行自带「无独立验证、后果自负」的免责声明。AndroidControl 79.1 接棒了 AITW 的步级口径。这一代还是模拟器 + 开源 App，但任务数上了百。

### 第三代（2026 上半年）：当前主战场

- **MobileWorld**（沙箱）：201 任务、跨应用占 62.2%，Qwen-UI-Agent 自报 82.1——两个月涨 30.4 分，全场涨速最快；
- **AndroidDaily**（arXiv:2605.27761）：94 个闭源高频真机 App、350 任务，Qwen-UI-Agent 自报 97.5、论文自测 62.0——一个基准两套口径，引用前必须对齐；
- **MobileWorld-Real**：409 个真机任务，自报 92.2。

这一代的实质变化是三条口径：真机集群（100 台以上）、闭源 App（拿不到内部状态）、过程可判定（AndroidDaily 的 GRADE 判定器与人工一致率 87.37%，后端数据库直查取代终态快照）。

### 第四代（长程与跨系统）：远未解决

AndroidLens 571 个长程任务（平均 26 步以上、38 个域）最好成绩 **12.7**（动作级也只有 50.5）；iOSWorld（2026-06，133 任务 / 26 个自建 iOS 应用）总体 52、跨应用 37，加无障碍树观察最高能再涨 26 分——观察空间的杠杆在移动端同样巨大。

### 读移动端分数前必须知道的三件事

一、AndroidWorld 榜单是自报的；可复现的 GUI 基线在统一环境里只有 57.8 到 69.3。
二、**纯命令行的 Claude Code 没做任何移动端后训练就在 AndroidWorld 拿到 71.8，人工写的 oracle 命令行能到 88.8（116 题里 103 题可纯 CLI 解）**。榜单在相当程度上测的是「会不会绕开界面」——这与桌面上 StateAct、Qwen-UI-Agent 的发现完全同构。
三、同名不同物：AndroidDaily 在不同论文里有三套互不相容的描述；MobileWorld / GUI-only 子集 / MobileWorld-Real 是三套任务。引用前须对齐任务数与判定协议。

## 5. 主线三：全平台榜单的真实水位

把 CUA 一侧的主要榜单放在一起看，分层非常清晰：

![GUI Agent 主要榜单进度](/images/guiagent-two-month-trends/leaderboard-progress.png)

**已接近饱和（>90）**：Online-Mind2Web 97.7（Hark Handoff）、AndroidDaily 97.5（自报）、ScreenSpot-V2 97.5（自报）、AndroidWorld 97.4（自报、10 个月无人刷新）、MobileWorld-Real 92.2（自报）、OSWorld-Verified 全榜视图 90.2（Intelligence-Indeed Agent）。这一层的每个数字都要打折：OSWorld-Verified 榜内分母在 356-361 间浮动、多数只跑 1 次，前两名的差距没有统计意义；同一页面切一个 tab（默认视图）榜首就变成 86.0 的 claude-fable-5。

**仍在争夺（60-90）**：OSWorld-Verified 默认视图 86.0、Qwen-CUA-Max 自报 87.6、ComponentBench 无障碍树 83.1（GPT-5 mini）、ScreenSpot-Pro 含 zoom-in 82.7（Indeed-UI-32B；同模型单次前向只有 73.3——涨分靠的是管线不是模型）、MobileWorld 沙箱 82.1、WebArena 74.3（WebTactix，约半年无人刷新）、UI-Vision 70.0、WebVoyager 标准化重测 68.6（**同一个 Operator 自报 87、统一重测掉 18 分**）、WindowsAgentArena 66.2、OSWorld 2.0 部分完成度 61.6（StateAct + Opus 4.8）。

**远未解决（<60）**：VisualWebArena 54.0（13 个月零增长，人类 88.7）、iOSWorld 52.0、ComponentBench 纯像素 48.9（同一个 GPT-5 mini，只换观察空间）、OSWorld 2.0 二元完成 26.9（StateAct + Opus 4.8，官方榜 20.6）、AndroidLens 12.7。

三条结构性观察：

1. **涨分的榜几乎都能被 zoom-in 管线、命令行旁路或无障碍树观察吃掉**；不涨的分两类——已饱和的（AndroidWorld、Online-Mind2Web）和真正难的（OSWorld 2.0、VisualWebArena、AndroidLens）。
2. **OSWorld 的人类基线 72.4 测于 2024 年原版，从未在 Verified 上重测**，「已超越人类」并不成立。
3. **自报与重测的系统性差距**（Operator 的 87→68.6）说明：这个领域目前还没有一个跨榜单的第三方复现机制，凡是「自报」都应视为上界估计。

## 6. 主线四：安全攻击面，移动端最拥挤的新赛道

两个月里移动端安全论文的密度超过了训练方法论文，这本身就是信号。攻击研究正在从「单点注入」走向「多步、低危害、自我合成」：

- **MobileWorldSafety**（arXiv:2608.17659，08-18）：142 个基于真实 Android 应用的风险任务，环境注入攻击（间接提示注入 + 对抗指令），六个被测 agent（通用 + GUI 专用）的攻击成功率全部落在 **40.4%~66.9%**。它把安全失败和能力失败用可编程验证的风险指标分开判定，这是安全基准第一次做到「可复现」。
- **StepJack**（arXiv:2608.06477，08-06）：多步间接提示注入——把有害目标拆成多个看似无害的子步骤分布到导航链的多个页面里。GPT-5.4-mini 的攻击成功率从单步 41.7% 升到三步 **72.9%**；五个能跟上参考链的 CUA 平均从 31.3% 升到 36.9%。
- **Invisible Ink Threats / II-Bench**（arXiv:2608.02018，08-03）：444 个「低危害」注入任务（给仓库点星、装一个包），行为上与合法任务不可区分，因此同时绕过模型安全机制和 HITL 人工审查。人机协同防御对这类攻击结构性失效。
- **SynChain**（arXiv:2608.06862，08-07）：更进一步——恶意影响被嵌入 agent **自己合成的技能和记忆工件**里，随内部状态更新存活、在未来工作流中作为「可信上下文」复活，全程不需要新的外部恶意输入。在 OpenClaw、Codex、Claude Code 四种防御配置下攻击成功率都很高。这对所有带技能库/SKILL.md 机制的 agent 框架是直接警示。
- **MIRAGE**（arXiv:2605.28116，05-27）：把良性截图转成注入样本，在用户生成内容区域渲染攻击载荷，五个 VLM agent 全部沦陷（ASR 23%-30%），且样本真实感与攻击成功率**不相关**——视觉质量过滤防不住。
- **CAPED**（arXiv:2606.12666，06-10）：防御侧。截图上传前的选择性暴露层，把种子隐私泄露从 0.766 压到 0.268，代价是一定的任务成功率。
- **权限素养**（"Allow" to Achieve, arXiv:2608.04755，08-05）：同一个日历任务，弹窗请求方从 Calendar 换成 PiMusic，授权从 26/32 掉到 0/32——**App-Trust Bias 强烈但任务条件化**；任务上下文一变授权决策就系统性改变（Task-Prior Override）。结论很工程化：任务执行与权限授权应该分离成两个组件。

加上此前已精读的 Capable but Careless（11/15 个 agent 在超 50% 场景泄露隐私）和 SeerGuard（执行前用世界模型预判风险，安全-效用分从 0.191 提到 0.596），移动端安全的图景是：**攻击面清单每周都在加长，防御侧只有「执行前预判」这一条线真正成型**。

## 7. 主线五：判定器成为被研究的对象

两个月里一个安静的转折：给 agent 打分的系统本身，成了被测量、被审计、被训练的对象。

- **How Benchmarks Mis-Score Computer-Use Agents**（arXiv:2607.28367，07-30）：审计 150 条公开的失败轨迹，**15.3% 的 FAIL 判定是错的**（10.7% 是裁判假阴性，4.7% 是任务本身坏了）。对真实失败的三级归因显示验证/反馈与规划失败远多于执行/grounding 失败——而单一的成功率标量把这些全部压扁。
- **OSReward**（arXiv:2607.28609，07-30）：对 VLM 裁判做系统评估，发现即使最强模型也有**系统性偏松偏差**（把失败标成成功），可靠到可用的太贵、便宜的又不可靠；于是放出 OS-Shepherd-100K 语料并训练了 9B/35B 开源奖励模型，成本比前沿商业裁判低 30~60 倍。
- **SeekJudge**（arXiv:2607.23263，07-25）：四个角色化子代理（Condense/Ground/Seek/Analyze）走 Seek-Analyze 循环判轨迹，蒸馏到一个 9B 底座，是**第一个在在线 RL 下追平或超过规则判定**的模型奖励。
- **AndroidDaily 的 GRADE**：三级 guideline（操作义务/输出质量/负向约束）+ 过程判定，与人工一致率 87.37%——闭源 App 判定的现实解。
- 已精读的 **IRA**（arXiv:2607.25904）量化了截图判定的天花板：最强的被动 VLM 裁判召回只有 65.5%，propose-then-verify（显式完成条件 + 只读证据通道验证）做到 86.9%。

这一条线对做 RL 的人是前置条件：**奖励信号自身的错误率如果高于策略的成功率，RL 学到的是裁判的偏差而不是任务**。OSReward 的「偏松」+ Mis-Score 的「假阴性」合在一起意味着：目前多数 RL 工作的奖励通道既漏报又误报，且方向不对称。任何号称 RL 涨分的论文，都应该先报裁判的混淆矩阵。

## 8. 主线六：移动端训练侧的三个新变量

### 变量一：世界模型从「生成下一屏」收敛到「生成可执行变更」

两个月里世界模型的方向明显收敛：不再追求生成下一张截图，而是生成**结构化的、可执行的变更**。AppDeltaWorld（arXiv:2608.05891，已精读）预测「可达代码更新」（delta HTML），作为训练环境让 AppDeltaAgent 在 AndroidLens 上拿到 SOTA、MobileGym/MobileWorld 一致涨分，还支持免真机的测试时强化学习。SeerGuard 用安全增强世界模型做执行前风险预判。更早的 How Mobile World Model Guides GUI Agents（arXiv:2605.10347）横向比较四种模态后发现：可渲染代码重建保真度最高，文本反馈对 OOD 执行更稳健——代码与文本各占一头。世界模型已经从「锦上添花」变成移动端的独立扩展轴。

### 变量二：反思从开放推理收敛到结构化预测

StepReflect（arXiv:2608.05587，08-06）把每步反思从「开放式多模态推理」改成**条件于显式转移规范的结构化预测**，8B 模型转移级准确率 82.16%、超过零样本 GPT-5.2 达 11.83 个百分点；在线接入四个 agent 配置里三个涨点，且 API 账单全降。Gated Hindsight Distillation（arXiv:2608.06065，已精读）用「下一张截图」作为训练期特权信息做门控蒸馏，在 AndroidWorld/AndroidLab 上两个 VLM 底座都超过 GRPO。共同点：**训练信号从「轨迹级别对/错」下沉到「转移级别对/错」**。

### 变量三：适应从「预训练见得多」走向「测试时学得快」

CoAdapt-GUI（arXiv:2608.11588，08-12）：面对训练时没见过的 App，在无目标演示、有限交互预算下做测试时适应——工作流上下文（保留可迁移流程、失败模式、验证规则，剥离 App 绑定细节）+ LoRA 策略联合更新，AndroidWorld-Generalization 37.5%→45.0%，AndroidWorld Plus 38.6%→52.9%。HyMobileAgent（arXiv:2607.14548）则代表另一条路线：数据-环境协同扩展（mock 接口合成飞轮 + 教程视频转结构化交互数据 + 2000 沙箱/真机实例的百万级动作管线 + PhoneWorld 的 34 个 mock App / 34000 任务），用 A3B 级小模型吃下部署预算约束。加上已精读的 MobileForge（免标注适应，ForgeOwl-8B 在 AndroidWorld 达 77.6 Pass@3），移动端训练侧的三个杠杆已经很清楚：**结构化环境合成、转移级信号、测试时适应**。

CUA 一侧的对应物是 Echoverse（arXiv:2607.28074）：把规格编译成有状态应用、任务用应用自己的数据库判分、每次 rollout 反哺环境和判定器——9B 模型从 36.5% 提到 67.1%，其中「浅环境把在线准确率从 80.0 拉低到 75.0、深环境拉高到 85.0」这组对照，是环境深度比环境数量更重要的最直接证据。

## 9. 哪些方向还值得做

把两个月的论文按「研究拥挤度 × 剩余头部空间」摆开：

![研究方向象限](/images/guiagent-two-month-trends/direction-quadrant.png)

**左上角（空间大且人少）是优先投入区**：

1. **混合动作与接口设计（GUI+CLI+MCP）**——Qwen-UI-Agent 的 CLI 占比 55.1%、Screenshots or Tools?（arXiv:2608.03327）发现同一套 MCP 工具让推理模型 +4.0pp、非推理模型 -5.9pp，且推理模型也只在 23.9% 的工具可达任务上真的用了工具（adoption gap）；Tactile（arXiv:2607.14443）在做工具层的动作锚定。接口共识还是空白，MCP 在 CUA 场景几乎无人做——这是最确定的结构性机会。
2. **失败归因与可靠性工程**——CUADebug 联合归因准确率只有 19.6%，CUA 特有的五类失败分类（P/G/R/S/O）刚建立，S 类（环境/系统）归因 F1 只有 0.35。可靠性工程在传统软件里是成熟学科，在 GUI Agent 里连词汇表都还没统一。
3. **评测的元评估**——15.3% 的 FAIL 判定是错的、VLM 裁判系统性偏松。谁来给裁判打分，谁就掌握了 RL 时代的度量衡。
4. **世界模型/状态迁移扩展轴**——4 篇起步，方向刚收敛到「可执行变更」。

**右上角（空间大但拥挤）是必做但需差异化**：长程真实工作流评测（二元完成率 26.9，43 篇在做）、安全与注入（35 篇）、环境工程深度（Echoverse 的 68.7→43.9 对照）、记忆与上下文治理（20 篇但缺统一口径——ATMem 的「主动执行状态」和 Activity Frames 的「确定性编译」是两个有希望统一讨论的框架）。

**右下角（空间小又拥挤）收益递减**：短程沙箱 benchmark（AndroidDaily 97.5 近满分）、静态 grounding 单点精度（ScreenSpot-V2 97.5 饱和）、通用合成数据配方（39 篇，边际收益趋缓）。

**左下角利基**：端侧小模型成本工程（PalmClaw、MobileExplorer、UI-KOBE、HyMobileAgent 的 A3B 路线）——对大厂是必选项，对学术界是差异化空间。

## 10. 对 APP 自动化测试 / Mobile QA 的启发

落到 APP 自动化测试和 Mobile QA，这两个月的论文可以直接转成六条工程决策：

1. **观察空间优先级重排**。ComponentBench 的 34.2 分差和 iOSWorld 的 +26 分差都说明：uiautomator dump / View Hierarchy / 无障碍树应该成为用例的主观察通道，截图降级为视觉断言和兜底定位。这直接对应 Appium/XCUITest 里「优先 accessibility id、image assertion 兜底」的最佳实践，但现在有了硬数字。
2. **动作通道分层**。PalmClaw 的 device tools 路线和 Claude Code 在 AndroidWorld 的 71.8 共同说明：能用 adb/deeplink/Intent/API 直达的验证（后端数据库直查、SharedPreferences/plist、ContentProvider）不要走 UI 点击。**测试编排走结构化通道，UI 只测真正要验证的交互路径**。
3. **判定器要单独验收**。GRADE 87.37% 人工一致率、IRA 86.9% 准确率、OS-Shepherd 开源 9B/35B——如果团队在用 LLM 做用例结果判定，先在自己的失败样本上测判定器的混淆矩阵，再谈用它做回归门槛。propose-then-verify（显式完成条件 + 只读证据通道）是当前最稳的判定架构。
4. **失败归因结构化**。CUADebug 的 P/G/R/S/O 五类映射到 UI 自动化缺陷分诊非常自然：P→元素识别、G→坐标与手势语义、R→用例编排与断言时机、S→弹窗/权限/超时/设备状态、O→用例本身写错。配对观测记录（前截图 + view hierarchy + 动作 + **意图** + 状态 + 后截图 + logcat 窗口）是模型无关、最高 ROI 的一件事——intent 字段最常被省略，恰恰是它让归因成为可能。
5. **权限弹窗进用例设计**。权限素养研究的 App-Trust Bias 说明 agent（和人）对「谁在请求」极度敏感：自动化测试里的权限预授权（grant-all）会系统性掩盖 App 冒用权限的缺陷。Android 13+ 的运行时权限、iOS 的 ATT 弹窗应该作为独立用例类别。
6. **安全测试的攻击面清单**。MobileWorldSafety、MIRAGE、StepJack 的攻击模式（环境内容注入、用户内容注入、多步链式注入）可以直接翻译成对抗性测试用例：在 feed/评论/搜索结果里植入指令样文本，验证 agent 化的测试框架和 RPA 机器人是否被劫持——**当 QA 工具本身开始用 LLM，QA 工具也成了攻击面**。

## 11. 附：两个月论文清单

精选代表（含已精读与新检索，多标签分类）：

**Mobile 基准与环境**：AndroidDaily（2605.27761）、MobileGym（2605.26114）、ScaleWoB（2605.25160）、MobileWorld 系列、AndroidLens、iOSWorld、LivingScreen（2606.04701）、MobileWorldSafety（2608.17659）、PhoneWorld（HyMobileAgent 内）
**CUA 桌面/Web 基准**：OSWorld 2.0（2606.29537）、MacAgentBench（2606.22557）、ChainWorld（2606.21654）、PPT-Eval（2606.31154）、TUA-Bench（2606.28480）、ComponentBench（2608.18307）、LegacyWorld（2608.14131）、Desktop-Delta Bench（2607.26041）、SaaS-Bench、Echoverse（2607.28074）、WebRetriever（2607.06118）
**观察空间与状态**：StateAct（2607.22798）、GUI Agents Believe Their Eyes（2607.04334）、LUMOS（2606.30697）、Screenshots or Tools?（2608.03327）、GUI vs. CLI（2606.24551）
**移动端训练**：MobileForge（2606.19930）、MemGUI-Agent（2606.19926）、HyMobileAgent（2607.14548）、CoAdapt-GUI（2608.11588）、StepReflect（2608.05587）、Gated Hindsight Distillation（2608.06065）、AppDeltaWorld（2608.05891）、Faithful-Agent（2605.01208）、STAMP（2605.29324）、UI-KOBE（2605.29534）
**CUA 训练与模型**：Qwen-CUA（2608.02352）、Qwen-UI-Agent（2607.28227）、ScaleCUA（2607.11185）、EvoCUA-1.5（2607.09773）、Fara-1.5（2606.20785）、OpenForgeRL（2607.21557）、Teach it to stop（2607.17136）、Learning from Failure（2606.31270）、RL with Autonomous Evaluation（2606.24515）
**记忆与上下文**：ATMem（2606.31612）、Activity Frames（2608.05784）、MementoGUI、TSR（2607.00502）、SkillLens（2608.10775）、SKILL.md 自动生成（2606.20363）
**判定与元评估**：OSReward（2607.28609）、SeekJudge（2607.23263）、How Benchmarks Mis-Score（2607.28367）、IRA（2607.25904）、AJ-Bench、LLM-as-a-Verifier、GRADE（AndroidDaily 内）
**安全**：MobileWorldSafety（2608.17659）、StepJack（2608.06477）、Invisible Ink（2608.02018）、SynChain（2608.06862）、MIRAGE（2605.28116）、CAPED（2606.12666）、权限素养（2608.04755）、Capable but Careless（2606.23189）、SeerGuard（2607.15550）
**实时性与端侧**：SeedRealtime（全双工）、AAPT（2607.28399）、RT-SHCUA（2607.17951）、MobileExplorer（2605.26546）、Local CUA Inference Scaling（2607.28573）、Sidekick（2607.17527）、PalmClaw（2607.13027）

两个月前的判断是「GUI Agent 正在从模型能力问题变成系统工程问题」。这两个月的新证据把它推进了一步：**系统工程内部也在分层——观察空间与判定器这两个「外围组件」的重要性，已经超过了「再练一个更大模型」**。移动端因为结构化通道最全、真机成本最低、攻击面最直接，会是这场分层变革里最先见分晓的战场。

## 参考链接

- OSU-NLP-Group GUI Agents Paper List: https://github.com/OSU-NLP-Group/GUI-Agents-Paper-List
- OSWorld-Verified 榜单: https://os-world.github.io/
- OSWorld 2.0: https://arxiv.org/abs/2606.29537
- AndroidWorld 榜单: https://android-world.github.io/
- Qwen-CUA 技术报告: https://arxiv.org/abs/2608.02352
- ComponentBench: https://componentbench.com
- MobileWorldSafety: https://arxiv.org/abs/2608.17659
- OSReward: https://arxiv.org/abs/2607.28609
- StateAct: https://arxiv.org/abs/2607.22798
