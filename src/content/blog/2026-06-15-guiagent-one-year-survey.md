---
title: "近一年 GUIAgent 论文综述：从会点屏幕到可验证的移动端 QA Agent"
description: "系统梳理 2025-06-15 至 2026-06-15 公开可检索的 GUIAgent / computer-use agent 论文，从移动端 APP 自动化测试、benchmark、grounding、RL、自进化、verifier、混合工具与安全治理七条主线总结领域变化。"
date: "2026-06-15"
tags: ["GUI Agent", "Computer Use", "Survey", "Mobile QA", "APP Automation"]
draft: false
featured: false
readingTime: 38
---

## 摘要

过去一年，GUIAgent / computer-use agent 的研究重心发生了明显迁移：领域不再满足于“模型能不能在截图上点中按钮”，而是开始追问 agent 是否能在真实应用、真实设备、真实工作流中稳定完成任务，并且能否被验证、被审计、被纠错、被安全约束。

本文覆盖 2025-06-15 至 2026-06-15 的公开可检索论文与 GUI Agents Paper List 近一年相关条目。基于标题、摘要、项目页和已有论文解读，论文池中共筛出约 **250 篇** GUIAgent / computer-use agent 相关工作。它们大致汇聚成七条主线：

1. **移动端 / APP 自动化测试与 Mobile QA**：AndroidDaily、GUITester、GUITestScape、WebTestBench、WebTestPilot 等把 GUIAgent 从“完成用户任务”推向“生成、执行和验证测试”。
2. **Benchmark、环境与可验证评测**：WindowsWorld、MacArena、DeskCraft、LivingScreen、MobileGym、CUA-Gym、OpenComputer 等把评测从静态截图推向在线、长程、跨应用、动态屏幕和可验证环境。
3. **GUI grounding 与屏幕解析**：GUI-Actor、GUI-G2、AutoFocus、DRS-GUI、ScreenParse、UI-Zoomer、WinDeskGround 等继续补齐“看得准、点得稳、能处理高分辨率和复杂 UI”的底层能力。
4. **训练数据、SFT / RL 与自进化**：UI-Voyager、SE-GA、Video2GUI、GUI-CIDER、UI-TARS-2、MobileRL、PRO-CUA 等说明 GUIAgent 已进入数据飞轮和过程强化学习阶段。
5. **长程记忆、过程奖励、Verifier 与 Critic**：VeriGUI、HiViG、StainFlow、GUI-Shepherd、VAGEN、OS-Themis 等把“每一步是否有效”变成核心研究对象。
6. **Hybrid action、RPA、MCP 与工具融合**：OSWorld-MCP、ToolCUA、CLI-Anything、AutoRPA、AppAgent-Claw、SkillDroid 等表明纯视觉点击不是终局，GUI + API + CLI + test framework 的混合控制更接近生产系统。
7. **安全、隐私、权限与对抗鲁棒性**：MIRAGE、AgentRAE、CORA、GUIGuard、AgentHijack、WebSentinel、CaMeLs 等把 GUIAgent 的攻击面、权限边界和审计问题推到前台。

从 APP 自动化测试视角看，近一年最重要的变化可以概括为一句话：**GUIAgent 正在从“操作执行器”转向“可验证的测试执行与缺陷发现系统”。** 这意味着未来移动端 QA 平台不能只把大模型接到 Appium 或截图点击器上，而要建设完整闭环：任务生成、环境 reset、动作执行、等待策略、oracle 推断、日志/网络/业务状态验证、失败归因、可回放报告，以及对高风险动作的安全治理。

## 1. 范围与领域地图

本文讨论的 GUIAgent 包括几类相邻系统：

- 以截图、控件树、视频或多模态上下文为输入的 GUI 操作 agent；
- 面向 Android / iOS / Web / Desktop / OS 的 computer-use agent；
- GUI grounding、screen parsing、element localization 等底层感知模型；
- 面向 GUI 任务的 SFT、RL、过程奖励、critic、verifier、memory 与 self-evolution 方法；
- 面向 APP / Web / SaaS / OS 的自动化测试、RPA、benchmark、可验证环境与安全评估。

不把“GUIAgent”限定为单一平台是必要的。移动端 APP 自动化测试确实是本文的工程落点，但 Mobile、Web、Desktop、OS benchmark 正在共享同一组核心问题：

| 层次 | 关键问题 | 对 APP 自动化测试的意义 |
|---|---|---|
| Observation | 截图、控件树、视频、日志、网络请求、设备状态如何组合 | 决定测试 agent 能看到什么，能否处理 WebView、权限弹窗、动态内容 |
| Grounding | 如何稳定定位按钮、文本、图标、列表项、拖拽目标 | 误点会被误判为 App 缺陷，必须区分 agent error 与 product bug |
| Planning | 如何把自然语言目标拆成可执行子目标 | 从“点一下登录”扩展到登录、授权、下单、支付前校验等业务流 |
| Execution | 如何处理等待、重试、前后台、弹窗、弱网、滑动 | 决定 E2E 测试是否 flaky |
| Verification | 如何判断每一步和最终结果是否正确 | 从最终截图变成 UI、业务、日志、网络、DB/mock 状态的多层 oracle |
| Learning | 如何从失败轨迹、人工用例、录屏和历史测试中学习 | 决定测试平台能否持续进化，而不是每次靠 prompt 调参 |
| Safety | 如何限制支付、删除、发布、隐私访问等高风险动作 | 决定 agent 能否进入真实预发、灰度或生产影子环境 |

## 2. 第一条主线：移动端 / APP 自动化测试从“脚本执行”走向“缺陷发现”

移动端相关论文是近一年增长最快、也最贴近工程落地的一支。早期 Mobile GUI Agent 更多关注“能否完成用户指令”，例如打开 App、搜索内容、发送消息；近一年则出现了明显的 QA 化趋势：任务不再只是用户目标，而是测试目标；成功不再只是走到某个页面，而是发现缺陷、验证业务状态、生成可复现报告。

### 2.1 代表论文

| 时间 | 论文 |
|---|---|
| 2026-05-26 | [AndroidDaily: A Verifiable Benchmark for Mobile GUI Agents on Real-World Closed-Source Applications](https://arxiv.org/abs/2605.27761) |
| 2026-05-25 | [MobileGym: A Verifiable and Highly Parallel Simulation Platform for Mobile GUI Agent Research](https://arxiv.org/abs/2605.26114) |
| 2026-04-30 | [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments](https://arxiv.org/abs/2604.27776) |
| 2026-04-23 | [VLAA-GUI: Knowing When to Stop, Recover, and Search, A Modular Framework for GUI Automation](https://arxiv.org/abs/2604.21375) |
| 2026-04-14 | [See, Point, Refine: Multi-Turn Approach to GUI Grounding with Visual Feedback](https://arxiv.org/abs/2604.13019) |
| 2026-04-10 | [CORA: Conformal Risk-Controlled Agents for Safeguarded Mobile GUI Automation](https://arxiv.org/abs/2604.09155) |
| 2026-04-09 | [KnowU-Bench: Towards Interactive, Proactive, and Personalized Mobile Agent Evaluation](https://arxiv.org/abs/2604.08455) |
| 2026-04-08 | [Android Coach: Improve Online Agentic Training Efficiency with Single State Multiple Actions](https://arxiv.org/abs/2604.07277) |
| 2026-04-07 | [Don''t Act Blindly: Robust GUI Automation via Action-Effect Verification and Self-Correction](https://arxiv.org/abs/2604.05477) |
| 2026-04-02 | [GPA: Learning GUI Process Automation from Demonstrations](https://arxiv.org/abs/2604.01676) |
| 2026-03-31 | [Terminal Agents Suffice for Enterprise Automation](https://arxiv.org/abs/2604.00073) |
| 2026-03-31 | [PSPA-Bench: A Personalized Benchmark for Smartphone GUI Agent](https://arxiv.org/abs/2603.29318) |
| 2026-03-26 | [WebTestBench: Evaluating Computer-Use Agents towards End-to-End Automated Web Testing](https://arxiv.org/abs/2603.25226) |
| 2026-03-24 | [AgentRAE: Remote Action Execution through Notification-based Visual Backdoors against Screenshots-based Mobile GUI](https://arxiv.org/abs/2603.23007) |
| 2026-03-16 | [GUI-CEval: A Hierarchical and Comprehensive Chinese Benchmark for Mobile GUI Agents](https://arxiv.org/abs/2603.15039) |
| 2026-03-10 | [SpecOps: A Fully Automated AI Agent Testing Framework in Real-World GUI Environments](https://arxiv.org/abs/2603.10268) |
| 2026-03-09 | [SecAgent: Efficient Mobile GUI Agent with Semantic Context](https://arxiv.org/abs/2603.08533) |
| 2026-03-09 | [AgentOS: From Application Silos to a Natural Language-Driven Data Ecosystem](https://arxiv.org/abs/2603.08938) |
| 2026-03-08 | [Generalization in Online Reinforcement Learning for Mobile Agents](https://arxiv.org/abs/2603.07432) |
| 2026-02-28 | [MobiFlow: Real-World Mobile Agent Benchmarking through Trajectory Fusion](https://arxiv.org/abs/2604.09587) |
| 2026-02-24 | [Turing Test on Screen: A Benchmark for Mobile GUI Agent Humanization](https://arxiv.org/abs/2604.09574) |
| 2026-02-15 | [Mobile-Agent-v3.5: Multi-platform Fundamental GUI Agents](https://arxiv.org/abs/2602.16855) |
| 2026-02-12 | [AmbiBench: Benchmarking Mobile GUI Agents Beyond One-Shot Instructions in the Wild](https://arxiv.org/abs/2602.11750) |
| 2026-02-11 | [Blind Gods and Broken Screens: Architecting a Secure, Intent-Centric Mobile Agent Operating System](https://arxiv.org/abs/2602.10915) |
| 2026-02-10 | [TreeCUA: Efficiently Scaling GUI Automation with Tree-Structured Verifiable Evolution](https://arxiv.org/abs/2602.09662) |
| 2026-02-07 | [Mapping the Design Space of User Experience for Computer Use Agents](https://arxiv.org/abs/2602.07283) |
| 2026-02-06 | [VenusBench-Mobile: A Challenging and User-Centric Benchmark for Mobile GUI Agents with Capability Diagnostics](https://arxiv.org/abs/2604.06182) |
| 2026-02-05 | [UI-Mem: Self-Evolving Experience Memory for Online Reinforcement Learning in Mobile GUI Agents](https://arxiv.org/abs/2602.05832) |
| 2026-02-05 | [M$^2$-Miner: Multi-Agent Enhanced MCTS for Mobile GUI Agent Data Mining](https://arxiv.org/abs/2602.05429) |
| 2026-02-03 | [MemGUI-Bench: Benchmarking Memory of Mobile GUI Agents in Dynamic Environments](https://arxiv.org/abs/2602.06075) |
| 2026-01-30 | [Learning with Challenges: Adaptive Difficulty-Aware Data Generation for Mobile GUI Agent Training](https://arxiv.org/abs/2601.22781) |
| 2026-01-28 | [MobileBench-OL: A Comprehensive Chinese Benchmark for Evaluating Mobile GUI Agents in Real-World Environment](https://arxiv.org/abs/2601.20335) |
| 2026-01-26 | [SMAN-Bench: A Cross-System Benchmark for Mobile Agents under Single- and Multi-path, Ambiguous, and Noisy Tasks](https://openreview.net/forum?id=IWDpCaSF9Q) |
| 2026-01-26 | [LongHorizonUI: A Unified Framework for Robust long-horizon Task Automation of GUI Agent](https://openreview.net/forum?id=BK7Mk5d4WE) |
| 2026-01-24 | [GraphPilot: GUI Task Automation with One-Step LLM Reasoning Powered by Knowledge Graph](https://arxiv.org/abs/2601.17418) |
| 2026-01-08 | [GUITester: Enabling GUI Agents for Exploratory Defect Discovery](https://arxiv.org/abs/2601.04500) |
| 2026-01-07 | [MobileDreamer: Generative Sketch World Model for GUI Agent](https://arxiv.org/abs/2601.04035) |
| 2025-12-24 | [AndroidLens: Long-latency Evaluation with Nested Sub-targets for Android GUI Agents](https://arxiv.org/abs/2512.21302) |
| 2025-12-22 | [MobileWorld: Benchmarking Autonomous Mobile Agents in Agent-User Interactive and MCP-Augmented Environments](https://arxiv.org/abs/2512.19432) |
| 2025-12-18 | [OS-Oracle: A Comprehensive Framework for Cross-Platform GUI Critic Models](https://arxiv.org/abs/2512.16295) |
| 2025-12-16 | [MobileWorldBench: Towards Semantic World Modeling For Mobile Agents](https://arxiv.org/abs/2512.14014) |
| 2025-12-14 | [Modular and Multi-Path-Aware Offline Benchmarking for Mobile GUI Agents](https://arxiv.org/abs/2512.12634) |
| 2025-12-12 | [Using GUI Agent for Electronic Design Automation](https://arxiv.org/abs/2512.11611) |
| 2025-12-10 | [GAIR: GUI Automation via Information-Joint Reasoning and Group Reflection](https://arxiv.org/abs/2512.09396) |
| 2025-11-27 | [Training High-Level Schedulers with Execution-Feedback Reinforcement Learning for Long-Horizon GUI Automation](https://arxiv.org/abs/2511.22235) |

### 2.2 从 Mobile Agent 到 Mobile QA Agent

AndroidDaily、MobileGym、SimuWoB、GUI-CEval、MobileBench-OL、VenusBench-Mobile 代表了移动端 benchmark 的一个共识：真实移动 App 不是静态网页，也不是干净模拟器。它包含登录态、权限、推送、系统弹窗、厂商 ROM、推荐流、弱网、WebView、第三方 SDK、前后台切换和多设备同步。

这对 APP 自动化测试有三个直接结论。

**第一，测试环境本身必须成为平台能力。** MobileGym 和 SimuWoB 的价值不只是“又建了一个 benchmark”，而是把可并行、可 reset、可验证的移动环境当作训练和评测基础设施。传统 Appium / UIAutomator / XCUITest 往往解决动作执行，但不完整解决环境状态、账号状态、服务端 mock、设备扰动和结果 oracle。

**第二，探索式测试正在从随机遍历转向语义探索。** GUITester、GUITestScape、Scenario-Guided LLM-based Mobile App GUI Testing 等工作把 LLM/GUIAgent 引入缺陷发现：agent 不只是覆盖更多页面，还要理解业务意图、异常路径和潜在缺陷类型。对 QA 团队来说，这意味着“测试用例生成”会逐步变成“测试场景规划 + GUI 执行 + 缺陷证据收集”。

**第三，oracle 推断成为核心瓶颈。** WebTestPilot、From Exploration to Specification、VAGEN、GUI-Shepherd 等工作虽然横跨 Web 和 Mobile，但都指向同一个问题：agent 如何知道 App 行为是错的？最终截图很少足够。移动端 oracle 必须融合 UI 状态、接口返回、埋点、日志、crash/ANR、业务数据和历史基线。

## 3. 第二条主线：Benchmark 从静态截图转向可验证、动态、长程环境

过去的 GUI benchmark 很容易被简化成“看图点点点”。近一年最有价值的 benchmark 工作，普遍在挑战这个简化假设：任务会跨应用，屏幕会动态变化，成功需要过程证据，环境要可 reset，agent 还要知道何时等待、何时停止、何时承认失败。

### 3.1 代表论文

| 时间 | 论文 |
|---|---|
| 2026-06-03 | [Benchmarking Living-Screen-Native GUI Agents on Short-Video Platforms](https://arxiv.org/abs/2606.04701) |
| 2026-05-26 | [AndroidDaily: A Verifiable Benchmark for Mobile GUI Agents on Real-World Closed-Source Applications](https://arxiv.org/abs/2605.27761) |
| 2026-05-25 | [MobileGym: A Verifiable and Highly Parallel Simulation Platform for Mobile GUI Agent Research](https://arxiv.org/abs/2605.26114) |
| 2026-04-30 | [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments](https://arxiv.org/abs/2604.27776) |
| 2026-04-27 | [Odysseys: Benchmarking Web Agents on Realistic Long Horizon Tasks](https://arxiv.org/abs/2604.24964) |
| 2026-04-27 | [AutoGUI-v2: A Comprehensive Multi-Modal GUI Functionality Understanding Benchmark](https://arxiv.org/abs/2604.24441) |
| 2026-04-13 | [WebForge: Breaking the Realism-Reproducibility-Scalability Trilemma in Browser Agent Benchmark](https://arxiv.org/abs/2604.10988) |
| 2026-04-13 | [ClawGUI: A Unified Framework for Training, Evaluating, and Deploying GUI Agents](https://arxiv.org/abs/2604.11784) |
| 2026-04-10 | [HealthAdminBench: Evaluating Computer-Use Agents on Healthcare Administration Tasks](https://arxiv.org/abs/2604.09937) |
| 2026-04-10 | [EE-MCP: Self-Evolving MCP-GUI Agents via Automated Environment Generation and Experience Learning](https://arxiv.org/abs/2604.09815) |
| 2026-04-09 | [KnowU-Bench: Towards Interactive, Proactive, and Personalized Mobile Agent Evaluation](https://arxiv.org/abs/2604.08455) |
| 2026-04-07 | [WebSP-Eval: Evaluating Web Agents on Website Security and Privacy Tasks](https://arxiv.org/abs/2604.06367) |
| 2026-04-06 | [IntentScore: Intent-Conditioned Action Evaluation for Computer-Use Agents](https://arxiv.org/abs/2604.05157) |
| 2026-04-06 | [GUIDE: Interpretable GUI Agent Evaluation via Hierarchical Diagnosis](https://arxiv.org/abs/2604.04399) |
| 2026-03-31 | [PSPA-Bench: A Personalized Benchmark for Smartphone GUI Agent](https://arxiv.org/abs/2603.29318) |
| 2026-03-27 | [GUIDE: Resolving Domain Bias in GUI Agents through Real-Time Web Video Retrieval and Plug-and-Play Annotation](https://arxiv.org/abs/2603.26266) |
| 2026-03-26 | [WebTestBench: Evaluating Computer-Use Agents towards End-to-End Automated Web Testing](https://arxiv.org/abs/2603.25226) |
| 2026-03-26 | [GUIDE: A Benchmark for Understanding and Assisting Users in Open-Ended GUI Tasks](https://arxiv.org/abs/2603.25864) |
| 2026-03-23 | [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529) |
| 2026-03-18 | [WebPII: Benchmarking Visual PII Detection for Computer-Use Agents](https://arxiv.org/abs/2603.17357) |
| 2026-03-16 | [GUI-CEval: A Hierarchical and Comprehensive Chinese Benchmark for Mobile GUI Agents](https://arxiv.org/abs/2603.15039) |
| 2026-03-11 | [CUAAudit: Meta-Evaluation of Vision-Language Models as Auditors of Autonomous Computer-Use Agents](https://arxiv.org/abs/2603.10577) |
| 2026-03-10 | [SpecOps: A Fully Automated AI Agent Testing Framework in Real-World GUI Environments](https://arxiv.org/abs/2603.10268) |
| 2026-03-09 | [PIRA-Bench: A Transition from Reactive GUI Agents to GUI-based Proactive Intent Recommendation Agents](https://arxiv.org/abs/2603.08013) |
| 2026-03-09 | [OSExpert: Computer-Use Agents Learning Professional Skills via Exploration](https://arxiv.org/abs/2603.07978) |
| 2026-03-05 | [TimeWarp: Evaluating Web Agents by Revisiting the Past](https://arxiv.org/abs/2603.04949) |
| 2026-03-01 | [WebArena-Infinity: Generating Browser Environments with Verifiable Tasks at Scale](https://webarena.dev/webarena-infinity/) |
| 2026-02-28 | [MobiFlow: Real-World Mobile Agent Benchmarking through Trajectory Fusion](https://arxiv.org/abs/2604.09587) |
| 2026-02-28 | [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503) |
| 2026-02-25 | [OpeFlo: Automated UX Evaluation via Simulated Human Web Interaction with GUI Grounding](https://arxiv.org/abs/2604.09581) |
| 2026-02-25 | [GUI-Libra: Training Native GUI Agents to Reason and Act with Action-aware Supervision and Partially Verifiable RL](https://arxiv.org/abs/2602.22190) |
| 2026-02-24 | [Turing Test on Screen: A Benchmark for Mobile GUI Agent Humanization](https://arxiv.org/abs/2604.09574) |
| 2026-02-19 | [Persona2Web: Benchmarking Personalized Web Agents for Contextual Reasoning with User History](https://arxiv.org/abs/2602.17003) |
| 2026-02-17 | [World-Model-Augmented Web Agents with Action Correction](https://arxiv.org/abs/2602.15384) |
| 2026-02-16 | [WebWorld: A Large-Scale World Model for Web Agent Training](https://arxiv.org/abs/2602.14721) |
| 2026-02-15 | [GUI-GENESIS: Automated Synthesis of Efficient Environments with Verifiable Rewards for GUI Agent Post-Training](https://arxiv.org/abs/2602.14093) |
| 2026-02-13 | [Scaling Web Agent Training through Automatic Data Generation and Fine-grained Evaluation](https://arxiv.org/abs/2602.12544) |
| 2026-02-12 | [AmbiBench: Benchmarking Mobile GUI Agents Beyond One-Shot Instructions in the Wild](https://arxiv.org/abs/2602.11750) |
| 2026-02-11 | [UI-Oceanus: Scaling GUI Agents with Synthetic Environmental Dynamics](https://arxiv.org/abs/2604.02345) |
| 2026-02-11 | [See, Plan, Snap: Evaluating Multimodal GUI Agents in Scratch](https://arxiv.org/abs/2602.10814) |
| 2026-02-10 | [TreeCUA: Efficiently Scaling GUI Automation with Tree-Structured Verifiable Evolution](https://arxiv.org/abs/2602.09662) |
| 2026-02-10 | [Code2World: A GUI World Model via Renderable Code Generation](https://arxiv.org/abs/2602.09856) |
| 2026-02-10 | [Autonomous Continual Learning of Computer-Use Agents for Environment Adaptation](https://arxiv.org/abs/2602.10356) |
| 2026-02-06 | [VenusBench-Mobile: A Challenging and User-Centric Benchmark for Mobile GUI Agents with Capability Diagnostics](https://arxiv.org/abs/2604.06182) |
| 2026-02-05 | [PATHWAYS: Evaluating Investigation and Context Discovery in AI Web Agents](https://arxiv.org/abs/2602.05354) |
| 2026-02-03 | [MemGUI-Bench: Benchmarking Memory of Mobile GUI Agents in Dynamic Environments](https://arxiv.org/abs/2602.06075) |
| 2026-02-03 | [LPS-Bench: Benchmarking Safety Awareness of Computer-Use Agents in Long-Horizon Planning under Benign and Adversarial](https://arxiv.org/abs/2602.03255) |
| 2026-02-03 | [Agent Alpha: Tree Search Unifying Generation, Exploration and Evaluation for Computer-Use Agents](https://arxiv.org/abs/2602.02995) |
| 2026-01-29 | [How do Visual Attributes Influence Web Agents? A Comprehensive Evaluation of User Interface Design Factors](https://arxiv.org/abs/2601.21961) |
| 2026-01-28 | [OS-Marathon: Benchmarking Computer-Use Agents on Long-Horizon Repetitive Tasks](https://arxiv.org/abs/2601.20650) |

### 3.2 WindowsWorld、MacArena、DeskCraft、LivingScreen 的共同指向

WindowsWorld 把桌面任务放进跨应用、带中间 checkpoint 的专业流程中；MacArena 强调真实 macOS、第三方应用和执行式验证；DeskCraft 把 human-in-the-loop 和 professional workflow 纳入评测；LivingScreen 则直接挑战“屏幕在两次动作之间静止”的隐含假设。

这些工作看似偏桌面，但对 APP 自动化测试的启发非常强：

- **过程检查比终态成功更重要。** 一条下单链路失败，必须知道是登录、搜索、领券、加购、支付前校验还是回流出错。
- **动态 UI 是一等对象。** 短视频、直播、IM、地图、外卖、打车、行情、推荐流都不是静止页面。测试 agent 需要 watch / wait / observe / sample 的策略，而不只是 click。
- **不可行任务识别很关键。** 当账号无权限、库存不足、网络断开或服务端 mock 不满足条件时，agent 应该报告不可执行，而不是继续乱点。
- **环境 reset 和可验证性决定 benchmark 质量。** 没有可控账号态、设备态、服务端态，移动端 benchmark 很容易不可复现。

## 4. 第三条主线：GUI grounding 仍是底座，但不再是全部

GUI grounding 仍然是 GUIAgent 的底层能力。真实 App 中，按钮很小、文字密集、列表可滚动、图标语义模糊、WebView 与 Native 混合、高 DPI 和不同分辨率会造成定位漂移。近一年 grounding 工作大多围绕 coordinate-free、区域搜索、zoom-in、完整 screen parsing、测试时增强和鲁棒性展开。

### 4.1 代表论文

| 时间 | 论文 |
|---|---|
| 2026-06-03 | [Benchmarking Living-Screen-Native GUI Agents on Short-Video Platforms](https://arxiv.org/abs/2606.04701) |
| 2026-05-29 | [GUI-C²: Coarse-to-Fine GUI Grounding via Difficulty-Aware Reinforcement Learning](https://z1oong.github.io/GUI-C2/) |
| 2026-05-01 | [A11y-Compressor: A Framework for Enhancing the Efficiency of GUI Agent Observations through Visual Context Reconstruction](https://arxiv.org/abs/2605.00551) |
| 2026-04-15 | [UI-Zoomer: Uncertainty-Driven Adaptive Zoom-In for GUI Grounding](https://arxiv.org/abs/2604.14113) |
| 2026-04-15 | [GUI-Perturbed: Domain Randomization Reveals Systematic Brittleness in GUI Grounding Models](https://arxiv.org/abs/2604.14262) |
| 2026-04-14 | [See, Point, Refine: Multi-Turn Approach to GUI Grounding with Visual Feedback](https://arxiv.org/abs/2604.13019) |
| 2026-04-09 | [MolmoWeb: Open Visual Web Agent and Open Data for the Open Web](https://arxiv.org/abs/2604.08516) |
| 2026-04-09 | [Are GUI Agents Focused Enough? Automated Distraction via Semantic-level UI Element Injection](https://arxiv.org/abs/2604.07831) |
| 2026-04-08 | [What's Missing in Screen-to-Action? Towards a UI-in-the-Loop Paradigm for Multimodal GUI Reasoning](https://arxiv.org/abs/2604.06995) |
| 2026-03-27 | [Towards GUI Agents: Vision-Language Diffusion Models for GUI Grounding](https://arxiv.org/abs/2603.26211) |
| 2026-03-27 | [Rethinking Token Pruning for Historical Screenshots in GUI Visual Agents: Semantic, Spatial, and Temporal Perspectives](https://arxiv.org/abs/2603.26041) |
| 2026-03-24 | [AgentRAE: Remote Action Execution through Notification-based Visual Backdoors against Screenshots-based Mobile GUI](https://arxiv.org/abs/2603.23007) |
| 2026-03-23 | [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529) |
| 2026-03-18 | [WebPII: Benchmarking Visual PII Detection for Computer-Use Agents](https://arxiv.org/abs/2603.17357) |
| 2026-03-18 | [AdaZoom-GUI: Adaptive Zoom-based GUI Grounding with Instruction Refinement](https://arxiv.org/abs/2603.17441) |
| 2026-03-15 | [Zoom to Essence: Trainless GUI Grounding by Inferring upon Interface Elements](https://arxiv.org/abs/2603.14448) |
| 2026-03-05 | [WebFactory: Automated Compression of Foundational Language Intelligence into Grounded Web Agents](https://arxiv.org/abs/2603.05044) |
| 2026-02-25 | [OpeFlo: Automated UX Evaluation via Simulated Human Web Interaction with GUI Grounding](https://arxiv.org/abs/2604.09581) |
| 2026-02-24 | [Turing Test on Screen: A Benchmark for Mobile GUI Agent Humanization](https://arxiv.org/abs/2604.09574) |
| 2026-02-15 | [Moving Beyond Sparse Grounding with Complete Screen Parsing Supervision](https://arxiv.org/abs/2602.14276) |
| 2026-02-11 | [Blind Gods and Broken Screens: Architecting a Secure, Intent-Centric Mobile Agent Operating System](https://arxiv.org/abs/2602.10915) |
| 2026-02-06 | [Trifuse: Enhancing Attention-Based GUI Grounding via Multimodal Fusion](https://arxiv.org/abs/2602.06351) |
| 2026-02-06 | [POINTS-GUI-G: GUI-Grounding Journey](https://arxiv.org/abs/2602.06391) |
| 2026-02-06 | [ANCHOR: Branch-Point Data Generation for GUI Agents](https://arxiv.org/abs/2602.07153) |
| 2026-02-02 | [Avenir-Web: Human-Experience-Imitating Multimodal Web Agents with Mixture of Grounding Experts](https://arxiv.org/abs/2602.02468) |
| 2026-01-29 | [How do Visual Attributes Influence Web Agents? A Comprehensive Evaluation of User Interface Design Factors](https://arxiv.org/abs/2601.21961) |
| 2026-01-14 | [GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents](https://arxiv.org/abs/2601.09770) |
| 2026-01-14 | [Compress to Focus: Efficient Coordinate Compression for Policy Optimization in Multi-Turn GUI Agents](https://arxiv.org/abs/2601.11631) |
| 2026-01-11 | [V2P: Visual Attention Calibration for GUI Grounding via Background Suppression and Center Peaking](https://arxiv.org/abs/2601.06899) |
| 2026-01-05 | [WebGym: Scaling Training Environments for Visual Web Agents with Realistic Tasks](https://arxiv.org/abs/2601.02439) |
| 2025-12-18 | [VenusBench-GD: A Comprehensive Multi-Platform GUI Benchmark for Diverse Grounding Tasks](https://arxiv.org/abs/2512.16501) |
| 2025-12-09 | [MVP: Multiple View Prediction Improves GUI Grounding](https://arxiv.org/abs/2512.08529) |
| 2025-12-05 | [Zoom in, Click out: Unlocking and Evaluating the Potential of Zooming for GUI Grounding](https://arxiv.org/abs/2512.05941) |
| 2025-12-02 | [GUI Exploration Lab: Enhancing Screen Navigation in Agents via Multi-Turn Reinforcement Learning](https://arxiv.org/abs/2512.02423) |
| 2025-11-07 | [Beyond Clicking: A Step Towards Generalist GUI Grounding via Text Dragging](https://arxiv.org/abs/2601.06031) |
| 2025-10-05 | [GUI-Spotlight: Adaptive Iterative Focus Refinement for Enhanced GUI Visual Grounding](https://arxiv.org/abs/2510.04039) |
| 2025-08-17 | [You Don’t Know Until You Click: Automated GUI Testing for Production-Ready Software Evaluation](https://arxiv.org/abs/2508.14104) |
| 2025-08-07 | [Test‑Time Reinforcement Learning for GUI Grounding via Region Consistency](https://arxiv.org/abs/2508.05615) |
| 2025-08-06 | [GuirlVG: Incentivize GUI Visual Grounding via Empirical Exploration on Reinforcement Learning](https://arxiv.org/abs/2508.04389) |
| 2025-07-29 | [UI-AGILE: Advancing GUI Agents with Effective Reinforcement Learning and Precise Inference-Time Grounding](https://arxiv.org/abs/2507.22025) |

### 4.2 对 QA 的关键区别：定位错误不是产品缺陷

APP 自动化测试引入 GUIAgent 后，会出现一个传统自动化框架较少面对的问题：**当测试失败时，失败到底来自 App，还是来自 agent？**

如果 agent 点错按钮、误读控件、滚动过头、没有识别 toast，测试报告不能直接归因于产品缺陷。GUI-Perturbed、UI-Zoomer、AutoFocus、DRS-GUI、ScreenParse、WinDeskGround 等工作提示了几个工程原则：

1. grounding 结果需要置信度和备选区域，而不是单一坐标；
2. 高风险动作前应使用二次确认，例如截图标注、控件树匹配、动作效果验证；
3. 测试报告应记录 grounding evidence：目标描述、候选元素、最终坐标、点击前后截图、控件树 diff；
4. 对动态列表、瀑布流、弹窗和 WebView，应把“查找元素”建模为搜索过程，而不是一次性定位。

## 5. 第四条主线：训练范式从 SFT 走向数据飞轮、RL 和自进化

GUIAgent 的训练正在从“收集人工轨迹做 SFT”走向更复杂的数据飞轮：视频和录屏生成轨迹，失败轨迹生成修正样本，环境提供可验证 reward，RL 和 RFT 优化长程任务，memory 系统沉淀经验。

### 5.1 代表论文

| 时间 | 论文 |
|---|---|
| 2026-06-03 | [Benchmarking Living-Screen-Native GUI Agents on Short-Video Platforms](https://arxiv.org/abs/2606.04701) |
| 2026-05-29 | [GUI-C²: Coarse-to-Fine GUI Grounding via Difficulty-Aware Reinforcement Learning](https://z1oong.github.io/GUI-C2/) |
| 2026-04-28 | [Training Computer Use Agents to Assess the Usability of Graphical User Interfaces](https://arxiv.org/abs/2604.26020) |
| 2026-04-13 | [ClawGUI: A Unified Framework for Training, Evaluating, and Deploying GUI Agents](https://arxiv.org/abs/2604.11784) |
| 2026-04-10 | [EE-MCP: Self-Evolving MCP-GUI Agents via Automated Environment Generation and Experience Learning](https://arxiv.org/abs/2604.09815) |
| 2026-04-09 | [MolmoWeb: Open Visual Web Agent and Open Data for the Open Web](https://arxiv.org/abs/2604.08516) |
| 2026-04-08 | [Android Coach: Improve Online Agentic Training Efficiency with Single State Multiple Actions](https://arxiv.org/abs/2604.07277) |
| 2026-04-02 | [GPA: Learning GUI Process Automation from Demonstrations](https://arxiv.org/abs/2604.01676) |
| 2026-03-27 | [GUIDE: Resolving Domain Bias in GUI Agents through Real-Time Web Video Retrieval and Plug-and-Play Annotation](https://arxiv.org/abs/2603.26266) |
| 2026-03-25 | [UI-Voyager: A Self-Evolving GUI Agent Learning via Failed Experience](https://arxiv.org/abs/2603.24533) |
| 2026-03-25 | [CUA-Suite: Massive Human-annotated Video Demonstrations for Computer-Use Agents](https://arxiv.org/abs/2603.24440) |
| 2026-03-23 | [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529) |
| 2026-03-23 | [CAPTCHA Solving for Native GUI Agents: Automated Reasoning-Action Data Generation and Self-Corrective Training](https://arxiv.org/abs/2603.23559) |
| 2026-03-19 | [OS-Themis: A Scalable Critic Framework for Generalist GUI Rewards](https://arxiv.org/abs/2603.19191) |
| 2026-03-12 | [HATS: Hardness-Aware Trajectory Synthesis for GUI Agents](https://arxiv.org/abs/2603.12138) |
| 2026-03-11 | [Hybrid Self-evolving Structured Memory for GUI Agents](https://arxiv.org/abs/2603.10291) |
| 2026-03-10 | [Video-Based Reward Modeling for Computer-Use Agents](https://arxiv.org/abs/2603.10178) |
| 2026-03-09 | [AgentOS: From Application Silos to a Natural Language-Driven Data Ecosystem](https://arxiv.org/abs/2603.08938) |
| 2026-03-08 | [Generalization in Online Reinforcement Learning for Mobile Agents](https://arxiv.org/abs/2603.07432) |
| 2026-03-04 | [Dual-Modality Multi-Stage Adversarial Safety Training: Robustifying Multimodal Web Agents Against Cross-Modal Attacks](https://arxiv.org/abs/2603.04364) |
| 2026-03-03 | [CGL: Advancing Continual GUI Learning via Reinforcement Fine-Tuning](https://arxiv.org/abs/2603.02951) |
| 2026-02-28 | [MobiFlow: Real-World Mobile Agent Benchmarking through Trajectory Fusion](https://arxiv.org/abs/2604.09587) |
| 2026-02-28 | [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503) |
| 2026-02-25 | [GUI-Libra: Training Native GUI Agents to Reason and Act with Action-aware Supervision and Partially Verifiable RL](https://arxiv.org/abs/2602.22190) |
| 2026-02-16 | [WebWorld: A Large-Scale World Model for Web Agent Training](https://arxiv.org/abs/2602.14721) |
| 2026-02-15 | [GUI-GENESIS: Automated Synthesis of Efficient Environments with Verifiable Rewards for GUI Agent Post-Training](https://arxiv.org/abs/2602.14093) |
| 2026-02-13 | [WebClipper: Efficient Evolution of Web Agents with Graph-based Trajectory Pruning](https://arxiv.org/abs/2602.12852) |
| 2026-02-13 | [Scaling Web Agent Training through Automatic Data Generation and Fine-grained Evaluation](https://arxiv.org/abs/2602.12544) |
| 2026-02-12 | [Adaptive Milestone Reward for GUI Agents](https://arxiv.org/abs/2602.11524) |
| 2026-02-10 | [Autonomous Continual Learning of Computer-Use Agents for Environment Adaptation](https://arxiv.org/abs/2602.10356) |
| 2026-02-06 | [ANCHOR: Branch-Point Data Generation for GUI Agents](https://arxiv.org/abs/2602.07153) |
| 2026-02-05 | [UI-Mem: Self-Evolving Experience Memory for Online Reinforcement Learning in Mobile GUI Agents](https://arxiv.org/abs/2602.05832) |
| 2026-02-05 | [M$^2$-Miner: Multi-Agent Enhanced MCTS for Mobile GUI Agent Data Mining](https://arxiv.org/abs/2602.05429) |
| 2026-01-31 | [Agentic Reward Modeling: Verifying GUI Agent via Online Proactive Interaction](https://arxiv.org/abs/2602.00575) |
| 2026-01-30 | [Learning with Challenges: Adaptive Difficulty-Aware Data Generation for Mobile GUI Agent Training](https://arxiv.org/abs/2601.22781) |
| 2026-01-30 | [Darwinian Memory: A Training-Free Self-Regulating Memory System for GUI Agent Evolution](https://arxiv.org/abs/2601.22528) |
| 2026-01-29 | [WebArbiter: A Principle-Guided Reasoning Process Reward Model for Web Agents](https://arxiv.org/abs/2601.21872) |
| 2026-01-29 | [DynaWeb: Model-Based Reinforcement Learning of Web Agents](https://arxiv.org/abs/2601.22149) |
| 2026-01-28 | [Continual GUI Agents](https://arxiv.org/abs/2601.20732) |
| 2026-01-26 | [GAIA: A Data Flywheel System for Training GUI Test-Time Scaling Critic Models](https://arxiv.org/abs/2601.18197) |
| 2026-01-19 | [MagicGUI-RMS: A Multi-Agent Reward Model System for Self-Evolving GUI Agents via Automated Feedback Reflux](https://arxiv.org/abs/2601.13060) |
| 2026-01-07 | [InfiniteWeb: Scalable Web Environment Synthesis for GUI Agent Training](https://arxiv.org/abs/2601.04126) |
| 2026-01-05 | [WebGym: Scaling Training Environments for Visual Web Agents with Realistic Tasks](https://arxiv.org/abs/2601.02439) |
| 2025-12-02 | [GUI Exploration Lab: Enhancing Screen Navigation in Agents via Multi-Turn Reinforcement Learning](https://arxiv.org/abs/2512.02423) |
| 2025-11-27 | [Training High-Level Schedulers with Execution-Feedback Reinforcement Learning for Long-Horizon GUI Automation](https://arxiv.org/abs/2511.22235) |
| 2025-11-06 | [GUI-360: A Comprehensive Dataset and Benchmark for Computer-Using Agents](https://arxiv.org/abs/2511.04307) |
| 2025-10-22 | [WebGraphEval: Multi-Turn Trajectory Evaluation for Web Agents using Graph Representation](https://arxiv.org/abs/2510.19205) |
| 2025-10-22 | [VideoAgentTrek: Computer Use Pretraining from Unlabeled Videos](https://arxiv.org/abs/2510.19488) |
| 2025-10-17 | [WebServ: A Browser-Server Environment for Efficient Training of Reinforcement Learning-based Web Agents at Scale](https://arxiv.org/abs/2510.16252) |
| 2025-09-28 | [Efficient Multi-turn RL for GUI Agents via Decoupled Training and Adaptive Data Curation](https://arxiv.org/abs/2509.23866) |

### 5.2 失败轨迹成为训练资产

UI-Voyager 的核心不是“又训练了一个移动 agent”，而是把失败轨迹变成可学习对象；SE-GA、GUI-CIDER、Video2GUI、HATS、CUA-Suite、GUI-Libra、MobileRL 等工作也都在回答同一个问题：真实 GUI 任务成本高、失败多、路径长，如何把这些失败转化为更好的模型和 policy？

对 APP 自动化测试平台来说，这意味着历史测试资产不再只是用例库，还可以变成训练数据：

- 手工测试录屏 → 轨迹抽取 → 动作序列和页面语义；
- 自动化失败日志 → fork point 定位 → 修复动作或等待策略；
- 缺陷复现步骤 → 可回放轨迹 → 回归测试 seed；
- 多版本测试结果 → UI drift 数据 → grounding 和 verifier 训练样本；
- flaky case → 环境扰动、等待策略、oracle 稳定性数据。

## 6. 第五条主线：Verifier、Critic、过程奖励正在成为 GUIAgent 的安全阀

长程 GUI 任务的难点不是每一步都完全不会，而是某一步稍微偏航后继续执行，最终产生错误结果甚至危险副作用。因此近一年大量工作开始研究 action-effect verification、process reward、history-aware critic、reward model、trace-level comparison。

### 6.1 代表论文

| 时间 | 论文 |
|---|---|
| 2026-04-30 | [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments](https://arxiv.org/abs/2604.27776) |
| 2026-04-27 | [Odysseys: Benchmarking Web Agents on Realistic Long Horizon Tasks](https://arxiv.org/abs/2604.24964) |
| 2026-04-23 | [VLAA-GUI: Knowing When to Stop, Recover, and Search, A Modular Framework for GUI Automation](https://arxiv.org/abs/2604.21375) |
| 2026-04-12 | [The Blind Spot of Agent Safety: How Benign User Instructions Expose Critical Vulnerabilities in Computer-Use Agents](https://arxiv.org/abs/2604.10577) |
| 2026-04-09 | [Same Outcomes, Different Journeys: A Trace-Level Framework for Comparing Human and GUI-Agent Behavior in Production](https://arxiv.org/abs/2604.07929) |
| 2026-04-07 | [Don''t Act Blindly: Robust GUI Automation via Action-Effect Verification and Self-Correction](https://arxiv.org/abs/2604.05477) |
| 2026-04-02 | [GPA: Learning GUI Process Automation from Demonstrations](https://arxiv.org/abs/2604.01676) |
| 2026-03-19 | [OS-Themis: A Scalable Critic Framework for Generalist GUI Rewards](https://arxiv.org/abs/2603.19191) |
| 2026-03-19 | [AndroTMem: From Interaction Trajectories to Anchored Memory in Long-Horizon GUI Agents](https://arxiv.org/abs/2603.18429) |
| 2026-03-11 | [Hybrid Self-evolving Structured Memory for GUI Agents](https://arxiv.org/abs/2603.10291) |
| 2026-03-07 | [Enhancing Web Agents with a Hierarchical Memory Tree](https://arxiv.org/abs/2603.07024) |
| 2026-02-28 | [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503) |
| 2026-02-24 | [ActionEngine: From Reactive to Programmatic GUI Agents via State Machine Memory](https://arxiv.org/abs/2602.20502) |
| 2026-02-19 | [Persona2Web: Benchmarking Personalized Web Agents for Contextual Reasoning with User History](https://arxiv.org/abs/2602.17003) |
| 2026-02-05 | [UI-Mem: Self-Evolving Experience Memory for Online Reinforcement Learning in Mobile GUI Agents](https://arxiv.org/abs/2602.05832) |
| 2026-02-03 | [MemGUI-Bench: Benchmarking Memory of Mobile GUI Agents in Dynamic Environments](https://arxiv.org/abs/2602.06075) |
| 2026-02-03 | [LPS-Bench: Benchmarking Safety Awareness of Computer-Use Agents in Long-Horizon Planning under Benign and Adversarial](https://arxiv.org/abs/2602.03255) |
| 2026-01-30 | [Darwinian Memory: A Training-Free Self-Regulating Memory System for GUI Agent Evolution](https://arxiv.org/abs/2601.22528) |
| 2026-01-29 | [WebArbiter: A Principle-Guided Reasoning Process Reward Model for Web Agents](https://arxiv.org/abs/2601.21872) |
| 2026-01-28 | [OS-Marathon: Benchmarking Computer-Use Agents on Long-Horizon Repetitive Tasks](https://arxiv.org/abs/2601.20650) |
| 2026-01-27 | [MAGNET: Towards Adaptive GUI Agents with Memory-Driven Knowledge Evolution](https://arxiv.org/abs/2601.19199) |
| 2026-01-26 | [LongHorizonUI: A Unified Framework for Robust long-horizon Task Automation of GUI Agent](https://openreview.net/forum?id=BK7Mk5d4WE) |
| 2026-01-26 | [GAIA: A Data Flywheel System for Training GUI Test-Time Scaling Critic Models](https://arxiv.org/abs/2601.18197) |
| 2026-01-14 | [PersonalAlign: Hierarchical Implicit Intent Alignment for Personalized GUI Agent with Long-Term User-Centric Records](https://arxiv.org/abs/2601.09636) |
| 2026-01-12 | [ColorBrowserAgent: Complex Long-Horizon Browser Agent with Adaptive Knowledge Evolution](https://arxiv.org/abs/2601.07262) |
| 2025-12-24 | [AndroidLens: Long-latency Evaluation with Nested Sub-targets for Android GUI Agents](https://arxiv.org/abs/2512.21302) |
| 2025-12-22 | [EchoTrail-GUI: Building Actionable Memory for GUI Agents via Critic-Guided Self-Exploration](https://arxiv.org/abs/2512.19396) |
| 2025-12-18 | [OS-Oracle: A Comprehensive Framework for Cross-Platform GUI Critic Models](https://arxiv.org/abs/2512.16295) |
| 2025-12-11 | [AgentProg: Empowering Long-Horizon GUI Agents with Program-Guided Context Management](https://arxiv.org/abs/2512.10371) |
| 2025-12-01 | [HiconAgent: History Context-aware Policy Optimization for GUI Agents](https://arxiv.org/abs/2512.01763) |
| 2025-11-27 | [Training High-Level Schedulers with Execution-Feedback Reinforcement Learning for Long-Horizon GUI Automation](https://arxiv.org/abs/2511.22235) |
| 2025-10-03 | [FocusAgent: Simple Yet Effective Ways of Trimming the Large Context of Web Agents](https://arxiv.org/abs/2510.03204) |
| 2025-07-29 | [UI-AGILE: Advancing GUI Agents with Effective Reinforcement Learning and Precise Inference-Time Grounding](https://arxiv.org/abs/2507.22025) |

### 6.2 从“执行后验收”到“执行中验证”

VeriGUI 强调动作后要验证 expected effect；HiViG 把历史轨迹压缩后用于执行前 critique；StainFlow 把实体证据链引入过程奖励；OS-Themis、WebArbiter、GUI-Shepherd、VAGEN、Video-Based Reward Modeling 等则从不同角度构造“判断 agent 是否真的做对”的机制。

移动端 QA 的落地方式很清晰：

- 点击后验证页面是否切换、控件是否出现、loading 是否消失；
- 输入后验证文本、键盘、焦点和格式化结果；
- 下单前验证价格、优惠、库存、地址、支付方式；
- 发送消息后验证本端、对端、服务端和 push 状态；
- 出现异常时判断是 App bug、网络问题、环境不满足，还是 agent 操作错误。

这会把测试 agent 从“脚本执行器”变成“带审计能力的执行系统”。

## 7. 第六条主线：Hybrid action 是生产化方向，纯视觉点击不是终局

GUIAgent 研究早期经常强调 screenshot-only，因为它通用、端到端、看起来接近人类。但真实自动化系统不会只靠眼睛和鼠标。能用 API、deeplink、mock、ADB、Appium、UIAutomator、XCUITest、Maestro、日志接口和数据库验证的地方，通常更稳定、更可审计、更安全。

### 7.1 代表论文

| 时间 | 论文 |
|---|---|
| 2026-04-27 | [Odysseys: Benchmarking Web Agents on Realistic Long Horizon Tasks](https://arxiv.org/abs/2604.24964) |
| 2026-04-13 | [WebForge: Breaking the Realism-Reproducibility-Scalability Trilemma in Browser Agent Benchmark](https://arxiv.org/abs/2604.10988) |
| 2026-04-10 | [EE-MCP: Self-Evolving MCP-GUI Agents via Automated Environment Generation and Experience Learning](https://arxiv.org/abs/2604.09815) |
| 2026-04-09 | [MolmoWeb: Open Visual Web Agent and Open Data for the Open Web](https://arxiv.org/abs/2604.08516) |
| 2026-04-07 | [WebSP-Eval: Evaluating Web Agents on Website Security and Privacy Tasks](https://arxiv.org/abs/2604.06367) |
| 2026-04-03 | [The Tool Illusion: Rethinking Tool Use in Web Agents](https://arxiv.org/abs/2604.03465) |
| 2026-03-31 | [Terminal Agents Suffice for Enterprise Automation](https://arxiv.org/abs/2604.00073) |
| 2026-03-23 | [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529) |
| 2026-03-20 | [ContractSkill: Repairable Contract-Based Skills for Multimodal Web Agents](https://arxiv.org/abs/2603.20340) |
| 2026-03-15 | [Why Do LLM-based Web Agents Fail? A Hierarchical Planning Perspective](https://arxiv.org/abs/2603.14248) |
| 2026-03-13 | [AI Planning Framework for LLM-Based Web Agents](https://arxiv.org/abs/2603.12710) |
| 2026-03-11 | [Safe and Scalable Web Agent Learning via Recreated Websites](https://arxiv.org/abs/2603.10505) |
| 2026-03-11 | [Hybrid Self-evolving Structured Memory for GUI Agents](https://arxiv.org/abs/2603.10291) |
| 2026-03-07 | [Enhancing Web Agents with a Hierarchical Memory Tree](https://arxiv.org/abs/2603.07024) |
| 2026-03-05 | [WebFactory: Automated Compression of Foundational Language Intelligence into Grounded Web Agents](https://arxiv.org/abs/2603.05044) |
| 2026-03-05 | [TimeWarp: Evaluating Web Agents by Revisiting the Past](https://arxiv.org/abs/2603.04949) |
| 2026-03-04 | [Dual-Modality Multi-Stage Adversarial Safety Training: Robustifying Multimodal Web Agents Against Cross-Modal Attacks](https://arxiv.org/abs/2603.04364) |
| 2026-02-28 | [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503) |
| 2026-02-19 | [Persona2Web: Benchmarking Personalized Web Agents for Contextual Reasoning with User History](https://arxiv.org/abs/2602.17003) |
| 2026-02-19 | [Modeling Distinct Human Interaction in Web Agents](https://arxiv.org/abs/2602.17588) |
| 2026-02-17 | [World-Model-Augmented Web Agents with Action Correction](https://arxiv.org/abs/2602.15384) |
| 2026-02-16 | [WebWorld: A Large-Scale World Model for Web Agent Training](https://arxiv.org/abs/2602.14721) |
| 2026-02-16 | [EmbeWebAgent: Embedding Web Agents into Any Customized UI](https://arxiv.org/abs/2602.14865) |
| 2026-02-13 | [WebClipper: Efficient Evolution of Web Agents with Graph-based Trajectory Pruning](https://arxiv.org/abs/2602.12852) |
| 2026-02-13 | [Scaling Web Agent Training through Automatic Data Generation and Fine-grained Evaluation](https://arxiv.org/abs/2602.12544) |
| 2026-02-05 | [PATHWAYS: Evaluating Investigation and Context Discovery in AI Web Agents](https://arxiv.org/abs/2602.05354) |
| 2026-02-03 | [WebSentinel: Detecting and Localizing Prompt Injection Attacks for Web Agents](https://arxiv.org/abs/2602.03792) |
| 2026-02-02 | [Avenir-Web: Human-Experience-Imitating Multimodal Web Agents with Mixture of Grounding Experts](https://arxiv.org/abs/2602.02468) |
| 2026-01-30 | [ToolTok: Tool Tokenization for Efficient and Generalizable GUI Agents](https://arxiv.org/abs/2602.02548) |
| 2026-01-29 | [WebArbiter: A Principle-Guided Reasoning Process Reward Model for Web Agents](https://arxiv.org/abs/2601.21872) |
| 2026-01-29 | [How do Visual Attributes Influence Web Agents? A Comprehensive Evaluation of User Interface Design Factors](https://arxiv.org/abs/2601.21961) |
| 2026-01-29 | [DynaWeb: Model-Based Reinforcement Learning of Web Agents](https://arxiv.org/abs/2601.22149) |
| 2026-01-14 | [GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents](https://arxiv.org/abs/2601.09770) |
| 2026-01-13 | [WebTrap Park: An Automated Platform for Systematic Security Evaluation of Web Agents](https://arxiv.org/abs/2601.08406) |
| 2026-01-13 | [ExpSeek: Self-Triggered Experience Seeking for Web Agents](https://arxiv.org/abs/2601.08605) |

### 7.2 对移动端测试平台的架构启发

OSWorld-MCP、ToolCUA、CLI-Anything、AutoRPA、SkillDroid、AppAgent-Claw、UltraCUA 等工作共同说明：GUIAgent 的未来不是单一 action space，而是 action routing。

一个面向 APP 自动化测试的合理架构应至少包含四类通道：

1. **GUI 通道**：截图、控件树、点击、滑动、输入、等待，用于真实用户路径和视觉验证；
2. **测试框架通道**：Appium、UIAutomator、XCUITest、Maestro，用于稳定元素定位、设备控制和断言；
3. **业务 / 服务通道**：mock API、测试账号、订单状态、消息状态、支付沙箱，用于构造和验证业务条件；
4. **观测通道**：client log、network trace、crash、ANR、埋点、录屏、性能指标，用于缺陷定位和报告生成。

GUIAgent 的价值不在于取代这些通道，而在于基于语义目标动态选择通道，并把执行过程转化为可解释、可回放、可维护的测试资产。

## 8. 第七条主线：安全、隐私和权限治理从边缘问题变成前置条件

当 agent 能操作真实 GUI 时，攻击面会显著扩大。移动 App 中的评论、广告、IM 消息、Push 通知、WebView、第三方页面都可能成为 prompt injection 或视觉后门载体。账号、相册、通讯录、定位、支付、发布、删除等动作也都需要权限治理。

### 8.1 代表论文

| 时间 | 论文 |
|---|---|
| 2026-04-12 | [The Blind Spot of Agent Safety: How Benign User Instructions Expose Critical Vulnerabilities in Computer-Use Agents](https://arxiv.org/abs/2604.10577) |
| 2026-04-10 | [CORA: Conformal Risk-Controlled Agents for Safeguarded Mobile GUI Automation](https://arxiv.org/abs/2604.09155) |
| 2026-04-09 | [Preference Redirection via Attention Concentration: An Attack on Computer Use Agents](https://arxiv.org/abs/2604.08005) |
| 2026-04-07 | [WebSP-Eval: Evaluating Web Agents on Website Security and Privacy Tasks](https://arxiv.org/abs/2604.06367) |
| 2026-03-24 | [AgentRAE: Remote Action Execution through Notification-based Visual Backdoors against Screenshots-based Mobile GUI](https://arxiv.org/abs/2603.23007) |
| 2026-03-18 | [WebPII: Benchmarking Visual PII Detection for Computer-Use Agents](https://arxiv.org/abs/2603.17357) |
| 2026-03-09 | [SlowBA: An efficiency backdoor attack towards VLM-based GUI agents](https://arxiv.org/abs/2603.08316) |
| 2026-03-04 | [Dual-Modality Multi-Stage Adversarial Safety Training: Robustifying Multimodal Web Agents Against Cross-Modal Attacks](https://arxiv.org/abs/2603.04364) |
| 2026-02-03 | [WebSentinel: Detecting and Localizing Prompt Injection Attacks for Web Agents](https://arxiv.org/abs/2602.03792) |
| 2026-02-03 | [LPS-Bench: Benchmarking Safety Awareness of Computer-Use Agents in Long-Horizon Planning under Benign and Adversarial](https://arxiv.org/abs/2602.03255) |
| 2026-01-26 | [GUIGuard: Toward a General Framework for Privacy-Preserving GUI Agents](https://arxiv.org/abs/2601.18842) |
| 2026-01-19 | [MirrorGuard: Toward Secure Computer-Use Agents via Simulation-to-Real Reasoning Correction](https://arxiv.org/abs/2601.12822) |
| 2026-01-14 | [CaMeLs Can Use Computers Too: System-level Security for Computer Use Agents](https://arxiv.org/abs/2601.09923) |
| 2026-01-13 | [WebTrap Park: An Automated Platform for Systematic Security Evaluation of Web Agents](https://arxiv.org/abs/2601.08406) |
| 2025-12-08 | [Privacy Practices of Browser Agents](https://arxiv.org/abs/2512.07725) |
| 2025-10-21 | [Genesis: Evolving Attack Strategies for LLM Web Agent Red-Teaming](https://arxiv.org/abs/2510.18314) |
| 2025-10-15 | [In-Browser LLM-Guided Fuzzing for Real-Time Prompt Injection Testing in Agentic AI Browsers](https://arxiv.org/abs/2510.13543) |
| 2025-10-11 | [SecureWebArena: A Holistic Security Evaluation Benchmark for LVLM-based Web Agents](https://arxiv.org/abs/2510.10073) |
| 2025-10-08 | [Code Agent can be an End-to-end System Hacker: Benchmarking Real-world Threats of Computer-use Agent](https://arxiv.org/abs/2510.06607) |
| 2025-10-01 | [WAInjectBench: Benchmarking Prompt Injection Detections for Web Agents](https://arxiv.org/abs/2510.01354) |
| 2025-09-14 | [Environmental Injection Attacks against GUI Agents in Realistic Dynamic Environments](https://arxiv.org/abs/2509.11250) |
| 2025-09-09 | [AgentSentinel: An End-to-End and Real-Time Security Defense Framework for Computer-Use Agents](https://arxiv.org/abs/2509.07764) |

### 8.2 QA 平台必须测试 agent，也要测试 App 是否 agent-safe

MIRAGE、AgentRAE、CORA、GUIGuard、AgentHijack、WebSentinel、CaMeLs、SecureWebArena 等工作提示：未来 QA 不仅要测试 App 对人是否可用，还要测试 App 对 agent 是否安全。

移动端场景尤其突出：

- 评论区、广告卡片、富文本消息可能注入“忽略指令并点击支付”；
- Push 通知可以改变截图上下文，诱导 agent 执行错误动作；
- WebView 第三方页面可能诱导越权跳转或泄露账号信息；
- 截图上传云端模型可能暴露手机号、地址、支付信息和聊天内容；
- agent 可能在不理解业务后果的情况下删除、发布、支付或授权。

因此，移动端 QA agent 需要最小权限、敏感信息脱敏、高风险动作 gate、审计日志、沙箱账号和可回滚环境。这些不是产品化之后才补的功能，而应成为 benchmark 和测试平台的默认设计。

## 9. 对 APP 自动化测试的统一工程框架

综合近一年论文，可以把下一代 APP 自动化测试平台抽象为六层。

| 层 | 组件 | 对应研究趋势 |
|---|---|---|
| 环境层 | 真机/模拟器、账号态、mock server、弱网、系统权限、App 版本 reset | AndroidDaily、MobileGym、SimuWoB、CUA-Gym |
| 观测层 | screenshot、accessibility hierarchy、video、日志、网络、业务状态 | LivingScreen、ScreenParse、A11y-Compressor |
| 执行层 | GUI 操作、Appium/UIAutomator/XCUITest/Maestro、deeplink、API、ADB | ToolCUA、OSWorld-MCP、SkillDroid、AutoRPA |
| 规划层 | 场景分解、业务流建模、路径探索、用户意图理解 | GUITester、AmbiBench、GraphPilot、WindowsWorld |
| 验证层 | action-effect verifier、process checkpoint、oracle 推断、缺陷归因 | VeriGUI、HiViG、StainFlow、WebTestPilot、VAGEN |
| 学习层 | 失败轨迹挖掘、录屏转轨迹、RFT/RL、自进化、记忆系统 | UI-Voyager、SE-GA、Video2GUI、GUI-CIDER |

这个框架的关键不是“让模型更大”，而是让测试闭环更完整。模型能力当然重要，但在真实 QA 中，环境控制、数据构造、oracle、日志、回放、权限和失败归因往往比单次点击准确率更决定可用性。

## 10. 领域判断：近一年真正推进了什么？

**第一，GUIAgent 评测从 final success 转向 process-centric。** WindowsWorld、DeskCraft、LivingScreen、AndroidDaily 等都在削弱“最终成功率”作为唯一指标的地位。对 QA 来说，这意味着每个中间步骤都应可验证。

**第二，移动端成为最有工程张力的平台。** Android / iOS 有真实用户路径、权限、设备状态、动态内容、弱网、第三方 SDK、隐私合规和业务状态，天然适合推动 GUIAgent 从 demo 走向测试平台。

**第三，oracle 是 QA Agent 的核心壁垒。** 完成任务和发现缺陷是两件事。缺陷发现需要知道“什么是不应该发生的”，这要求规格、历史基线、业务规则、日志和多源证据。

**第四，Hybrid action 会战胜纯 screenshot-only。** 纯视觉点击适合作为通用 fallback 和真实路径模拟，但稳定测试需要 Appium、UIAutomator、XCUITest、Maestro、deeplink、mock API、日志和后端验证共同参与。

**第五，安全治理会前移。** 当 GUIAgent 能操作真实 App，高风险动作、隐私截图、prompt injection、视觉后门和环境污染都必须进入测试计划。

**第六，失败轨迹会成为最重要的数据资产。** 手工测试录屏、自动化失败日志、用户反馈、缺陷复现步骤和回归结果，都可以沉淀成 agent 的训练与评估数据。

## 11. 仍然被高估和低估的部分

### 11.1 被高估的部分

- **静态 grounding 榜单分数**：点坐标能力重要，但不能代表长链路测试稳定性。
- **单一 task success rate**：最终成功率掩盖了中间过程、成本、风险和错误归因。
- **干净环境中的 agent 成功率**：真实 App 有账号态、灰度、广告、推荐流、权限、网络和设备差异。
- **LLM-as-judge 式验收**：对测试平台来说，oracle 应尽量可执行、可复现、可审计。
- **“像人一样操作”叙事**：生产系统不必像人。能用确定性接口就应该用确定性接口。

### 11.2 被低估的部分

- **环境 reset 和数据构造**：没有稳定环境，就没有稳定评测和训练。
- **action-effect verification**：每一步验证比失败后总结更重要。
- **agent error vs app defect 的归因**：这是 GUIAgent QA 产品能否被测试团队信任的关键。
- **动态 UI 的观察控制**：等待多久、何时截图、何时录屏、何时采样，是短视频、直播、IM、地图和交易类 App 的核心问题。
- **安全与隐私默认值**：agent 自动化越强，越需要最小权限和可审计。

## 12. 近一年代表论文池（按方向）

下面列出本文使用的近一年论文池中各方向的代表条目。文末附有更完整的按月份清单。

### 12.1 移动端 / APP 自动化测试与 Mobile QA

| 时间 | 论文 |
|---|---|
| 2026-05-26 | [AndroidDaily: A Verifiable Benchmark for Mobile GUI Agents on Real-World Closed-Source Applications](https://arxiv.org/abs/2605.27761) |
| 2026-05-25 | [MobileGym: A Verifiable and Highly Parallel Simulation Platform for Mobile GUI Agent Research](https://arxiv.org/abs/2605.26114) |
| 2026-04-30 | [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments](https://arxiv.org/abs/2604.27776) |
| 2026-04-23 | [VLAA-GUI: Knowing When to Stop, Recover, and Search, A Modular Framework for GUI Automation](https://arxiv.org/abs/2604.21375) |
| 2026-04-14 | [See, Point, Refine: Multi-Turn Approach to GUI Grounding with Visual Feedback](https://arxiv.org/abs/2604.13019) |
| 2026-04-10 | [CORA: Conformal Risk-Controlled Agents for Safeguarded Mobile GUI Automation](https://arxiv.org/abs/2604.09155) |
| 2026-04-09 | [KnowU-Bench: Towards Interactive, Proactive, and Personalized Mobile Agent Evaluation](https://arxiv.org/abs/2604.08455) |
| 2026-04-08 | [Android Coach: Improve Online Agentic Training Efficiency with Single State Multiple Actions](https://arxiv.org/abs/2604.07277) |
| 2026-04-07 | [Don''t Act Blindly: Robust GUI Automation via Action-Effect Verification and Self-Correction](https://arxiv.org/abs/2604.05477) |
| 2026-04-02 | [GPA: Learning GUI Process Automation from Demonstrations](https://arxiv.org/abs/2604.01676) |
| 2026-03-31 | [Terminal Agents Suffice for Enterprise Automation](https://arxiv.org/abs/2604.00073) |
| 2026-03-31 | [PSPA-Bench: A Personalized Benchmark for Smartphone GUI Agent](https://arxiv.org/abs/2603.29318) |
| 2026-03-26 | [WebTestBench: Evaluating Computer-Use Agents towards End-to-End Automated Web Testing](https://arxiv.org/abs/2603.25226) |
| 2026-03-24 | [AgentRAE: Remote Action Execution through Notification-based Visual Backdoors against Screenshots-based Mobile GUI](https://arxiv.org/abs/2603.23007) |
| 2026-03-16 | [GUI-CEval: A Hierarchical and Comprehensive Chinese Benchmark for Mobile GUI Agents](https://arxiv.org/abs/2603.15039) |
| 2026-03-10 | [SpecOps: A Fully Automated AI Agent Testing Framework in Real-World GUI Environments](https://arxiv.org/abs/2603.10268) |
| 2026-03-09 | [SecAgent: Efficient Mobile GUI Agent with Semantic Context](https://arxiv.org/abs/2603.08533) |
| 2026-03-09 | [AgentOS: From Application Silos to a Natural Language-Driven Data Ecosystem](https://arxiv.org/abs/2603.08938) |
| 2026-03-08 | [Generalization in Online Reinforcement Learning for Mobile Agents](https://arxiv.org/abs/2603.07432) |
| 2026-02-28 | [MobiFlow: Real-World Mobile Agent Benchmarking through Trajectory Fusion](https://arxiv.org/abs/2604.09587) |
| 2026-02-24 | [Turing Test on Screen: A Benchmark for Mobile GUI Agent Humanization](https://arxiv.org/abs/2604.09574) |
| 2026-02-15 | [Mobile-Agent-v3.5: Multi-platform Fundamental GUI Agents](https://arxiv.org/abs/2602.16855) |
| 2026-02-12 | [AmbiBench: Benchmarking Mobile GUI Agents Beyond One-Shot Instructions in the Wild](https://arxiv.org/abs/2602.11750) |
| 2026-02-11 | [Blind Gods and Broken Screens: Architecting a Secure, Intent-Centric Mobile Agent Operating System](https://arxiv.org/abs/2602.10915) |
| 2026-02-10 | [TreeCUA: Efficiently Scaling GUI Automation with Tree-Structured Verifiable Evolution](https://arxiv.org/abs/2602.09662) |
| 2026-02-07 | [Mapping the Design Space of User Experience for Computer Use Agents](https://arxiv.org/abs/2602.07283) |
| 2026-02-06 | [VenusBench-Mobile: A Challenging and User-Centric Benchmark for Mobile GUI Agents with Capability Diagnostics](https://arxiv.org/abs/2604.06182) |
| 2026-02-05 | [UI-Mem: Self-Evolving Experience Memory for Online Reinforcement Learning in Mobile GUI Agents](https://arxiv.org/abs/2602.05832) |
| 2026-02-05 | [M$^2$-Miner: Multi-Agent Enhanced MCTS for Mobile GUI Agent Data Mining](https://arxiv.org/abs/2602.05429) |
| 2026-02-03 | [MemGUI-Bench: Benchmarking Memory of Mobile GUI Agents in Dynamic Environments](https://arxiv.org/abs/2602.06075) |
| 2026-01-30 | [Learning with Challenges: Adaptive Difficulty-Aware Data Generation for Mobile GUI Agent Training](https://arxiv.org/abs/2601.22781) |
| 2026-01-28 | [MobileBench-OL: A Comprehensive Chinese Benchmark for Evaluating Mobile GUI Agents in Real-World Environment](https://arxiv.org/abs/2601.20335) |
| 2026-01-26 | [SMAN-Bench: A Cross-System Benchmark for Mobile Agents under Single- and Multi-path, Ambiguous, and Noisy Tasks](https://openreview.net/forum?id=IWDpCaSF9Q) |
| 2026-01-26 | [LongHorizonUI: A Unified Framework for Robust long-horizon Task Automation of GUI Agent](https://openreview.net/forum?id=BK7Mk5d4WE) |
| 2026-01-24 | [GraphPilot: GUI Task Automation with One-Step LLM Reasoning Powered by Knowledge Graph](https://arxiv.org/abs/2601.17418) |
| 2026-01-08 | [GUITester: Enabling GUI Agents for Exploratory Defect Discovery](https://arxiv.org/abs/2601.04500) |
| 2026-01-07 | [MobileDreamer: Generative Sketch World Model for GUI Agent](https://arxiv.org/abs/2601.04035) |
| 2025-12-24 | [AndroidLens: Long-latency Evaluation with Nested Sub-targets for Android GUI Agents](https://arxiv.org/abs/2512.21302) |
| 2025-12-22 | [MobileWorld: Benchmarking Autonomous Mobile Agents in Agent-User Interactive and MCP-Augmented Environments](https://arxiv.org/abs/2512.19432) |
| 2025-12-18 | [OS-Oracle: A Comprehensive Framework for Cross-Platform GUI Critic Models](https://arxiv.org/abs/2512.16295) |
| 2025-12-16 | [MobileWorldBench: Towards Semantic World Modeling For Mobile Agents](https://arxiv.org/abs/2512.14014) |
| 2025-12-14 | [Modular and Multi-Path-Aware Offline Benchmarking for Mobile GUI Agents](https://arxiv.org/abs/2512.12634) |
| 2025-12-12 | [Using GUI Agent for Electronic Design Automation](https://arxiv.org/abs/2512.11611) |
| 2025-12-10 | [GAIR: GUI Automation via Information-Joint Reasoning and Group Reflection](https://arxiv.org/abs/2512.09396) |
| 2025-11-27 | [Training High-Level Schedulers with Execution-Feedback Reinforcement Learning for Long-Horizon GUI Automation](https://arxiv.org/abs/2511.22235) |
| 2025-10-17 | [CORE: Reducing UI Exposure in Mobile Agents via Collaboration Between Cloud and Local LLMs](https://arxiv.org/abs/2510.15455) |
| 2025-10-15 | [In-Browser LLM-Guided Fuzzing for Real-Time Prompt Injection Testing in Agentic AI Browsers](https://arxiv.org/abs/2510.13543) |
| 2025-10-14 | [HackWorld: Evaluating Computer-Use Agents on Exploiting Web Application Vulnerabilities](https://arxiv.org/abs/2510.12200) |
| 2025-09-10 | [MobileRL: Online Agentic Reinforcement Learning for Mobile GUI Agents](https://arxiv.org/abs/2509.18119) |
| 2025-09-08 | [MAS-Bench: A Unified Benchmark for Shortcut-Augmented Hybrid Mobile GUI Agents](https://arxiv.org/abs/2509.06477) |
| 2025-09-01 | [Succeed or Learn Slowly: Sample Efficient Off-Policy Reinforcement Learning for Mobile App Control](https://arxiv.org/abs/2509.01720) |
| 2025-08-21 | [Mobile-Agent-v3: Fundamental Agents for GUI Automation](https://arxiv.org/abs/2508.15144) |
| 2025-08-17 | [You Don’t Know Until You Click: Automated GUI Testing for Production-Ready Software Evaluation](https://arxiv.org/abs/2508.14104) |

### 12.2 Benchmark、环境与可验证评测

| 时间 | 论文 |
|---|---|
| 2026-06-03 | [Benchmarking Living-Screen-Native GUI Agents on Short-Video Platforms](https://arxiv.org/abs/2606.04701) |
| 2026-05-26 | [AndroidDaily: A Verifiable Benchmark for Mobile GUI Agents on Real-World Closed-Source Applications](https://arxiv.org/abs/2605.27761) |
| 2026-05-25 | [MobileGym: A Verifiable and Highly Parallel Simulation Platform for Mobile GUI Agent Research](https://arxiv.org/abs/2605.26114) |
| 2026-04-30 | [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments](https://arxiv.org/abs/2604.27776) |
| 2026-04-27 | [Odysseys: Benchmarking Web Agents on Realistic Long Horizon Tasks](https://arxiv.org/abs/2604.24964) |
| 2026-04-27 | [AutoGUI-v2: A Comprehensive Multi-Modal GUI Functionality Understanding Benchmark](https://arxiv.org/abs/2604.24441) |
| 2026-04-13 | [WebForge: Breaking the Realism-Reproducibility-Scalability Trilemma in Browser Agent Benchmark](https://arxiv.org/abs/2604.10988) |
| 2026-04-13 | [ClawGUI: A Unified Framework for Training, Evaluating, and Deploying GUI Agents](https://arxiv.org/abs/2604.11784) |
| 2026-04-10 | [HealthAdminBench: Evaluating Computer-Use Agents on Healthcare Administration Tasks](https://arxiv.org/abs/2604.09937) |
| 2026-04-10 | [EE-MCP: Self-Evolving MCP-GUI Agents via Automated Environment Generation and Experience Learning](https://arxiv.org/abs/2604.09815) |
| 2026-04-09 | [KnowU-Bench: Towards Interactive, Proactive, and Personalized Mobile Agent Evaluation](https://arxiv.org/abs/2604.08455) |
| 2026-04-07 | [WebSP-Eval: Evaluating Web Agents on Website Security and Privacy Tasks](https://arxiv.org/abs/2604.06367) |
| 2026-04-06 | [IntentScore: Intent-Conditioned Action Evaluation for Computer-Use Agents](https://arxiv.org/abs/2604.05157) |
| 2026-04-06 | [GUIDE: Interpretable GUI Agent Evaluation via Hierarchical Diagnosis](https://arxiv.org/abs/2604.04399) |
| 2026-03-31 | [PSPA-Bench: A Personalized Benchmark for Smartphone GUI Agent](https://arxiv.org/abs/2603.29318) |
| 2026-03-27 | [GUIDE: Resolving Domain Bias in GUI Agents through Real-Time Web Video Retrieval and Plug-and-Play Annotation](https://arxiv.org/abs/2603.26266) |
| 2026-03-26 | [WebTestBench: Evaluating Computer-Use Agents towards End-to-End Automated Web Testing](https://arxiv.org/abs/2603.25226) |
| 2026-03-26 | [GUIDE: A Benchmark for Understanding and Assisting Users in Open-Ended GUI Tasks](https://arxiv.org/abs/2603.25864) |
| 2026-03-23 | [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529) |
| 2026-03-18 | [WebPII: Benchmarking Visual PII Detection for Computer-Use Agents](https://arxiv.org/abs/2603.17357) |
| 2026-03-16 | [GUI-CEval: A Hierarchical and Comprehensive Chinese Benchmark for Mobile GUI Agents](https://arxiv.org/abs/2603.15039) |
| 2026-03-11 | [CUAAudit: Meta-Evaluation of Vision-Language Models as Auditors of Autonomous Computer-Use Agents](https://arxiv.org/abs/2603.10577) |
| 2026-03-10 | [SpecOps: A Fully Automated AI Agent Testing Framework in Real-World GUI Environments](https://arxiv.org/abs/2603.10268) |
| 2026-03-09 | [PIRA-Bench: A Transition from Reactive GUI Agents to GUI-based Proactive Intent Recommendation Agents](https://arxiv.org/abs/2603.08013) |
| 2026-03-09 | [OSExpert: Computer-Use Agents Learning Professional Skills via Exploration](https://arxiv.org/abs/2603.07978) |
| 2026-03-05 | [TimeWarp: Evaluating Web Agents by Revisiting the Past](https://arxiv.org/abs/2603.04949) |
| 2026-03-01 | [WebArena-Infinity: Generating Browser Environments with Verifiable Tasks at Scale](https://webarena.dev/webarena-infinity/) |
| 2026-02-28 | [MobiFlow: Real-World Mobile Agent Benchmarking through Trajectory Fusion](https://arxiv.org/abs/2604.09587) |
| 2026-02-28 | [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503) |
| 2026-02-25 | [OpeFlo: Automated UX Evaluation via Simulated Human Web Interaction with GUI Grounding](https://arxiv.org/abs/2604.09581) |
| 2026-02-25 | [GUI-Libra: Training Native GUI Agents to Reason and Act with Action-aware Supervision and Partially Verifiable RL](https://arxiv.org/abs/2602.22190) |
| 2026-02-24 | [Turing Test on Screen: A Benchmark for Mobile GUI Agent Humanization](https://arxiv.org/abs/2604.09574) |
| 2026-02-19 | [Persona2Web: Benchmarking Personalized Web Agents for Contextual Reasoning with User History](https://arxiv.org/abs/2602.17003) |
| 2026-02-17 | [World-Model-Augmented Web Agents with Action Correction](https://arxiv.org/abs/2602.15384) |
| 2026-02-16 | [WebWorld: A Large-Scale World Model for Web Agent Training](https://arxiv.org/abs/2602.14721) |
| 2026-02-15 | [GUI-GENESIS: Automated Synthesis of Efficient Environments with Verifiable Rewards for GUI Agent Post-Training](https://arxiv.org/abs/2602.14093) |
| 2026-02-13 | [Scaling Web Agent Training through Automatic Data Generation and Fine-grained Evaluation](https://arxiv.org/abs/2602.12544) |
| 2026-02-12 | [AmbiBench: Benchmarking Mobile GUI Agents Beyond One-Shot Instructions in the Wild](https://arxiv.org/abs/2602.11750) |
| 2026-02-11 | [UI-Oceanus: Scaling GUI Agents with Synthetic Environmental Dynamics](https://arxiv.org/abs/2604.02345) |
| 2026-02-11 | [See, Plan, Snap: Evaluating Multimodal GUI Agents in Scratch](https://arxiv.org/abs/2602.10814) |
| 2026-02-10 | [TreeCUA: Efficiently Scaling GUI Automation with Tree-Structured Verifiable Evolution](https://arxiv.org/abs/2602.09662) |
| 2026-02-10 | [Code2World: A GUI World Model via Renderable Code Generation](https://arxiv.org/abs/2602.09856) |
| 2026-02-10 | [Autonomous Continual Learning of Computer-Use Agents for Environment Adaptation](https://arxiv.org/abs/2602.10356) |
| 2026-02-06 | [VenusBench-Mobile: A Challenging and User-Centric Benchmark for Mobile GUI Agents with Capability Diagnostics](https://arxiv.org/abs/2604.06182) |
| 2026-02-05 | [PATHWAYS: Evaluating Investigation and Context Discovery in AI Web Agents](https://arxiv.org/abs/2602.05354) |
| 2026-02-03 | [MemGUI-Bench: Benchmarking Memory of Mobile GUI Agents in Dynamic Environments](https://arxiv.org/abs/2602.06075) |
| 2026-02-03 | [LPS-Bench: Benchmarking Safety Awareness of Computer-Use Agents in Long-Horizon Planning under Benign and Adversarial](https://arxiv.org/abs/2602.03255) |
| 2026-02-03 | [Agent Alpha: Tree Search Unifying Generation, Exploration and Evaluation for Computer-Use Agents](https://arxiv.org/abs/2602.02995) |
| 2026-01-29 | [How do Visual Attributes Influence Web Agents? A Comprehensive Evaluation of User Interface Design Factors](https://arxiv.org/abs/2601.21961) |
| 2026-01-28 | [OS-Marathon: Benchmarking Computer-Use Agents on Long-Horizon Repetitive Tasks](https://arxiv.org/abs/2601.20650) |
| 2026-01-28 | [MobileBench-OL: A Comprehensive Chinese Benchmark for Evaluating Mobile GUI Agents in Real-World Environment](https://arxiv.org/abs/2601.20335) |
| 2026-01-26 | [SMAN-Bench: A Cross-System Benchmark for Mobile Agents under Single- and Multi-path, Ambiguous, and Noisy Tasks](https://openreview.net/forum?id=IWDpCaSF9Q) |
| 2026-01-25 | [EntWorld: A Holistic Environment and Benchmark for Verifiable Enterprise GUI Agents](https://arxiv.org/abs/2601.17722) |
| 2026-01-13 | [WebTrap Park: An Automated Platform for Systematic Security Evaluation of Web Agents](https://arxiv.org/abs/2601.08406) |
| 2026-01-07 | [MobileDreamer: Generative Sketch World Model for GUI Agent](https://arxiv.org/abs/2601.04035) |
| 2026-01-07 | [InfiniteWeb: Scalable Web Environment Synthesis for GUI Agent Training](https://arxiv.org/abs/2601.04126) |
| 2026-01-05 | [WebGym: Scaling Training Environments for Visual Web Agents with Realistic Tasks](https://arxiv.org/abs/2601.02439) |
| 2025-12-29 | [It's a TRAP! Task-Redirecting Agent Persuasion Benchmark for Web Agents](https://arxiv.org/abs/2512.23128) |
| 2025-12-26 | [MAI-UI Technical Report: Real-World Centric Foundation GUI Agents](https://arxiv.org/abs/2512.22047) |
| 2025-12-24 | [AndroidLens: Long-latency Evaluation with Nested Sub-targets for Android GUI Agents](https://arxiv.org/abs/2512.21302) |
| 2025-12-22 | [MobileWorld: Benchmarking Autonomous Mobile Agents in Agent-User Interactive and MCP-Augmented Environments](https://arxiv.org/abs/2512.19432) |
| 2025-12-18 | [VenusBench-GD: A Comprehensive Multi-Platform GUI Benchmark for Diverse Grounding Tasks](https://arxiv.org/abs/2512.16501) |
| 2025-12-16 | [MobileWorldBench: Towards Semantic World Modeling For Mobile Agents](https://arxiv.org/abs/2512.14014) |
| 2025-12-14 | [Modular and Multi-Path-Aware Offline Benchmarking for Mobile GUI Agents](https://arxiv.org/abs/2512.12634) |
| 2025-12-05 | [Zoom in, Click out: Unlocking and Evaluating the Potential of Zooming for GUI Grounding](https://arxiv.org/abs/2512.05941) |
| 2025-12-01 | [DrawingBench: Evaluating Spatial Reasoning and UI Interaction Capabilities of Large Language Models through Mouse-Based](https://arxiv.org/abs/2512.01174) |
| 2025-11-30 | [MPR-GUI: Benchmarking and Enhancing Multilingual Perception and Reasoning in GUI Agents](https://arxiv.org/abs/2512.00756) |
| 2025-11-06 | [GUI-360: A Comprehensive Dataset and Benchmark for Computer-Using Agents](https://arxiv.org/abs/2511.04307) |
| 2025-10-22 | [WebGraphEval: Multi-Turn Trajectory Evaluation for Web Agents using Graph Representation](https://arxiv.org/abs/2510.19205) |
| 2025-10-17 | [WebServ: A Browser-Server Environment for Efficient Training of Reinforcement Learning-based Web Agents at Scale](https://arxiv.org/abs/2510.16252) |

### 12.3 GUI grounding、屏幕解析与视觉定位

| 时间 | 论文 |
|---|---|
| 2026-06-03 | [Benchmarking Living-Screen-Native GUI Agents on Short-Video Platforms](https://arxiv.org/abs/2606.04701) |
| 2026-05-29 | [GUI-C²: Coarse-to-Fine GUI Grounding via Difficulty-Aware Reinforcement Learning](https://z1oong.github.io/GUI-C2/) |
| 2026-05-01 | [A11y-Compressor: A Framework for Enhancing the Efficiency of GUI Agent Observations through Visual Context Reconstruction](https://arxiv.org/abs/2605.00551) |
| 2026-04-15 | [UI-Zoomer: Uncertainty-Driven Adaptive Zoom-In for GUI Grounding](https://arxiv.org/abs/2604.14113) |
| 2026-04-15 | [GUI-Perturbed: Domain Randomization Reveals Systematic Brittleness in GUI Grounding Models](https://arxiv.org/abs/2604.14262) |
| 2026-04-14 | [See, Point, Refine: Multi-Turn Approach to GUI Grounding with Visual Feedback](https://arxiv.org/abs/2604.13019) |
| 2026-04-09 | [MolmoWeb: Open Visual Web Agent and Open Data for the Open Web](https://arxiv.org/abs/2604.08516) |
| 2026-04-09 | [Are GUI Agents Focused Enough? Automated Distraction via Semantic-level UI Element Injection](https://arxiv.org/abs/2604.07831) |
| 2026-04-08 | [What's Missing in Screen-to-Action? Towards a UI-in-the-Loop Paradigm for Multimodal GUI Reasoning](https://arxiv.org/abs/2604.06995) |
| 2026-03-27 | [Towards GUI Agents: Vision-Language Diffusion Models for GUI Grounding](https://arxiv.org/abs/2603.26211) |
| 2026-03-27 | [Rethinking Token Pruning for Historical Screenshots in GUI Visual Agents: Semantic, Spatial, and Temporal Perspectives](https://arxiv.org/abs/2603.26041) |
| 2026-03-24 | [AgentRAE: Remote Action Execution through Notification-based Visual Backdoors against Screenshots-based Mobile GUI](https://arxiv.org/abs/2603.23007) |
| 2026-03-23 | [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529) |
| 2026-03-18 | [WebPII: Benchmarking Visual PII Detection for Computer-Use Agents](https://arxiv.org/abs/2603.17357) |
| 2026-03-18 | [AdaZoom-GUI: Adaptive Zoom-based GUI Grounding with Instruction Refinement](https://arxiv.org/abs/2603.17441) |
| 2026-03-15 | [Zoom to Essence: Trainless GUI Grounding by Inferring upon Interface Elements](https://arxiv.org/abs/2603.14448) |
| 2026-03-05 | [WebFactory: Automated Compression of Foundational Language Intelligence into Grounded Web Agents](https://arxiv.org/abs/2603.05044) |
| 2026-02-25 | [OpeFlo: Automated UX Evaluation via Simulated Human Web Interaction with GUI Grounding](https://arxiv.org/abs/2604.09581) |
| 2026-02-24 | [Turing Test on Screen: A Benchmark for Mobile GUI Agent Humanization](https://arxiv.org/abs/2604.09574) |
| 2026-02-15 | [Moving Beyond Sparse Grounding with Complete Screen Parsing Supervision](https://arxiv.org/abs/2602.14276) |
| 2026-02-11 | [Blind Gods and Broken Screens: Architecting a Secure, Intent-Centric Mobile Agent Operating System](https://arxiv.org/abs/2602.10915) |
| 2026-02-06 | [Trifuse: Enhancing Attention-Based GUI Grounding via Multimodal Fusion](https://arxiv.org/abs/2602.06351) |
| 2026-02-06 | [POINTS-GUI-G: GUI-Grounding Journey](https://arxiv.org/abs/2602.06391) |
| 2026-02-06 | [ANCHOR: Branch-Point Data Generation for GUI Agents](https://arxiv.org/abs/2602.07153) |
| 2026-02-02 | [Avenir-Web: Human-Experience-Imitating Multimodal Web Agents with Mixture of Grounding Experts](https://arxiv.org/abs/2602.02468) |
| 2026-01-29 | [How do Visual Attributes Influence Web Agents? A Comprehensive Evaluation of User Interface Design Factors](https://arxiv.org/abs/2601.21961) |
| 2026-01-14 | [GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents](https://arxiv.org/abs/2601.09770) |
| 2026-01-14 | [Compress to Focus: Efficient Coordinate Compression for Policy Optimization in Multi-Turn GUI Agents](https://arxiv.org/abs/2601.11631) |
| 2026-01-11 | [V2P: Visual Attention Calibration for GUI Grounding via Background Suppression and Center Peaking](https://arxiv.org/abs/2601.06899) |
| 2026-01-05 | [WebGym: Scaling Training Environments for Visual Web Agents with Realistic Tasks](https://arxiv.org/abs/2601.02439) |
| 2025-12-18 | [VenusBench-GD: A Comprehensive Multi-Platform GUI Benchmark for Diverse Grounding Tasks](https://arxiv.org/abs/2512.16501) |
| 2025-12-09 | [MVP: Multiple View Prediction Improves GUI Grounding](https://arxiv.org/abs/2512.08529) |
| 2025-12-05 | [Zoom in, Click out: Unlocking and Evaluating the Potential of Zooming for GUI Grounding](https://arxiv.org/abs/2512.05941) |
| 2025-12-02 | [GUI Exploration Lab: Enhancing Screen Navigation in Agents via Multi-Turn Reinforcement Learning](https://arxiv.org/abs/2512.02423) |
| 2025-11-07 | [Beyond Clicking: A Step Towards Generalist GUI Grounding via Text Dragging](https://arxiv.org/abs/2601.06031) |
| 2025-10-05 | [GUI-Spotlight: Adaptive Iterative Focus Refinement for Enhanced GUI Visual Grounding](https://arxiv.org/abs/2510.04039) |
| 2025-08-17 | [You Don’t Know Until You Click: Automated GUI Testing for Production-Ready Software Evaluation](https://arxiv.org/abs/2508.14104) |
| 2025-08-07 | [Test‑Time Reinforcement Learning for GUI Grounding via Region Consistency](https://arxiv.org/abs/2508.05615) |
| 2025-08-06 | [GuirlVG: Incentivize GUI Visual Grounding via Empirical Exploration on Reinforcement Learning](https://arxiv.org/abs/2508.04389) |
| 2025-07-29 | [UI-AGILE: Advancing GUI Agents with Effective Reinforcement Learning and Precise Inference-Time Grounding](https://arxiv.org/abs/2507.22025) |

### 12.4 训练数据、SFT / RL 与自进化

| 时间 | 论文 |
|---|---|
| 2026-06-03 | [Benchmarking Living-Screen-Native GUI Agents on Short-Video Platforms](https://arxiv.org/abs/2606.04701) |
| 2026-05-29 | [GUI-C²: Coarse-to-Fine GUI Grounding via Difficulty-Aware Reinforcement Learning](https://z1oong.github.io/GUI-C2/) |
| 2026-04-28 | [Training Computer Use Agents to Assess the Usability of Graphical User Interfaces](https://arxiv.org/abs/2604.26020) |
| 2026-04-13 | [ClawGUI: A Unified Framework for Training, Evaluating, and Deploying GUI Agents](https://arxiv.org/abs/2604.11784) |
| 2026-04-10 | [EE-MCP: Self-Evolving MCP-GUI Agents via Automated Environment Generation and Experience Learning](https://arxiv.org/abs/2604.09815) |
| 2026-04-09 | [MolmoWeb: Open Visual Web Agent and Open Data for the Open Web](https://arxiv.org/abs/2604.08516) |
| 2026-04-08 | [Android Coach: Improve Online Agentic Training Efficiency with Single State Multiple Actions](https://arxiv.org/abs/2604.07277) |
| 2026-04-02 | [GPA: Learning GUI Process Automation from Demonstrations](https://arxiv.org/abs/2604.01676) |
| 2026-03-27 | [GUIDE: Resolving Domain Bias in GUI Agents through Real-Time Web Video Retrieval and Plug-and-Play Annotation](https://arxiv.org/abs/2603.26266) |
| 2026-03-25 | [UI-Voyager: A Self-Evolving GUI Agent Learning via Failed Experience](https://arxiv.org/abs/2603.24533) |
| 2026-03-25 | [CUA-Suite: Massive Human-annotated Video Demonstrations for Computer-Use Agents](https://arxiv.org/abs/2603.24440) |
| 2026-03-23 | [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529) |
| 2026-03-23 | [CAPTCHA Solving for Native GUI Agents: Automated Reasoning-Action Data Generation and Self-Corrective Training](https://arxiv.org/abs/2603.23559) |
| 2026-03-19 | [OS-Themis: A Scalable Critic Framework for Generalist GUI Rewards](https://arxiv.org/abs/2603.19191) |
| 2026-03-12 | [HATS: Hardness-Aware Trajectory Synthesis for GUI Agents](https://arxiv.org/abs/2603.12138) |
| 2026-03-11 | [Hybrid Self-evolving Structured Memory for GUI Agents](https://arxiv.org/abs/2603.10291) |
| 2026-03-10 | [Video-Based Reward Modeling for Computer-Use Agents](https://arxiv.org/abs/2603.10178) |
| 2026-03-09 | [AgentOS: From Application Silos to a Natural Language-Driven Data Ecosystem](https://arxiv.org/abs/2603.08938) |
| 2026-03-08 | [Generalization in Online Reinforcement Learning for Mobile Agents](https://arxiv.org/abs/2603.07432) |
| 2026-03-04 | [Dual-Modality Multi-Stage Adversarial Safety Training: Robustifying Multimodal Web Agents Against Cross-Modal Attacks](https://arxiv.org/abs/2603.04364) |
| 2026-03-03 | [CGL: Advancing Continual GUI Learning via Reinforcement Fine-Tuning](https://arxiv.org/abs/2603.02951) |
| 2026-02-28 | [MobiFlow: Real-World Mobile Agent Benchmarking through Trajectory Fusion](https://arxiv.org/abs/2604.09587) |
| 2026-02-28 | [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503) |
| 2026-02-25 | [GUI-Libra: Training Native GUI Agents to Reason and Act with Action-aware Supervision and Partially Verifiable RL](https://arxiv.org/abs/2602.22190) |
| 2026-02-16 | [WebWorld: A Large-Scale World Model for Web Agent Training](https://arxiv.org/abs/2602.14721) |
| 2026-02-15 | [GUI-GENESIS: Automated Synthesis of Efficient Environments with Verifiable Rewards for GUI Agent Post-Training](https://arxiv.org/abs/2602.14093) |
| 2026-02-13 | [WebClipper: Efficient Evolution of Web Agents with Graph-based Trajectory Pruning](https://arxiv.org/abs/2602.12852) |
| 2026-02-13 | [Scaling Web Agent Training through Automatic Data Generation and Fine-grained Evaluation](https://arxiv.org/abs/2602.12544) |
| 2026-02-12 | [Adaptive Milestone Reward for GUI Agents](https://arxiv.org/abs/2602.11524) |
| 2026-02-10 | [Autonomous Continual Learning of Computer-Use Agents for Environment Adaptation](https://arxiv.org/abs/2602.10356) |
| 2026-02-06 | [ANCHOR: Branch-Point Data Generation for GUI Agents](https://arxiv.org/abs/2602.07153) |
| 2026-02-05 | [UI-Mem: Self-Evolving Experience Memory for Online Reinforcement Learning in Mobile GUI Agents](https://arxiv.org/abs/2602.05832) |
| 2026-02-05 | [M$^2$-Miner: Multi-Agent Enhanced MCTS for Mobile GUI Agent Data Mining](https://arxiv.org/abs/2602.05429) |
| 2026-01-31 | [Agentic Reward Modeling: Verifying GUI Agent via Online Proactive Interaction](https://arxiv.org/abs/2602.00575) |
| 2026-01-30 | [Learning with Challenges: Adaptive Difficulty-Aware Data Generation for Mobile GUI Agent Training](https://arxiv.org/abs/2601.22781) |
| 2026-01-30 | [Darwinian Memory: A Training-Free Self-Regulating Memory System for GUI Agent Evolution](https://arxiv.org/abs/2601.22528) |
| 2026-01-29 | [WebArbiter: A Principle-Guided Reasoning Process Reward Model for Web Agents](https://arxiv.org/abs/2601.21872) |
| 2026-01-29 | [DynaWeb: Model-Based Reinforcement Learning of Web Agents](https://arxiv.org/abs/2601.22149) |
| 2026-01-28 | [Continual GUI Agents](https://arxiv.org/abs/2601.20732) |
| 2026-01-26 | [GAIA: A Data Flywheel System for Training GUI Test-Time Scaling Critic Models](https://arxiv.org/abs/2601.18197) |
| 2026-01-19 | [MagicGUI-RMS: A Multi-Agent Reward Model System for Self-Evolving GUI Agents via Automated Feedback Reflux](https://arxiv.org/abs/2601.13060) |
| 2026-01-07 | [InfiniteWeb: Scalable Web Environment Synthesis for GUI Agent Training](https://arxiv.org/abs/2601.04126) |
| 2026-01-05 | [WebGym: Scaling Training Environments for Visual Web Agents with Realistic Tasks](https://arxiv.org/abs/2601.02439) |
| 2025-12-02 | [GUI Exploration Lab: Enhancing Screen Navigation in Agents via Multi-Turn Reinforcement Learning](https://arxiv.org/abs/2512.02423) |
| 2025-11-27 | [Training High-Level Schedulers with Execution-Feedback Reinforcement Learning for Long-Horizon GUI Automation](https://arxiv.org/abs/2511.22235) |
| 2025-11-06 | [GUI-360: A Comprehensive Dataset and Benchmark for Computer-Using Agents](https://arxiv.org/abs/2511.04307) |
| 2025-10-22 | [WebGraphEval: Multi-Turn Trajectory Evaluation for Web Agents using Graph Representation](https://arxiv.org/abs/2510.19205) |
| 2025-10-22 | [VideoAgentTrek: Computer Use Pretraining from Unlabeled Videos](https://arxiv.org/abs/2510.19488) |
| 2025-10-17 | [WebServ: A Browser-Server Environment for Efficient Training of Reinforcement Learning-based Web Agents at Scale](https://arxiv.org/abs/2510.16252) |
| 2025-09-28 | [Efficient Multi-turn RL for GUI Agents via Decoupled Training and Adaptive Data Curation](https://arxiv.org/abs/2509.23866) |
| 2025-09-26 | [ProRe: A Proactive Reward System for GUI Agents via Reasoner-Actor Collaboration](https://arxiv.org/abs/2509.21823) |
| 2025-09-18 | [ScaleCUA: Scaling Open-Source Computer Use Agents with Cross-Platform Data](https://arxiv.org/abs/2509.15221) |
| 2025-09-10 | [MobileRL: Online Agentic Reinforcement Learning for Mobile GUI Agents](https://arxiv.org/abs/2509.18119) |
| 2025-09-02 | [UI-TARS-2 Technical Report: Advancing GUI Agent with Multi-Turn Reinforcement Learning](https://arxiv.org/abs/2509.02544) |
| 2025-09-01 | [Succeed or Learn Slowly: Sample Efficient Off-Policy Reinforcement Learning for Mobile App Control](https://arxiv.org/abs/2509.01720) |
| 2025-08-27 | [CODA: Coordinating the Cerebrum and Cerebellum for a Dual-Brain Computer Use Agent with Decoupled Reinforcement](https://arxiv.org/abs/2508.20096) |
| 2025-08-19 | [ComputerRL: Scaling End-to-End Online Reinforcement Learning for Computer Use Agents](https://arxiv.org/abs/2508.14040) |
| 2025-08-07 | [Test‑Time Reinforcement Learning for GUI Grounding via Region Consistency](https://arxiv.org/abs/2508.05615) |
| 2025-08-06 | [SEAgent: Self-Evolving Computer Use Agent with Autonomous Learning from Experience](https://arxiv.org/abs/2508.04700) |
| 2025-08-06 | [GuirlVG: Incentivize GUI Visual Grounding via Empirical Exploration on Reinforcement Learning](https://arxiv.org/abs/2508.04389) |

### 12.5 长程记忆、过程奖励、Verifier 与 Critic

| 时间 | 论文 |
|---|---|
| 2026-04-30 | [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments](https://arxiv.org/abs/2604.27776) |
| 2026-04-27 | [Odysseys: Benchmarking Web Agents on Realistic Long Horizon Tasks](https://arxiv.org/abs/2604.24964) |
| 2026-04-23 | [VLAA-GUI: Knowing When to Stop, Recover, and Search, A Modular Framework for GUI Automation](https://arxiv.org/abs/2604.21375) |
| 2026-04-12 | [The Blind Spot of Agent Safety: How Benign User Instructions Expose Critical Vulnerabilities in Computer-Use Agents](https://arxiv.org/abs/2604.10577) |
| 2026-04-09 | [Same Outcomes, Different Journeys: A Trace-Level Framework for Comparing Human and GUI-Agent Behavior in Production](https://arxiv.org/abs/2604.07929) |
| 2026-04-07 | [Don''t Act Blindly: Robust GUI Automation via Action-Effect Verification and Self-Correction](https://arxiv.org/abs/2604.05477) |
| 2026-04-02 | [GPA: Learning GUI Process Automation from Demonstrations](https://arxiv.org/abs/2604.01676) |
| 2026-03-19 | [OS-Themis: A Scalable Critic Framework for Generalist GUI Rewards](https://arxiv.org/abs/2603.19191) |
| 2026-03-19 | [AndroTMem: From Interaction Trajectories to Anchored Memory in Long-Horizon GUI Agents](https://arxiv.org/abs/2603.18429) |
| 2026-03-11 | [Hybrid Self-evolving Structured Memory for GUI Agents](https://arxiv.org/abs/2603.10291) |
| 2026-03-07 | [Enhancing Web Agents with a Hierarchical Memory Tree](https://arxiv.org/abs/2603.07024) |
| 2026-02-28 | [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503) |
| 2026-02-24 | [ActionEngine: From Reactive to Programmatic GUI Agents via State Machine Memory](https://arxiv.org/abs/2602.20502) |
| 2026-02-19 | [Persona2Web: Benchmarking Personalized Web Agents for Contextual Reasoning with User History](https://arxiv.org/abs/2602.17003) |
| 2026-02-05 | [UI-Mem: Self-Evolving Experience Memory for Online Reinforcement Learning in Mobile GUI Agents](https://arxiv.org/abs/2602.05832) |
| 2026-02-03 | [MemGUI-Bench: Benchmarking Memory of Mobile GUI Agents in Dynamic Environments](https://arxiv.org/abs/2602.06075) |
| 2026-02-03 | [LPS-Bench: Benchmarking Safety Awareness of Computer-Use Agents in Long-Horizon Planning under Benign and Adversarial](https://arxiv.org/abs/2602.03255) |
| 2026-01-30 | [Darwinian Memory: A Training-Free Self-Regulating Memory System for GUI Agent Evolution](https://arxiv.org/abs/2601.22528) |
| 2026-01-29 | [WebArbiter: A Principle-Guided Reasoning Process Reward Model for Web Agents](https://arxiv.org/abs/2601.21872) |
| 2026-01-28 | [OS-Marathon: Benchmarking Computer-Use Agents on Long-Horizon Repetitive Tasks](https://arxiv.org/abs/2601.20650) |
| 2026-01-27 | [MAGNET: Towards Adaptive GUI Agents with Memory-Driven Knowledge Evolution](https://arxiv.org/abs/2601.19199) |
| 2026-01-26 | [LongHorizonUI: A Unified Framework for Robust long-horizon Task Automation of GUI Agent](https://openreview.net/forum?id=BK7Mk5d4WE) |
| 2026-01-26 | [GAIA: A Data Flywheel System for Training GUI Test-Time Scaling Critic Models](https://arxiv.org/abs/2601.18197) |
| 2026-01-14 | [PersonalAlign: Hierarchical Implicit Intent Alignment for Personalized GUI Agent with Long-Term User-Centric Records](https://arxiv.org/abs/2601.09636) |
| 2026-01-12 | [ColorBrowserAgent: Complex Long-Horizon Browser Agent with Adaptive Knowledge Evolution](https://arxiv.org/abs/2601.07262) |
| 2025-12-24 | [AndroidLens: Long-latency Evaluation with Nested Sub-targets for Android GUI Agents](https://arxiv.org/abs/2512.21302) |
| 2025-12-22 | [EchoTrail-GUI: Building Actionable Memory for GUI Agents via Critic-Guided Self-Exploration](https://arxiv.org/abs/2512.19396) |
| 2025-12-18 | [OS-Oracle: A Comprehensive Framework for Cross-Platform GUI Critic Models](https://arxiv.org/abs/2512.16295) |
| 2025-12-11 | [AgentProg: Empowering Long-Horizon GUI Agents with Program-Guided Context Management](https://arxiv.org/abs/2512.10371) |
| 2025-12-01 | [HiconAgent: History Context-aware Policy Optimization for GUI Agents](https://arxiv.org/abs/2512.01763) |
| 2025-11-27 | [Training High-Level Schedulers with Execution-Feedback Reinforcement Learning for Long-Horizon GUI Automation](https://arxiv.org/abs/2511.22235) |
| 2025-10-03 | [FocusAgent: Simple Yet Effective Ways of Trimming the Large Context of Web Agents](https://arxiv.org/abs/2510.03204) |
| 2025-07-29 | [UI-AGILE: Advancing GUI Agents with Effective Reinforcement Learning and Precise Inference-Time Grounding](https://arxiv.org/abs/2507.22025) |

### 12.6 Hybrid action、RPA、MCP 与工具融合

| 时间 | 论文 |
|---|---|
| 2026-04-27 | [Odysseys: Benchmarking Web Agents on Realistic Long Horizon Tasks](https://arxiv.org/abs/2604.24964) |
| 2026-04-13 | [WebForge: Breaking the Realism-Reproducibility-Scalability Trilemma in Browser Agent Benchmark](https://arxiv.org/abs/2604.10988) |
| 2026-04-10 | [EE-MCP: Self-Evolving MCP-GUI Agents via Automated Environment Generation and Experience Learning](https://arxiv.org/abs/2604.09815) |
| 2026-04-09 | [MolmoWeb: Open Visual Web Agent and Open Data for the Open Web](https://arxiv.org/abs/2604.08516) |
| 2026-04-07 | [WebSP-Eval: Evaluating Web Agents on Website Security and Privacy Tasks](https://arxiv.org/abs/2604.06367) |
| 2026-04-03 | [The Tool Illusion: Rethinking Tool Use in Web Agents](https://arxiv.org/abs/2604.03465) |
| 2026-03-31 | [Terminal Agents Suffice for Enterprise Automation](https://arxiv.org/abs/2604.00073) |
| 2026-03-23 | [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529) |
| 2026-03-20 | [ContractSkill: Repairable Contract-Based Skills for Multimodal Web Agents](https://arxiv.org/abs/2603.20340) |
| 2026-03-15 | [Why Do LLM-based Web Agents Fail? A Hierarchical Planning Perspective](https://arxiv.org/abs/2603.14248) |
| 2026-03-13 | [AI Planning Framework for LLM-Based Web Agents](https://arxiv.org/abs/2603.12710) |
| 2026-03-11 | [Safe and Scalable Web Agent Learning via Recreated Websites](https://arxiv.org/abs/2603.10505) |
| 2026-03-11 | [Hybrid Self-evolving Structured Memory for GUI Agents](https://arxiv.org/abs/2603.10291) |
| 2026-03-07 | [Enhancing Web Agents with a Hierarchical Memory Tree](https://arxiv.org/abs/2603.07024) |
| 2026-03-05 | [WebFactory: Automated Compression of Foundational Language Intelligence into Grounded Web Agents](https://arxiv.org/abs/2603.05044) |
| 2026-03-05 | [TimeWarp: Evaluating Web Agents by Revisiting the Past](https://arxiv.org/abs/2603.04949) |
| 2026-03-04 | [Dual-Modality Multi-Stage Adversarial Safety Training: Robustifying Multimodal Web Agents Against Cross-Modal Attacks](https://arxiv.org/abs/2603.04364) |
| 2026-02-28 | [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503) |
| 2026-02-19 | [Persona2Web: Benchmarking Personalized Web Agents for Contextual Reasoning with User History](https://arxiv.org/abs/2602.17003) |
| 2026-02-19 | [Modeling Distinct Human Interaction in Web Agents](https://arxiv.org/abs/2602.17588) |
| 2026-02-17 | [World-Model-Augmented Web Agents with Action Correction](https://arxiv.org/abs/2602.15384) |
| 2026-02-16 | [WebWorld: A Large-Scale World Model for Web Agent Training](https://arxiv.org/abs/2602.14721) |
| 2026-02-16 | [EmbeWebAgent: Embedding Web Agents into Any Customized UI](https://arxiv.org/abs/2602.14865) |
| 2026-02-13 | [WebClipper: Efficient Evolution of Web Agents with Graph-based Trajectory Pruning](https://arxiv.org/abs/2602.12852) |
| 2026-02-13 | [Scaling Web Agent Training through Automatic Data Generation and Fine-grained Evaluation](https://arxiv.org/abs/2602.12544) |
| 2026-02-05 | [PATHWAYS: Evaluating Investigation and Context Discovery in AI Web Agents](https://arxiv.org/abs/2602.05354) |
| 2026-02-03 | [WebSentinel: Detecting and Localizing Prompt Injection Attacks for Web Agents](https://arxiv.org/abs/2602.03792) |
| 2026-02-02 | [Avenir-Web: Human-Experience-Imitating Multimodal Web Agents with Mixture of Grounding Experts](https://arxiv.org/abs/2602.02468) |
| 2026-01-30 | [ToolTok: Tool Tokenization for Efficient and Generalizable GUI Agents](https://arxiv.org/abs/2602.02548) |
| 2026-01-29 | [WebArbiter: A Principle-Guided Reasoning Process Reward Model for Web Agents](https://arxiv.org/abs/2601.21872) |
| 2026-01-29 | [How do Visual Attributes Influence Web Agents? A Comprehensive Evaluation of User Interface Design Factors](https://arxiv.org/abs/2601.21961) |
| 2026-01-29 | [DynaWeb: Model-Based Reinforcement Learning of Web Agents](https://arxiv.org/abs/2601.22149) |
| 2026-01-14 | [GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents](https://arxiv.org/abs/2601.09770) |
| 2026-01-13 | [WebTrap Park: An Automated Platform for Systematic Security Evaluation of Web Agents](https://arxiv.org/abs/2601.08406) |
| 2026-01-13 | [ExpSeek: Self-Triggered Experience Seeking for Web Agents](https://arxiv.org/abs/2601.08605) |
| 2026-01-12 | [ColorBrowserAgent: Complex Long-Horizon Browser Agent with Adaptive Knowledge Evolution](https://arxiv.org/abs/2601.07262) |
| 2026-01-05 | [WebGym: Scaling Training Environments for Visual Web Agents with Realistic Tasks](https://arxiv.org/abs/2601.02439) |
| 2025-12-29 | [It's a TRAP! Task-Redirecting Agent Persuasion Benchmark for Web Agents](https://arxiv.org/abs/2512.23128) |
| 2025-12-28 | [DECEPTICON: How Dark Patterns Manipulate Web Agents](https://arxiv.org/abs/2512.22894) |
| 2025-12-22 | [MobileWorld: Benchmarking Autonomous Mobile Agents in Agent-User Interactive and MCP-Augmented Environments](https://arxiv.org/abs/2512.19432) |

### 12.7 安全、隐私、权限与对抗鲁棒性

| 时间 | 论文 |
|---|---|
| 2026-04-12 | [The Blind Spot of Agent Safety: How Benign User Instructions Expose Critical Vulnerabilities in Computer-Use Agents](https://arxiv.org/abs/2604.10577) |
| 2026-04-10 | [CORA: Conformal Risk-Controlled Agents for Safeguarded Mobile GUI Automation](https://arxiv.org/abs/2604.09155) |
| 2026-04-09 | [Preference Redirection via Attention Concentration: An Attack on Computer Use Agents](https://arxiv.org/abs/2604.08005) |
| 2026-04-07 | [WebSP-Eval: Evaluating Web Agents on Website Security and Privacy Tasks](https://arxiv.org/abs/2604.06367) |
| 2026-03-24 | [AgentRAE: Remote Action Execution through Notification-based Visual Backdoors against Screenshots-based Mobile GUI](https://arxiv.org/abs/2603.23007) |
| 2026-03-18 | [WebPII: Benchmarking Visual PII Detection for Computer-Use Agents](https://arxiv.org/abs/2603.17357) |
| 2026-03-09 | [SlowBA: An efficiency backdoor attack towards VLM-based GUI agents](https://arxiv.org/abs/2603.08316) |
| 2026-03-04 | [Dual-Modality Multi-Stage Adversarial Safety Training: Robustifying Multimodal Web Agents Against Cross-Modal Attacks](https://arxiv.org/abs/2603.04364) |
| 2026-02-03 | [WebSentinel: Detecting and Localizing Prompt Injection Attacks for Web Agents](https://arxiv.org/abs/2602.03792) |
| 2026-02-03 | [LPS-Bench: Benchmarking Safety Awareness of Computer-Use Agents in Long-Horizon Planning under Benign and Adversarial](https://arxiv.org/abs/2602.03255) |
| 2026-01-26 | [GUIGuard: Toward a General Framework for Privacy-Preserving GUI Agents](https://arxiv.org/abs/2601.18842) |
| 2026-01-19 | [MirrorGuard: Toward Secure Computer-Use Agents via Simulation-to-Real Reasoning Correction](https://arxiv.org/abs/2601.12822) |
| 2026-01-14 | [CaMeLs Can Use Computers Too: System-level Security for Computer Use Agents](https://arxiv.org/abs/2601.09923) |
| 2026-01-13 | [WebTrap Park: An Automated Platform for Systematic Security Evaluation of Web Agents](https://arxiv.org/abs/2601.08406) |
| 2025-12-08 | [Privacy Practices of Browser Agents](https://arxiv.org/abs/2512.07725) |
| 2025-10-21 | [Genesis: Evolving Attack Strategies for LLM Web Agent Red-Teaming](https://arxiv.org/abs/2510.18314) |
| 2025-10-15 | [In-Browser LLM-Guided Fuzzing for Real-Time Prompt Injection Testing in Agentic AI Browsers](https://arxiv.org/abs/2510.13543) |
| 2025-10-11 | [SecureWebArena: A Holistic Security Evaluation Benchmark for LVLM-based Web Agents](https://arxiv.org/abs/2510.10073) |
| 2025-10-08 | [Code Agent can be an End-to-end System Hacker: Benchmarking Real-world Threats of Computer-use Agent](https://arxiv.org/abs/2510.06607) |
| 2025-10-01 | [WAInjectBench: Benchmarking Prompt Injection Detections for Web Agents](https://arxiv.org/abs/2510.01354) |
| 2025-09-14 | [Environmental Injection Attacks against GUI Agents in Realistic Dynamic Environments](https://arxiv.org/abs/2509.11250) |
| 2025-09-09 | [AgentSentinel: An End-to-End and Real-Time Security Defense Framework for Computer-Use Agents](https://arxiv.org/abs/2509.07764) |

## 13. 附录：近一年 GUIAgent 相关论文清单

以下清单来自公开可检索的 GUI Agents Paper List 近一年条目，并用 GUIAgent / computer-use / mobile agent / grounding / automation / benchmark / security 等关键词筛选。由于 arXiv 与项目页会持续更新，清单应理解为截至 2026-06-15 的公开可检索快照，而不是永久完备全集。


### 2026-06

- 2026-06-03 — [Benchmarking Living-Screen-Native GUI Agents on Short-Video Platforms](https://arxiv.org/abs/2606.04701)
- 2026-06-01 — [STaR-KV: Spatio-Temporal Adaptive Re-weighting for KV Cache Compression in GUI Vision-Language Models](https://arxiv.org/abs/2606.01790)

### 2026-05

- 2026-05-29 — [GUI-C²: Coarse-to-Fine GUI Grounding via Difficulty-Aware Reinforcement Learning](https://z1oong.github.io/GUI-C2/)
- 2026-05-26 — [AndroidDaily: A Verifiable Benchmark for Mobile GUI Agents on Real-World Closed-Source Applications](https://arxiv.org/abs/2605.27761)
- 2026-05-25 — [MobileGym: A Verifiable and Highly Parallel Simulation Platform for Mobile GUI Agent Research](https://arxiv.org/abs/2605.26114)
- 2026-05-01 — [A11y-Compressor: A Framework for Enhancing the Efficiency of GUI Agent Observations through Visual Context Reconstruction](https://arxiv.org/abs/2605.00551)

### 2026-04

- 2026-04-30 — [WindowsWorld: A Process-Centric Benchmark of Autonomous GUI Agents in Professional Cross-Application Environments](https://arxiv.org/abs/2604.27776)
- 2026-04-28 — [Training Computer Use Agents to Assess the Usability of Graphical User Interfaces](https://arxiv.org/abs/2604.26020)
- 2026-04-27 — [Odysseys: Benchmarking Web Agents on Realistic Long Horizon Tasks](https://arxiv.org/abs/2604.24964)
- 2026-04-27 — [AutoGUI-v2: A Comprehensive Multi-Modal GUI Functionality Understanding Benchmark](https://arxiv.org/abs/2604.24441)
- 2026-04-23 — [VLAA-GUI: Knowing When to Stop, Recover, and Search, A Modular Framework for GUI Automation](https://arxiv.org/abs/2604.21375)
- 2026-04-15 — [UI-Zoomer: Uncertainty-Driven Adaptive Zoom-In for GUI Grounding](https://arxiv.org/abs/2604.14113)
- 2026-04-15 — [GUI-Perturbed: Domain Randomization Reveals Systematic Brittleness in GUI Grounding Models](https://arxiv.org/abs/2604.14262)
- 2026-04-14 — [See, Point, Refine: Multi-Turn Approach to GUI Grounding with Visual Feedback](https://arxiv.org/abs/2604.13019)
- 2026-04-13 — [WebForge: Breaking the Realism-Reproducibility-Scalability Trilemma in Browser Agent Benchmark](https://arxiv.org/abs/2604.10988)
- 2026-04-13 — [ClawGUI: A Unified Framework for Training, Evaluating, and Deploying GUI Agents](https://arxiv.org/abs/2604.11784)
- 2026-04-12 — [The Blind Spot of Agent Safety: How Benign User Instructions Expose Critical Vulnerabilities in Computer-Use Agents](https://arxiv.org/abs/2604.10577)
- 2026-04-10 — [HealthAdminBench: Evaluating Computer-Use Agents on Healthcare Administration Tasks](https://arxiv.org/abs/2604.09937)
- 2026-04-10 — [EE-MCP: Self-Evolving MCP-GUI Agents via Automated Environment Generation and Experience Learning](https://arxiv.org/abs/2604.09815)
- 2026-04-10 — [CORA: Conformal Risk-Controlled Agents for Safeguarded Mobile GUI Automation](https://arxiv.org/abs/2604.09155)
- 2026-04-09 — [Same Outcomes, Different Journeys: A Trace-Level Framework for Comparing Human and GUI-Agent Behavior in Production](https://arxiv.org/abs/2604.07929)
- 2026-04-09 — [Preference Redirection via Attention Concentration: An Attack on Computer Use Agents](https://arxiv.org/abs/2604.08005)
- 2026-04-09 — [MolmoWeb: Open Visual Web Agent and Open Data for the Open Web](https://arxiv.org/abs/2604.08516)
- 2026-04-09 — [KnowU-Bench: Towards Interactive, Proactive, and Personalized Mobile Agent Evaluation](https://arxiv.org/abs/2604.08455)
- 2026-04-09 — [Are GUI Agents Focused Enough? Automated Distraction via Semantic-level UI Element Injection](https://arxiv.org/abs/2604.07831)
- 2026-04-08 — [What's Missing in Screen-to-Action? Towards a UI-in-the-Loop Paradigm for Multimodal GUI Reasoning](https://arxiv.org/abs/2604.06995)
- 2026-04-08 — [Android Coach: Improve Online Agentic Training Efficiency with Single State Multiple Actions](https://arxiv.org/abs/2604.07277)
- 2026-04-07 — [WebSP-Eval: Evaluating Web Agents on Website Security and Privacy Tasks](https://arxiv.org/abs/2604.06367)
- 2026-04-07 — [MAESTRO: Adapting GUIs and Guiding Navigation with User Preferences in Conversational Agents with GUIs](https://arxiv.org/abs/2604.06134)
- 2026-04-07 — [Don''t Act Blindly: Robust GUI Automation via Action-Effect Verification and Self-Correction](https://arxiv.org/abs/2604.05477)
- 2026-04-06 — [IntentScore: Intent-Conditioned Action Evaluation for Computer-Use Agents](https://arxiv.org/abs/2604.05157)
- 2026-04-06 — [GUIDE: Interpretable GUI Agent Evaluation via Hierarchical Diagnosis](https://arxiv.org/abs/2604.04399)
- 2026-04-05 — [The Art of Building Verifiers for Computer Use Agents](https://arxiv.org/abs/2604.06240)
- 2026-04-03 — [The Tool Illusion: Rethinking Tool Use in Web Agents](https://arxiv.org/abs/2604.03465)
- 2026-04-02 — [GPA: Learning GUI Process Automation from Demonstrations](https://arxiv.org/abs/2604.01676)

### 2026-03

- 2026-03-31 — [Terminal Agents Suffice for Enterprise Automation](https://arxiv.org/abs/2604.00073)
- 2026-03-31 — [PSPA-Bench: A Personalized Benchmark for Smartphone GUI Agent](https://arxiv.org/abs/2603.29318)
- 2026-03-27 — [Towards GUI Agents: Vision-Language Diffusion Models for GUI Grounding](https://arxiv.org/abs/2603.26211)
- 2026-03-27 — [Rethinking Token Pruning for Historical Screenshots in GUI Visual Agents: Semantic, Spatial, and Temporal Perspectives](https://arxiv.org/abs/2603.26041)
- 2026-03-27 — [GUIDE: Resolving Domain Bias in GUI Agents through Real-Time Web Video Retrieval and Plug-and-Play Annotation](https://arxiv.org/abs/2603.26266)
- 2026-03-26 — [WebTestBench: Evaluating Computer-Use Agents towards End-to-End Automated Web Testing](https://arxiv.org/abs/2603.25226)
- 2026-03-26 — [GUIDE: A Benchmark for Understanding and Assisting Users in Open-Ended GUI Tasks](https://arxiv.org/abs/2603.25864)
- 2026-03-25 — [UI-Voyager: A Self-Evolving GUI Agent Learning via Failed Experience](https://arxiv.org/abs/2603.24533)
- 2026-03-25 — [CUA-Suite: Massive Human-annotated Video Demonstrations for Computer-Use Agents](https://arxiv.org/abs/2603.24440)
- 2026-03-24 — [AgentRAE: Remote Action Execution through Notification-based Visual Backdoors against Screenshots-based Mobile GUI](https://arxiv.org/abs/2603.23007)
- 2026-03-23 — [Ego2Web: A Web Agent Benchmark Grounded in Egocentric Videos](https://arxiv.org/abs/2603.22529)
- 2026-03-23 — [CAPTCHA Solving for Native GUI Agents: Automated Reasoning-Action Data Generation and Self-Corrective Training](https://arxiv.org/abs/2603.23559)
- 2026-03-20 — [ContractSkill: Repairable Contract-Based Skills for Multimodal Web Agents](https://arxiv.org/abs/2603.20340)
- 2026-03-19 — [OS-Themis: A Scalable Critic Framework for Generalist GUI Rewards](https://arxiv.org/abs/2603.19191)
- 2026-03-19 — [AndroTMem: From Interaction Trajectories to Anchored Memory in Long-Horizon GUI Agents](https://arxiv.org/abs/2603.18429)
- 2026-03-18 — [WebPII: Benchmarking Visual PII Detection for Computer-Use Agents](https://arxiv.org/abs/2603.17357)
- 2026-03-18 — [AdaZoom-GUI: Adaptive Zoom-based GUI Grounding with Instruction Refinement](https://arxiv.org/abs/2603.17441)
- 2026-03-16 — [GUI-CEval: A Hierarchical and Comprehensive Chinese Benchmark for Mobile GUI Agents](https://arxiv.org/abs/2603.15039)
- 2026-03-15 — [Zoom to Essence: Trainless GUI Grounding by Inferring upon Interface Elements](https://arxiv.org/abs/2603.14448)
- 2026-03-15 — [Why Do LLM-based Web Agents Fail? A Hierarchical Planning Perspective](https://arxiv.org/abs/2603.14248)
- 2026-03-13 — [Adaptive Vision-Language Model Routing for Computer Use Agents](https://arxiv.org/abs/2603.12823)
- 2026-03-13 — [AI Planning Framework for LLM-Based Web Agents](https://arxiv.org/abs/2603.12710)
- 2026-03-12 — [HATS: Hardness-Aware Trajectory Synthesis for GUI Agents](https://arxiv.org/abs/2603.12138)
- 2026-03-11 — [Safe and Scalable Web Agent Learning via Recreated Websites](https://arxiv.org/abs/2603.10505)
- 2026-03-11 — [Hybrid Self-evolving Structured Memory for GUI Agents](https://arxiv.org/abs/2603.10291)
- 2026-03-11 — [CUAAudit: Meta-Evaluation of Vision-Language Models as Auditors of Autonomous Computer-Use Agents](https://arxiv.org/abs/2603.10577)
- 2026-03-10 — [Video-Based Reward Modeling for Computer-Use Agents](https://arxiv.org/abs/2603.10178)
- 2026-03-10 — [SpecOps: A Fully Automated AI Agent Testing Framework in Real-World GUI Environments](https://arxiv.org/abs/2603.10268)
- 2026-03-09 — [SlowBA: An efficiency backdoor attack towards VLM-based GUI agents](https://arxiv.org/abs/2603.08316)
- 2026-03-09 — [SecAgent: Efficient Mobile GUI Agent with Semantic Context](https://arxiv.org/abs/2603.08533)
- 2026-03-09 — [PIRA-Bench: A Transition from Reactive GUI Agents to GUI-based Proactive Intent Recommendation Agents](https://arxiv.org/abs/2603.08013)
- 2026-03-09 — [OSExpert: Computer-Use Agents Learning Professional Skills via Exploration](https://arxiv.org/abs/2603.07978)
- 2026-03-09 — [AgentOS: From Application Silos to a Natural Language-Driven Data Ecosystem](https://arxiv.org/abs/2603.08938)
- 2026-03-08 — [Generalization in Online Reinforcement Learning for Mobile Agents](https://arxiv.org/abs/2603.07432)
- 2026-03-07 — [Enhancing Web Agents with a Hierarchical Memory Tree](https://arxiv.org/abs/2603.07024)
- 2026-03-05 — [WebFactory: Automated Compression of Foundational Language Intelligence into Grounded Web Agents](https://arxiv.org/abs/2603.05044)
- 2026-03-05 — [TimeWarp: Evaluating Web Agents by Revisiting the Past](https://arxiv.org/abs/2603.04949)
- 2026-03-04 — [Dual-Modality Multi-Stage Adversarial Safety Training: Robustifying Multimodal Web Agents Against Cross-Modal Attacks](https://arxiv.org/abs/2603.04364)
- 2026-03-03 — [CGL: Advancing Continual GUI Learning via Reinforcement Fine-Tuning](https://arxiv.org/abs/2603.02951)
- 2026-03-01 — [WebArena-Infinity: Generating Browser Environments with Verifiable Tasks at Scale](https://webarena.dev/webarena-infinity/)

### 2026-02

- 2026-02-28 — [MobiFlow: Real-World Mobile Agent Benchmarking through Trajectory Fusion](https://arxiv.org/abs/2604.09587)
- 2026-02-28 — [M^2: Dual-Memory Augmentation for Long-Horizon Web Agents via Trajectory Summarization and Insight Retrieval](https://arxiv.org/abs/2603.00503)
- 2026-02-25 — [OpeFlo: Automated UX Evaluation via Simulated Human Web Interaction with GUI Grounding](https://arxiv.org/abs/2604.09581)
- 2026-02-25 — [GUI-Libra: Training Native GUI Agents to Reason and Act with Action-aware Supervision and Partially Verifiable RL](https://arxiv.org/abs/2602.22190)
- 2026-02-24 — [Turing Test on Screen: A Benchmark for Mobile GUI Agent Humanization](https://arxiv.org/abs/2604.09574)
- 2026-02-24 — [ActionEngine: From Reactive to Programmatic GUI Agents via State Machine Memory](https://arxiv.org/abs/2602.20502)
- 2026-02-19 — [Persona2Web: Benchmarking Personalized Web Agents for Contextual Reasoning with User History](https://arxiv.org/abs/2602.17003)
- 2026-02-19 — [Modeling Distinct Human Interaction in Web Agents](https://arxiv.org/abs/2602.17588)
- 2026-02-19 — [IntentCUA: Learning Intent-level Representations for Skill Abstraction and Multi-Agent Planning in Computer-Use](https://arxiv.org/abs/2602.17049)
- 2026-02-17 — [World-Model-Augmented Web Agents with Action Correction](https://arxiv.org/abs/2602.15384)
- 2026-02-16 — [WebWorld: A Large-Scale World Model for Web Agent Training](https://arxiv.org/abs/2602.14721)
- 2026-02-16 — [EmbeWebAgent: Embedding Web Agents into Any Customized UI](https://arxiv.org/abs/2602.14865)
- 2026-02-15 — [Moving Beyond Sparse Grounding with Complete Screen Parsing Supervision](https://arxiv.org/abs/2602.14276)
- 2026-02-15 — [Mobile-Agent-v3.5: Multi-platform Fundamental GUI Agents](https://arxiv.org/abs/2602.16855)
- 2026-02-15 — [GUI-GENESIS: Automated Synthesis of Efficient Environments with Verifiable Rewards for GUI Agent Post-Training](https://arxiv.org/abs/2602.14093)
- 2026-02-14 — [Building Autonomous GUI Navigation via Agentic-Q Estimation and Step-Wise Policy Optimization](https://arxiv.org/abs/2602.13653)
- 2026-02-13 — [WebClipper: Efficient Evolution of Web Agents with Graph-based Trajectory Pruning](https://arxiv.org/abs/2602.12852)
- 2026-02-13 — [Scaling Web Agent Training through Automatic Data Generation and Fine-grained Evaluation](https://arxiv.org/abs/2602.12544)
- 2026-02-12 — [How Smart Is Your GUI Agent? A Framework for the Future of Software Interaction](https://arxiv.org/abs/2602.11514)
- 2026-02-12 — [AmbiBench: Benchmarking Mobile GUI Agents Beyond One-Shot Instructions in the Wild](https://arxiv.org/abs/2602.11750)
- 2026-02-12 — [Adaptive Milestone Reward for GUI Agents](https://arxiv.org/abs/2602.11524)
- 2026-02-11 — [UI-Oceanus: Scaling GUI Agents with Synthetic Environmental Dynamics](https://arxiv.org/abs/2604.02345)
- 2026-02-11 — [See, Plan, Snap: Evaluating Multimodal GUI Agents in Scratch](https://arxiv.org/abs/2602.10814)
- 2026-02-11 — [Blind Gods and Broken Screens: Architecting a Secure, Intent-Centric Mobile Agent Operating System](https://arxiv.org/abs/2602.10915)
- 2026-02-10 — [TreeCUA: Efficiently Scaling GUI Automation with Tree-Structured Verifiable Evolution](https://arxiv.org/abs/2602.09662)
- 2026-02-10 — [Code2World: A GUI World Model via Renderable Code Generation](https://arxiv.org/abs/2602.09856)
- 2026-02-10 — [Autonomous Continual Learning of Computer-Use Agents for Environment Adaptation](https://arxiv.org/abs/2602.10356)
- 2026-02-09 — [When Benign Inputs Lead to Severe Harms: Eliciting Unsafe Unintended Behaviors of Computer-Use Agents](https://arxiv.org/abs/2602.08235)
- 2026-02-09 — [When Actions Go Off-Task: Detecting and Correcting Misaligned Actions in Computer-Use Agents](https://arxiv.org/abs/2602.08995)
- 2026-02-07 — [Mapping the Design Space of User Experience for Computer Use Agents](https://arxiv.org/abs/2602.07283)
- 2026-02-06 — [VenusBench-Mobile: A Challenging and User-Centric Benchmark for Mobile GUI Agents with Capability Diagnostics](https://arxiv.org/abs/2604.06182)
- 2026-02-06 — [Trifuse: Enhancing Attention-Based GUI Grounding via Multimodal Fusion](https://arxiv.org/abs/2602.06351)
- 2026-02-06 — [POINTS-GUI-G: GUI-Grounding Journey](https://arxiv.org/abs/2602.06391)
- 2026-02-06 — [ANCHOR: Branch-Point Data Generation for GUI Agents](https://arxiv.org/abs/2602.07153)
- 2026-02-05 — [UI-Mem: Self-Evolving Experience Memory for Online Reinforcement Learning in Mobile GUI Agents](https://arxiv.org/abs/2602.05832)
- 2026-02-05 — [PATHWAYS: Evaluating Investigation and Context Discovery in AI Web Agents](https://arxiv.org/abs/2602.05354)
- 2026-02-05 — [M$^2$-Miner: Multi-Agent Enhanced MCTS for Mobile GUI Agent Data Mining](https://arxiv.org/abs/2602.05429)
- 2026-02-03 — [WebSentinel: Detecting and Localizing Prompt Injection Attacks for Web Agents](https://arxiv.org/abs/2602.03792)
- 2026-02-03 — [MemGUI-Bench: Benchmarking Memory of Mobile GUI Agents in Dynamic Environments](https://arxiv.org/abs/2602.06075)
- 2026-02-03 — [LPS-Bench: Benchmarking Safety Awareness of Computer-Use Agents in Long-Horizon Planning under Benign and Adversarial](https://arxiv.org/abs/2602.03255)
- 2026-02-03 — [Agent Alpha: Tree Search Unifying Generation, Exploration and Evaluation for Computer-Use Agents](https://arxiv.org/abs/2602.02995)
- 2026-02-02 — [Avenir-Web: Human-Experience-Imitating Multimodal Web Agents with Mixture of Grounding Experts](https://arxiv.org/abs/2602.02468)

### 2026-01

- 2026-01-31 — [Agentic Reward Modeling: Verifying GUI Agent via Online Proactive Interaction](https://arxiv.org/abs/2602.00575)
- 2026-01-30 — [ToolTok: Tool Tokenization for Efficient and Generalizable GUI Agents](https://arxiv.org/abs/2602.02548)
- 2026-01-30 — [SSL: Sweet Spot Learning for Differentiated Guidance in Agentic Optimization](https://arxiv.org/abs/2601.22491)
- 2026-01-30 — [Learning with Challenges: Adaptive Difficulty-Aware Data Generation for Mobile GUI Agent Training](https://arxiv.org/abs/2601.22781)
- 2026-01-30 — [Darwinian Memory: A Training-Free Self-Regulating Memory System for GUI Agent Evolution](https://arxiv.org/abs/2601.22528)
- 2026-01-29 — [WebArbiter: A Principle-Guided Reasoning Process Reward Model for Web Agents](https://arxiv.org/abs/2601.21872)
- 2026-01-29 — [How do Visual Attributes Influence Web Agents? A Comprehensive Evaluation of User Interface Design Factors](https://arxiv.org/abs/2601.21961)
- 2026-01-29 — [DynaWeb: Model-Based Reinforcement Learning of Web Agents](https://arxiv.org/abs/2601.22149)
- 2026-01-29 — [BEAP-Agent: Backtrackable Execution and Adaptive Planning for GUI Agents](https://arxiv.org/abs/2601.21352)
- 2026-01-28 — [OmegaUse: Building a General-Purpose GUI Agent for Autonomous Task Execution](https://arxiv.org/abs/2601.20380)
- 2026-01-28 — [OS-Marathon: Benchmarking Computer-Use Agents on Long-Horizon Repetitive Tasks](https://arxiv.org/abs/2601.20650)
- 2026-01-28 — [MobileBench-OL: A Comprehensive Chinese Benchmark for Evaluating Mobile GUI Agents in Real-World Environment](https://arxiv.org/abs/2601.20335)
- 2026-01-28 — [Continual GUI Agents](https://arxiv.org/abs/2601.20732)
- 2026-01-27 — [MAGNET: Towards Adaptive GUI Agents with Memory-Driven Knowledge Evolution](https://arxiv.org/abs/2601.19199)
- 2026-01-26 — [SwipeGen: Bridging the Execution Gap in GUI Agents via Human-like Swipe Synthesis](https://arxiv.org/abs/2601.18305)
- 2026-01-26 — [SMAN-Bench: A Cross-System Benchmark for Mobile Agents under Single- and Multi-path, Ambiguous, and Noisy Tasks](https://openreview.net/forum?id=IWDpCaSF9Q)
- 2026-01-26 — [LongHorizonUI: A Unified Framework for Robust long-horizon Task Automation of GUI Agent](https://openreview.net/forum?id=BK7Mk5d4WE)
- 2026-01-26 — [GUIGuard: Toward a General Framework for Privacy-Preserving GUI Agents](https://arxiv.org/abs/2601.18842)
- 2026-01-26 — [GAIA: A Data Flywheel System for Training GUI Test-Time Scaling Critic Models](https://arxiv.org/abs/2601.18197)
- 2026-01-25 — [EntWorld: A Holistic Environment and Benchmark for Verifiable Enterprise GUI Agents](https://arxiv.org/abs/2601.17722)
- 2026-01-24 — [GraphPilot: GUI Task Automation with One-Step LLM Reasoning Powered by Knowledge Graph](https://arxiv.org/abs/2601.17418)
- 2026-01-22 — [The Behavioral Fabric of LLM-Powered GUI Agents: Human Values and Interaction Outcomes](https://arxiv.org/abs/2601.16356)
- 2026-01-22 — [EvoCUA: Evolving Computer Use Agents via Learning from Scalable Synthetic Experience](https://arxiv.org/abs/2601.15876)
- 2026-01-19 — [MirrorGuard: Toward Secure Computer-Use Agents via Simulation-to-Real Reasoning Correction](https://arxiv.org/abs/2601.12822)
- 2026-01-19 — [MagicGUI-RMS: A Multi-Agent Reward Model System for Self-Evolving GUI Agents via Automated Feedback Reflux](https://arxiv.org/abs/2601.13060)
- 2026-01-18 — [Zero-Permission Manipulation: Can We Trust Large Multimodal Model Powered GUI Agents?](https://arxiv.org/abs/2601.12349)
- 2026-01-14 — [PersonalAlign: Hierarchical Implicit Intent Alignment for Personalized GUI Agent with Long-Term User-Centric Records](https://arxiv.org/abs/2601.09636)
- 2026-01-14 — [GUI-Eyes: Tool-Augmented Perception for Visual Grounding in GUI Agents](https://arxiv.org/abs/2601.09770)
- 2026-01-14 — [Compress to Focus: Efficient Coordinate Compression for Policy Optimization in Multi-Turn GUI Agents](https://arxiv.org/abs/2601.11631)
- 2026-01-14 — [CaMeLs Can Use Computers Too: System-level Security for Computer Use Agents](https://arxiv.org/abs/2601.09923)
- 2026-01-13 — [WebTrap Park: An Automated Platform for Systematic Security Evaluation of Web Agents](https://arxiv.org/abs/2601.08406)
- 2026-01-13 — [ExpSeek: Self-Triggered Experience Seeking for Web Agents](https://arxiv.org/abs/2601.08605)
- 2026-01-12 — [ShowUI-Aloha: Human-Taught GUI Agent](https://arxiv.org/abs/2601.07181)
- 2026-01-12 — [ColorBrowserAgent: Complex Long-Horizon Browser Agent with Adaptive Knowledge Evolution](https://arxiv.org/abs/2601.07262)
- 2026-01-11 — [V2P: Visual Attention Calibration for GUI Grounding via Background Suppression and Center Peaking](https://arxiv.org/abs/2601.06899)
- 2026-01-09 — [From Off-Policy to On-Policy: Enhancing GUI Agents via Bi-level Expert-to-Policy Assimilation](https://arxiv.org/abs/2601.05787)
- 2026-01-08 — [GUITester: Enabling GUI Agents for Exploratory Defect Discovery](https://arxiv.org/abs/2601.04500)
- 2026-01-07 — [MobileDreamer: Generative Sketch World Model for GUI Agent](https://arxiv.org/abs/2601.04035)
- 2026-01-07 — [InfiniteWeb: Scalable Web Environment Synthesis for GUI Agent Training](https://arxiv.org/abs/2601.04126)
- 2026-01-05 — [WebGym: Scaling Training Environments for Visual Web Agents with Realistic Tasks](https://arxiv.org/abs/2601.02439)

### 2025-12

- 2025-12-31 — [ShowUI-π: Flow-based Generative Models as GUI Dexterous Hands](https://arxiv.org/abs/2512.24965)
- 2025-12-29 — [It's a TRAP! Task-Redirecting Agent Persuasion Benchmark for Web Agents](https://arxiv.org/abs/2512.23128)
- 2025-12-28 — [DECEPTICON: How Dark Patterns Manipulate Web Agents](https://arxiv.org/abs/2512.22894)
- 2025-12-26 — [iSHIFT: Lightweight Slow-Fast GUI Agent with Adaptive Perception](https://arxiv.org/abs/2512.22009)
- 2025-12-26 — [MAI-UI Technical Report: Real-World Centric Foundation GUI Agents](https://arxiv.org/abs/2512.22047)
- 2025-12-24 — [AndroidLens: Long-latency Evaluation with Nested Sub-targets for Android GUI Agents](https://arxiv.org/abs/2512.21302)
- 2025-12-22 — [MobileWorld: Benchmarking Autonomous Mobile Agents in Agent-User Interactive and MCP-Augmented Environments](https://arxiv.org/abs/2512.19432)
- 2025-12-22 — [EchoTrail-GUI: Building Actionable Memory for GUI Agents via Critic-Guided Self-Exploration](https://arxiv.org/abs/2512.19396)
- 2025-12-19 — [DAVE: A VLM Vision Encoder for Document Understanding and Web Agents](https://arxiv.org/abs/2512.17221)
- 2025-12-18 — [VenusBench-GD: A Comprehensive Multi-Platform GUI Benchmark for Diverse Grounding Tasks](https://arxiv.org/abs/2512.16501)
- 2025-12-18 — [OS-Oracle: A Comprehensive Framework for Cross-Platform GUI Critic Models](https://arxiv.org/abs/2512.16295)
- 2025-12-17 — [Step-GUI Technical Report](https://arxiv.org/abs/2512.15431)
- 2025-12-16 — [MobileWorldBench: Towards Semantic World Modeling For Mobile Agents](https://arxiv.org/abs/2512.14014)
- 2025-12-14 — [Modular and Multi-Path-Aware Offline Benchmarking for Mobile GUI Agents](https://arxiv.org/abs/2512.12634)
- 2025-12-12 — [Using GUI Agent for Electronic Design Automation](https://arxiv.org/abs/2512.11611)
- 2025-12-11 — [AgentProg: Empowering Long-Horizon GUI Agents with Program-Guided Context Management](https://arxiv.org/abs/2512.10371)
- 2025-12-10 — [GAIR: GUI Automation via Information-Joint Reasoning and Group Reflection](https://arxiv.org/abs/2512.09396)
- 2025-12-09 — [MVP: Multiple View Prediction Improves GUI Grounding](https://arxiv.org/abs/2512.08529)
- 2025-12-08 — [Privacy Practices of Browser Agents](https://arxiv.org/abs/2512.07725)
- 2025-12-07 — [Permission Manifests for Web Agents](https://arxiv.org/abs/2601.02371)
- 2025-12-05 — [Zoom in, Click out: Unlocking and Evaluating the Potential of Zooming for GUI Grounding](https://arxiv.org/abs/2512.05941)
- 2025-12-02 — [GUI Exploration Lab: Enhancing Screen Navigation in Agents via Multi-Turn Reinforcement Learning](https://arxiv.org/abs/2512.02423)
- 2025-12-01 — [HiconAgent: History Context-aware Policy Optimization for GUI Agents](https://arxiv.org/abs/2512.01763)
- 2025-12-01 — [DrawingBench: Evaluating Spatial Reasoning and UI Interaction Capabilities of Large Language Models through Mouse-Based](https://arxiv.org/abs/2512.01174)

### 2025-11

- 2025-11-30 — [MPR-GUI: Benchmarking and Enhancing Multilingual Perception and Reasoning in GUI Agents](https://arxiv.org/abs/2512.00756)
- 2025-11-30 — [AFRAgent : An Adaptive Feature Renormalization Based High Resolution Aware GUI agent](https://arxiv.org/abs/2512.00846)
- 2025-11-28 — [LegalWebAgent: Empowering Access to Justice via LLM-Based Web Agents](https://arxiv.org/abs/2512.04105)
- 2025-11-27 — [Training High-Level Schedulers with Execution-Feedback Reinforcement Learning for Long-Horizon GUI Automation](https://arxiv.org/abs/2511.22235)
- 2025-11-26 — [Prune4Web: DOM Tree Pruning Programming for Web Agent](https://arxiv.org/abs/2511.21398)
- 2025-11-08 — [Adapting Web Agents with Synthetic Supervision](https://arxiv.org/abs/2511.06101)
- 2025-11-07 — [Beyond Clicking: A Step Towards Generalist GUI Grounding via Text Dragging](https://arxiv.org/abs/2601.06031)
- 2025-11-06 — [GUI-360: A Comprehensive Dataset and Benchmark for Computer-Using Agents](https://arxiv.org/abs/2511.04307)

### 2025-10

- 2025-10-22 — [WebGraphEval: Multi-Turn Trajectory Evaluation for Web Agents using Graph Representation](https://arxiv.org/abs/2510.19205)
- 2025-10-22 — [VideoAgentTrek: Computer Use Pretraining from Unlabeled Videos](https://arxiv.org/abs/2510.19488)
- 2025-10-22 — [Surfer 2: The Next Generation of Cross-Platform Computer Use Agents](https://arxiv.org/abs/2510.19949)
- 2025-10-21 — [Genesis: Evolving Attack Strategies for LLM Web Agent Red-Teaming](https://arxiv.org/abs/2510.18314)
- 2025-10-20 — [UltraCUA: A Foundation Model for Computer Use Agents with Hybrid Action](https://arxiv.org/abs/2510.17790)
- 2025-10-20 — [Investigating the Impact of Dark Patterns on LLM-Based Web Agents](https://arxiv.org/abs/2510.18113)
- 2025-10-17 — [WebServ: A Browser-Server Environment for Efficient Training of Reinforcement Learning-based Web Agents at Scale](https://arxiv.org/abs/2510.16252)
- 2025-10-17 — [CORE: Reducing UI Exposure in Mobile Agents via Collaboration Between Cloud and Local LLMs](https://arxiv.org/abs/2510.15455)
- 2025-10-15 — [In-Browser LLM-Guided Fuzzing for Real-Time Prompt Injection Testing in Agentic AI Browsers](https://arxiv.org/abs/2510.13543)
- 2025-10-14 — [HackWorld: Evaluating Computer-Use Agents on Exploiting Web Application Vulnerabilities](https://arxiv.org/abs/2510.12200)
- 2025-10-13 — [WebRouter: Query-specific Router via Variational Information Bottleneck for Cost-sensitive Web Agent](https://arxiv.org/abs/2510.11221)
- 2025-10-13 — [SusBench: An Online Benchmark for Evaluating Dark Pattern Susceptibility of Computer-Use Agents](https://arxiv.org/abs/2510.11035)
- 2025-10-13 — [R-WoM: Retrieval-augmented World Model For Computer-use Agents](https://arxiv.org/abs/2510.11892)
- 2025-10-12 — [BrowserAgent: Building Web Agents with Human-Inspired Web Browsing Actions](https://arxiv.org/abs/2510.10666)
- 2025-10-11 — [SecureWebArena: A Holistic Security Evaluation Benchmark for LVLM-based Web Agents](https://arxiv.org/abs/2510.10073)
- 2025-10-10 — [WARC-Bench: Web Archive Based Benchmark for GUI Subtask Executions](https://arxiv.org/abs/2510.09872)
- 2025-10-08 — [Code Agent can be an End-to-end System Hacker: Benchmarking Real-world Threats of Computer-use Agent](https://arxiv.org/abs/2510.06607)
- 2025-10-06 — [From Imperative to Declarative: Towards LLM-friendly OS Interfaces for Boosted Computer-Use Agents](https://arxiv.org/abs/2510.04607)
- 2025-10-05 — [JEF-Hinter: Leveraging Offline Knowledge for Improving Web Agents Adaptation](https://arxiv.org/abs/2510.04373)
- 2025-10-05 — [GUI-Spotlight: Adaptive Iterative Focus Refinement for Enhanced GUI Visual Grounding](https://arxiv.org/abs/2510.04039)
- 2025-10-04 — [Cross-Modal Content Optimization for Steering Web Agent Preferences](https://arxiv.org/abs/2510.03612)
- 2025-10-03 — [FocusAgent: Simple Yet Effective Ways of Trimming the Large Context of Web Agents](https://arxiv.org/abs/2510.03204)
- 2025-10-02 — [Scaling Agents for Computer Use](https://arxiv.org/abs/2510.02250)
- 2025-10-02 — [Just Do It!? Computer-Use Agents Exhibit Blind Goal-Directedness](https://arxiv.org/abs/2510.01670)
- 2025-10-02 — [BrowserArena: Evaluating LLM Agents on Real-World Web Navigation Tasks](https://arxiv.org/abs/2510.02418)
- 2025-10-01 — [WALT: Web Agents that Learn Tools](https://arxiv.org/abs/2510.01524)
- 2025-10-01 — [WAInjectBench: Benchmarking Prompt Injection Detections for Web Agents](https://arxiv.org/abs/2510.01354)
- 2025-10-01 — [PAL-UI: Planning with Active Look-back for Vision-Based GUI Agents](https://arxiv.org/abs/2510.00413)
- 2025-10-01 — [GUI-KV: Efficient GUI Agents via KV Cache with Spatio-Temporal Awareness](https://arxiv.org/abs/2510.00536)

### 2025-09

- 2025-09-30 — [SCUBA: Salesforce Computer Use Benchmark](https://openreview.net/forum?id=bkjKnO9s7T)
- 2025-09-30 — [Ferret-UI Lite: Lessons from Building Small On-Device GUI Agents](https://arxiv.org/abs/2509.26539)
- 2025-09-28 — [Efficient Multi-turn RL for GUI Agents via Decoupled Training and Adaptive Data Curation](https://arxiv.org/abs/2509.23866)
- 2025-09-26 — [Secure and Efficient Access Control for Computer-Use Agents via Context Space](https://arxiv.org/abs/2509.22256)
- 2025-09-26 — [ProRe: A Proactive Reward System for GUI Agents via Reasoner-Actor Collaboration](https://arxiv.org/abs/2509.21823)
- 2025-09-19 — [BTL-UI: Blink-Think-Link Reasoning Model for GUI Agent](https://arxiv.org/abs/2509.15566)
- 2025-09-18 — [ScaleCUA: Scaling Open-Source Computer Use Agents with Cross-Platform Data](https://arxiv.org/abs/2509.15221)
- 2025-09-14 — [Environmental Injection Attacks against GUI Agents in Realistic Dynamic Environments](https://arxiv.org/abs/2509.11250)
- 2025-09-10 — [MobileRL: Online Agentic Reinforcement Learning for Mobile GUI Agents](https://arxiv.org/abs/2509.18119)
- 2025-09-09 — [AgentSentinel: An End-to-End and Real-Time Security Defense Framework for Computer-Use Agents](https://arxiv.org/abs/2509.07764)
- 2025-09-08 — [MAS-Bench: A Unified Benchmark for Shortcut-Augmented Hybrid Mobile GUI Agents](https://arxiv.org/abs/2509.06477)
- 2025-09-02 — [UI-TARS-2 Technical Report: Advancing GUI Agent with Multi-Turn Reinforcement Learning](https://arxiv.org/abs/2509.02544)
- 2025-09-02 — [OmniActor: A Generalist GUI and Embodied Agent for 2D&3D Worlds](https://arxiv.org/abs/2509.02322)
- 2025-09-01 — [Throttling Web Agents Using Reasoning Gates](https://arxiv.org/abs/2509.01619)
- 2025-09-01 — [Succeed or Learn Slowly: Sample Efficient Off-Policy Reinforcement Learning for Mobile App Control](https://arxiv.org/abs/2509.01720)

### 2025-08

- 2025-08-31 — [A Multimodal GUI Architecture for Interfacing with LLM-Based Conversational Assistants](https://arxiv.org/abs/2510.06223)
- 2025-08-27 — [CODA: Coordinating the Cerebrum and Cerebellum for a Dual-Brain Computer Use Agent with Decoupled Reinforcement](https://arxiv.org/abs/2508.20096)
- 2025-08-21 — [Mobile-Agent-v3: Fundamental Agents for GUI Automation](https://arxiv.org/abs/2508.15144)
- 2025-08-19 — [ComputerRL: Scaling End-to-End Online Reinforcement Learning for Computer Use Agents](https://arxiv.org/abs/2508.14040)
- 2025-08-18 — [WebMall -- A Multi-Shop Benchmark for Evaluating Web Agents [Technical Report]](https://arxiv.org/abs/2508.13024)
- 2025-08-17 — [You Don’t Know Until You Click: Automated GUI Testing for Production-Ready Software Evaluation](https://arxiv.org/abs/2508.14104)
- 2025-08-14 — [UI-Venus Technical Report: Building High-performance UI Agents with RFT](https://arxiv.org/abs/2508.10833)
- 2025-08-12 — [OpenCUA: Open Foundations for Computer-Use Agents](https://arxiv.org/abs/2508.09123)
- 2025-08-07 — [Test‑Time Reinforcement Learning for GUI Grounding via Region Consistency](https://arxiv.org/abs/2508.05615)
- 2025-08-06 — [SEAgent: Self-Evolving Computer Use Agent with Autonomous Learning from Experience](https://arxiv.org/abs/2508.04700)
- 2025-08-06 — [GuirlVG: Incentivize GUI Visual Grounding via Empirical Exploration on Reinforcement Learning](https://arxiv.org/abs/2508.04389)
- 2025-08-06 — [Evolving in Tasks: Empowering the Multi-modality Large Language Model as the Computer Use Agent](https://arxiv.org/abs/2508.04037)
- 2025-08-04 — [NaviMaster: Learning a Unified Policy for GUI and Embodied Navigation Tasks](https://arxiv.org/abs/2508.02046)
- 2025-08-03 — [Web-CogReasoner: Towards Knowledge-Induced Cognitive Reasoning for Web Agents](https://arxiv.org/abs/2508.01858)
- 2025-08-02 — [NaturalGAIA: Pushing the Frontiers of GUI Agents with a Challenging Benchmark and High-Quality Trajectory Dataset](https://arxiv.org/abs/2508.01330)

### 2025-07

- 2025-07-29 — [UI-AGILE: Advancing GUI Agents with Effective Reinforcement Learning and Precise Inference-Time Grounding](https://arxiv.org/abs/2507.22025)
- 2025-07-01 — [Explorer: Scaling Exploration-driven Web Trajectory Synthesis for Multimodal Web Agents](https://aclanthology.org/2025.findings-acl.326/)

## 参考入口

- GUI Agents Paper List: [https://github.com/OSU-NLP-Group/GUI-Agents-Paper-List](https://github.com/OSU-NLP-Group/GUI-Agents-Paper-List)
- OSWorld: [https://os-world.github.io/](https://os-world.github.io/)
- AndroidWorld: [https://github.com/google-research/android_world](https://github.com/google-research/android_world)
- WebArena / VisualWebArena: [https://webarena.dev/](https://webarena.dev/)
- AndroidDaily: [https://arxiv.org/abs/2605.27761](https://arxiv.org/abs/2605.27761)
- WindowsWorld: [https://arxiv.org/abs/2604.27776](https://arxiv.org/abs/2604.27776)
- MacArena: [https://arxiv.org/abs/2606.06560](https://arxiv.org/abs/2606.06560)
- LivingScreen: [https://arxiv.org/abs/2606.04701](https://arxiv.org/abs/2606.04701)
