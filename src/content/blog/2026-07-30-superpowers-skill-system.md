---
title: "Superpowers 拆解：7169 行 Markdown 怎么变成 Coding Agent 的强制规程"
description: "obra/superpowers 没有一行功能代码，只有 14 个 skill 和几百行 shell。它真正解决的问题不是「写下工程规范」，而是「让一段 prompt 在几小时的长会话里持续生效」——从 SessionStart 硬注入、compact 后重注入，到把状态挪出上下文写进文件。逐层拆开看它怎么做的，以及哪些部分可能被高估。"
date: "2026-07-30"
tags: ["Coding Agent", "Claude Code", "Agent Skills", "源码拆解"]
draft: false
featured: false
readingTime: 20
---

Superpowers 是个奇怪的仓库：clone 下来找不到一行功能代码。14 个 skill、7169 行 Markdown、几百行 shell 脚本，全部用来做同一件事——把一套软件工程规程写成模型必须遵守的文本，并且想办法让模型真的遵守。

先给判断。这个项目里最值得抄的不是它的 TDD 流程或者调试四阶段，那些东西任何一本工程书上都有。它真正处理的是另一个问题：**一段 prompt 怎么在几小时、几十轮、中间还被压缩过好几次的长会话里持续生效。** 它给的答案有三层——会话启动时硬注入、上下文压缩后再注入一次、把状态挪出上下文写进文件。这三层是可以脱离 Superpowers 本身单独拿走的。

版本固定在 commit `44c9b2d`（2026-07-27），`plugin.json` 声明 `6.2.0`。下文所有路径、行数、脚本输出都来自这个 commit 的本地 clone 和本地实跑。

## 一、它是什么形状的

数字先摆出来：

```bash
$ ls skills/ | wc -l
14
$ find skills -name 'SKILL.md' | wc -l
14
$ find skills -name '*.md' | xargs wc -l | tail -1
    7169 total
```

14 个 skill，每个一份 `SKILL.md`，加上参考文档一共 7169 行。结构上分三层：

![Superpowers v6.2.0 的三层结构：分发层把同一个仓库装进 11 个 coding agent，注入层用 SessionStart hook 把入口 skill 硬塞进会话，skill 库里 14 个 skill 只有入口那个被全文注入](/images/superpowers-skill-system/architecture.png)

分发层这件事单独值得说一句。同一个 git 仓库里同时躺着 Claude Code 的 plugin marketplace 清单、`.codex-plugin`、`.cursor-plugin`、`gemini-extension.json`、`.kimi-plugin`、`.opencode/plugins`、`.pi`、`.agents/plugins`……README 列了 11 个 harness 的安装方式。作者没有给每个平台维护一份 skill，而是让 11 个平台读同一份 Markdown。这个决定省了大量重复维护，代价在第八节讲。

## 二、它凭什么敢说「必须用」

大部分 prompt 库的失效方式都一样：规则写了一堆，模型开头记得，聊到第二十轮就忘了。Superpowers 不指望模型自觉。

`hooks/hooks.json` 通篇只干一件事：

```json
{"hooks":{"SessionStart":[{"matcher":"startup|clear|compact",
  "hooks":[{"type":"command",
    "command":"\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start",
    "shell":"bash","async":false}]}]}}
```

`matcher` 里那个 `compact` 是整套设计的支点，第五节会回来讲。

### run-hook.cmd：一个文件，两种解释器

链路是 `hooks.json → run-hook.cmd → hooks/session-start`。中间这个 `.cmd` 是 bash/cmd 双语脚本——同一个文件在 Unix 下被 bash 执行，在 Windows 下被 cmd 执行。Windows 分支依次到三个固定位置找 Git Bash，都没有就退回 PATH，再没有就静默 `exit 0`。注释写得很直白：插件仍然可用，只是没有 SessionStart 注入。

还有个细节容易被略过：`hooks/` 下的脚本全部不带扩展名。原因写在仓库文档里——Claude Code 的 Windows 自动检测会给任何含 `.sh` 的命令前面自动加 `bash`，去掉扩展名就绕开了这个行为。这类兼容性补丁在仓库里不止一处，能看出它是被很多人在很多环境下跑过的。

### session-start：读文件、转义、按平台选字段

主脚本做三件事。第一件是读 `skills/using-superpowers/SKILL.md` 全文。第二件是转成 JSON 字符串——它没用 `jq`（不能假设装了），也没调 Python，而是纯 bash 参数替换：

```bash
escape_for_json() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  # ... 换行、制表符等逐类替换
}
```

注释解释了为什么这么写：`Each ${s//old/new} is a single C-level pass - orders of magnitude faster than the character-by-character loop this replaces`。一段被专门优化过的转义函数，说明它确实每次会话启动都要跑一遍，慢了用户有感觉。同一个文件里另一条注释指向 issue #571：改用 `printf` 而不是 heredoc，因为 bash 5.3+ 的 heredoc 会 hang。

第三件事最有意思——按平台选 JSON 字段：

```bash
if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
  printf '{\n  "additional_context": "%s"\n}\n' "$escaped"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -z "${COPILOT_CLI:-}" ]; then
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$escaped"
else
  printf '{\n  "additionalContext": "%s"\n}\n' "$escaped"
fi
```

上面那段注释说明了为什么必须三选一而不能全发：`Claude Code reads BOTH ... without deduplication, so we must emit only the field the current platform consumes.` 两个字段都发，上下文里就会出现两份一模一样的 skill 全文。

本地跑一遍三个分支确认行为：

```bash
$ CLAUDE_PLUGIN_ROOT=/tmp/superpowers bash hooks/session-start session-start | head -c 120
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<EXTREMELY_IMPORTANT>\nYou have superpowers.

$ CURSOR_PLUGIN_ROOT=/tmp/superpowers bash hooks/session-start session-start | head -c 60
{
  "additional_context": "<EXTREMELY_IMPORTANT>\nYou have

$ CLAUDE_PLUGIN_ROOT= bash hooks/session-start session-start | head -c 55
{
  "additionalContext": "<EXTREMELY_IMPORTANT>\nYou h
```

三个分支各走各的字段，符合源码。再看注入体积：

```bash
$ CLAUDE_PLUGIN_ROOT=/tmp/superpowers bash hooks/session-start session-start | wc -c
    3484
```

3484 字节。这个数字比前面所有描述都重要：仓库有 7169 行 Markdown，但每次会话只硬塞进去 3.4KB，其余 13 个 skill 全靠 Skill 工具按需加载。渐进披露在这里不是口号，是有具体预算的——入口 skill 被刻意写得很短，短到可以无条件塞进每一次会话。

而这 3.4KB 里的核心内容，就是一句话：

> If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

后面跟着一张 12 行的 Red Flags 表，逐条列出模型准备跳过 skill 时会给自己找的借口——「这个改动很小」「我已经知道怎么做了」「用户很急」。这张表不是写给人看的，是写给模型看的：它把模型最可能生成的那几句自我说服，提前抄在了纸上。

## 三、主工作流：一句需求到合并分支

![主工作流全景：从用户提需求到分支合并，中间只有 4 道人类门禁，左列是落盘产出物，右列是每一步最强的那条原文约束](/images/superpowers-skill-system/workflow.png)

整条流水线是 brainstorming → 写 spec → writing-plans → 执行循环 → final review → finishing-a-development-branch。几个位置的处理方式比流程本身更值得看。

**brainstorming 的硬门禁。** skill 里有个 `<HARD-GATE>` 标签，内容是：在你把设计讲清楚、用户明确批准之前，不许调用任何实现类 skill、不许写代码、不许搭项目骨架。更有意思的是它专门写了一节叫 *Anti-Pattern: This Is Too Simple To Need A Design* ——因为模型最常用的跳过理由就是「这个太简单了」。同一节还规定了提问方式：一次只问一个问题，给 2-3 个方案并明确推荐一个，设计要分段呈现而不是一次倒完。

**writing-plans 的读者设定。** 这条我看下来最实用：计划要写给「一个热情但没品味、没有项目上下文、还讨厌写测试的初级工程师」看。这不是修辞，它直接决定了验收标准——计划里出现 TBD、「加上适当的错误处理」、「参照 Task N 的做法」，一律算计划本身的缺陷，而不是执行者的问题。每个任务必须写死 Files、Interfaces 和 5 个步骤，粒度控制在 2-5 分钟。

把「计划的读者是一个没有上下文的人」当成硬约束，倒推出来的东西，恰好就是子代理需要的东西。这个设定和第五节的上下文隔离是同一件事的两面。

**TDD 的 Iron Law。** `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST`。配套一句执行细则：先写了实现再补测试的，删掉重来——不许留着当参考，不许照着改，不许再看一眼。理由写在旁边：`If you didn't watch the test fail, you don't know if it tests the right thing.`

同样句式的还有两条。systematic-debugging：`NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST`，并且规定连续 3 次修复失败就必须停下来质疑架构本身，而不是继续试第 4 次。verification-before-completion：`NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE`——「fresh」是重点，五分钟前跑过的测试不算证据。

**人类只在 4 个点上被打断**：批准设计、确认读过 spec、选执行方式、决定分支去向。中间的任务执行阶段明确要求不要停下来问「要继续吗」。这个取舍很清楚：门禁放在决策点上，不放在执行过程里。

## 四、SDD：整个库里技术密度最高的部分

subagent-driven-development 是 14 个 skill 里最长也最具体的一个。它回答的问题是：一个计划有 12 个任务，怎么让 agent 从头跑到尾，中间不失忆、不糊弄、不无限循环。

![SDD 的单任务生命周期：从 Setup 记录 BASE，到派发实现者、四种回报状态、生成 review package、双结论复审，右侧是最多 5 轮的修复循环和断路器裁决](/images/superpowers-skill-system/sdd-loop.png)

拆开看几个设计。

**实现者只能回四种状态。** `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`。长报告写进文件，不回传给协调者。这里的约束不是「让子代理少说话」，是让协调者的处理逻辑可枚举——四种状态各自对应一条明确的处置路径，`BLOCKED` 那条又展开成补足上下文、换更强的模型、把任务拆小、上报人类四个选项。

**复审必须给两个独立结论。** spec 符合度是一个，代码质量是另一个，缺一不可。一份「代码写得不错」但没说清是否满足任务要求的复审，不算通过。同时 skill 里明确禁止协调者预判：派发 prompt 里出现「这条不用报」「那个是已知的」就是在替 reviewer 做判断。

**修复循环有上限，而且中途换人换模型。** 1 到 3 轮唤醒原来那个实现者——它的上下文还在，知道自己当初为什么那么写。4 到 5 轮换一个全新的实现者，模型比卡住那个高一档，开场白是写死的：

> A prior implementer attempted this task N times; you own it now.

连续三轮没修好，通常意味着它看不见自己的问题。换眼睛加加算力，一次到位。

**第 5 轮是断路器。** 跳闸之后不是放弃，是逐条裁决，每条都必须落到 ledger 上，禁止静默丢弃：

- reviewer 判错了或者本身可争议 → park，写明代码为什么站得住
- 问题是真的但下游没有东西压在上面 → park，注明真实且延后
- 真的，而且是承重的 → 写 BLOCKED，停下来找人类

这三个分支的区分标准是「有没有下游依赖」，不是「严不严重」。这个判据比严重性分级更好执行，因为它可以从计划里剩下的任务直接读出来。

还有一条容易忽略的规定：协调者永远不自己动手改 findings。理由有两个——自己改会把 diff 拉进上下文，而且绕过了复审。

配套的两个 shell 脚本我在本地跑过。`task-brief` 从计划里抽单个任务：

```bash
$ bash scripts/task-brief docs/plans/2026-07-30-demo.md 2
wrote .superpowers/sdd/2026-07-30-demo/task-2-brief.md: 6 lines
```

抽出来就是任务原文那 6 行，不多不少。`review-package` 打 diff 包：

```bash
$ bash scripts/review-package docs/plans/2026-07-30-demo.md "$BASE" HEAD
wrote .superpowers/sdd/2026-07-30-demo/review-b4a3a71..559b1ae.diff: 2 commit(s), 436 bytes
```

包里是三节：Commits 列表、`diff --stat`、`git diff -U10` 全文。文件名直接编码了 base 和 head 的短 sha。这就是为什么 skill 里反复强调 Setup 阶段要 `git rev-parse HEAD` 记下 BASE，并且写了一句「绝不能用 `HEAD~1`」——一个任务可能产生任意多个 commit，`HEAD~1` 只能盖住最后一个。

## 五、上下文经济学：真正的内核

前面几节讲的都是流程。这一节讲的是让流程能跑完的那个东西。

![上下文经济学：协调者只装路径不装内容，所有内容走文件系统总线，子代理各自独立；右侧是 compact 发生时靠 ledger 恢复位置的路径](/images/superpowers-skill-system/context.png)

SDD 反复强调的一件事是：协调者的上下文是全程唯一真正稀缺的资源。所以它只装路径——计划文件路径、ledger 路径加最后几行、当前任务号、BASE 和 HEAD 两个 sha、简报/报告/diff 三个文件路径。完整 diff 不进，完整实现报告不进，子代理的会话历史更不能进。

skill 里记了一个真实案例：某次会话的派发 prompt 达到 42k 字符，其中 99% 是粘进去的历史。粘的人当时的动机很正当——「让子代理有上下文」。

所以内容全部走文件系统。`.superpowers/sdd/<plan-basename>/` 下面放 ledger、任务简报、实现报告、diff 包。这个目录的位置有个说法：它建在工作树里而不是 `.git/` 下面，因为 Claude Code 把 `.git/` 当保护路径，代理写不进去。脚本建目录时顺手让它自我忽略。本地验证：

```bash
$ bash scripts/sdd-workspace docs/plans/2026-07-30-demo.md
/private/tmp/sddtest/.superpowers/sdd/2026-07-30-demo

$ cat .superpowers/.gitignore
*

$ git status --short
（无输出）
```

目录建好了，`git status` 干净。一个 `printf '*\n' > .gitignore` 解决问题——不入版本库，也不污染工作区状态。

### ledger 和 compact

现在回到第二节留下的那个 `compact`。

长会话跑到一定长度，harness 会压缩历史。压掉的是中间过程，其中就包括「我走到第几个任务了」。这时候两件事同时发生：SessionStart hook 因为 matcher 里有 `compact` 而重新完整注入入口 skill；协调者重读 ledger，从最后一行推出下一个该做的任务号。ledger 是纯追加的 Markdown：

```
# SDD ledger — plan: docs/superpowers/plans/2026-07-30-foo.md
Task 1: complete (commits a1b2c3d..e4f5a6b, review clean)
Task 2: fix round 2/5 (3 addressed, 1 open — 空指针未覆盖; commits e4f5a6b..0c1d2e3)
Task 3: BLOCKED — schema 迁移方向需要人类拍板
Task 4: parked — reviewer 的性能顾虑无下游依赖，留到后续
```

首行写死了它属于哪个计划，协调者恢复时先核对这一行。ledger 万一也丢了，降级方案是 `git log` 反推——已落地的 commit 就是已完成任务的证据。

不这么做的后果，skill 里写得很不客气：

> controllers that lost their place have re-dispatched entire completed task sequences — the single most expensive failure observed.

协调者丢了位置，会把已经做完的整段任务序列重新派发一遍。这是观察到的最贵的失败。

把「重新注入」和「状态落盘」这两件事放在一起看，才能看懂这套设计：**hook 保证规则在压缩后还在，ledger 保证进度在压缩后还在。** 缺任何一个,长任务都会在某次 compact 之后开始漂。

顺带一提，子代理隔离带来的不只是省 token。reviewer 从没见过实现过程，它拿不到「我当时是这么想的」，只能对着 diff 说话——这是省偏见，不是省钱。

## 六、它怎么让模型真的照做

`skills/writing-skills/persuasion-principles.md` 这个文件的存在，说明作者把「模型会不会照做」当成了一个可以工程化的问题，而不是碰运气。

文件引用 Meincke 等人 2025 年的研究：在 28,000 段 AI 对话上，用上 Cialdini 的说服原则后，模型对请求的服从率从 33% 提到 72%（p < .001）。然后它把七条原则逐条翻译成写 skill 的手法——权威（引用具体来源而不是泛泛说「最佳实践」）、承诺一致（让模型先声明再执行）、稀缺（说明不这么做会失去什么）、社会认同（写明这是团队的既定做法）、共同体（用「我们」而不是「你」）等等。

回头看前面几节的措辞，全都对得上。`<EXTREMELY_IMPORTANT>` 标签、大写的 Iron Law、`ABSOLUTELY MUST`、把模型的借口提前抄成 Red Flags 表、修复循环第 4 轮那句「前面有人试了 N 次，现在归你」——这些不是随手写的，是照着一份清单调的。

同一个 skill 里还有一条更细的经验，叫 SDO（Skill Discovery Optimization）：`description` 字段只能写「什么时候用」，绝不能概括工作流程。原因是踩过坑——某个 skill 的 description 里概括了流程，模型看完 description 觉得自己已经知道该干什么，就直接照着 description 干了，跳过了 SKILL.md 里的两阶段复审。一句话的摘要变成了一条捷径。

这个观察挺尖锐的：**给模型看的每一段文字都可能被当成可执行指令，包括那些你以为只是索引的部分。**

## 七、真正的贡献在哪

抛开具体流程，有三件事是可以脱离这个仓库单独拿走的。

**第一，把「规则失效」当成系统问题处理。** 大部分人写 CLAUDE.md 或者 system prompt 的方式是写完就完，指望模型记住。Superpowers 的处理是：入口规则压到 3.4KB，用 hook 在 startup / clear / compact 三个时机各注入一次，其余内容按需加载。这套做法不需要装 Superpowers 也能用——任何一个自己维护 skill 库的团队都可以照搬。

**第二，把状态从上下文里搬出来。** ledger 这个东西简单到几乎不像一个设计，但它解决的是长任务里最贵的失败模式。判断标准也很清楚：任何「压缩之后会丢、丢了会导致重做」的信息，都应该落盘。

**第三，用不可协商的措辞替代描述性建议。** 「应该先写测试」和 `NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST` 对人类读者是同一个意思，对模型不是。后者附带了「写反了就删掉重来」的执行细则，前者没有。这个差别在几十轮对话之后会被放大。

## 八、哪些部分可能被高估

拆完之后，有几个地方值得保留怀疑。

**7169 行的维护面。** 这些 Markdown 描述的是流程，而流程会随 harness 能力变化。Claude Code 加一个新的 subagent 机制、Cursor 改一次 hook 协议，就可能有若干处描述失准。仓库里已经能看到这种痕迹：绕 Windows `.sh` 自动检测的扩展名技巧、绕 bash 5.3 heredoc 的 printf 改写、三个 JSON 字段的分支。这些补丁本身没问题，但它们的数量会随支持的 harness 数线性增长。

**跨 11 个 harness 的最小公分母。** 同一份 Markdown 喂给 11 个平台，代价是无法利用任何一个平台的特有能力。SDD 里大量依赖「派发子代理并指定模型」，这个能力在不同 harness 上的支持程度差别很大，skill 文本里对此的处理基本是假设它可用。在支持较弱的平台上，SDD 这一整套能落地多少，源码层面看不出来。

**说服工程是双刃的。** 靠 `ABSOLUTELY MUST` 和 `<EXTREMELY_IMPORTANT>` 提升服从率，这个手段在当下有效，但它依赖模型对特定措辞模式的反应。模型换代之后这些措辞的效力如何变化，仓库里没有回归测试能回答。更实际的顾虑是通胀——一个库里同时存在四条 Iron Law、十几处 MUST、多个 `<HARD-GATE>`，边际效果大概率是递减的。

**1% 规则本身有成本。** 「有 1% 可能相关就必须调用 skill」在纪律上很干净，代价是把大量本来两行就能改完的事情拖进完整流程。skill 里对此的回应是专门写反驳章节（*This Is Too Simple To Need A Design*），也就是说作者选择了「宁可过度」这一侧。这个取舍对个人小项目未必划算。

**缺少效果数据。** 引用的 33% → 72% 是别人论文里的通用结论，不是这套 skill 自己的度量。仓库里没有 A/B 数据能说明装了 Superpowers 之后任务完成率或者返工率变化多少。它更像是一套经过实战打磨、但没有量化验证的经验集合——这不减损它的价值，但读的时候得清楚这一点。

## 九、不装这个库也能拿走的东西

按落地成本从低到高：

1. **把入口规则控制在 3-4KB，用 SessionStart hook 注入，matcher 记得带 `compact`。** 这是投入产出比最高的一条，改几行配置的事。
2. **给长任务加一个纯追加的 ledger 文件。** 记任务号、状态、commit 区间、未决项。压缩之后靠它恢复位置。
3. **规则用不可协商的句式写，并且附上违反后的处置。** 「先写测试」改成「写反了就删掉重来，不许留着参考」。
4. **skill 的 description 只写「什么时候用」。** 一旦概括了流程，它就会变成模型抄近道的入口。
5. **派发子任务时只传路径，不传内容。** 计划切片、实现报告、diff 包都落盘，prompt 里只放文件路径和一句定位。
6. **修复循环设上限，并且在后半程换人换模型。** 三轮修不好通常不是努力不够，是视角问题。

## 验证边界

说明清楚这篇文章的证据到哪为止。

**做过的：** 在本地 clone 了 commit `44c9b2d`；完整读了 `using-superpowers`、`brainstorming`、`test-driven-development`、`writing-plans`、`systematic-debugging`、`subagent-driven-development` 六份 SKILL.md，以及 `hooks/` 下三个文件和 `persuasion-principles.md`；实跑了 `hooks/session-start` 的三个平台分支并核对输出字段；在一个临时 git 仓库里实跑了 `sdd-workspace`、`task-brief`、`review-package` 三个脚本，验证了目录自忽略、任务切片和 diff 包结构；行数、字节数、版本号都来自命令输出。

**没做过的：** 没有在真实项目上完整跑一遍 SDD 流程，所以文中关于「修复循环有效」「上下文隔离降低返工」这类判断，来源是 skill 文本里作者记录的经验，不是我这边的观测。没有在 Claude Code 之外的 harness 上安装验证，第八节关于跨平台能力差异的怀疑属于源码层面的推断。没有对 skill 措辞的实际服从率做任何测量。

**图的来源：** 四张图都是按上述源码路径手工画的，不是从仓库文档里搬的。图里出现的文件名、脚本参数、状态枚举都和 commit `44c9b2d` 对得上——中间有一处 `review-package` 输出文件名的写法在实跑后被改正过。
