---
title: "Hermes Agent 自动沉淀 Skill：从后台复盘到 Curator"
description: "结合源码、prompt 和示意图，拆解 Hermes Agent 如何在复杂任务后复盘、写入 Skill、标记来源，并由 Curator 做二次整理。"
date: "2026-06-05"
tags: ["Hermes Agent", "AI Agent", "Skills", "Memory"]
draft: false
featured: false
readingTime: 16
---

本文介绍 Hermes Agent 的 Skill 自动沉淀机制。

这个机制要解决的问题很具体：Agent 做完一个复杂任务后，怎么把过程中出现的可复用经验，转成下次能被检索、加载和继续改进的 Skill，而不是把所有内容都塞进短期对话或长期记忆里。

Hermes 的做法不是在主任务里边干活边写经验总结，而是把“交付”和“复盘”拆开：主 Agent 先完成用户任务；如果这轮工具调用足够复杂，再 fork 一个后台 review agent，让它只使用 memory 和 skills 相关工具，判断是否需要创建或更新 Skill。

下面会按四个问题展开：

- 什么时候触发后台复盘？
- review fork 为什么能读上下文，却不能乱用工具？
- `skill_manage` 如何写入 Skill，并区分前台创建和后台自动沉淀？
- Skill 越积越多以后，Curator 如何做整理和归档？

文中结论基于本地 `hermes-agent` 仓库 `main@ff5652d0f`，关键位置会直接引用源码或 prompt 摘录。

## 机制总览：一次任务如何变成 Skill

![Hermes Agent 自动沉淀 Skill 总览](/images/hermes-skill-loop/loop-overview.svg)

这张图里最重要的是三段：

| 阶段 | 做什么 | 关键文件 |
| --- | --- | --- |
| 主对话 | 正常完成用户任务，并累计工具迭代数 | `agent/conversation_loop.py`、`agent/codex_runtime.py` |
| 后台复盘 | 新开 review fork，只允许 memory / skills 工具 | `agent/background_review.py` |
| 后续治理 | 记录使用情况，定期整理 agent-created skills | `tools/skill_usage.py`、`agent/curator.py` |

所以它的目标不是“多记一点”，而是把反复会用到的做法写成可复用步骤。这个区别很重要：多记一点很容易变成噪声；可复用步骤才像 Skill。

## 触发器：不是每轮都复盘

先看初始化。Hermes 给 skill review 准备了一个计数器阈值，默认是 `10`：

```python
# agent/agent_init.py
agent._skill_nudge_interval = 10
try:
    skills_config = _agent_cfg.get("skills", {})
    agent._skill_nudge_interval = int(
        skills_config.get("creation_nudge_interval", 10)
    )
except Exception:
    pass
```

这个配置叫 `skills.creation_nudge_interval`。它不是“聊 10 句”，而是工具调用循环跑了多少轮。复杂任务、调试任务、来回试错的任务，更容易把这个计数打上去。

主循环里每轮工具迭代都会加一次：

```python
# agent/conversation_loop.py
# Track tool-calling iterations for skill nudge.
# Counter resets whenever skill_manage is actually used.
if (agent._skill_nudge_interval > 0
        and "skill_manage" in agent.valid_tool_names):
    agent._iters_since_skill += 1
```

等任务结束后，它才检查是否要复盘：

```python
# agent/conversation_loop.py
if (agent._skill_nudge_interval > 0
        and agent._iters_since_skill >= agent._skill_nudge_interval
        and "skill_manage" in agent.valid_tool_names):
    _should_review_skills = True
    agent._iters_since_skill = 0

if final_response and not interrupted and (_should_review_memory or _should_review_skills):
    agent._spawn_background_review(
        messages_snapshot=list(messages),
        review_memory=_should_review_memory,
        review_skills=_should_review_skills,
    )
```

这里有几个结论可以直接读出来：

- 必须有最终回复，用户不能中断。
- `skill_manage` 必须可用，否则不安排 Skill review。
- 触发后计数器清零，避免每轮都重复 review。
- review 是在主回复之后跑，主任务不会被它卡住。

Codex runtime 这条路径也做了同样的事，只是计数来源变成 `turn.tool_iterations`：

```python
# agent/codex_runtime.py
agent._iters_since_skill = (
    getattr(agent, "_iters_since_skill", 0) + turn.tool_iterations
)
```

翻译成人话：Hermes 不是问完一个简单问题就立刻“长记性”。它先看这轮有没有足够多的工具活动，再决定要不要在后台复盘。

## 后台复盘：继承上下文，但工具被拴住

![后台 review fork 工作方式](/images/hermes-skill-loop/review-fork.svg)

触发之后，Hermes 不会让主 Agent 原地停下来复盘。它会新建一个 `review_agent`：

```python
# agent/background_review.py
review_agent = AIAgent(
    model=agent.model,
    max_iterations=16,
    quiet_mode=True,
    provider=agent.provider,
    api_mode=_parent_api_mode,
    parent_session_id=agent.session_id,
    enabled_toolsets=getattr(agent, "enabled_toolsets", None),
    disabled_toolsets=getattr(agent, "disabled_toolsets", None),
    skip_memory=True,
)
review_agent._memory_write_origin = "background_review"
review_agent._memory_nudge_interval = 0
review_agent._skill_nudge_interval = 0
```

这段代码说明两件事。

第一，review fork 尽量继承父 Agent 的运行环境，比如 model、provider、toolset 配置和 session。这样它不需要重新猜 provider，也更接近刚才那次任务的上下文。

第二，它把自己的 memory / skill nudge 都关掉。也就是说，后台复盘不会再触发下一轮后台复盘。这个设计很实在，不然很容易变成“复盘复盘的复盘”。

还有一个细节跟成本有关。review fork 会继承父 Agent 缓存好的 system prompt：

```python
# agent/background_review.py
review_agent._cached_system_prompt = agent._cached_system_prompt
review_agent.session_start = agent.session_start
review_agent.session_id = agent.session_id
```

源码注释里写得很直白：这么做是为了让 Anthropic / OpenRouter 这类 provider 的 prefix cache 更容易命中。也就是说，后台复盘不是完全另起炉灶，它会尽量复用主对话已经暖过的 prompt 前缀。

但继承上下文会带来风险：review fork 会不会顺手跑 terminal、web、delegate 之类的工具？

源码里用白名单挡住：

```python
# agent/background_review.py
review_whitelist = {
    t["function"]["name"]
    for t in get_tool_definitions(
        enabled_toolsets=["memory", "skills"],
        quiet_mode=True,
    )
}
set_thread_tool_whitelist(
    review_whitelist,
    deny_msg_fmt=(
        "Background review denied non-whitelisted tool: "
        "{tool_name}. Only memory/skill tools are allowed."
    ),
)
```

所以后台复盘能做的事很窄：读 Skill、改 Skill、写 memory。它不能借着复盘的名义去跑 shell、查网页、发请求或派子任务。

## 它复盘时到底在问什么

这一段很关键。后台 review 的 prompt 不是“总结一下刚才发生了什么”，而是更像一张检查表。

先看原 prompt 的开头：

```text
# agent/background_review.py
Review the conversation above and update the skill library. Be ACTIVE...

Target shape of the library: CLASS-LEVEL skills, each with a rich
SKILL.md and a `references/` directory...
Not a long flat list of narrow one-session-one-skill entries.
```

这里有两个方向同时存在：

第一，它鼓励主动更新，甚至说“多数 session 至少应该有一次小更新”。这会让模型不那么懒，不会把每次复盘都变成 `Nothing to save.`。

第二，它明确反对“一次任务一个 Skill”。目标形态是 class-level skill，也就是按任务类别沉淀，而不是按当天的 bug、PR 编号、报错字符串建一堆窄 Skill。

prompt 里还列了触发信号。摘几条最有代表性的：

```text
Signals to look for:
  • User corrected your style, tone, format, legibility, or verbosity.
  • User corrected your workflow, approach, or sequence of steps.
  • Non-trivial technique, fix, workaround, debugging path...
  • A skill that got loaded or consulted this session turned out
    to be wrong, missing a step, or outdated.
```

所以它不是只记“技术修复方法”。用户纠正了输出风格、步骤顺序、工作习惯，也被当作 Skill 信号。比如用户说“不要全白话，适当引用原始代码或者 prompt”，这不是单纯的情绪反馈，而是一个会影响“写源码拆解博客”这类任务的工作规范。

更关键的是优先级。原 prompt 写得很明确：

```text
Preference order:
  1. UPDATE A CURRENTLY-LOADED SKILL.
  2. UPDATE AN EXISTING UMBRELLA (via skills_list + skill_view).
  3. ADD A SUPPORT FILE under an existing umbrella.
  4. CREATE A NEW CLASS-LEVEL UMBRELLA SKILL when no existing skill covers the class.
```

这四条决定了自动沉淀的风格。

如果本轮已经加载过某个 Skill，就优先 patch 它。没有加载过，但库里有一个大类 Skill 能覆盖，就 patch 那个 umbrella。再不行，把细节写进 `references/`、`templates/`、`scripts/`。最后才新建新的 class-level umbrella。

所以一个失败的设计是这样：

```text
debug-pr-1234-ci-timeout
fix-today-astro-build
remember-user-angry-about-blog-style
```

更符合 Hermes prompt 的设计是这样：

```text
ci-debugging
astro-blog-writing
repo-blog-writer
```

具体的一次任务细节，可以进这些 Skill 的小节，或者进 `references/`。Skill 名本身应该描述一类任务。

prompt 还专门写了反模式：

```text
Do NOT capture:
  • Environment-dependent failures...
  • Negative claims about tools or features...
  • One-off task narratives...

If a tool failed because of setup state, capture the FIX...
```

这个约束很重要。比如某次 `npm` 因为本机依赖没装失败了，不能沉淀成“npm 不可用”。真正该沉淀的是“遇到这个项目时先安装依赖”或者“这个环境变量要设置”。它要保存修复路径，不保存临时故障本身。

## 写入：skill_manage 是唯一入口

后台 review 真的要改 Skill 时，不会自己写文件，而是调用 `skill_manage`。

这个工具的 schema description 本身就把使用规则写进去了：

```text
# tools/skill_manager_tool.py
Actions: create, patch, edit, delete, write_file, remove_file.

Create when: complex task succeeded (5+ calls), errors overcome,
user-corrected approach worked, non-trivial workflow discovered,
or user asks you to remember a procedure.

After difficult/iterative tasks, offer to save as a skill.
Skip for simple one-offs.
```

这里有个很实用的点：`patch` 是 preferred for fixes，`edit` 是 major overhauls only。也就是说，平时小修应该 patch，不要整篇重写。

最小 Skill 是一个目录加一个 `SKILL.md`：

```text
~/.hermes/skills/
└── repo-blog-writer/
    └── SKILL.md
```

复杂一点可以带支持文件：

```text
~/.hermes/skills/
└── repo-blog-writer/
    ├── SKILL.md
    ├── references/
    │   └── evidence-checklist.md
    ├── templates/
    │   └── blog-outline.md
    └── scripts/
        └── verify-post-links.py
```

`SKILL.md` 是入口，`references/` 放更细的知识，`templates/` 放可复制的模板，`scripts/` 放可重复运行的脚本。background review prompt 也是这么要求的：如果新增了支持文件，umbrella 的 `SKILL.md` 里还要加一行指向它，不然未来 Agent 不知道这个文件存在。

## Provenance：为什么同样 create，后果不一样

![foreground create 与 background review create 的区别](/images/hermes-skill-loop/provenance.svg)

这块很容易误会：只要调用 `skill_manage(action="create")`，就算自动沉淀吗？

答案是否定的。

先看写入成功后的 telemetry 逻辑：

```python
# tools/skill_manager_tool.py
if action == "create":
    if is_background_review():
        mark_agent_created(name)
elif action in {"patch", "edit", "write_file", "remove_file"}:
    bump_patch(name)
elif action == "delete":
    forget(name)
```

只有 `is_background_review()` 为真时，新建 Skill 才会被标记成 agent-created。

这个判断来自 `ContextVar`：

```python
# tools/skill_provenance.py
BACKGROUND_REVIEW = "background_review"

def get_current_write_origin() -> str:
    return _write_origin.get()

def is_background_review() -> bool:
    return get_current_write_origin() == BACKGROUND_REVIEW
```

前面提到过，review fork 创建时会设置：

```python
review_agent._memory_write_origin = "background_review"
review_agent._memory_write_context = "background_review"
```

所以同样是 create，有两种情况：

| 来源 | 是否写入 Skill | 是否标记 `created_by=agent` | Curator 是否默认纳入 |
| --- | --- | --- | --- |
| 用户明确要求前台 Agent 创建 | 是 | 否 | 否 |
| background review fork 自己创建 | 是 | 是 | 是 |

`mark_agent_created` 最后写到 `.usage.json`：

```python
# tools/skill_usage.py
def mark_agent_created(skill_name: str) -> None:
    def _apply(rec: Dict[str, Any]) -> None:
        rec["created_by"] = "agent"
    _mutate(skill_name, _apply, require_curation_eligible=True)
```

这就是 provenance 的意义：Hermes 不把所有本地 Skill 都当成“Agent 自动生成资产”。用户明确创建的 Skill 更像用户资产，默认不交给 Curator 自动整理。

## 下次怎么复用

沉淀完只是第一步。下次能不能被用上，靠三条路径。

第一条是系统提示里的 Skill 索引。`prompt_builder.py` 会把 Skill 名和描述放进 system prompt，并要求模型先加载相关 Skill：

```text
# agent/prompt_builder.py
Before replying, scan the skills below.
If a skill matches or is even partially relevant to your task,
you MUST load it with skill_view(name) and follow its instructions.
```

这段语气很硬：不是“有空可以看”，而是“匹配就必须 load”。这样 Skill 不需要把全文都塞进系统提示，只要先暴露索引，真正相关时再 `skill_view`。

第二条是 slash command。`agent/skill_commands.py` 会把 Skill 变成 `/skill-name` 形式。用户可以直接说：

```text
/repo-blog-writer 帮我把这个仓库机制写成博客
```

这时 Skill 内容会作为用户消息注入，而不是永久塞进 system prompt。对 prompt cache 更友好。

第三条是 telemetry。`skill_view` 成功后会记录 view 和 use：

```python
# tools/skills_tool.py
if resolved:
    from tools.skill_usage import bump_use, bump_view
    bump_view(str(resolved))
    bump_use(str(resolved))
```

`.usage.json` 里会积累 `view_count`、`use_count`、`patch_count`、`last_used_at`、`last_patched_at` 等字段。后面的 Curator 就靠这些信息判断一个 Skill 是活跃、过期，还是可以归档。

## Curator：自动沉淀之后还要整理

![Curator 生命周期](/images/hermes-skill-loop/curator-lifecycle.svg)

如果只会写 Skill，不会整理，最后还是会乱。

Hermes 里 Curator 的职责是整理 agent-created skills。它有两类动作：一类不用 LLM，按使用时间做状态转换；一类用 LLM，看内容能不能合并成 umbrella。

先看自动状态转换：

```python
# agent/curator.py
for row in _u.agent_created_report():
    name = row["name"]
    if row.get("pinned"):
        continue

    if anchor <= archive_cutoff and current != _u.STATE_ARCHIVED:
        ok, _msg = _u.archive_skill(name)
    elif anchor <= stale_cutoff and current == _u.STATE_ACTIVE:
        _u.set_state(name, _u.STATE_STALE)
```

默认配置大致是：

```yaml
interval_hours: 168
min_idle_hours: 2
stale_after_days: 30
archive_after_days: 90
```

也就是每 7 天左右检查一次，空闲足够久才跑。30 天没活动标成 stale，90 天没活动归档。pin 掉的 Skill 会跳过。

归档不是删目录。`archive_skill` 的实现是移动到 `.archive/`：

```python
# tools/skill_usage.py
def archive_skill(skill_name: str) -> Tuple[bool, str]:
    """Move a curator-eligible skill directory to ~/.hermes/skills/.archive/."""
    ...
    skill_dir.rename(dest)
    ...
    set_state(skill_name, STATE_ARCHIVED)
```

再看 LLM curator 的 prompt。它的目标不是“找重复项”，而是做 umbrella-building：

```text
# agent/curator.py
This is an UMBRELLA-BUILDING consolidation pass...

The right target shape is CLASS-LEVEL skills with rich SKILL.md
bodies + `references/`, `templates/`, and `scripts/` subfiles...

Hard rules:
1. DO NOT touch bundled or hub-installed skills.
2. DO NOT delete any skill. Archiving ... is the maximum destructive action.
3. DO NOT touch skills shown as pinned=yes.
```

这和 background review prompt 是同一个方向：不要把 Skill 库变成一堆今天的问题。能合并成大类，就合并成大类；细节放支持文件。

举个例子，如果库里出现：

```text
astro-build-failure
astro-image-path-debugging
astro-content-schema-fix
```

Curator 更希望最后变成：

```text
astro-blog-maintenance/
├── SKILL.md
└── references/
    ├── build-failures.md
    ├── image-paths.md
    └── content-schema.md
```

读起来更少，命中更准，也更容易维护。

## 源码里几个边界

### 1. “agent-created”在报告里有两层意思

`skill_usage.py` 里 `is_agent_created(skill_name)` 的 docstring 写的是“既不是 bundled，也不是 hub-installed”。但 Curator 真正枚举候选时，不只看文件位置，还要求 usage record 显式 opt in：

```python
# tools/skill_usage.py
if not _is_curator_managed_record(usage.get(name)):
    continue

def _is_curator_managed_record(record: Any) -> bool:
    return record.get("created_by") == "agent" or record.get("agent_created") is True
```

所以当前实现比“本地非内置 Skill 都可管”更保守。没有 `created_by=agent` 的本地手写 Skill，不会自动进入 Curator 候选。

### 2. Curator prompt 说 archive，但 skill_manage 的 delete 语义要小心

Curator prompt 里写 `skill_manage action=delete — archive a skill`，但 `skill_manage(action="delete")` 这个工具本身是删除类操作。确定性的 `archive_skill()` 才是移动到 `.archive/`。

所以重要 Skill 最稳的保护方式是 pin：

```bash
hermes curator pin my-important-skill
```

源码里也写了 pinned skill 的保护规则：delete 会被拒绝，但 patch 和 edit 仍然允许。也就是说，pin 是防丢，不是防改。

### 3. 后台复盘是 best-effort

主循环里 `_spawn_background_review` 外面包了 `try/except`：

```python
try:
    agent._spawn_background_review(...)
except Exception:
    pass  # Background review is best-effort
```

这意味着自动沉淀失败不会让用户任务失败。它是“顺手学习”，不是主流程的一部分。这个取舍挺合理：复盘坏了可以以后修，不能因为复盘坏了把用户刚完成的任务也判失败。

## 按源码阅读顺序

如果你要继续读仓库，建议按这个顺序：

| 文件 | 重点 |
| --- | --- |
| `agent/agent_init.py` | `_skill_nudge_interval` 的默认值和配置读取 |
| `agent/conversation_loop.py` | 主循环如何累计 `_iters_since_skill`，任务结束后如何 fork review |
| `agent/codex_runtime.py` | Codex runtime 路径如何用 `turn.tool_iterations` 补同一套逻辑 |
| `agent/background_review.py` | review fork、review prompt、工具白名单、prompt cache 复用 |
| `tools/skill_manager_tool.py` | `skill_manage` 的 action、写入校验、成功后的 telemetry |
| `tools/skill_provenance.py` | foreground 和 background review 的来源区分 |
| `tools/skill_usage.py` | `.usage.json`、`created_by`、view/use/patch 计数、归档 |
| `agent/prompt_builder.py` | Skill 索引如何进 system prompt |
| `agent/skill_commands.py` | `/skill-name` 如何把 Skill 内容注入对话 |
| `agent/curator.py` | stale、archive、umbrella 合并和 dry-run 规则 |

## 最后总结

Hermes 的自动沉淀 Skill 机制可以压缩成这条链路：

```text
复杂任务产生足够多工具迭代
  -> 主回复完成
  -> 后台 review fork 复盘
  -> 优先 patch 旧 Skill
  -> 必要时 create class-level Skill
  -> background_review create 才标记 created_by=agent
  -> 下次通过索引、/skill-name、skill_view 复用
  -> Curator 定期 stale / archive / umbrella 合并
```

我觉得这里最值得借鉴的是两个克制点。

第一，主任务和学习任务分开。用户先拿结果，后台再复盘。

第二，自动沉淀不等于疯狂新建。Prompt 反复强调 class-level、umbrella、references，代码又用 provenance 区分用户资产和自动资产。这样做的目的很明确：让 Skill 库变成可复用的操作手册，而不是一堆任务残留。
