---
title: "近两个月 GUI Agent 论文全景：从“会点击”走向可训练、可验证、可部署的 Computer Use 系统"
description: "梳理 2026-04-08 至 2026-06-08 期间可检索到的 90+ 篇 GUI Agent / Computer-Use Agent 相关论文，总结基准环境、GUI grounding、RL 训练、长程记忆、工具融合、安全可靠性等研究趋势。"
date: "2026-06-08"
tags: ["GUI Agent", "Computer Use", "VLM", "Research", "Survey"]
draft: false
featured: true
readingTime: 24
---

## 目录

1. 这两个月发生了什么
2. 我如何界定和检索“GUI Agent 论文”
3. 总体趋势：GUI Agent 正在从模型能力问题变成系统工程问题
4. 趋势一：基准和环境爆发，研究重心转向“可验证任务世界”
5. 趋势二：GUI grounding 从单点点击进入复杂几何交互
6. 趋势三：RL、过程奖励和自进化成为主流训练路线
7. 趋势四：长程任务需要记忆、世界模型和上下文压缩
8. 趋势五：GUI-only 正在让位于 GUI + Tool + CLI 的混合动作
9. 趋势六：安全、可靠性、隐私成为部署前置条件
10. 对 macOS 研发效率工具的启发
11. 近两个月论文清单
12. 总结

## 1. 这两个月发生了什么

如果只看单篇论文，GUI Agent 似乎每天都在解决一个局部问题：点得更准、跑得更快、任务更长、评测更真实。但把 2026-04-08 到 2026-06-08 这两个月的论文放在一起看，会发现方向已经明显变化：

**GUI Agent 研究不再只是“让多模态模型根据截图点一个坐标”，而是在构建一套可训练、可评测、可恢复、可约束、可部署的 computer-use 系统。**

我这次用 arXiv 和 Web 检索了 GUI agent、computer-use agent、GUI grounding、mobile GUI agent、OSWorld、AndroidWorld、ScreenSpot、web agent 等关键词，去重后得到 101 个候选；剔除与 GUI / computer-use 关系较弱的泛 agent、游戏、代码 agent、科学可视化等条目后，整理出 **92 篇**近两个月相关论文。

这 92 篇里，最明显的不是某一个模型突然碾压所有 benchmark，而是几个方向同时加速：

- **基准和环境**：AndroidDaily、PhoneWorld、MobileGym、CUA-Gym、WindowsWorld、SaaS-Bench、OpenComputer 等试图把评测从静态截图推向真实软件世界和可验证环境。
- **GUI grounding**：从 click grounding 扩展到拖拽、区域搜索、缩放一致性、复杂多窗口桌面、代码编辑器里的像素级光标定位。
- **训练范式**：Video2GUI、GUI-CIDER、PRO-CUA、SE-GA、LiteGUI、RL GUI Agents 等把重点放到预训练、mid-training、过程奖励、自进化和小模型蒸馏。
- **长程任务**：MementoGUI、Mem-W、Executable Agentic Memory、ReVision、VLAA-GUI 等关注长期上下文、状态记忆、视觉冗余和恢复策略。
- **混合动作**：ToolCUA、AutoRPA、CLI-Anything、AppAgent-Claw、SkillDroid 等开始承认 GUI 不是唯一交互面，工具、脚本、CLI、RPA 和 API 是更稳的执行通道。
- **安全可靠性**：AgentHijack、MIRAGE、BraveGuard、ProjGuard、CORA、TOCTOU、HalluClear 等把部署风险摆到台前：环境内容会误导 agent，截图会变，权限会被滥用，隐私会泄露。

这篇文章不是逐篇摘要，而是把这些论文当成一个信号：GUI Agent 领域正在从“模型能不能看懂屏幕”进入“系统能不能在真实环境稳定工作”的阶段。

## 2. 我如何界定和检索“GUI Agent 论文”

这次我采用的是相对宽的定义：只要论文与图形界面智能体、computer-use agent、mobile / desktop / web agent、GUI grounding、软件界面自动化、GUI 安全与可靠性、可验证 GUI 环境或混合 GUI 工具执行强相关，就纳入清单。

检索时间窗口：**2026-04-08 至 2026-06-08**。

主要关键词包括：

- GUI agent / GUI agents
- computer-use agent / computer using agent
- GUI grounding / GUI automation
- mobile GUI agent / desktop GUI agent / web agent
- OSWorld / AndroidWorld / ScreenSpot / VisualWebArena
- GUI trajectory / graphical user interface agent

需要说明的是，“所有论文”在实践里只能定义为“在上述关键词和来源下可检索到、且与 GUI Agent 强相关的论文”。例如有些泛 agent benchmark、游戏 agent、代码 agent、医学或安全论文会在关键词里被召回，但和 GUI agent 主线关系较弱，我没有放进正文趋势统计；完整相关清单放在第 11 节。

## 3. 总体趋势：GUI Agent 正在从模型能力问题变成系统工程问题

过去一年 GUI Agent 的主线经常是：给模型一张截图、一条指令，让它输出点击坐标或动作序列。这个范式非常重要，因为 GUI agent 的入口确实是视觉理解和空间定位。但近两个月的论文显示，单点能力已经不够了。

真实 computer-use 场景至少包含六层问题：

1. **感知层**：截图是否看得清？元素能否被定位？坐标有没有偏差？多窗口和小控件怎么办？
2. **动作层**：除了点击，还要拖拽、滑动、框选、输入、快捷键、菜单操作、文件拖放。
3. **任务层**：任务往往跨页面、跨 App、跨文档、跨账号状态，不是一步能完成。
4. **环境层**：真实软件会变，页面动态加载，广告、弹窗、第三方内容和权限提示都会干扰 agent。
5. **训练层**：人工轨迹贵，真实环境慢，需要合成数据、视频轨迹、可验证环境和 RL。
6. **治理层**：部署时要有权限边界、安全监控、隐私保护、失败恢复、审计和人工接管。

所以这两个月的研究趋势，可以概括为一句话：

**GUI Agent 从“多模态模型 + 屏幕坐标”升级为“模型 + 环境 + 训练数据 + 工具接口 + 安全治理”的完整系统。**

这对做 macOS 研发效率工具尤其重要。桌面自动化不是只让模型点一个按钮，而是要在 IDE、终端、浏览器、Finder、系统设置、企业 IM、工单系统之间建立可靠的任务执行链。

## 4. 趋势一：基准和环境爆发，研究重心转向“可验证任务世界”

这两个月最密集的方向是 benchmark 和 environment。

代表性论文包括：

- **WindowsWorld**：面向专业跨应用桌面任务的 process-centric benchmark。
- **AndroidDaily**：真实闭源 Android 应用上的可验证 mobile GUI agent benchmark。
- **MobileGym / CUA-Gym / PhoneWorld**：为训练和评测提供可并行、可验证、可扩展的 GUI agent 环境。
- **OpenComputer**：强调 verifiable software worlds，让 computer-use agent 的任务结果能够被程序化检查。
- **SaaS-Bench**：把评测推进到真实 SaaS 专业工作流。
- **HealthAdminBench / MedCUA-Bench**：进入医疗行政和临床场景，说明垂直领域评测正在出现。

为什么 benchmark 会突然变多？核心原因是：**静态截图 benchmark 已经无法解释真实任务成败。**

一个 agent 在 ScreenSpot 上点得准，不代表它能在真实软件里完成任务。真实任务有状态变化、网络延迟、弹窗、版本差异、错误恢复、登录态、权限限制和多步依赖。更关键的是，很多任务的成功不是“点击了某个元素”，而是“最终业务状态正确”。

因此，新的环境论文普遍在追求三个目标：

- **可验证**：任务完成与否可以自动判定，而不只是人工看轨迹。
- **可扩展**：环境可以批量运行，支持 RL 和大规模数据采集。
- **接近真实软件**：覆盖闭源 App、SaaS、Windows 桌面、短视频平台、医疗行政等真实场景。

这说明领域正在补基础设施。没有可验证环境，就很难训练可靠 agent；没有真实软件世界，就很难知道模型是否真的能部署。

## 5. 趋势二：GUI grounding 从单点点击进入复杂几何交互

GUI grounding 仍然是核心瓶颈，但问题定义正在变宽。

早期 grounding 更像是：给一句话和一张图，输出一个点击坐标。现在的论文已经开始覆盖更细的几何控制：

- **DragOn** 专门研究拖拽交互，覆盖文本高亮、单元格选择、元素 resize、slider 操作等，指出 drag grounding 数据比 click grounding 少一个数量级。
- **WinDeskGround** 关注复杂多窗口桌面环境中的鲁棒定位。
- **PrecisionCUA** 聚焦代码编辑器里的像素级 cursor grounding。
- **DRS-GUI、AutoFocus、UI-Zoomer、Zoom Consistency** 关注动态区域搜索、主动视觉搜索、缩放和置信信号。
- **BAMI、GUI-Perturbed、What Happens Before Decoding?** 则从 bias、domain randomization、prefill 等角度解释 grounding 为什么会系统性失败。

这背后的结论很明确：**GUI agent 的动作空间不是离散按钮，而是连续、几何化、上下文相关的操作空间。**

在研发效率场景里，这个问题尤其明显。比如：

- 在 IDE 里移动光标、选中一段代码、拖拽文件、调整 diff 面板。
- 在表格或日志界面中框选区域。
- 在图形化调试器里缩放视图、拖拽节点。
- 在 macOS 系统设置里处理多窗口和浮层。

这些动作无法只靠“点击按钮”覆盖。未来的桌面 agent 必须同时具备元素级语义 grounding、像素级几何控制和连续动作反馈。

## 6. 趋势三：RL、过程奖励和自进化成为主流训练路线

另一个明显变化是：越来越多论文不满足于 SFT，而是转向 RL、过程奖励、自蒸馏、自进化和 mid-training。

代表工作包括：

- **Video2GUI**：从互联网教程视频合成大规模 GUI 交互轨迹，用于通用 GUI agent 预训练。
- **GUI-CIDER**：把 GUI 轨迹转成可内化的因果知识，在 mid-training 阶段提升模型。
- **PRO-CUA**：强调 computer-use agent 的过程奖励优化，而不是只看最终成功。
- **SE-GA**：memory-augmented self-evolution，让 agent 从自身执行经验中演化。
- **LiteGUI**：用 RL 蒸馏紧凑 GUI agent。
- **GUI Agents with Reinforcement Learning**：系统性讨论 RL 如何让 GUI agent 更像“数字居民”。
- **Learn where to Click from Yourself**：on-policy self-distillation，让模型从自身探索中学习点击。

为什么 RL 在 GUI agent 里变重要？因为 GUI task 天然具有“交互式、部分可观测、长程、可失败恢复”的特点。单步 SFT 学到的是人类演示的平均行为，但真实任务里 agent 需要：

- 在不确定时探索。
- 在点错后恢复。
- 在长程任务里管理风险。
- 在不同 UI 状态下选择不同策略。
- 通过环境反馈更新策略。

不过，这也带来新的基础设施要求：RL 需要可验证环境、可并行运行、可靠 reward、失败轨迹诊断和安全 sandbox。这也解释了为什么 benchmark/environment 论文和 RL 论文同时爆发。

## 7. 趋势四：长程任务需要记忆、世界模型和上下文压缩

长程任务是 GUI agent 走向实际生产力工具的关键，但它也是当前系统最容易崩的地方。

相关论文包括：

- **MementoGUI**：学习 multimodal memory control，面向长程 GUI agent。
- **Mem-W**：提出 latent memory-native GUI agents。
- **Executable Agentic Memory**：让记忆不只是文本摘要，而是可执行的状态和过程结构。
- **ReVision**：利用 temporal visual redundancy reduction 扩展 computer-use agent。
- **How Mobile World Model Guides GUI Agents?**：探索 mobile GUI world model 对 agent 的指导作用。
- **VLAA-GUI**：在 stop、recover、search 等行为上构建模块化 GUI automation 框架。
- **Context-Aware Workflow Decomposition**：把移动 UI 标注任务进行上下文感知的 workflow decomposition。

这些论文共同指向一个事实：**把完整历史截图和动作全部塞进上下文，是不可持续的。**

真实 GUI 任务里，大量状态是重复的：窗口布局、导航栏、列表项、固定控件、历史动作。真正需要保留的是状态变化、未完成目标、关键证据、失败原因和可恢复点。

对 macOS 研发效率工具来说，这可以转化为几个设计原则：

- 不要只记录屏幕录像，要抽取结构化状态变化。
- 每一步动作都应该有“为什么做、看到了什么、改变了什么”的可追踪记录。
- 对长任务保留 checkpoint，支持回滚、重试和人工接管。
- 将常见工作流沉淀成可复用技能，而不是每次重新规划。

## 8. 趋势五：GUI-only 正在让位于 GUI + Tool + CLI 的混合动作

过去 computer-use agent 常被定义为“只看屏幕、只用鼠标键盘”。但近两个月的论文显示，纯 GUI 路线正在被混合动作路线挑战。

代表论文包括：

- **ToolCUA**：研究 GUI-tool path orchestration，决定什么时候走 GUI、什么时候调用工具。
- **CLI-Anything**：提出 agent-native computer use，把 CLI 作为更稳定的执行界面。
- **AppAgent-Claw**：标题非常直接：CLI Is All You Need for GUI Automation。
- **AutoRPA**：从交互中合成代码，提升 GUI automation 效率。
- **SkillDroid**：compile once, reuse forever，强调技能复用。

这并不意味着 GUI 不重要，而是意味着：**GUI 是人类接口，但不总是 agent 的最佳执行接口。**

如果任务是“修改一段配置并重启服务”，直接调用 CLI 或 API 往往比在图形界面里找按钮可靠。如果任务是“检查某个设计稿视觉状态”，GUI 观察又不可替代。真正有用的 computer-use agent 应该能在 GUI、CLI、API、脚本、快捷指令、RPA 之间切换。

这对 macOS 工具尤其关键。macOS 本身就有丰富的自动化层：AppleScript、Shortcuts、Accessibility API、shell、x-callback-url、应用内 CLI、文件系统、系统偏好设置、日志和通知中心。一个好的研发效率 agent 不应该执着于“模拟人点鼠标”，而应该选择最稳定、最可审计、最小权限的执行通道。

## 9. 趋势六：安全、可靠性、隐私成为部署前置条件

安全方向在这两个月非常密集，而且不再停留在抽象 prompt injection。

代表论文包括：

- **AgentHijack**：评测 computer-use agent 对常见环境污染的鲁棒性。
- **MIRAGE**：研究移动 GUI agent 面对用户生成内容时的上下文感知 prompt injection。
- **Temporal UI State Inconsistency / TOCTOU**：指出 agent 看到的 UI 状态和执行时状态可能不一致。
- **BraveGuard、ProjGuard、CORA**：尝试用监控、低维投影、风险控制等方式提供部署安全边界。
- **HalluClear、On the Reliability of Computer Use Agents**：关注幻觉、可靠性和失败诊断。
- **MaskClaw、Mobile GUI Agent Privacy Personalization**：把隐私和个性化偏好纳入 GUI agent。
- **Constraining Host-Level Abuse**：关注自托管 computer-use agent 的宿主机级滥用问题。

这些论文反复提醒同一件事：GUI agent 的输入不是干净文本，而是复杂环境。环境里可能有广告、评论、网页内容、恶意提示、伪造按钮、遮挡窗口、延迟加载、权限弹窗和用户隐私。

对部署来说，安全不是最后加一个 guardrail，而应该从架构层前置：

- **权限隔离**：agent 默认不能访问所有 App、文件和账户。
- **动作审计**：每一步都要记录观察、决策、动作和结果。
- **状态校验**：执行前后校验 UI 状态，防止 TOCTOU。
- **风险分级**：删除、支付、发送、授权、上传等动作需要更高门槛。
- **隐私最小化**：截图、OCR、日志、轨迹数据要脱敏和可删除。
- **人工接管**：高风险或低置信任务应该主动请求确认。

GUI agent 越接近真实桌面，越像一个有权限的“数字员工”。数字员工必须有制度，而不仅是模型能力。

## 10. 对 macOS 研发效率工具的启发

结合这两个月趋势，我对 macOS 研发效率工具有几个判断。

**第一，桌面 agent 的核心资产不是 prompt，而是可验证工作流。** 例如发版检查、CI 失败排障、证书更新、日志采集、崩溃复现、App Store Connect 操作，都应该被拆成可观测步骤、可验证状态和可回滚动作。

**第二，Accessibility API + CLI + 文件系统应该共同构成执行层。** 对 GUI 能力的投入不能只放在截图定位上，还要打通系统 API、命令行工具、应用内部自动化接口和脚本执行。

**第三，研发场景天然适合“技能沉淀”。** 每次排障和自动化执行都可以沉淀成 reusable skill：前置条件、命令、检查点、失败处理、权限边界。这比让模型每次从零规划更稳定。

**第四，GUI 数据要从“录屏”升级为“结构化轨迹”。** 只保存视频不够，要同时保存截图、元素树、动作、OCR、窗口状态、命令输出、文件 diff、验证结果和错误原因。

**第五，安全和审计要产品化。** 研发工具往往能访问源码、密钥、CI、生产配置和企业账号。GUI agent 的每次动作都应该可追踪、可解释、可撤销。

**第六，本地小模型会有机会。** LiteGUI、小模型 domain specialization、edge-side privacy arbitration 等方向说明，未来不一定所有 desktop automation 都要调用超大模型。对于高频、隐私敏感、模式稳定的研发工作流，本地小模型 + 规则 + 工具可能更经济可靠。

## 11. 近两个月论文清单

下面是本次检索整理出的 92 篇相关论文。分类是为了阅读方便，不代表论文唯一归属；不少论文同时涉及训练、评测、安全或系统设计。

### 11.1 基准、环境与可验证评测（23 篇）

- 2026-06-04 · [DragOn: A Benchmark and Dataset for Drag-Based GUI Interactions](https://arxiv.org/abs/2606.06322) · `2606.06322`
- 2026-06-03 · [Benchmarking Living-Screen-Native GUI Agents on Short-Video Platforms](https://arxiv.org/abs/2606.04701) · `2606.04701`
- 2026-06-02 · [MedCUA-Bench: A Screenshot-Only Benchmark for Clinical Computer-Use Agents](https://arxiv.org/abs/2606.03203) · `2606.03203`
- 2026-05-28 · [Recovering Policy-Induced Errors: Benchmarking and Trajectory Synthesis for Robust GUI Agents](https://arxiv.org/abs/2605.29447) · `2605.29447`
- 2026-05-28 · [STAMP: Training Explicit Memory for Mobile GUI Agents in Controllable and Scalable Virtual Environments](https://arxiv.org/abs/2605.29324) · `2605.29324`
- 2026-05-28 · [PhoneWorld: Scaling Phone-Use Agent Environments](https://arxiv.org/abs/2605.29486) · `2605.29486`
- 2026-05-26 · [AndroidDaily: A Verifiable Benchmark for Mobile GUI Agents on Real-World Closed-Source Applications](https://arxiv.org/abs/2605.27761) · `2605.27761`
- 2026-05-25 · [MobileGym: A Verifiable and Highly Parallel Simulation Platform for Mobile GUI Agent Research](https://arxiv.org/abs/2605.26114) · `2605.26114`
- 2026-05-25 · [CUA-Gym: Scaling Verifiable Training Environments and Tasks for Computer-Use Agents](https://arxiv.org/abs/2605.25624) · `2605.25624`
- 2026-05-24 · [SimuWoB: Simulating Real-World Mobile Apps for Fast and Faithful GUI Agent Benchmarking](https://arxiv.org/abs/2605.25160) · `2605.25160`
- 2026-05-19 · [CutVerse: A Compositional GUI Agents Benchmark for Media Post-Production Editing](https://arxiv.org/abs/2605.19484) · `2605.19484`
- 2026-05-19 · [OpenComputer: Verifiable Software Worlds for Computer-Use Agents](https://arxiv.org/abs/2605.19769) · `2605.19769`
- 2026-05-17 · [DiagEval: Trajectory-Conditioned Diagnosis for Reliable Software Evaluation with GUI Agents](https://arxiv.org/abs/2605.17439) · `2605.17439`
- 2026-05-17 · [TClone: Low-Latency Forking of Live GUI Environments for Computer-Use Agents](https://arxiv.org/abs/2605.17320) · `2605.17320`
- 2026-05-15 · [SaaS-Bench: Can Computer-Use Agents Leverage Real-World SaaS to Solve Professional Workflows?](https://arxiv.org/abs/2605.15777) · `2605.15777`
- 2026-05-13 · [WinDeskGround: A Benchmark for Robust GUI Grounding in Complex Multi-Window Desktop Environments](https://arxiv.org/abs/2605.16402) · `2605.16402`
- 2026-05-12 · [Covering Human Action Space for Computer Use: Data Synthesis and Benchmark](https://arxiv.org/abs/2605.12501) · `2605.12501`
- 2026-05-11 · [How Mobile World Model Guides GUI Agents?](https://arxiv.org/abs/2605.10347) · `2605.10347`
- 2026-04-30 · [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments](https://arxiv.org/abs/2604.27776) · `2604.27776`
- 2026-04-27 · [Odysseys: Benchmarking Web Agents on Realistic Long Horizon Tasks](https://arxiv.org/abs/2604.24964) · `2604.24964`
- 2026-04-13 · [CocoaBench: Evaluating Unified Digital Agents in the Wild](https://arxiv.org/abs/2604.11201) · `2604.11201`
- 2026-04-10 · [HealthAdminBench: Evaluating Computer-Use Agents on Healthcare Administration Tasks](https://arxiv.org/abs/2604.09937) · `2604.09937`
- 2026-04-10 · [EE-MCP: Self-Evolving MCP-GUI Agents via Automated Environment Generation and Experience Learning](https://arxiv.org/abs/2604.09815) · `2604.09815`

### 11.2 Grounding、视觉定位与推理效率（18 篇）

- 2026-06-01 · [STaR-KV: Spatio-Temporal Adaptive Re-weighting for KV Cache Compression in GUI Vision-Language Models](https://arxiv.org/abs/2606.01790) · `2606.01790`
- 2026-05-29 · [GUI-C²: Coarse-to-Fine GUI Grounding via Difficulty-Aware Reinforcement Learning](https://arxiv.org/abs/2605.30884) · `2605.30884`
- 2026-05-28 · [DiffSpot: Can VLMs Spot Fine-Grained Visual Differences in Web Interfaces?](https://arxiv.org/abs/2605.29615) · `2605.29615`
- 2026-05-20 · [Agent JIT Compilation for Latency-Optimizing Web Agent Planning and Scheduling](https://arxiv.org/abs/2605.21470) · `2605.21470`
- 2026-05-19 · [AQuaUI: Visual Token Reduction for GUI Agents with Adaptive Quadtrees](https://arxiv.org/abs/2605.19260) · `2605.19260`
- 2026-05-16 · [TriAxialKV: Toward Extreme Low-Precision KV-Cache Quantization for Agentic Inference Tasks](https://arxiv.org/abs/2605.17170) · `2605.17170`
- 2026-05-15 · [DRS-GUI: Dynamic Region Search for Training-Free GUI Grounding](https://arxiv.org/abs/2605.15542) · `2605.15542`
- 2026-05-10 · [What Happens Before Decoding? Prefill Determines GUI Grounding in VLMs](https://arxiv.org/abs/2605.12549) · `2605.12549`
- 2026-05-07 · [BAMI: Training-Free Bias Mitigation in GUI Grounding](https://arxiv.org/abs/2605.06664) · `2605.06664`
- 2026-05-04 · [AutoFocus: Uncertainty-Aware Active Visual Search for GUI Grounding](https://arxiv.org/abs/2605.02630) · `2605.02630`
- 2026-05-01 · [Learn where to Click from Yourself: On-Policy Self-Distillation for GUI Grounding](https://arxiv.org/abs/2605.00642) · `2605.00642`
- 2026-04-27 · [GoClick: Lightweight Element Grounding Model for Autonomous GUI Interaction](https://arxiv.org/abs/2604.23941) · `2604.23941`
- 2026-04-23 · [Measure Twice, Click Once: Co-evolving Proposer and Visual Critic via Reinforcement Learning for GUI Grounding](https://arxiv.org/abs/2604.21268) · `2604.21268`
- 2026-04-22 · [AgentLens: Adaptive Visual Modalities for Human-Agent Interaction in Mobile GUI Agents](https://arxiv.org/abs/2604.20279) · `2604.20279`
- 2026-04-15 · [Zoom Consistency: A Free Confidence Signal in Multi-Step Visual Grounding Pipelines](https://arxiv.org/abs/2604.15376) · `2604.15376`
- 2026-04-15 · [UI-Zoomer: Uncertainty-Driven Adaptive Zoom-In for GUI Grounding](https://arxiv.org/abs/2604.14113) · `2604.14113`
- 2026-04-15 · [GUI-Perturbed: Domain Randomization Reveals Systematic Brittleness in GUI Grounding Models](https://arxiv.org/abs/2604.14262) · `2604.14262`
- 2026-04-14 · [PrecisionCUA: Iterative Visual Refinement for Pixel-Precise Cursor Grounding in Code Editors](https://arxiv.org/abs/2604.13019) · `2604.13019`

### 11.3 训练范式、RL 与自进化（10 篇）

- 2026-05-27 · [GUI-CIDER: Mid-training GUI Agents via Causal Internalization and Density-aware Exemplar Reselection](https://arxiv.org/abs/2605.28534) · `2605.28534`
- 2026-05-27 · [PRO-CUA: Process-Reward Optimization for Computer Use Agents](https://arxiv.org/abs/2605.29119) · `2605.29119`
- 2026-05-27 · [Learn from Weaknesses: Automated Domain Specialization for Small Computer-Use Agents](https://arxiv.org/abs/2605.28775) · `2605.28775`
- 2026-05-16 · [SE-GA: Memory-Augmented Self-Evolution for GUI Agents](https://arxiv.org/abs/2605.16883) · `2605.16883`
- 2026-05-14 · [Video2GUI: Synthesizing Large-Scale Interaction Trajectories for Generalized GUI Agent Pretraining](https://arxiv.org/abs/2605.14747) · `2605.14747`
- 2026-05-08 · [LiteGUI: Distilling Compact GUI Agents with Reinforcement Learning](https://arxiv.org/abs/2605.07505) · `2605.07505`
- 2026-05-02 · [Faithful Mobile GUI Agents with Guided Advantage Estimator](https://arxiv.org/abs/2605.01208) · `2605.01208`
- 2026-04-30 · [GUI Agents with Reinforcement Learning: Toward Digital Inhabitants](https://arxiv.org/abs/2604.27955) · `2604.27955`
- 2026-04-28 · [Training Computer Use Agents to Assess the Usability of Graphical User Interfaces](https://arxiv.org/abs/2604.26020) · `2604.26020`
- 2026-04-15 · [UI-Copilot: Advancing Long-Horizon GUI Automation via Tool-Integrated Policy Optimization](https://arxiv.org/abs/2604.13822) · `2604.13822`

### 11.4 长程任务、记忆与世界模型（7 篇）

- 2026-06-01 · [Context-Aware Workflow Decomposition for Automated Mobile UI Annotation Using Multimodal Large Language Models](https://arxiv.org/abs/2606.02208) · `2606.02208`
- 2026-05-18 · [MementoGUI: Learning Agentic Multimodal Memory Control for Long-Horizon GUI Agents](https://arxiv.org/abs/2605.18652) · `2605.18652`
- 2026-05-18 · [DocOS: Towards Proactive Document-Guided Actions in GUI Agents](https://arxiv.org/abs/2605.18048) · `2605.18048`
- 2026-05-12 · [Executable Agentic Memory for GUI Agent](https://arxiv.org/abs/2605.12294) · `2605.12294`
- 2026-05-11 · [ReVision: Scaling Computer-Use Agents via Temporal Visual Redundancy Reduction](https://arxiv.org/abs/2605.11212) · `2605.11212`
- 2026-05-10 · [Mem-W: Latent Memory-Native GUI Agents](https://arxiv.org/abs/2605.09317) · `2605.09317`
- 2026-04-23 · [VLAA-GUI: Knowing When to Stop, Recover, and Search, A Modular Framework for GUI Automation](https://arxiv.org/abs/2604.21375) · `2604.21375`

### 11.5 工具融合、RPA 与混合动作（5 篇）

- 2026-06-02 · [CLI-Anything: Towards Agent-Native Computer Use](https://arxiv.org/abs/2606.03854) · `2606.03854`
- 2026-05-20 · [AutoRPA: Efficient GUI Automation through LLM-Driven Code Synthesis from Interactions](https://arxiv.org/abs/2605.21082) · `2605.21082`
- 2026-05-12 · [ToolCUA: Towards Optimal GUI-Tool Path Orchestration for Computer Use Agents](https://arxiv.org/abs/2605.12481) · `2605.12481`
- 2026-04-16 · [SkillDroid: Compile Once, Reuse Forever](https://arxiv.org/abs/2604.14872) · `2604.14872`
- 2026-04-15 · [AppAgent-Claw: CLI Is All You Need for GUI Automation](https://arxiv.org/abs/2606.05171) · `2606.05171`

### 11.6 安全、可靠性与隐私（16 篇）

- 2026-06-03 · [Domain-Conditioned Safety in Frontier Computer-Using Agents: A 793-Episode Browser Benchmark, a Coding-Domain Cross-Reference, and a Reproducibility Audit of Recent Red-Teaming](https://arxiv.org/abs/2606.05233) · `2606.05233`
- 2026-05-31 · [BraveGuard: From Open-World Threats to Safer Computer-Use Agents](https://arxiv.org/abs/2606.01166) · `2606.01166`
- 2026-05-27 · [MaskClaw: Edge-Side Personalized Privacy Arbitration for GUI Agents with Behavior-Driven Skill Evolution](https://arxiv.org/abs/2605.28646) · `2605.28646`
- 2026-05-27 · [MIRAGE: Context-Aware Prompt Injection against Mobile GUI Agents via User-Generated Content](https://arxiv.org/abs/2605.28116) · `2605.28116`
- 2026-05-25 · [AgentHijack: Benchmarking Computer Use Agent Robustness to Common Environment Corruptions](https://arxiv.org/abs/2605.25707) · `2605.25707`
- 2026-05-13 · [ProjGuard: Safety Monitoring for Computer-Use Agents via Low-Dimensional Projections](https://arxiv.org/abs/2605.13631) · `2605.13631`
- 2026-05-08 · [Securing Computer-Use Agents: A Unified Architecture-Lifecycle Framework for Deployment-Grounded Reliability](https://arxiv.org/abs/2605.07110) · `2605.07110`
- 2026-05-07 · [Constraining Host-Level Abuse in Self-Hosted Computer-Use Agents via TEE-Backed Isolation](https://arxiv.org/abs/2605.06393) · `2605.06393`
- 2026-04-20 · [Human-Guided Harm Recovery for Computer Use Agents](https://arxiv.org/abs/2604.18847) · `2604.18847`
- 2026-04-20 · [Temporal UI State Inconsistency in Desktop GUI Agents: Formalizing and Defending Against TOCTOU Attacks on Computer-Use Agents](https://arxiv.org/abs/2604.18860) · `2604.18860`
- 2026-04-20 · [On the Reliability of Computer Use Agents](https://arxiv.org/abs/2604.17849) · `2604.17849`
- 2026-04-19 · [HalluClear: Diagnosing, Evaluating and Mitigating Hallucinations in GUI Agents](https://arxiv.org/abs/2604.17284) · `2604.17284`
- 2026-04-13 · [Mobile GUI Agent Privacy Personalization with Trajectory Induced Preference Optimization](https://arxiv.org/abs/2604.11259) · `2604.11259`
- 2026-04-12 · [The Blind Spot of Agent Safety: How Benign User Instructions Expose Critical Vulnerabilities in Computer-Use Agents](https://arxiv.org/abs/2604.10577) · `2604.10577`
- 2026-04-10 · [CORA: Conformal Risk-Controlled Agents for Safeguarded Mobile GUI Automation](https://arxiv.org/abs/2604.09155) · `2604.09155`
- 2026-04-09 · [Preference Redirection via Attention Concentration: An Attack on Computer Use Agents](https://arxiv.org/abs/2604.08005) · `2604.08005`

### 11.7 其他相关方向（13 篇）

- 2026-06-02 · [Demo2Tutorial: From Human Experience to Multimodal Software Tutorials](https://arxiv.org/abs/2606.03951) · `2606.03951`
- 2026-06-01 · [Multi-Agent Computer Use](https://arxiv.org/abs/2606.01533) · `2606.01533`
- 2026-05-28 · [UI-KOBE: Knowledge-Oriented Behavior Exploration for Lightweight Graph-Guided GUI Agents](https://arxiv.org/abs/2605.29534) · `2605.29534`
- 2026-05-27 · [Do you dare to try Test-Driven Forensics? Increasing Trust in Desktop Forensics with ADARE](https://arxiv.org/abs/2605.28476) · `2605.28476`
- 2026-05-26 · [MobileExplorer: Accelerating On-Device Inference for Mobile GUI Agents via Online Exploration](https://arxiv.org/abs/2605.26546) · `2605.26546`
- 2026-05-15 · [ScreenSearch: Uncertainty-Aware OS Exploration](https://arxiv.org/abs/2605.16024) · `2605.16024`
- 2026-05-15 · [PAGER: Bridging the Semantic-Execution Gap in Point-Precise Geometric GUI Control](https://arxiv.org/abs/2605.15963) · `2605.15963`
- 2026-05-14 · [Beyond Binary: Reframing GUI Critique as Continuous Semantic Alignment](https://arxiv.org/abs/2605.14311) · `2605.14311`
- 2026-05-07 · [Computer Use at the Edge of the Statistical Precipice](https://arxiv.org/abs/2605.08261) · `2605.08261`
- 2026-05-04 · [cotomi Act: Learning to Automate Work by Watching You](https://arxiv.org/abs/2605.03231) · `2605.03231`
- 2026-05-04 · [Augmenting Interface Usability Heuristics for Reliable Computer-Use Agents](https://arxiv.org/abs/2605.02729) · `2605.02729`
- 2026-04-29 · [Step-level Optimization for Efficient Computer-use Agents](https://arxiv.org/abs/2604.27151) · `2604.27151`
- 2026-04-15 · [Towards Scalable Lightweight GUI Agents via Multi-role Orchestration](https://arxiv.org/abs/2604.13488) · `2604.13488`

## 12. 总结

近两个月 GUI Agent 论文给我的最大感受是：这个方向已经过了“demo 驱动”的早期阶段，正在进入“基础设施驱动”的阶段。

下一阶段真正重要的可能不是某个模型在单一点击 benchmark 上多涨几个点，而是下面这些能力能否组合起来：

- 有足够真实、足够可验证、足够可扩展的任务环境。
- 有覆盖点击、拖拽、输入、框选、滚动、多窗口和连续控制的 grounding 能力。
- 有能从视频、轨迹、失败、弱点和环境反馈中学习的训练管线。
- 有面向长程任务的结构化记忆、状态压缩和失败恢复。
- 有 GUI、CLI、API、RPA、脚本之间的混合动作编排。
- 有权限隔离、隐私治理、安全监控和审计机制。

如果把 GUI agent 看作未来个人电脑和移动设备上的“数字执行层”，那它不只是一个 VLM，也不只是一个浏览器插件，而是一套操作系统级的自动化基础设施。

对 macOS 研发效率工具来说，机会也在这里：把开发者每天重复的跨应用工作流转化为可学习、可验证、可复用、可审计的自动化资产。GUI agent 的终局未必是完全替代人，而是让人把更多注意力放在判断、设计和创造上，把稳定、重复、可验证的操作交给系统完成。
