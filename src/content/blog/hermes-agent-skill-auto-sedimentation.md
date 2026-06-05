---
title: "Hermes Agent 自动沉淀 Skill 机制拆解"
description: "从触发器、后台 review fork、skill_manage、usage sidecar 到 curator，拆解 Hermes Agent 如何把一次任务经验沉淀成可复用的 Skill。"
date: "2026-06-05"
tags: ["Hermes Agent", "AI Agent", "Skills", "Memory"]
draft: false
featured: false
readingTime: 18
---

## 目录

1. 先说结论
2. Skill 在 Hermes 里是什么
3. 自动沉淀的主链路
4. 后台 review fork 如何工作
5. skill_manage 如何落盘
6. provenance：为什么不是所有新建 skill 都算自动沉淀
7. 沉淀后的 skill 如何被再次使用
8. Curator：自动沉淀后的二次整理
9. 实现里的几个边界
10. 总结

---

## 1. 先说结论

这篇基于本地 `hermes-agent` 仓库 `main@ff5652d0f` 拆解。Hermes Agent 的自动沉淀 skill 不是一个简单的“任务结束后自动写文件”，而是一套分层闭环：

```
普通对话执行
  -> 统计工具调用迭代次数
  -> 达到阈值后在主回复结束后启动 background review
  -> review fork 只允许记忆和技能工具
  -> review prompt 判断应该 patch 旧 skill、写 support file，还是创建新 umbrella skill
  -> skill_manage 写入 ~/.hermes/skills/
  -> .usage.json 记录 created_by、use/view/patch 计数和生命周期状态
  -> 后续系统提示、/skill-name、skills_list、skill_view 重新发现并复用
  -> curator 周期性整理过期、重复、过窄的 agent-created skills
```

这里有三个关键设计点：

- **沉淀发生在主任务之后**：用户的任务先完成并返回，后台 review 再决定是否写 skill，不抢主任务注意力。
- **沉淀优先更新而不是新建**：review prompt 明确要求先 patch 当前加载的 skill，再 patch 现有 umbrella，再写 `references/`、`templates/`、`scripts/`，最后才创建新的 class-level umbrella skill。
- **自动沉淀和用户手动创建被区分**：`skill_manage(create)` 只有在 background review 上下文里运行时，才会把 skill 标记为 `created_by: agent`，进入 curator 管理范围。

## 2. Skill 在 Hermes 里是什么

Hermes 把 skill 定义成一种“过程记忆”。它不是普通的长期记忆，也不是工具本身，而是一组针对某类任务的可复用操作说明。

典型目录结构是：

```text
~/.hermes/skills/
├── my-skill/
│   ├── SKILL.md
│   ├── references/
│   ├── templates/
│   ├── scripts/
│   └── assets/
└── category/
    └── another-skill/
        └── SKILL.md
```

`SKILL.md` 必须有 YAML frontmatter，至少包含 `name` 和 `description`。这是 progressive disclosure 的第一层：系统提示里只放 name 和 description，让模型知道有哪些 skill；真正需要时再通过 `skill_view(name)` 加载完整内容和支持文件。

源码入口主要在这些文件：

| 模块 | 作用 |
| --- | --- |
| `agent/background_review.py` | 后台记忆/技能 review 的 prompt 和 fork 逻辑 |
| `agent/conversation_loop.py` | 主对话循环，统计触发条件并启动后台 review |
| `tools/skill_manager_tool.py` | `skill_manage` 工具，创建、patch、编辑、删除 skill |
| `tools/skills_tool.py` | `skills_list` 和 `skill_view` |
| `tools/skill_usage.py` | `.usage.json` 遥测和生命周期状态 |
| `tools/skill_provenance.py` | 用 `ContextVar` 区分 foreground 写入和 background review 写入 |
| `agent/curator.py` | 周期性整理 agent-created skills |
| `agent/prompt_builder.py` | 构建系统提示里的 compact skill index |

## 3. 自动沉淀的主链路

Hermes 有两种让 skill 被沉淀的力量。

第一种是**前台提示和工具描述**。系统提示里的 `SKILLS_GUIDANCE` 会告诉模型：完成复杂任务、修复棘手错误、发现非平凡 workflow 后，应当用 `skill_manage` 保存为 skill。`skill_manage` 的 schema 也写得很直接：复杂任务成功、克服错误、用户纠正后的方法有效、发现非平凡 workflow、用户要求记住某个过程，都可以创建 skill。

这条路径偏“模型自觉”。它会提醒模型在合适时机保存，但 schema 里也要求“difficult/iterative tasks 后要 offer to save as a skill，创建或删除前确认用户”。所以普通 foreground 对话里调用 `skill_manage(create)`，更像用户指导下的显式保存。

第二种才是更像“自动沉淀”的路径：**background self-improvement review**。

在 `agent/agent_init.py` 中，Hermes 初始化两个计数器：

```text
_iters_since_skill = 0
_skill_nudge_interval = skills.creation_nudge_interval or 10
```

在常规 chat-completions 对话循环中，每次工具调用迭代都会增加 `_iters_since_skill`。如果模型实际使用了 `skill_manage`，计数器会被清零，表示已经沉淀过本轮经验。等主任务结束后，`agent/conversation_loop.py` 再检查：

```text
final_response 存在
and 未被 interrupt
and _iters_since_skill >= _skill_nudge_interval
and skill_manage 在可用工具列表里
```

满足条件时，Hermes 调用：

```text
agent._spawn_background_review(
  messages_snapshot=list(messages),
  review_memory=_should_review_memory,
  review_skills=_should_review_skills,
)
```

这里有两个细节很重要。

第一，检查发生在主循环结束之后。用户先拿到最终回答，skill review 在后台跑。

第二，Codex runtime 也有同构逻辑。`agent/codex_runtime.py` 会从 Codex app-server 的 `TurnResult.tool_iterations` 累加 `_iters_since_skill`，达到同样阈值后触发 `_spawn_background_review(...)`。也就是说，不同运行时共享同一套“复杂任务后复盘”的语义。

## 4. 后台 review fork 如何工作

`AIAgent._spawn_background_review` 只是薄包装，真正逻辑在 `agent/background_review.py`。

它会启动一个 daemon thread，并在里面新建一个 review agent。这个 review agent 不是随便开的小模型，它继承父 agent 的运行时：

- `model`、`provider`、`base_url`、`api_key`、`api_mode`
- 父 agent 的 toolset 配置
- 父 agent 的 cached system prompt
- 父 agent 的 session id 和 session start

这样做的目的之一是 prompt cache 命中。测试 `tests/run_agent/test_background_review_toolset_restriction.py` 里也明确记录了这个取舍：review fork 继承父工具 schema 保持缓存 key 一致，但在 runtime 层用 thread-local whitelist 拦截非 memory/skills 工具调用。

所以 review fork 的权限模型是：

```text
请求体里的 tools schema 尽量和父 agent 一致
实际 dispatch 前只放行 memory + skills 工具
terminal / send_message / delegate_task / web_search / execute_code 等都会被拒绝
```

它还做了几个安全处理：

- `skip_memory=True`，避免 review prompt 被写入外部记忆插件。
- 危险命令审批 callback 固定为 auto-deny，避免后台线程卡在交互式确认。
- `_memory_nudge_interval = 0`、`_skill_nudge_interval = 0`，避免 review fork 再递归触发 review。
- stdout/stderr 重定向到 `/dev/null`，用户只看到最终的 self-improvement summary。

真正决定“沉淀什么”的是 `_SKILL_REVIEW_PROMPT`。它的策略非常像一套 skill 维护准则：

1. 用户纠正风格、格式、冗余度、工作流，都是 first-class skill signal。
2. 出现非平凡技巧、修复、绕过路径、调试过程，要捕获。
3. 如果本轮加载过某个 skill 且它缺步骤、错命令、过期，要立刻 patch。
4. 优先级是：patch 当前加载 skill，patch 现有 umbrella，给 umbrella 增加 support file，最后才创建新的 class-level umbrella。
5. 新 skill 名必须是类别级，不允许是 PR 号、错误字符串、当天任务代号、`fix-X`、`debug-Y` 这类一次性名称。
6. 不要把环境缺失、`command not found`、未配置 credential、工具暂时不可用，沉淀成长期规则；如果要记录，只记录修复方式。

这一段是 Hermes 自动沉淀质量的核心。它试图避免一个常见灾难：Agent 每做一次任务就创建一个窄 skill，最后 skill catalog 变成一堆“某天修某 bug”的碎片。

## 5. skill_manage 如何落盘

`tools/skill_manager_tool.py` 暴露的 `skill_manage` 支持六个动作：

| action | 作用 |
| --- | --- |
| `create` | 新建 skill 目录和 `SKILL.md` |
| `edit` | 全量替换已有 skill 的 `SKILL.md` |
| `patch` | 对 `SKILL.md` 或支持文件做定向替换 |
| `delete` | 删除 skill |
| `write_file` | 写入 `references/`、`templates/`、`scripts/`、`assets/` 下的支持文件 |
| `remove_file` | 删除支持文件 |

创建 skill 时会做这些校验：

- name 只能用小写字母、数字、点、下划线、连字符，并且长度有限制。
- category 必须是单段安全目录名。
- `SKILL.md` 必须有合法 frontmatter，包含 `name` 和 `description`。
- 内容大小不能超过限制。
- 所有已配置 skill 目录里不能有同名 skill。
- 写文件使用 atomic replace。
- 如果开启 `skills.guard_agent_created`，写完后会跑 `skills_guard`，失败则回滚。

新建 skill 永远写入本地 `~/.hermes/skills/`。但是 patch、edit、write_file、remove_file、delete 会先 `_find_skill(name)`，因此可以改到本地 skills，也可以改到 `skills.external_dirs` 中可写的外部 skills。这个能力很强，也意味着保护边界主要来自配置、文件权限和 prompt 约束，而不是 `skill_manage` 对 bundled/hub/external 的硬性只读判断。

成功写入后，`skill_manage` 会清理 skills system prompt cache。这样下次构建系统提示时，新 skill 或被改过的 description 能被重新扫描。

## 6. provenance：为什么不是所有新建 skill 都算自动沉淀

这是源码里最值得注意的分界。

`tools/skill_provenance.py` 用 `ContextVar` 保存当前写入来源，默认是 `foreground`。普通 agent 对话开始时，`agent/conversation_loop.py` 会执行：

```text
set_current_write_origin(agent._memory_write_origin or "assistant_tool")
```

而 background review fork 会把：

```text
review_agent._memory_write_origin = "background_review"
review_agent._memory_write_context = "background_review"
```

于是 `skill_manage` 成功执行后，会检查：

```text
if action == "create" and is_background_review():
    mark_agent_created(name)
```

`mark_agent_created` 会在 `~/.hermes/skills/.usage.json` 中写入：

```json
{
  "review-sediment": {
    "created_by": "agent"
  }
}
```

这意味着：**foreground 对话里创建的 skill，即使用的是同一个 `skill_manage(create)`，也不会自动被标记成 `created_by: agent`。**

测试 `tests/tools/test_skill_manager_tool.py` 对这个行为有直接覆盖：

- foreground create 成功，但 `.usage.json` 里没有 provenance marker。
- background-review create 成功，并且 `created_by == "agent"`。

这层设计的语义是：用户要求当前 agent 写一个 skill，那个 skill 属于用户；后台自我改进 review 自己沉淀出来的 skill，才属于自动沉淀产物，才应该被 curator 后续自动整理。

## 7. 沉淀后的 skill 如何被再次使用

skill 写入后，Hermes 有三条复用途径。

第一条是系统提示里的 skill index。

`agent/prompt_builder.py` 会扫描本地 `~/.hermes/skills/` 和 `skills.external_dirs`，读取 `SKILL.md` 和 `DESCRIPTION.md`，构建 compact index。这个 index 会告诉模型：

```text
如果某个 skill 匹配任务，必须用 skill_view(name) 加载并遵循它。
如果 skill 有问题，用 skill_manage(action='patch') 修复。
困难或迭代任务后，offer to save as a skill。
```

为了性能，它有两层缓存：

- 进程内 LRU cache。
- 磁盘快照 `.skills_prompt_snapshot.json`，通过 mtime/size manifest 校验。

第二条是 slash command。

`agent/skill_commands.py` 会扫描 skill 目录，把 `SKILL.md` 变成 `/skill-name` 形式的命令。用户输入 `/my-skill 做这个任务` 时，Hermes 会把 skill 内容作为用户消息注入，而不是塞进 system prompt。AGENTS.md 里也特别强调这是为了保护 prompt caching。

第三条是工具。

模型可以调用 `skills_list` 看 name 和 description，再调用 `skill_view` 加载完整内容。`skill_view` 成功后会同时 `bump_view` 和 `bump_use`，因为这不只是浏览，它代表 agent 主动加载 skill 来执行任务。

这些使用痕迹都会进入 `.usage.json`，成为 curator 判断活跃度的依据。

## 8. Curator：自动沉淀后的二次整理

自动沉淀如果没有清理机制，很快会把 skill 库变成垃圾场。Hermes 用 `agent/curator.py` 处理这个问题。

Curator 的默认配置在 `hermes_cli/config.py`：

```yaml
curator:
  enabled: true
  interval_hours: 168
  min_idle_hours: 2
  stale_after_days: 30
  archive_after_days: 90
  prune_builtins: true
  backup:
    enabled: true
    keep: 5
```

它不是独立 cron daemon，而是挂在两个地方：

- CLI 启动时检查一次，CLI startup 被认为是 fully idle。
- Gateway 的 cron ticker 周期性检查一次。

`maybe_run_curator` 会先看配置、pause 状态、距离上次运行是否超过 `interval_hours`，以及 idle 时间是否超过 `min_idle_hours`。首次观察不会立刻运行，而是写入 `last_run_at = now`，把第一次真实运行推迟一个完整 interval，给用户 dry-run、pin 或 opt-out 的时间。

一次 curator run 分两阶段。

第一阶段是确定性的自动状态转换，不用 LLM：

- 超过 `stale_after_days` 未使用：`active -> stale`
- 超过 `archive_after_days` 未使用：移动到 `~/.hermes/skills/.archive/`
- pinned skill 跳过所有自动转换
- hub-installed skill 永远不纳入
- bundled skill 只有在 `curator.prune_builtins` 开启时才纳入，且第一次看到时先 seed usage record，不会因为历史上没用过就立刻批量归档

第二阶段是 LLM review。

Curator 会再开一个 `AIAgent` fork，读取候选列表，做“umbrella-building consolidation pass”。它的 prompt 明确说目标不是被动审计，也不是简单查重，而是把大量窄 skill 整理成类别级 umbrella：

- 识别同前缀或同领域 cluster。
- 能并入现有 umbrella 就 patch umbrella。
- 没有 umbrella 就创建 class-level umbrella。
- 窄但有价值的内容降级到 `references/`、`templates/`、`scripts/`。
- 支持文件要按完整 package 处理，不能只把 `SKILL.md` 粘到另一个 skill 的 references 里导致相对路径断掉。
- 输出必须包含结构化 YAML，总结哪些 skill 被 consolidated，哪些是 pruned。

Curator 每次真实运行前会先 snapshot `~/.hermes/skills/` 到 `.curator_backups`。`hermes curator run --dry-run` 则只产报告不改文件。用户还可以通过 `hermes curator pin <skill>` 阻止某个 skill 被自动 stale/archive/consolidate。

## 9. 实现里的几个边界

### 9.1 文档和代码里的 agent-created 口径有差异

我读到的当前代码中，`tools/skill_usage.py::list_agent_created_skill_names()` 对本地非 bundled、非 hub skill 还有一层 record gate：

```text
usage record 中 created_by == "agent" 或 agent_created == true
```

也就是说，手写放进 `~/.hermes/skills/` 的本地 skill 默认不会出现在 curator 管理列表里，除非它有相应 usage record。这个实现比部分文档里“非 bundled/hub 都算 agent-created”的说法更保守。

### 9.2 skill_manage(delete) 和 curator 的“归档”语义需要分清

确定性自动归档走的是 `tools/skill_usage.py::archive_skill()`，它会把目录移动到 `.archive/`，这是可恢复的。

但 `tools/skill_manager_tool.py::_delete_skill()` 本身是 `shutil.rmtree(skill_dir)`，语义是真删除。Curator prompt 中把 `skill_manage action=delete` 描述成 archive，并要求传 `absorbed_into` 来区分 consolidation 和 pruning；同时也允许用 terminal 把目录移动到 `.archive/`。因此实际运行时，安全性依赖几层兜底：

- curator 真实运行前 snapshot。
- pinned skill 的 delete 会被 `_pinned_guard` 拒绝。
- dry-run 可预览。
- structured report 记录迁移关系。

如果只看工具层，`delete` 不是 archive。这个实现点很值得后续继续收敛命名或行为。

### 9.3 foreground agent 仍然能改很多东西

`skill_manage` 的 schema 写着 existing skills can be modified wherever they live。后台 review prompt 会明确禁止改 bundled 和 hub-installed skills，但工具层本身主要做路径、frontmatter、大小、扫描等校验，并不把所有 protected skill 都硬性只读化。

这符合 Hermes 的“agent 可以维护自己的技能库”的定位，但也说明：如果团队共享 external skill 目录，真正的只读边界最好用文件系统权限或独立 profile/toolset 来做。

### 9.4 自动沉淀不是“每 10 次工具调用创建一个 skill”

`creation_nudge_interval` 只是触发 review 的阈值。review prompt 仍然可以输出 `Nothing to save.`，也可以选择 patch 旧 skill 或写 support file。更准确的理解是：

```text
每累计约 10 次工具迭代，Hermes 安排一次后台复盘。
复盘是否产生新 skill，取决于本轮是否真的出现可复用经验。
```

## 10. 总结

Hermes Agent 的自动沉淀 skill 机制，本质上是把“任务执行”和“经验整理”拆成两个异步阶段：

- 主 agent 专注把用户任务做完。
- background review agent 复盘这次任务，选择更新或创建 skill。
- `skill_manage` 把过程知识写成结构化的 `SKILL.md` 包。
- `.usage.json` 记录来源和活跃度。
- skill index、slash command 和 `skill_view` 让后续任务能重新加载这些经验。
- curator 再用生命周期和 umbrella consolidation 防止 skill 库膨胀。

这个设计比单纯的长期记忆更适合保存“怎么做”。记忆记录用户是谁、环境是什么、偏好是什么；skill 记录某类任务应该怎么执行、有哪些坑、如何验证、哪些脚本和模板可以复用。

我最喜欢它的一点是 provenance 的边界：foreground 用户要求创建的 skill 不会自动进入 curator，而 background review 自己沉淀的 skill 会被标记为 `created_by: agent`。这让“用户资产”和“agent 自我沉淀产物”在同一个文件系统形态下仍然有了生命周期差异。

当然，这套机制也还保留了一些工程张力，特别是 `skill_manage(delete)` 的真实删除语义和 curator prompt 的归档语义之间并不完全一致。但整体上，它已经把 Agent 的“经验复用”从一句 prompt，推进成了一套可追踪、可恢复、可整理的工程闭环。
