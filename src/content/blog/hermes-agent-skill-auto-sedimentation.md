---
title: "Hermes Agent 怎么把一次任务变成 Skill"
description: "用几张图讲清楚 Hermes Agent 的自动沉淀 Skill：什么时候触发、后台怎么复盘、写到哪里、下次怎么复用。"
date: "2026-06-05"
tags: ["Hermes Agent", "AI Agent", "Skills", "Memory"]
draft: false
featured: false
readingTime: 12
---

## 先别看源码，先看这张图

![Hermes Agent 自动沉淀 Skill 总览](/images/hermes-skill-loop/loop-overview.svg)

一句话版：

**Hermes 不是每次任务结束都立刻写一个 Skill。它是先把用户的任务做完，然后后台开一个复盘线程，看看这次有没有值得保存的经验。**

如果有，它会优先更新已有 Skill；没有合适的旧 Skill，才会新建一个。新建之后，这个 Skill 会出现在下次对话的 Skill 索引里，也能通过 `/skill-name` 或 `skill_view` 被再次加载。

这篇基于本地 `hermes-agent` 仓库 `main@ff5652d0f`。下面不按源码顺序讲，按“它到底怎么学会下次少踩坑”来讲。

## 这件事里有三个角色

先把角色分清楚，不然后面会绕。

| 角色 | 它做什么 | 类比 |
| --- | --- | --- |
| 主对话 Agent | 正常处理用户任务 | 当前正在干活的人 |
| Background Review Fork | 任务结束后复盘这次过程 | 事后写复盘的人 |
| Curator | 定期整理 Skill 库 | 整理文档库的人 |

主对话 Agent 不应该一边干活一边整理长期经验。那样会拖慢用户任务，也容易把临时问题写成长期规则。所以 Hermes 的处理方式是：**先交付，再复盘**。

## 什么时候会触发自动复盘

Hermes 有个计数器，大概意思是：

```text
这个 session 里，距离上次写 Skill 后，又跑了多少轮工具调用？
```

默认阈值是 `10`，配置名是：

```yaml
skills:
  creation_nudge_interval: 10
```

这里的“10”不是“调用了 10 个工具”，更接近“经历了 10 次工具调用迭代”。任务越复杂，越容易到这个阈值。

触发条件大概是这样：

```text
主回复已经生成
任务没有被用户中断
skill_manage 这个工具可用
工具迭代次数到阈值
```

所以它不是“一问一答后就自动沉淀”。简单问题通常不会触发；复杂任务、调试任务、反复试错的任务，更容易触发。

还有一个细节：如果主对话过程中模型已经主动用了 `skill_manage`，计数器会清零。意思是“这轮已经沉淀过了，不用再安排一次后台复盘”。

## 后台复盘怎么跑

![后台 review fork 工作方式](/images/hermes-skill-loop/review-fork.svg)

后台复盘不是把主 Agent 原地暂停，然后让它想半天。Hermes 会新开一个 review fork。

这个 fork 会继承父 Agent 的一些东西：

- 当前模型和 provider
- base_url / api_key / api_mode
- 父 Agent 的 toolset 配置
- 父 Agent 已经缓存好的 system prompt
- 当前 session id

这么做有两个好处。

第一，复盘用的是同一套运行环境，不用重新猜 provider 或 API key。

第二，能尽量复用 prompt cache。尤其在 Anthropic、OpenRouter 这类 provider 上，系统提示和工具 schema 变化会影响缓存命中。Hermes 为了省成本，会尽量让 review fork 的请求长得像主对话请求。

但这会带来一个问题：如果 review fork 继承了完整工具 schema，它岂不是也能乱用 `terminal`、`web_search`、`delegate_task`？

Hermes 的做法是：**schema 可以继承，真正执行前用白名单挡住。**

review fork 实际只允许：

```text
memory
skills_list
skill_view
skill_manage
```

其他工具会被 runtime whitelist 拒绝。也就是说，后台复盘不能顺手去跑 shell、查网页、发消息、派子任务。它只能做两件事：写记忆，改 Skill。

## 它复盘时在问什么

后台复盘收到的 prompt，不是“请总结一下刚才发生了什么”。它更具体，大概在逼模型回答这几个问题：

1. 用户有没有纠正你的风格、格式、步骤或工作方式？
2. 这次有没有发现一个以后还会用到的技巧、修复方法、调试路径？
3. 本轮用过的 Skill 有没有缺步骤、错命令、过期内容？
4. 如果要保存经验，应该改旧 Skill，还是新建 Skill？

最关键的是第 4 点。Hermes 不希望 Skill 库里到处都是“一次任务一个 Skill”。所以它给 review fork 定了一个优先级：

```text
1. 先 patch 本轮加载过的 Skill
2. 再找已有的 umbrella Skill patch
3. 再给已有 Skill 增加 references/templates/scripts
4. 最后才创建新的 class-level umbrella Skill
```

这句话翻译成人话就是：

**能补旧文档，就别新建文档；能挂到一个大类下面，就别为今天这个小问题单开一页。**

比如本轮调试的是某个 GitHub PR 的 CI 问题。好的 Skill 名不应该是：

```text
fix-pr-1234-ci-timeout
```

更可能应该是：

```text
github-ci-debugging
```

或者直接 patch 已经存在的 `github-pr-workflow`、`github-code-review` 这类大类 Skill。

## Skill 到底写到哪里

Hermes 的 Skill 本质上是一组文件。最小结构是：

```text
~/.hermes/skills/
└── my-skill/
    └── SKILL.md
```

复杂一点可以这样：

```text
~/.hermes/skills/
└── github-ci-debugging/
    ├── SKILL.md
    ├── references/
    │   └── flaky-runbook.md
    ├── templates/
    │   └── pr-checklist.md
    └── scripts/
        └── collect-ci-logs.py
```

`SKILL.md` 是主说明，必须有 frontmatter：

```md
---
name: github-ci-debugging
description: Debug GitHub CI failures and flaky workflow runs.
---

# GitHub CI Debugging

...
```

`skill_manage` 这个工具负责写这些文件。它支持这些动作：

| action | 解释 |
| --- | --- |
| `create` | 新建一个 Skill |
| `patch` | 改 `SKILL.md` 或支持文件里的一小段 |
| `edit` | 整个重写 `SKILL.md` |
| `write_file` | 增加 `references/`、`templates/`、`scripts/`、`assets/` 下的文件 |
| `remove_file` | 删除支持文件 |
| `delete` | 删除 Skill |

新建 Skill 时会做一堆检查，比如名字是否合法、frontmatter 是否完整、有没有重名、文件是否太大。写文件用的是 atomic replace，避免写一半崩掉。

## 这里有个很重要的区别

![foreground create 与 background review create 的区别](/images/hermes-skill-loop/provenance.svg)

同样是 `skill_manage(action="create")`，如果来源不同，后果不同。

### 情况一：用户让前台 Agent 创建

比如你在对话里说：

```text
帮我把这个流程保存成一个 Skill
```

前台 Agent 调 `skill_manage(create)`，Skill 会写进 `~/.hermes/skills/`，但不会自动标记：

```json
{
  "created_by": "agent"
}
```

这更像是“用户明确让它写的资产”。Hermes 不会默认把它交给 Curator 自动整理。

### 情况二：后台复盘自己创建

如果是 background review fork 觉得“这次经验值得沉淀”，然后自己调用 `skill_manage(create)`，它会在 `.usage.json` 里标记：

```json
{
  "created_by": "agent"
}
```

这个标记很关键。后面的 Curator 就靠它判断：哪些 Skill 是自动沉淀出来的，哪些 Skill 可以纳入自动整理范围。

实现上，Hermes 用了一个 `ContextVar` 保存当前写入来源。普通对话默认是 foreground；background review fork 会把来源设成 `background_review`。`skill_manage` 成功创建后会检查来源，只有 background review 创建的 Skill 才会被 `mark_agent_created`。

这点比很多“自动记忆”系统更克制。它没有把所有写进 Skill 目录的东西都当成自动沉淀产物。

## 下次怎么用这些 Skill

沉淀出来不代表有用。关键是下次能不能找到。

Hermes 有三种重新找到 Skill 的方式。

### 1. 系统提示里的 Skill 索引

`agent/prompt_builder.py` 会扫描 Skill 目录，只把每个 Skill 的名字和描述放进系统提示。这样 token 开销比较小。

模型看到类似这样的索引：

```text
github:
  - github-pr-workflow: ...
  - github-code-review: ...
  - github-ci-debugging: ...
```

如果某个 Skill 和当前任务相关，系统提示会要求模型先调用 `skill_view(name)` 加载完整内容。

### 2. `/skill-name` 命令

`agent/skill_commands.py` 会把 Skill 变成 slash command。

比如：

```text
/github-ci-debugging 帮我看这个失败的 workflow
```

这时 Hermes 会把 Skill 内容注入成一条用户消息。它没有塞进 system prompt，这样对 prompt cache 更友好。

### 3. `skills_list` 和 `skill_view`

模型也可以主动：

```text
skills_list()
skill_view(name="github-ci-debugging")
```

`skill_view` 成功后，还会更新 `.usage.json` 里的 `view_count` 和 `use_count`。这很重要，因为 Curator 后面会用这些数据判断一个 Skill 是活跃还是长期没人用。

## Skill 多了怎么办：Curator 出场

![Curator 生命周期](/images/hermes-skill-loop/curator-lifecycle.svg)

自动沉淀有个副作用：写多了会乱。

如果每次复杂任务都留下一个 Skill，过一段时间后，Skill 库里可能全是类似这样的名字：

```text
fix-gateway-timeout
debug-gateway-timeout-again
gateway-timeout-may-issue
gateway-timeout-final-fix
```

这对模型没帮助。模型看 Skill 列表时会被噪声干扰，用户也很难知道该用哪个。

所以 Hermes 有 Curator。

Curator 默认配置大概是：

```yaml
curator:
  enabled: true
  interval_hours: 168
  min_idle_hours: 2
  stale_after_days: 30
  archive_after_days: 90
  backup:
    enabled: true
    keep: 5
```

它不是一直后台跑的 daemon，而是在两个时机顺手检查：

- CLI 启动时
- Gateway 的 ticker 里

如果距离上次运行超过 7 天，并且 Agent 已经空闲足够久，就跑一次。

Curator 做两类事情。

### 第一类：不用 LLM 的状态转换

它会看 `.usage.json` 里的活跃度。

```text
active
  -> 30 天没用，标成 stale
  -> 90 天没用，移动到 ~/.hermes/skills/.archive/
```

注意是归档，不是直接删掉。归档后的 Skill 可以恢复。

如果某个 Skill 被 pin 了，Curator 会跳过它：

```bash
hermes curator pin <skill>
hermes curator unpin <skill>
```

### 第二类：用 LLM 做合并整理

Curator 还会开一个单独的 review agent，让它看当前候选 Skill。

它的目标不是简单删东西，而是做“合并同类项”：

- 多个窄 Skill 能不能合到一个 umbrella Skill？
- 某个 Skill 是不是应该降级成 `references/` 里的说明？
- 某个模板是不是应该放到 `templates/`？
- 某个可重复脚本是不是应该放到 `scripts/`？

比如这几个：

```text
github-ci-timeout
github-ci-artifact-missing
github-ci-rerun-flaky-tests
```

更好的整理方式可能是：

```text
github-ci-debugging/
├── SKILL.md
└── references/
    ├── timeout.md
    ├── artifact-missing.md
    └── flaky-tests.md
```

这就是 Hermes 里经常提到的 umbrella。不是每个小问题都单开一个 Skill，而是把同一类问题放到同一个更大的 Skill 下面。

## 几个容易误会的点

### 误会一：自动沉淀等于自动新建 Skill

不是。

自动复盘更多时候应该是 patch 旧 Skill。新建是最后选择。

### 误会二：10 次工具调用后一定会保存东西

也不是。

10 次只是触发 review。review fork 仍然可以说 `Nothing to save.`。

### 误会三：所有本地 Skill 都会被 Curator 整理

看当前源码实现，不是所有本地 Skill 都会自动进入 Curator 候选。

真正会被当作自动沉淀产物的，是 `.usage.json` 里带有：

```json
{
  "created_by": "agent"
}
```

的 Skill。

这通常来自 background review fork 创建的 Skill。用户在前台明确让 Agent 写的 Skill，不会自动带这个标记。

### 误会四：Curator 的删除就是安全归档

这里要小心。

确定性的自动归档走的是 `archive_skill()`，会移动到 `.archive/`。

但 `skill_manage(action="delete")` 这个工具本身在代码里是真删除目录。Curator prompt 里会要求归档、要求传 `absorbed_into`、真实运行前也会做 backup，这些都在兜底。

所以如果你要自己维护重要 Skill，最好直接 pin：

```bash
hermes curator pin my-important-skill
```

## 对照源码看哪里

想继续看源码，可以按这个顺序读：

| 文件 | 先看什么 |
| --- | --- |
| `agent/conversation_loop.py` | 主任务结束后如何触发 `_spawn_background_review` |
| `agent/background_review.py` | review fork 怎么建、prompt 怎么写、工具白名单怎么限制 |
| `tools/skill_manager_tool.py` | `skill_manage` 怎么 create / patch / write_file |
| `tools/skill_provenance.py` | foreground 和 background review 的来源区分 |
| `tools/skill_usage.py` | `.usage.json`、`created_by`、use/view/patch 计数 |
| `agent/prompt_builder.py` | Skill index 怎么进系统提示 |
| `agent/skill_commands.py` | `/skill-name` 怎么加载 Skill |
| `agent/curator.py` | stale、archive、umbrella 合并怎么跑 |

## 最后用一句话收尾

Hermes 的 Skill 自动沉淀，可以理解成：

```text
复杂任务结束后，后台复盘一次；
能修旧 Skill 就修旧 Skill；
确实没有合适的大类，才新建一个；
新建后打上来源标记；
以后被索引、加载、复用；
长期不用或重复的，再由 Curator 整理。
```

它想解决的不是“让 Agent 记住更多东西”，而是“让 Agent 少重复踩同一类坑”。这两件事差别很大。前者容易变成一堆长期噪声；后者才是真正有用的过程记忆。
