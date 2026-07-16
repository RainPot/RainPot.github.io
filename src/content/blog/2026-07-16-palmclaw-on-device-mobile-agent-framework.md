---
title: "PalmClaw：把 Mobile Agent 从“点屏幕”改成“直接调手机能力”，值不值得？"
description: "解析 2026 年论文 PalmClaw：它把 mobile agent 的执行重心从 GUI 点击序列转到手机端原生 device tools，用显式参数、结构化结果和执行边界管理权限、文件与自动化能力。文章从移动端 QA 和 APP 自动化测试视角讨论它的价值、证据与边界。"
date: "2026-07-16"
tags: ["GUI Agent", "Mobile Agent", "Android", "On-Device Agent", "APP 自动化测试"]
draft: false
featured: false
readingTime: 14
---

> 论文：[PalmClaw: A Native On-Device Agent Framework for Mobile Phones](https://arxiv.org/abs/2607.13027)  
> arXiv：`2607.13027v1`，2026-07-14  
> 代码：<https://github.com/ModalityDance/PalmClaw>  
> 一句话结论：**PalmClaw 的重点不是再造一个更会点按钮的 mobile GUI agent，而是把 agent loop、memory、skills 和 tools 直接放到手机里，把日历、文件、媒体、联系人、消息、自动化这些手机能力暴露成带参数边界的 device tools。对移动端 QA 来说，这篇论文最值得看的不是 97.1% success 这个数字本身，而是它提醒我们：很多手机自动化任务其实不该默认走脆弱的 GUI 路径，应该优先走“可验证、可约束、可审计”的原生执行通道。**

过去两年，mobile agent 论文大多默认一个前提：要让模型会用手机，先让它像人一样看屏幕、找控件、点坐标、滑动、输入。这个前提当然没错，GUI 操作确实是通用接口。但问题也很明显：一旦任务稍微长一点，点击链路就会变得很脆；页面一改版、弹窗一出现、滚动位置一变，前面规划好的动作很容易全部失效。

PalmClaw 试图改的正是这个默认前提。它的判断很直接：**手机不只是一个要被“看图点控件”的界面，它本身就是一个带文件、日历、媒体、联系人、消息、权限和自动化能力的执行环境。** 如果 agent 已经运行在手机里，那很多任务完全没必要绕一圈 GUI。

![PalmClaw 总览：左边是外部主机驱动的 GUI 型 mobile agent，右边是把 agent loop 放到手机本地、通过 device tools 直接访问资源与能力的 PalmClaw](/images/palmclaw-on-device-mobile-agent-framework/figure-1-overview.png)

这篇论文的价值，放在 GUI Agent / computer-use agent 谱系里更容易看清。它不是 AndroidWorld 那类在线 benchmark，也不是 UI grounding 或 action model 论文；它更像是 **mobile-native agent runtime / tool-execution framework**。它想回答的问题是：**当 agent 的运行位置已经来到手机端，动作空间是不是还必须以 GUI 为中心？**

我的判断是，这个问题对 APP 自动化测试比对“万能手机助手”更重要。因为测试场景里最麻烦的，往往不是“点不到按钮”，而是：

- 同一个任务到底该走 UI、系统 API 还是本地文件能力；
- 哪些动作需要权限确认，哪些能自动执行；
- 哪些结果能直接验证，哪些只是屏幕上看起来像成功；
- 当任务跨工作区、跨权限边界、跨应用时，agent 应该停在哪一步请求人工介入。

PalmClaw 给出的不是完整答案，但它把这些边界第一次用比较干净的框架形式摆了出来。

## 论文位置：它不是“更强 GUI”，而是“少走 GUI”

PalmClaw 的出发点和现有 mobile agent 明显不同。论文在 Figure 1 里把两种路线直接对照了出来：

- **外部托管 GUI agent**：agent loop 运行在桌面或云端，通过截图、点击、滑动、输入去控制手机；
- **PalmClaw**：agent loop、memory、skills、sessions 都在手机本地运行，模型通过 device tools 直接调用手机能力。

这里真正关键的不是“on-device”三个字本身，而是动作接口换了。PalmClaw 不把手机主要看成一张连续刷新的 GUI，而是看成一组可注册的能力：设备状态、媒体、文件、日历、联系人、消息、定时任务、web 搜索、memory、skills 等。

![PalmClaw 框架图：输入先进入 session，context 在手机本地组装，tool call 经过 schema、权限和执行边界检查后再真正落到设备能力上](/images/palmclaw-on-device-mobile-agent-framework/figure-2-framework.png)

这和近几个月 mobile / GUI agent 的几条主线刚好形成互补：

- **AndroidWorld、AndroidDaily、MobileAgentBench** 关注怎样评测 agent 在手机环境里完成任务；
- **Xiaomi-GUI-0、UI-MOPD、MobileForge** 更关注训练数据、在线优化和真实设备执行；
- **VeriGUI、Learning from Failure** 关注执行闭环里的失败诊断和恢复；
- **PalmClaw** 则在更靠底层的位置问：**如果手机端本来就有更明确的能力接口，为什么很多任务还要先退化成 GUI 序列？**

这点很像桌面端 agent 从“只会点网页和窗口”逐渐转向 tool-using agent 的过程。说白了，PalmClaw 想把手机端的 agent 也从“视觉点屏机器人”往“带明确接口的执行系统”推一步。

## 框架本体：agent loop 在手机里，工具边界也在手机里

PalmClaw 的系统结构并不花哨，但很完整。论文 Figure 2 里把它拆成了几个组件：sessions、memory、skills、tools、agent loop，以及真正落地执行的 device tool execution。

从工程上看，这个结构有两个值得注意的地方。

第一，**上下文组装在手机本地完成**。论文写得很清楚，PalmClaw 每轮会把 system instructions、runtime context、long-term memory、active skills、近期会话历史、tool traces 和 tool schema 一起组装，再发给远端 LLM API。也就是说，推理服务仍然是远端模型，但会话状态、工具注册、执行控制都留在本机。

第二，**tool call 不是“模型想调什么就调什么”，而是先经过 schema、权限、工作区和执行边界检查。** 这点比模型本身更值得关注。GUI 路线里，模型一旦拿到“点屏幕”的能力，理论上能到达的界面范围就很大，真实边界往往全靠 prompt 约束。PalmClaw 则试图把边界前置到工具层。

![PalmClaw 内置技能和工具分组：device、media、workspace、web、memory、channels、automation 等能力都以技能和工具形式挂在框架里](/images/palmclaw-on-device-mobile-agent-framework/figure-3-skills-tools.png)

论文 Figure 3 列出来的内置能力也能看出它的设计方向：

- device / media / bluetooth 这类设备控制；
- file 的 list / read / write / delete / move；
- channels / cron / message / sessions 这类自动化与会话能力；
- weather / search / fetch 等 web 能力；
- memory、summarize、calendar、contacts 等偏个人助理型能力。

这说明 PalmClaw 不是一个只为 GUI benchmark 服务的代理，而是一个想把“手机就是 agent 运行时”这件事做实的框架。

## 结果怎么读：97.1% success 很高，但先看任务类型

PalmClaw 最显眼的结果在 Table 1。论文在 MobileTask 和 AssistantBench 上做了评测，对比对象包括 MobileClaw、ClawMobile、ApkClaw。

![主结果表：PalmClaw 在 MobileTask 上达到 97.1% success rate，平均动作数 2.8、平均 17.7 秒完成；AssistantBench 上 accuracy 为 36.85%](/images/palmclaw-on-device-mobile-agent-framework/table-1-main-results.png)

其中最容易被转发的一组数字是：

- **MobileTask success rate：97.1%**；
- 相对最强 baseline 有 **11.5% 相对提升**；
- 平均完成时间从数百秒级降到 **17.7 秒**，论文写的是 **94.9% reduction**；
- 平均动作数降到 **2.8**，远低于 GUI 路线的几十到上百步。

这组结果确实很猛，但不能脱离任务定义来看。论文对 MobileTask 的构造有明显筛选：任务来自 AndroidWorld、MobileAgentBench、Mobile-Bench，但只保留了三类条件下适合 PalmClaw 的任务——

1. 不依赖固定 GUI 路径；
2. 不依赖第三方 App 状态；
3. 不明显偏向 GUI-only agent。

最终保留的是 **70 个任务**，主要覆盖 calendar、weather、contacts、audio、notes、files、Bluetooth、media 这些能力型任务。

这意味着 PalmClaw 的强项被非常清楚地放大了：当任务本质上就是“创建日历事件、读写文件、看天气、处理媒体、查联系人、切蓝牙”时，原生 tool 调用当然比看图点屏高效得多。这不是问题，反而说明论文很诚实——它并没有把自己包装成一个通吃所有手机 GUI 的方案。

对移动端 QA 而言，这组结果的正确解读不是“以后都不用 GUI agent 了”，而是：**如果你的测试或执行目标本来就能被显式能力接口表达，就别强迫 agent 绕回 GUI。**

举个最直接的例子：

- 创建日历事件、读写工作区文件、获取设备状态、调起权限页，这些事完全可以走 tool；
- 搜索闭源 App 某个按钮、处理动态推荐流、验证 WebView 页面渲染、跨 App 完成真实业务流程，这些事还是得回到 GUI 或混合通道。

所以 PalmClaw 更像是在给 mobile agent 补上“非 GUI 主路径”，而不是替代 GUI。

<!-- more -->

## 执行边界：这篇论文真正有工程味的地方

我觉得 PalmClaw 最有价值的不是性能表，而是 Figure 4 展示的 execution boundary 案例。很多 agent 系统都会说自己“安全”“可控”，但真正落到手机执行时，边界到底在哪，论文通常说不清。PalmClaw 至少给了两个具体例子。

![执行边界案例：一类是权限缺失时请求用户授权，另一类是写入工作区外路径时停止自动执行并引导用户去设置页](/images/palmclaw-on-device-mobile-agent-framework/figure-4-boundaries.png)

第一类是 **calendar permission**。用户要求“明天 10 点和 Alex 开会”，PalmClaw 先调 calendar()，发现缺权限，不会假装已经创建成功，而是向用户发权限请求。授权后再继续同一个任务。

第二类是 **workspace boundary**。用户要求把购物清单写到 `/sdcard/list.txt`。PalmClaw 会先发现目标路径超出当前 workspace，这不是普通写文件动作，而是跨了更高权限边界，于是它不会直接写，而是打开设置页，让用户手动开启 all files access。

这套处理方式对移动端 QA 很重要，因为它区分了三种经常被混在一起的问题：

- **模型会不会做**；
- **系统允不允许做**；
- **这件事应不应该在当前边界内自动做**。

传统 GUI agent 最大的问题之一，就是这三件事很容易糊在一起。模型看到一个“允许”按钮就点了，看到设置页就继续跳，最后虽然动作序列看起来流畅，但边界完全失控。PalmClaw 至少把“权限”“工作区”“需要人工确认”的中断显式化了。

对测试平台来说，这种设计其实比“更强模型”更接近生产需求。因为生产系统最怕的不是 agent 偶尔做不成，而是它在越权状态下还继续自信执行。

## 对 APP 自动化测试最直接的启发：把动作通道分层

PalmClaw 对 QA 的最大启发，是它逼着我们重新画一遍 mobile agent 的动作空间。

过去很多团队把 agent 的执行层默认成单通道：全都走截图 + 点按 + 输入 + 滑动。这种方式的优点是统一，坏处也很明显：任何任务都被压成了视觉定位问题，结果验证也经常只能回到截图。

PalmClaw 对应的工程思路更像是分层通道：

1. **原生可调用能力**：文件、媒体、系统状态、日历、联系人、定时任务、权限检查；
2. **半结构化系统能力**：intent、系统设置页、通知、分享面板、工作区文件流转；
3. **GUI 能力**：闭源 App 页面浏览、点击、输入、滚动、跨页导航；
4. **验证能力**：UI 证据、文件结果、系统状态、后端状态、日志与埋点。

这里真正麻烦的不是怎么给模型更多工具，而是**什么时候该走哪条通道，以及不同通道的结果如何统一验证**。

如果落到移动端 QA，我会把它翻成几条更具体的设计原则：

- 能直接调用系统能力的，不要硬走 GUI；
- 高风险或跨边界动作必须有明确中断点；
- GUI 负责复杂视觉交互，tool 负责稳定执行和结果获取；
- oracle 不要只盯屏幕，要结合文件、权限状态、系统回执、后端结果；
- trace 里要能看见“为什么停、停在哪、谁确认了继续”。

这和 Appium、Maestro、UIAutomator、XCUITest 并不冲突。相反，PalmClaw 证明了一件事：**mobile agent 不一定非要在“纯视觉 GUI”与“传统自动化脚本”之间二选一。** 更合理的方向是混合执行：GUI 处理开放世界交互，tool/API/系统能力处理明确、可验证、可约束的动作。

## 部署结果也有参考价值：不是每个团队都需要一台旁路控制机

PalmClaw 的 Table 2 还给了一个经常被低估的指标：部署和操作负担。

![部署与操作对比：PalmClaw 不需要外部电脑、CLI 或 bridge，设置步骤 2 步、约 2 分钟，明显轻于 MobileClaw、ClawMobile 等方案](/images/palmclaw-on-device-mobile-agent-framework/table-2-deployment.png)

论文的对比表里，PalmClaw 的特点是：

- **不需要外部电脑**；
- **不需要 CLI 工作流**；
- **不需要 phone 与外部 runtime 的 bridge**；
- 首次 setup 约 **2 步 / 2 分钟**。

这件事的现实意义在于，很多 mobile agent demo 默认都有一台看不见的“旁路主机”：手机只是执行端，真正的 agent loop、tool orchestration、日志、模型调用都在外面。研究演示时这样很方便，但到了企业内部部署、个人设备使用或者需要快速试验的 QA 场景，就会带来额外的环境和安全成本。

PalmClaw 说明，至少对一类手机任务，agent runtime 本身是可以下沉到端上的。对测试团队来说，这也给了一个思路：不是所有自动化都得先搭一套外部控制农场，某些能力可以先做成端内 agent runtime，再决定哪些日志和推理要回传到中心侧。

## 边界也很明确：它不是闭源 App 自动化的通吃方案

PalmClaw 的优点很清楚，边界也同样明显。

第一，**它评测的任务分布偏“能力型任务”，而不是重 GUI 的真实业务流。** 论文自己就说了，任务会过滤掉依赖第三方 App 状态、固定 GUI path 或明显偏 GUI-only 的例子。所以 97.1% 不能直接外推到电商下单、内容发布、打车、社交、支付、复杂 WebView、登录风控这类真实 APP 流程。

第二，**PalmClaw 仍然依赖远端 LLM API 推理。** 框架在手机里，执行在手机里，但模型不一定在手机里。这意味着真正部署时，隐私、延迟、联网可用性、provider 风险仍然存在。论文在 ethics statement 里也明确提到，需要让用户知道 prompt、tool result 和任务上下文可能发往远端模型服务。

第三，**设备 tool 的强大，天然也意味着能力边界设计必须更严格。** GUI agent 的问题常常是动作太泛；tool agent 的问题则可能变成接口太强。一旦文件、联系人、日历、消息、媒体等能力都能被调起，权限模型、审计日志、用户确认、workspace 隔离就不能只是装饰。

第四，**它对闭源商业 App 的帮助更多体现在“补充通道”，不是替代主通道”。** 很多真实 QA 场景仍然要走 GUI，因为业务逻辑就在 App 页面里，且结果并不总能被系统 API 直接看到。PalmClaw 的价值，在于让 agent 不必把所有前置准备、环境操作和结果搬运都压到 GUI 上。

## 我的结论：PalmClaw 更像 mobile QA 的底座补丁，不是终局形态

如果把 PalmClaw 放回 GUI Agent 的大图里，我会把它看成一个很务实的信号：**mobile agent 的下一阶段，不该只比谁更会“点手机”，还要比谁更会选择执行通道、管理权限边界、暴露结构化结果。**

这篇论文最有价值的地方，不是它证明了“on-device 就一定更强”，而是它把一个常被忽略的事实讲清楚了：手机本来就是执行环境，不只是视觉环境。把手机能力收敛成 device tools 后，很多任务可以从长而脆的 GUI 轨迹，变成短而清晰的显式操作。

对 APP 自动化测试 / 移动端 QA，我觉得最值得吸收的是三点：

1. **执行层要分通道**：GUI 不是唯一动作空间；
2. **边界要前置到工具层**：权限、工作区、确认机制不能只靠 prompt；
3. **验证要从截图扩展到结构化结果**：文件、系统状态、权限回执、后端状态都应该成为 oracle 的一部分。

PalmClaw 当然还不是“真实商业 App 自动化”的终局。它没有解决动态闭源 UI、账号状态、跨 App 业务链路、复杂视觉理解这些难点。但它补了一块长期缺失的底座：**让 mobile agent 不必一上来就把所有问题都降格成点屏幕。**

这点对研究和工程都很重要。因为真正可靠的移动端 agent，大概率既不是纯 GUI agent，也不是纯 API agent，而是一个知道什么时候该看屏幕、什么时候该调能力、什么时候该停下来要权限和确认的混合执行系统。
