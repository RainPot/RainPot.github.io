---
title: "Codex Memory 实现拆解：不是向量库，而是一套本地异步整理系统"
description: "基于 OpenAI Codex 官方 Memories 文档和 openai/codex 源码，系统拆解 Codex Memory 的读写链路：本地 memory store、阶段一 rollout extraction、阶段二 consolidation agent、memory_summary 注入、MEMORY.md 检索、/memories 控制、Chronicle 以及工程边界。"
date: "2026-07-21"
tags: ["Codex", "Agent Memory", "Coding Agent", "源码拆解", "AI Agent"]
draft: false
featured: false
readingTime: 17
---

> 参考资料：
> - 官方文档：[Memories](https://learn.chatgpt.com/codex/customization/memories)
> - 官方文档：[Configuration Reference](https://learn.chatgpt.com/codex/config-file/config-reference)
> - 源码版本：[openai/codex](https://github.com/openai/codex) `b9800de4867e500a92add3cde795cf4790306d0f`
>
> 一句话结论：**Codex Memory 不是“把历史对话丢进向量库，下次 top-k 检索”这么简单。它更像一个本地异步整理系统：先把合格的历史会话抽成 raw memory，再由一个受限的内部 consolidation agent 把它们整理成 markdown 工作区；新会话启动时只把压缩后的 `memory_summary.md` 注入 developer instructions，细节则通过 `MEMORY.md`、`skills/` 和 `rollout_summaries/` 渐进读取。**

Agent Memory 经常被讲成一个很抽象的能力：记住用户偏好、项目习惯、历史踩坑，下次自动复用。真落到 coding agent 里，问题会变得具体得多：记忆什么时候写？写什么？谁来合并？怎么防止把工具输出里的 prompt injection 记成规则？怎么避免每次启动都塞进一大坨历史上下文？怎么清理过期记忆？

Codex 的实现给了一个比较工程化的答案。它没有把 Memory 设计成“模型每轮随手写几条事实”，而是拆成三条链路：

1. **静态规则层**：`AGENTS.md` 或项目文档，适合团队必须遵守的稳定规则；
2. **自动生成层**：本地 `~/.codex/memories/`，由后台管线从历史会话中提炼；
3. **显式更新层**：用户明确要求“记住/忘记/更新”时，写入 ad-hoc note，由后续 consolidation 纳入正式记忆。

这篇文章主要看第二层，也就是 Codex local memories 的实现。

## 1. Memory 在 Codex 里首先是本地状态，不是云端黑盒

官方文档说得很直接：本地 Codex clients 使用单独的 local memory store；ChatGPT Web 使用 ChatGPT memory；Work mode 使用账户和 workspace 的 memory 设置，不使用本地 Codex memory store。对 CLI 和 IDE extension 来说，memory 默认在 Codex home 目录下，通常是：

```text
~/.codex/memories/
```

`CODEX_HOME` 可以改变这个位置。文档还强调：这些文件是 generated state，可以排查问题时查看，但不应该把手动编辑当作主要控制面。

源码里，这个本地 store 大致分成两部分：

```text
~/.codex/
├── memories/
│   ├── memory_summary.md
│   ├── MEMORY.md
│   ├── raw_memories.md
│   ├── rollout_summaries/
│   ├── skills/
│   └── extensions/ad_hoc/notes/
└── state DB / rollout logs / config.toml ...
```

其中 `memory_summary.md` 是每次新会话最先接触到的“压缩索引”；`MEMORY.md` 是可搜索的长期手册；`raw_memories.md` 和 `rollout_summaries/` 更像 consolidation 的中间证据；`skills/` 用来沉淀可复用流程；`extensions/ad_hoc/notes/` 承接用户显式要求的记忆更新。

这套设计有个重要取舍：Codex 不把所有记忆都直接塞进上下文，而是让 `memory_summary.md` 当路由层，把细节留在文件系统里按需读取。

## 2. 开关分两层：能不能写、能不能读

官方文档提到两个常用配置：

```toml
[features]
memories = true

[memories]
generate_memories = true
use_memories = true
```

源码里的默认有效配置更细一些。`codex-rs/config/src/types.rs` 里 `MemoriesConfig` 的默认值包括：

```rust
generate_memories: true,
use_memories: true,
dedicated_tools: false,
max_raw_memories_for_consolidation: 256,
max_unused_days: 30,
max_rollout_age_days: 10,
max_rollouts_per_startup: 2,
min_rollout_idle_hours: 6,
min_rate_limit_remaining_percent: 25,
```

这里容易混淆的是：文档说 local memories 默认关闭，指的是功能 flag 和产品设置层面；一旦 feature 打开，`[memories]` 里的读写默认就是 enabled。

`generate_memories` 和 `use_memories` 是两个独立开关：

- `generate_memories = false`：新线程在 state DB 里会被标成 memory disabled，不进入后续自动抽取；
- `use_memories = false`：不把 memory 读路径的 developer instructions 注入当前会话。

这给了几个实际模式：

- 只读：不继续学习新会话，但仍使用已有记忆；
- 只写：让会话成为未来记忆输入，但当前不受旧记忆影响；
- 全关：用于敏感会话、外部上下文污染风险高的会话，或排查 memory 误导。

还有一个关键配置是：

```toml
[memories]
disable_on_external_context = true
```

源码注释里把它描述为：外部上下文源会把线程 `memory_mode` 标成 `polluted`。测试覆盖了 web search 和 MCP call：如果这个开关打开，使用外部上下文后，该线程会被标记为 polluted。这个设计很实际，因为网页、MCP 返回、第三方文档都可能包含 prompt injection 或一次性噪声，不一定适合被自动沉淀成长期记忆。

## 3. 写入链路：启动时后台跑，两阶段处理历史会话

Codex 的自动 memory 写入不是在每个对话结束时同步发生。官方文档说，Codex 会跳过 active 或 short-lived sessions，等待会话 idle 足够久，再在后台更新。源码里入口在 `codex-rs/memories/write/src/start.rs`：

```rust
pub fn start_memories_startup_task(...) {
    if config.ephemeral
        || !config.features.enabled(Feature::MemoryTool)
        || source.is_non_root_agent()
    {
        return;
    }

    tokio::spawn(async move {
        phase1::prune(context.as_ref(), &config).await;

        if !guard::rate_limits_ok(&auth_manager, &config).await {
            return;
        }

        phase1::run(...).await;
        phase2::run(...).await;
    });
}
```

也就是说，memory 管线在 root session 启动时异步触发；ephemeral session、sub-agent session、feature 未启用、state DB 不可用都会跳过。它还会先看 rate limit，默认要求剩余比例至少 25%，避免后台整理记忆抢占前台额度。

在拆 Phase 1 / Phase 2 的细节之前，先用一张图把整条链路串起来，再配一个具体例子对照着看，会比单独读代码片段更容易建立直觉：

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="Codex Memory 写入链路：从新会话启动的资格检查，到 Phase 1 单会话抽取、Phase 2 全局合并的完整两阶段流程" src="/images/codex-memory-implementation/codex-memory-write-pipeline.drawio.png" style="width: 760px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">基于 codex-rs/memories/write 源码整理。Phase 1 面向单个 rollout、可并发抽取；Phase 2 面向全局 memory workspace，必须加锁串行；只有 git baseline diff 显示工作区有变化，才会启动受限的 consolidation agent。</p>
</div>

举个例子：假设你周一上午跟 Codex 聊了一个会话（记作会话 A），期间讨论了项目的测试命令、代码风格偏好这类信息，聊完之后你没有立刻关终端，但也没再输入新内容——会话 A 进入 idle 状态。写入链路不会因为会话 A 结束就马上处理它，因为它随时可能被你重新唤醒继续聊。真正触发处理的时机，是**下一次有新会话启动**：比如周二早上你开了一个新的 root session（记作会话 B）。

会话 B 一启动，`start_memories_startup_task` 就在后台异步触发（对应图中①），依次做三件事：

1. 先判断会话 B 本身有没有资格触发这条链路：如果它是 ephemeral、是 sub-agent（不是 root session）、或者 `Feature::MemoryTool` 没开，直接跳过，什么都不做；
2. 通过资格检查后还要看 rate limit：默认要求剩余额度至少 25%，账号额度紧张时宁可这次不整理，也不占前台交互的配额；
3. 两项检查都通过，才真正 spawn 一个后台任务，依次跑 `phase1::prune`（清理过期/失效候选，异步执行、不阻塞会话 B 当前的对话）、`phase1::run`、`phase2::run`。

注意这里**被处理的对象是会话 A**（那个已经 idle 足够久的历史会话），**触发者是会话 B 的启动动作**。这种“新会话启动，顺带整理旧会话”的关系，是理解整条写入链路的关键：它不是跟随当前对话实时更新的系统，而是由“新会话启动”这个事件驱动、批量处理历史积压的后台管线。

### Phase 1：把单个历史会话抽成 raw memory（对应图中②）

Phase 1 的对象是历史 rollout，也就是会话 A 这样的记录。它会从 state DB 里挑选最近、已 idle、允许来源、memory mode enabled、尚未处理或需要更新的会话。继续看会话 A：它要进入这一批候选，得同时满足下面这些默认参数：

- 每次启动最多 claim 2 个 rollout（如果周一你还聊了另外三个会话，这次最多处理 2 个，剩下的等下次新会话启动再排队）；
- 只看 10 天内的 rollout；
- rollout 至少 idle 6 小时（会话 A 从周一上午聊完到周二早上，显然早就超过 6 小时）；
- failed job 有 lease、retry 和 backoff；
- 抽取时并发执行，但有固定并发上限。

会话 A 一旦被选中，Phase 1 会先做一次输入过滤：序列化会话内容时过滤掉 developer message，也排除被标记的 `AGENTS.md instructions` 和 `<skill>...</skill>` 片段。原因很直接——这些东西本来就是运行时注入进对话的上下文，不应该被再次学习成“用户偏好”或“项目事实”，否则记忆会自我放大，越滚越像自己在给自己下指令。

过滤后的会话文本交给抽取模型，核心输出是严格 JSON schema：

```rust
struct StageOneOutput {
    raw_memory: String,
    rollout_summary: String,
    rollout_slug: Option<String>,
}
```

Phase 1 prompt 明确要求“证据驱动、不要编造、不要存 secret、没有高信号就输出空字段”——如果会话 A 里其实没什么值得记的内容，模型应该老实交白卷，而不是硬凑一条记忆出来。源码还会对 `raw_memory`、`rollout_summary`、`rollout_slug` 三个字段做 secret redaction。

Phase 1 成功后，结果不直接写 `MEMORY.md`，而是进 SQLite 表 `stage1_outputs`：

```sql
CREATE TABLE stage1_outputs (
    thread_id TEXT PRIMARY KEY,
    source_updated_at INTEGER NOT NULL,
    raw_memory TEXT NOT NULL,
    rollout_summary TEXT NOT NULL,
    rollout_slug TEXT,
    generated_at INTEGER NOT NULL,
    usage_count INTEGER,
    last_usage INTEGER,
    selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
    selected_for_phase2_source_updated_at INTEGER
);
```

这张表是 Codex Memory 的“候选记忆池”。会话 A 抽取出来的 raw memory 此刻只是池子里的一行记录，还没有资格进最终的 `MEMORY.md`——它要不要被真正采纳，取决于后面 Phase 2 的排序。这张表也保留了后续有没有被使用、最近何时被使用、是否被选入最近一次 Phase 2 baseline，这些字段会在下一节读取链路里被反过来更新。

### Phase 2：把候选记忆合并成本地 markdown 工作区（对应图中③）

Phase 1 结束后，`stage1_outputs` 里可能已经积累了几十上百条来自不同历史会话的候选记忆，光有这些散装记录还不能直接给新会话用——需要有人把它们合并、去重、控制总量，变成一份可以被稳定读取的文件。这就是 Phase 2 要做的事。

它先拿一个单例锁：`memory_consolidate_global`，避免多个 Codex 进程同时改 `~/.codex/memories/`。拿到锁之后，按下面规则从 `stage1_outputs` 里选 top-N：

1. `raw_memory` 或 `rollout_summary` 非空；
2. 如果曾经被引用，`last_usage` 必须在 `max_unused_days`（默认 30 天）窗口内；
3. 如果从未被引用，就看 `source_updated_at` 是否还新；
4. 排序优先级是 `usage_count DESC`，再看 `last_usage/source_updated_at` 新旧；
5. 默认最多 256 条，硬上限 4096。

也就是说，会话 A 这条记忆能不能被选中，不只看它新不新，还看它有没有被实际用过、用得多不多。这是一个会在下一节闭环的机制：读取链路里的 `<oai-mem-citation>` 标记，最终会更新这里的 `usage_count`/`last_usage`，反过来影响它在下一轮 Phase 2 里的排名。

选出来后，Phase 2 会把 DB 里的输入同步成文件：`raw_memories.md`（合并后的 raw memory）、`rollout_summaries/<slug>.md`（每个历史会话的 recap），并删除不再被选中的旧 rollout summary。

同步完文件后，Phase 2 用一个很有意思的办法判断“到底有没有实质变化”：把 `~/.codex/memories/` 当成一个 git baseline 工作区，生成 `phase2_workspace_diff.md`，内容是从上次成功 baseline 到这次同步后的 git diff。**只有工作区真的发生了变化，才会启动内部 consolidation agent**——如果这次选出来的 top-N 跟上次几乎一样（比如你周二只新增了会话 A 一条无关紧要的记忆，diff 很小甚至没有实质变化），就直接跳过，省下一次模型调用。

真正启动时，这个 consolidation agent 运行在受限环境里：

- `cwd` 被设为 memory root；
- `ephemeral = true`，防止它自己的会话再次进入 memory（不然就成了“记忆整理过程本身被记成了记忆”的死循环）；
- `generate_memories = false`，`use_memories = false`；
- MCP、Apps、Plugins、Collab 都关闭；
- approvals 设为 never；
- managed sandbox 下只允许写 memory root，没有网络。

它的任务是把 `raw_memories.md`、`rollout_summaries/` 和 diff 整理成正式输出：`MEMORY.md`、`memory_summary.md`、`skills/*`。完成后，Codex 校验 `MEMORY.md` 存在，并且 `memory_summary.md` 第一行必须是 `v1`。通过后重置 git baseline，并把本次选中的 stage1 snapshots 标成 `selected_for_phase2 = 1`。

这套流程的关键不是“用了一个模型总结历史”，而是把总结变成了一个有锁、有重试、有 baseline、有 diff、有沙箱的本地整理管线。到这一步，会话 A 里那次关于测试命令和代码风格偏好的讨论，才真正沉淀进了 `MEMORY.md`，等着被后面某次新会话读到。

## 4. 读取链路：先注入 summary，再按需搜索细节

写入链路把历史会话变成了文件，读取链路要解决的是相反的问题：新会话启动时，怎么把这些文件用起来，又不至于每次都把一大堆历史塞进上下文。读路径由 `codex-rs/ext/memories` 这个 extension 贡献。先看整体流程图，再接着用会话 B 的例子走一遍：

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="Codex Memory 读取链路：会话启动时注入 memory_summary，按需检索走 quick memory pass，再通过 citation 反馈回 Phase 2 排序" src="/images/codex-memory-implementation/codex-memory-read-path.drawio.png" style="width: 760px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">基于 codex-rs/ext/memories 源码整理。recall 依赖 MEMORY.md / rollout_summaries 的关键词搜索，不是向量语义检索；引用记忆会打 &lt;oai-mem-citation&gt; 标记，用来更新 usage_count / last_usage，进而影响下一轮 Phase 2 的 top-N 排序（对应图 1 的 Phase 2 环节）。</p>
</div>

延续上一节的例子：周二早上会话 B 启动时（对应图中①），如果 `Feature::MemoryTool` 启用且 `memories.use_memories = true`，Codex 会先读取 `~/.codex/memories/memory_summary.md`，然后把它渲染进 developer instructions。源码里有一个 token cap：`MEMORY_TOOL_DEVELOPER_INSTRUCTIONS_SUMMARY_TOKEN_LIMIT = 2500`，超出会直接截断。这一步跟会话 B 具体聊什么无关——不管你打算问什么，这份压缩摘要都会先被注入进去，相当于给这次对话预装一个“目录”。

注入模板的核心意思是：

- `memory_summary.md` 已经提供，不要再打开一次；
- `MEMORY.md` 是 searchable registry；
- `skills/<skill-name>/` 是可复用流程；
- `rollout_summaries/` 是证据和历史 recap；
- 当任务可能依赖历史上下文、项目习惯、用户偏好时，先做一个 quick memory pass；
- quick pass 尽量控制在 4-6 个搜索步骤内；
- 如果用了 memory，最终回答要附 `<oai-mem-citation>`，供程序解析和 usage 统计。

接着往下看图中②：假设你在会话 B 里问了一句“我们上次约定的测试命令是什么”。这类问题依赖历史上下文，所以 Codex 会走 quick memory pass，而不是直接凭空回答。这一步默认靠普通 shell/search/read 能力去翻文件——grep 一下 `MEMORY.md`，或者打开对应的 `rollout_summaries/<slug>.md` 确认细节。如果配置里打开了：

```toml
[memories]
dedicated_tools = true
```

Codex 还会暴露 dedicated memory tools：`memories/search`、`memories/read`、`memories/list`、`memories/add_ad_hoc_note`。其中 `search` 是 substring search，不是 embedding search；`read` 按相对路径和行号读取；`add_ad_hoc_note` 只在用户明确要求记住、忘记或更新时使用。不管走哪条路径，目标都是同一个：在 4-6 步以内翻到关于测试命令的那条记忆，拼出一个有依据的回答。

如果这次检索确实用上了会话 A 沉淀的记忆，回答里就会带上 `<oai-mem-citation>` 标记（对应图中③）。这个标记不是给你看的——它会触发对 `stage1_outputs` 里那条记录的 `usage_count`/`last_usage` 更新，也就是上一节提到的“会话 A 有没有被用过”。这里正好接回 Phase 2 的排序逻辑：会话 A 这次被引用了一次，`usage_count` 加一，`last_usage` 刷新，等到下一次新会话触发 Phase 2 重新选 top-N 时，它会比那些从没被用过的候选记忆更靠前，也更不容易被 30 天未用规则淘汰。反过来，如果这条题目跟历史无关（比如你只是让 Codex 写一段全新逻辑），判定不需要检索，就直接用 summary 回答，也不会触发这条反馈——读取本身不产生新记忆，会话 B 要成为未来的输入，还得等它自己 idle 够久，被下一次新会话触发的 Phase 1 认领。

所以 Codex native memory 的 recall 路径更像“压缩索引 + grep/read 细节”，而不是“embedding top-k 自动拼上下文”。好处是可解释、可审计、成本低；坏处也明显：同义改写、跨主题模糊匹配、不知道关键词时的召回，都会弱于语义检索。

## 5. `/memories` 控制的是当前 chat，不是全局配置

官方文档提到，ChatGPT desktop app 和 Codex TUI 里可以用 `/memories` 控制当前 chat 的 memory 行为。这个控制点和全局配置不是一回事：

- 全局配置决定 feature 是否可用、默认读写策略、模型和阈值；
- `/memories` 决定当前 chat 是否使用已有 memories、是否作为未来 memory 输入。

这点对真实工作很重要。比如你临时处理一个包含客户隐私、生产事故日志、外部网页污染内容的任务，不一定要改全局配置，可以在当前会话层禁用或限制 memory。

源码里线程的 memory mode 会落在 state DB 的 thread metadata 上。Phase 1 只处理 `memory_mode = 'enabled'` 的线程；如果线程被标成 disabled 或 polluted，后续就不会被当成正常记忆来源。

## 6. Chronicle 是另一路输入：用屏幕上下文帮 Codex 建记忆

官方文档里还有一个相关功能：Chronicle。它是 ChatGPT desktop app 的 macOS research preview，面向 Pro 用户，依赖 Screen Recording 和 Accessibility 权限。

Chronicle 的定位不是替代 local memories，而是给 memory building 增加“最近屏幕上下文”。当用户 prompt Codex 时，Chronicle 可以帮助 Codex理解你最近看过什么、用什么工具、在哪个工作流里。文档也很明确地提示了风险：

- 会更快消耗 rate limit；
- 增加 prompt injection 风险；
- memory 未加密地存储在本机；
- 如果屏幕上有恶意网页或第三方内容，可能污染后续记忆。

模型选择上，Chronicle 使用和 Memories 相同的模型配置；如果要指定便宜模型，可以配置：

```toml
[memories]
consolidation_model = "gpt-5.4-mini"
```

从架构上看，Chronicle 让 Codex 的 memory 来源从“历史对话”扩展到“近期工作现场”。这对减少用户复述很有帮助，但它也把隐私和污染问题放大了。对企业或敏感项目来说，Chronicle 应该被当成高权限采集器，而不是一个普通增强开关。

## 7. 这套实现最值得借鉴的地方

Codex Memory 最值得学的不是某个 prompt，而是几个工程判断。

第一，**把 memory 写入放到后台，不阻塞前台交互。** 自动总结和合并都可能耗 token、耗时间、失败或重试。Codex 选择 startup background task，而不是每轮对话都同步更新，避免把用户当前任务拖慢。

第二，**分离“抽取”和“合并”。** Phase 1 面向单个 rollout，适合并发；Phase 2 面向全局 memory workspace，必须串行、有锁、有 baseline。这比“每次直接 append 到一个 memory 文件”稳得多。

第三，**memory 是文件工作区，不只是数据库记录。** `MEMORY.md`、`memory_summary.md`、`skills/`、`rollout_summaries/` 让人可以检查、备份、迁移和排障；git baseline diff 又让自动整理有了明确增量。

第四，**读路径强调 progressive disclosure。** 先给 2500 token 左右的 summary，再让 agent 按需搜 `MEMORY.md` 和 rollout summaries。这样避免一上来把历史全塞进上下文，也让“为什么用了某条记忆”更容易追踪。

第五，**污染控制被放进数据模型。** `disable_on_external_context`、`polluted` thread、secret redaction、过滤 developer/skill/AGENTS 注入片段，这些都说明 Codex 没把历史上下文默认当成干净训练数据。

## 8. 边界也很清楚：它不是完美长期记忆

Codex 当前 memory 方案也有明显边界。

首先，它主要是**本地生成状态**。CLI 和 IDE extension 共享 connected Codex host 的 local memory store，但这不等于天然跨机器同步。换机器、换容器、换 `CODEX_HOME`，就可能看不到同一套记忆。

其次，它不是语义向量检索。native recall 更依赖 `memory_summary.md` 路由和 `MEMORY.md` 关键词搜索。对工程记忆来说，这种方式很可控；但如果用户只用模糊说法提问，或者旧记忆换了表达方式，召回能力会受限。

第三，自动 consolidation 有后台成本和一致性复杂度。GitHub issue 里已经有人报告过 Windows 上 stage1 成功但 global consolidation 没产出 summary artifact、并发 consolidation 可能因为 `LIMIT/OFFSET` 选择导致跳过或重复候选等问题。这类问题不一定代表设计方向错，但说明 memory 一旦从 demo 进入真实产品，就会变成一套需要事务、锁、重试、可观测性的后台系统。

第四，memory 不应该替代团队规则。官方文档也提醒：必须总是生效的团队 guidance 应该放在 `AGENTS.md` 或 checked-in docs 里。Memory 是 recall layer，不是 policy source of truth。

## 9. 对 coding agent / GUI agent 的启发

如果把 Codex Memory 放到更宽的 agent 工程里看，它其实在回答一个通用问题：长期记忆到底应该长什么样？

我的理解是，至少要分四层：

1. **硬规则层**：团队规范、权限边界、测试命令、禁止事项，应该进 repo 文档或 policy；
2. **路由摘要层**：短、密、可注入，告诉 agent 记忆里有什么；
3. **可搜索手册层**：稳定事实、用户偏好、项目踩坑、工作流；
4. **证据层**：历史会话、工具输出摘要、复现证据，按需打开。

Codex 的 `memory_summary.md` / `MEMORY.md` / `rollout_summaries/` 正好对应后三层。

对 GUIAgent 或 APP 自动化测试平台也一样。真正有用的 memory 不只是“用户喜欢中文回复”，还包括：某个 App 的登录流程、权限弹窗处理、测试环境账号约束、哪些动作绝不能自动执行、哪些页面容易误判、上次失败的具体截图/控件/状态转移。这里更不能简单依赖向量库 top-k，因为错误记忆可能直接变成错误动作。

更稳的做法是借鉴 Codex：

- 让 agent 执行链路和 memory 整理链路解耦；
- 把高风险外部上下文标成 polluted，不自动学习；
- 用 summary 做路由，用 handbook 做可搜索事实，用 rollout evidence 做追溯；
- 对“用户显式要求记住”的内容走单独入口，而不是等后台模型猜；
- 对 memory 使用本身做 citation 和 usage tracking，反过来影响后续保留和淘汰。

Memory 不是越多越好。好的 agent memory 更像一个小而准的工程知识库：知道什么时候该用，知道从哪里找，知道哪些东西已经过期，也知道哪些规则不能靠“想起来”才执行。

## 10. 小结

Codex Memory 的实现可以概括成一句话：**本地文件工作区 + SQLite job state + 两阶段异步整理 + summary 注入 + 按需搜索细节。**

它没有追求最炫的 RAG 形态，而是优先解决 coding agent 真正会遇到的问题：不阻塞交互、不污染长期记忆、可排查、可清理、有配置、有作用域、有用户控制。

如果你在做自己的 coding agent、GUI agent 或移动端自动化 agent，Codex 这套实现最值得抄的不是目录名，而是这个判断：memory 不是一个“存储插件”，而是一条独立的数据生产线。它需要准入、抽取、合并、索引、引用、淘汰和污染控制。少了其中任何一环，长期记忆都会很快从“帮你省上下文”变成“帮你制造幻觉”。
