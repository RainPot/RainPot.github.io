---
title: "LoopX 拆解：给长跑的 Agent 加一层本地控制面"
description: "拆 huangruiteng/loopx v0.4.2（commit 4452d53）。它不是 agent runtime，而是 runtime 外面那层——管目标、闸门、归属、证据和配额。事实源是仓库里的一份 Markdown 加一条 append-only 事件流，决定「现在该不该跑」的那条热路径上一次模型都不调。"
date: "2026-08-07"
tags: ["LoopX", "AI Agent", "Agent Harness", "Loop Engineering", "源码拆解"]
draft: false
featured: true
readingTime: 18
---

两个月前我写过一篇 [Loop Engineering：把提示词变成可验证的自治回路](/blog/2026-06-10-loop-engineering/)，当时的结论是：Agent 工程真正缺的不是更好的 prompt，而是外层那套控制系统——谁来触发、给什么上下文、允许碰哪些工具、怎么判断真的完成、什么时候必须停。

那篇文章讲的是应该有这么一层。这篇讲的是有人把它写出来了，六十多万行。

[LoopX](https://github.com/huangruiteng/loopx) 是一个 MIT 协议的开源项目，GitHub 上 3.1k star、235 fork。它的自我定位是 "loop engineering state kernel for long-running AI agent teams"。我花了大半天把它拆开看，本文基于 **commit `4452d53`（2026-08-07 12:15 +0800），版本 0.4.2**。

先交代一句方法论上的限制：**我没有在本地执行这个仓库的代码**。下面所有结论都来自读源码、读 docs 和读它自己的测试，不来自跑起来的输出。涉及运行时行为的地方我会写成"按代码逻辑应该是"，不会写成"实测如此"。

## 先说判断：它不是什么

拆开之前先把边界划清楚，因为这个项目最容易被误解的地方就在这里。

**它不是 agent runtime。** 它不调模型，不管工具调用，不做 sandbox。真正干活那一步在它的流程里是个空洞——你的 Codex、Claude Code 或者自己写的 runner 填进去。

**它不是 agent 框架。** 没有 Agent 类，没有 tool 抽象，没有 planner。

**它也不是任务管理 SaaS。** 没有服务端，没有数据库，`dependencies = []`，装完就是一个本地 CLI。

它管的是 runtime 之外那一层：这个目标现在卡在哪、哪件事该问人、哪件事 agent 可以自己往前推、谁认领了哪片活、上一轮到底算不算有进展、以及这个目标今天还能占多少自动执行时间。

README 里那句话说得比我准：

> LoopX does not grant credentials, approve destructive or production actions, publish on a user's behalf without authorization, or turn an unverified run into evidence of success.

![LoopX 的三层结构图，白底。第一层「驱动方」分左右两半：左半边红色框列出三件人必须做判断的事——user gate（只问具体问题，不问"要不要继续"）、授权边界（写权限、生产动作、对外发布）、reward（人工认可不等于自动获得写权限），下方灰色斜体注明聊天里说过的纠正不算数，要被提升成持久的 lesson 或 gate 事件才会影响后面的轮次；右半边黄色框列出四种 agent runtime——Codex App heartbeat、Codex CLI TUI、Claude Code 的 /loop 加 MCP、自建 runner 或手动 shell，它们互为 peer 没有常驻 leader，下方注明换一个 runtime 不应该改变 todo 的归属、授权和证据 lineage。第二层是蓝色高亮的「LoopX 状态内核」，左半边列出内核持有的五类东西：objective 加公私边界、user todo 与 agent todo 加 claim 归属、gate 加 decision_scope、run history 加 evidence、从事件重算的 quota 账本，旁边一个等宽字体框列出落在磁盘上的四处路径：.loopx/registry.json、.codex/goals/id/ACTIVE_GOAL_STATE.md、.codex/goals/id/events.jsonl、~/.codex/loopx/goals/id/runs/；右半边是每轮吐出的交互契约，顶部一个黑色命令框写着 loopx --format json quota should-run --goal-id id，下面三个绿色框分别是 user_channel（要不要打扰人以及具体问什么问题，不允许只说"等 owner 批准"）、agent_channel（must_attempt、delivery_allowed、quiet_noop_allowed、primary_action）、cli_channel（next_cli_actions，写回和记账要按什么顺序执行）。第三层「一轮结束」左边是绿色的证据写回，右边是紫色的只读投影面 loopx status、diagnose、dashboard、飞书看板，并注明看板只是投影不是第二个事实源。三层之间用四条彩色箭头连接，底部一条黑色横条写着不变式：被 gate 挡住的那条路要等，不依赖这个 gate 的活可以继续，只要产生了实质变化就把紧凑证据写回来。](/images/loopx-control-plane/architecture.png)

图里那条黑色不变式是整个项目的立场：**被挡住的不等于全停**。这看着像句废话，但它是绝大多数 Agent 自动化实际翻车的地方——一个 gate 卡住，整个 loop 要么原地空转刷日志，要么干脆停摆等人。

## 一次 tick 的八步

LoopX 的主循环小得出乎意料。README 里直接把它列成五条命令：

```text
loopx quota should-run      # should this registered agent act now?
loopx todo claim            # who owns this slice?
loopx todo update           # what changed?
loopx refresh-state         # what should the next turn see?
loopx quota spend-slot      # account for a completed, validated slice
```

这五条命令加上执行、校验和排下一次的时间，就是完整的一轮。全都是 CLI，没有 SDK，没有必须继承的基类。自建 runner 接进来，接的就是这八步。

![一次 tick 的八步流程图，两行四列共八个方框。第一行：① Decide 决定要不要动，命令是 loopx quota should-run，说明这是一条纯 Python 的 if/elif 链全程不调模型，返回 eligible 之外的任何状态这一轮就不该交付，goal 不认识或状态读不出来直接非零退出；② Route 把决定变成类型，对应 LoopXTurnRoute 的七种取值 ready_for_host、wait、blocked、user_action_required、repair_required、replan_required、contract_error，签名不匹配、快照哈希对不上、上下文超预算一律归为 contract_error；③ Claim 认领这一片活，命令是 loopx todo claim，默认是软归属只影响可见性和路由不过期，真出现并发写才升级成硬租约 task_lease_v0，默认 45 分钟最长 24 小时；④ Execute 真正干活，用虚线灰框表示这一步是你的 agent runtime，LoopX 在这一步是缺席的，跑的是一个有界的 turn 不是整个长期任务。第二行：⑤ Validate 校验，由 capability 校验 provider 回执，命令退出码是 0 通常只能证明进程正常退出不能证明业务效果发生了；⑥ Writeback 写回，命令是 loopx todo update 和 loopx refresh-state，追加一条事件到 events.jsonl 再把 User Todo、Agent Todo、Progress Ledger 三节重新投影成 Markdown；⑦ Account 记账，命令是 loopx quota spend-slot --execute，每轮恰好一次且必须在校验通过的写回之后，安静跳过、预检失败、dry-run 都不许记；⑧ Schedule 下一次什么时候来，产出 scheduler_hint 并调用 quota scheduler-ack-current，人类 gate 起步 30 分钟最长退到 120，agent 无在辖任务走 10、20、30、60 分钟递进，monitor 静默走 15、30、60，改节奏失败就不许 ACK。下方一个大框列出执行完必须回的十种 typed result：绿色一栏是可以走到记账的四种 validated_progress、validated_completion、repair_required、replan_required，红色一栏是 NO_SPEND_RESULT_KINDS 一律不许记账的六种 user_action_required、wait、host_failure、validation_failed、writeback_failed、quota_spend_failed。底部黑色横条写着事务的七个阶段有固定顺序：host_execute、typed_result、validation、durable_writeback、quota_spend、scheduler_apply、scheduler_ack，顺序错了或阶段跳了校验直接报错。](/images/loopx-control-plane/tick-lifecycle.png)

这张图里最值得看的是底下那两栏。`loopx/control_plane/turn_driver/transaction.py:48` 定义了一个集合：

```python
NO_SPEND_RESULT_KINDS = {
    LoopXTurnResultKind.USER_ACTION_REQUIRED,
    LoopXTurnResultKind.WAIT,
    LoopXTurnResultKind.HOST_FAILURE,
    LoopXTurnResultKind.VALIDATION_FAILED,
    LoopXTurnResultKind.WRITEBACK_FAILED,
    LoopXTurnResultKind.QUOTA_SPEND_FAILED,
}
```

同一个文件往下几十行，`transaction.py:223` 检查如果结果类型在这个集合里、但 `quota_spend` 阶段已经完成，就报错。

翻译成人话：**「我这轮什么也没干成」和「我这轮花了配额」是互斥的，这条互斥关系写死在代码里，不由 agent 自己声明。**

这点我觉得比任何架构图都能说明这个项目在防什么。跑过定时 Agent 的人都知道那个失败模式：任务卡住了，但 loop 还在按点醒来，每次醒来都写一行"继续推进中"，跑一周烧掉一堆 token，回头看进度条一动没动。LoopX 的做法是把"什么算一次有效消耗"从 agent 的自我报告里拿走，交给一个类型枚举。

同一个文件上面的 `TRANSACTION_PHASES` 把七个阶段的顺序也固定了：

```python
TRANSACTION_PHASES = (
    "host_execute", "typed_result", "validation",
    "durable_writeback", "quota_spend",
    "scheduler_apply", "scheduler_ack",
)
```

记账排在写回后面，写回排在校验后面。顺序不能颠倒，阶段不能跳。

## 状态到底存在哪

这是我觉得这个项目最有意思的一个设计决定：**没有数据库，事实源就是仓库里的一份 Markdown。**

![状态在磁盘上的形态图，分三栏加一条底部流程。第一栏「东西放在哪」分两块：项目内跟着 git 走的部分是 .loopx/registry.json 加 .codex/goals/goal-id/ 目录下的 ACTIVE_GOAL_STATE.md 和 events.jsonl，注明这记录了这个项目有哪些 goal、每个 goal 现在是什么样、以及它是怎么变成这样的；用户目录下跨项目的 runtime root 是 ~/.codex/loopx/，包含 registry.global.json 和 goals/goal-id/ 下的 runs 轮次快照与 task-leases 硬租约，注明换台机器换个 runtime goal 还认得出来，租约文件只在真出现并发写的时候才生成；底部蓝框强调零第三方运行时依赖，dependencies 等于空列表。第二栏是 ACTIVE_GOAL_STATE.md 的骨架，等宽字体展示 YAML frontmatter 含 status、objective、updated_at 三个字段，正文标题为 Active Goal State，下面依次是 Objective、Authority Sources、Operating Contract、Execution Profile、Non-Goals、User Todo、Owner Review Reading Queue、Agent Todo、Next Action、Recent User Feedback、Progress Ledger 共十一个二级小节，下方注明人的待办和 agent 的待办是两节不是一个列表里打标记。第三栏是一条 todo 的真实样子：上面黄框是一行普通的 Markdown 未勾选复选框，内容为 Run one validated benchmark case and write back result or blocker，注明这是人在 GitHub、编辑器、任何 Markdown 预览里看到的样子手改也行；下面绿框是紧跟着的一条 HTML 注释，内容为 loopx:todo 加上 todo_id=todo_8e280be49441、status=open、task_class=advancement_task、action_kind=run_eval、required_capabilities=shell%2Cbenchmark_runner、claimed_by=codex-main-control 六个字段，注明这是机器读的部分渲染时不可见，值做过 url-encode 所以逗号空格不会破坏行结构，它和上面那行绑在一起 git diff 里能一眼看出谁改了什么；最下方蓝框解释为什么值得这么做——人不用装工具就能读和改，agent 不用解析自然语言就能拿到结构化字段，任何一方单独存在时这份文件都还是有意义的。底部一条紫色流程：events.jsonl append-only 经过文件锁加单调递增序号、幂等重放加指纹冲突检测，投影成 Markdown 的 User Todo、Agent Todo、Progress Ledger 三节，成为人和 agent 下一轮读到的那份当前状态。最下方黑色横条写着投影可以为了省 token 而压缩细节，但不能改写那条让决定可审计的事件，两者一旦对不上以事件为准。](/images/loopx-control-plane/state-on-disk.png)

一条 todo 长这样：

```markdown
- [ ] Run one validated benchmark case and write back result or blocker.
  <!-- loopx:todo todo_id=todo_8e280be49441 status=open
       task_class=advancement_task action_kind=run_eval
       required_capabilities=shell%2Cbenchmark_runner
       claimed_by=codex-main-control -->
```

上面那行是人看的，任何 Markdown 预览器渲染出来都是个普通复选框，手改也行。下面那条 HTML 注释是机器读的，渲染时不可见，值做过 url-encode 所以逗号和空格不会撑破行结构。

这个设计我第一眼觉得土，想了想改主意了。它同时解决了三件事：人不用装任何工具就能读和改；agent 不用解析自然语言就能拿到结构化字段；`git diff` 里谁改了哪个字段一目了然。**任何一方单独存在的时候，这份文件都还是有意义的**——这是数据库方案给不了的。

不过 Markdown 只是投影，不是事实。真正的事实是 `events.jsonl`。`loopx/event_sourced_state.py:560` 的 `append()` 里塞了四件事：

```python
def append(self, event):
    with exclusive_file_lock(self.path):
        self._loaded = False
        events = self.load()
        existing = {item["event_id"]: item for item in events}
        next_sequence = max((int(item["append_sequence"]) for item in events), default=0) + 1
        normalized = normalize_state_event(event, append_sequence=next_sequence)
        prior = existing.get(normalized["event_id"])
        if prior is not None:
            if event_fingerprint(prior) != event_fingerprint(normalized):
                raise StateEventConflictError(f"conflicting event_id: {normalized['event_id']}")
            return prior
        ...
```

排他文件锁防并发写；`append_sequence` 单调递增给出全序；`event_id` 相同且指纹一致就直接返回旧的，所以重放是幂等的；指纹不一致直接抛冲突，不悄悄覆盖。

对一个"就是往文件里追加一行"的操作来说，这四层挺够用了。多个 agent 同时往一个 goal 里写，这是最容易出事的地方。

`docs/state-interaction-model.md` 里有句话把投影和事实的关系说得很清楚：投影可以为了省 token 而压缩细节，但不能改写那条让决定可审计的事件。

## 挑一个机制深挖：配额

八步里我最想细看的是第一步，因为它是唯一一个"每轮都要跑、跑错了整个系统就废了"的判断。

`compute` 在 LoopX 里不是优先级标签，是一个**占空比**。`loopx/quota.py:398`：

```python
default_allowed_slots = round((window_hours * 60 / slot_minutes) * compute)
```

24 小时窗口、1 分钟一个槽、compute = 0.5，算出来 720 个槽，相当于这个目标一天最多占一半的自动执行时间。compute = 0 就是 goal 级硬暂停。

![配额决策图。顶部蓝色区块是槽位计算：黑底公式 allowed_slots = round( window_hours × 60 ÷ slot_minutes × compute )，右侧三个例子——compute 等于 1.0 时 24 小时乘 60 除以 1 分钟得 1440 槽窗口内不设上限，compute 等于 0.5 时得 720 槽相当于一天占一半，compute 等于 0 时得 0 槽即 goal 级硬暂停；下方灰色斜体注明配额是滑动窗口不是日历日，已用槽 spent_slots 每次都从窗口内的 quota_slot_spent 事件重新算（spent 减 voided），不是一个只增不减的计数器，所以旧的消耗会随窗口滑过而自动腾出来。中部是八行 if/elif 判断链，左列为条件右列为结果，顺序即优先级：compute 小于等于 0 得到 paused（所有自动权限置 false 永远不会 run_now，红色）；severity 等于 high 得到 blocked_health（健康度排在产出前面先修再跑，红色）；waiting_on 属于 user_or_controller 或 controller 得到 operator_gate（被 gate 挡住的那条路停下，不依赖这个 gate 的活照常跑，黄色）；waiting_on 等于 external_evidence 得到 waiting（在等外部系统的回执不是在等人，灰色）；waiting_on 等于 codex 且 focus 在别处得到 focus_wait（排队让出注意力给当前聚焦的 goal，灰色）；waiting_on 等于 codex 且 allowed_slots 大于 0 且 spent_slots 大于等于 allowed_slots 得到 throttled（槽用完了，719 到 720 这一笔就是 eligible 翻成 throttled 的那一刻，黄色）；waiting_on 等于 codex 得到 eligible（唯一一个常规状态下 should_run 为 true 的出口，绿色加粗）；以上都不匹配得到 waiting（说不清楚就不跑，默认拒绝不默认放行，灰色）。底部三个说明框：蓝框「这条链上没有一次模型调用」，文档把理由写得很直白，给 should-run 这种每轮都要跑的判断引入 LLM 等于同时引入延迟、成本、不确定性、提示注入面以及一次不必要的隐私文本处理；绿框「记账只在一处发生」，每轮恰好一次且必须排在校验通过的写回之后，安静跳过、预检失败、dry-run 一律不记，所以配额账本反映的是真实交付不是尝试次数；红框「出错就关门」，goal 不认识或状态收集失败时命令直接非零退出而不是返回一个大概可以跑。最下方黑色横条写着配额只回答一个问题：在可用的自动 agent 时间里这个目标能占多少，它不决定人工奖励、写入审批、生产权限，也不决定 gate 的结果。](/images/loopx-control-plane/quota-decision.png)

`quota_status()`（`loopx/quota.py:472`）就是一条平铺的 if/elif，八个分支，顺序即优先级。健康度排在 gate 前面，gate 排在等外部证据前面，槽位耗尽排在 eligible 前面，兜底是 waiting。

我特意确认了两个细节：

一是 `throttled` 那个分支写的是 `if allowed_slots > 0 and spent_slots >= allowed_slots`。`allowed_slots == 0` 会掉到 `eligible`——这意味着 compute 小到 `round()` 归零、但又大于 0 的时候，反而不受槽位限制。这更像是把"0 表示不限制"和"compute=0 表示暂停"两套语义放在一起的结果，不像是有意为之的功能。真要用小 compute 值，这个边界得留意。

二是 `spent_slots` 不是计数器。它每次都从窗口内的 `quota_slot_spent` 事件重新算（spent 减 voided）。所以已用配额会随窗口滑过自动往下掉，也不会因为某次崩溃留下一个对不上的余额。事件溯源在这里的收益是实打实的。

**这条链上一次模型调用都没有。** `docs/state-interaction-model.md:200` 把理由写得很直白：

> The hot path should not call an LLM to decide whether the user is gated, because that adds latency, cost, nondeterminism, prompt-injection surface, and private-text handling risk to `quota should-run`. If an LLM is useful, keep it in a cold proposal lane that suggests structured `User Todo`, `decision_scope`, or `Agent Todo` edits for a later deterministic promotion step.

这段我认为是整个项目最值得抄走的一条判断。热路径确定性、冷路径才允许用模型提议——它把"AI 参与决策"和"AI 决定状态"这两件事分开了。前者是建议，后者要经过一个确定性的提升步骤。

顺带一提，退避节奏也是写死的常量而不是模型算的（`loopx/control_plane/scheduler/scheduler_hint.py`）：人类 gate 起步 30 分钟、最长退到 120；agent 手上没有在辖任务时走 10 / 20 / 30 / 60 分钟递进；monitor 静默走 15 / 30 / 60。理由在 `scheduler_hint.py:1172` 的 reason 字段里：把具体的 gate 摆出来一次，然后别再重复同一个安静轮询。

## 归属：软归属和硬租约

多 agent 协作这块的处理值得单说，因为它给出了一个我之前没想到的分层。

默认的 `claim` 是**软归属**：只影响可见性和路由，不过期，不阻止别人写。只有真出现并发写的时候才升级成 `task_lease_v0` 硬租约。`loopx/cli_commands/task_lease.py:89` 的 help 文本写着：默认 45 分钟，上限 24 小时。

先软后硬这个顺序我觉得是对的。分布式锁的成本不在实现，在于过期之后那一堆边界情况——租约到期了但活还在跑怎么办，进程挂了锁没释放怎么办。绝大多数时候 agent 之间根本不冲突，为了那少数几次冲突让所有人都付租约维护的代价，不划算。

`docs/state-interaction-model.md` 里还有一条：别的 agent 的 claim 保持**诊断性质**——能看见，但进不了本 goal 的执行队列。跨 goal 的清单只能通过一个显式的只读全局命令拿。这是在防 agent 互相看到对方的任务之后自作主张地"帮忙"。

## 边界在哪

拆到这儿，说几个我认为需要注意的地方。

**规模和这个阶段不太匹配。** 2210 个文件、1599 个 Python 文件、63.8 万行 Python，391 篇 docs 下的 markdown，其中 `examples/` 一个目录就 23.4 万行、631 个 `*-smoke.py` 契约冒烟文件。而它自己给的定位是 "early but usable"。做同样这件事，我估计核心逻辑一两万行足够。多出来的量主要在契约冒烟和各种 host 适配上——这是它选择"支持所有 runtime"要付的代价，但也意味着新人想读懂全貌会很吃力。

**测试覆盖率门槛设在 19.6%。** 这个数字对一个自称"状态内核"的项目偏低。不过 631 个契约冒烟文件是另一套保障机制，行覆盖率在这种以契约为主的项目里参考价值有限。这条我只能说存疑，没法下结论。

**它自己也知道分层容易被绕过。** `docs/architecture.md:143` 有一句自我警告：

> Hiding an adapter dependency inside a function or dynamic import does not count as architectural separation.

写这句话说明有人真的这么干过。这类"内核 vs 适配器"的分层，最后守不守得住，通常不取决于文档写得多严，而取决于有没有 CI 在管。

**"人的判断"这层是约定，不是强制。** 图一左上角那三个红框——user gate、授权边界、reward——LoopX 能做的是把它们记下来、在决策链里查一下。它拦不住一个拿到 shell 权限的 agent 直接绕过去干活。这是 prompt 约束和状态约束，不是安全边界，别当成 sandbox 用。

## 换到自己的活里，能拿走什么

我平时的工作在客户端性能和 GUI Agent 的自动化测试上，这两个场景恰好都有"长跑任务"的特征。四条我准备直接搬走的：

**第一，把"什么算一次有效消耗"从 agent 的自我报告里拿走。** 这是 `NO_SPEND_RESULT_KINDS` 那招。GUI Agent 跑用例的时候，"点了但没生效"和"点了且页面变了"必须是两种结果类型，不能都算"执行了一步"。让 agent 自己判断这个，它会倾向于说自己成功了。

**第二，热路径不调模型。** 判断"这个 case 该不该重跑"、"这个失败要不要升级"，这类每次都要走的判断如果塞进 LLM，你会同时得到不稳定的结论和一笔持续的账单。把模型放在冷路径上提议，提议要经过一个确定性的规则才能变成状态。

**第三，状态用 Markdown 加 HTML 注释存。** 我之前的做法是 JSON 加一个小 viewer，结果就是没人看。用这个格式，QA 同学在 GitHub 上就能直接读和改，机器读的字段藏在注释里互不干扰，`git diff` 天然就是变更历史。这个成本几乎为零，值得试。

**第四，投影和事实分开。** 看板、dashboard、飞书卡片都只是投影，改看板等价于调用一个会被校验的算子，而不是直接改状态。一旦允许第二个地方写状态，对账问题会追着你跑一整年。

至于要不要直接用 LoopX 本身——我的判断是：如果你已经有一套定时跑 Agent 的东西并且正在被"跑了一周没进展"折磨，值得把它的 quota 和 typed result 这两块思路搬过去。整个装上来用，考虑到 0.4.x 这个版本号和六十多万行的体量，我会先在一个不重要的项目上放一段时间再说。

它真正的价值不在代码量，在于它把一堆平时靠人盯着的隐性约定——什么时候该问人、什么算有进展、这个目标今天还能跑多久——写成了可以被检查的类型和状态。这件事本身比它写了多少行更值得看。

---

*本文基于 huangruiteng/loopx commit `4452d53`（v0.4.2）的源码与文档分析。未在本地执行该仓库代码，涉及运行时行为的判断均来自代码逻辑推导，不构成实测结论。文中提到的行号对应该 commit。*
