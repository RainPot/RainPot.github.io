---
title: "jcode 源码拆解：Coding Agent 的 Memory 不该只是一个向量库"
description: "固定到 1jehuang/jcode 的 ccf6153 commit，拆解 jcode 如何把 Memory 做成异步旁路：项目/全局图存储、hybrid retrieval、LLM listwise rerank、pending memory 注入、增量抽取与图维护。"
date: "2026-07-21"
tags: ["Coding Agent", "Agent Memory", "源码拆解", "RAG", "Rust"]
draft: false
featured: true
readingTime: 18
---

Coding Agent 里的 Memory 很容易被做成一个“高级剪贴板”：把对话总结成几条事实，塞进向量库，下次相似查询再取出来。这条路能很快跑通 demo，但到了真实编码任务，会遇到几个硬问题：记忆是不是和当前任务真相关？会不会在每轮都塞进一堆噪声？新记忆和旧记忆冲突怎么办？长期会不会越存越乱？最关键的是，Memory 检索如果挡在主请求前面，TUI 的响应速度会不会被拖垮？

[jcode](https://github.com/1jehuang/jcode) 对这个问题的处理比较有意思。它不是把 Memory 简化成“embedding search + top-k prompt injection”，而是把 Memory 做成一个**异步旁路系统**：主 Agent 每轮只消费上一轮已经算好的 pending memory；当前轮上下文被送到后台 `MemoryAgent`，由它做检索、LLM 裁决、去重和图维护，结果留给下一轮使用。

![jcode Memory 非阻塞 turn 链路：当前请求只消费上一轮 pending memory，同时把本轮上下文异步送给 MemoryAgent，为下一轮准备记忆](/images/jcode-memory-design/turn-pending-sequence.png)

本文固定在 [1jehuang/jcode](https://github.com/1jehuang/jcode) 的 commit [`ccf6153`](https://github.com/1jehuang/jcode/commit/ccf6153ebc32c07b42a37a8c2ccc8a5b310b45d9)，仓库版本是 `0.54.4`。我主要读了这些文件：

- `crates/jcode-tui/src/tui/app/turn.rs`
- `crates/jcode-tui/src/tui/app/turn_memory.rs`
- `crates/jcode-base/src/memory.rs`
- `crates/jcode-base/src/memory_agent.rs`
- `crates/jcode-base/src/memory/pending.rs`
- `crates/jcode-base/src/memory_rerank.rs`
- `crates/jcode-base/src/sidecar.rs`
- `crates/jcode-memory-types/src/lib.rs`
- `crates/jcode-memory-types/src/graph.rs`
- `crates/jcode-app-core/src/tool/memory.rs`
- `docs/MEMORY_ARCHITECTURE.md`

本地最小验证有个限制：当前环境没有 `cargo`，所以我没法跑 jcode 自己的 Rust 测试，`cargo test -p jcode-base memory --lib --quiet` 返回的是 `cargo: command not found`。下面的分析来自源码和文档，不把未运行的测试当成证据。文章写完后我会用博客仓库自己的 `npm run build` 做发布验证。

## 1. 先看核心判断：Memory 被放在主循环之外

jcode 的 README 说它面向 multi-session workflows 和性能。这个定位会直接影响 Memory 设计：如果每轮用户输入都要先同步做 embedding、BM25、LLM relevance judge、再拼 prompt，那么 Memory 越“聪明”，交互越慢。jcode 的解法是反过来：**Memory 不阻塞当前请求。**

关键入口在 `crates/jcode-tui/src/tui/app/turn.rs`：

```rust
let memory_pending = self.build_memory_prompt_nonblocking(&provider_messages);
let split_prompt =
    self.build_system_prompt_split(memory_pending.as_ref().map(|p| p.prompt.as_str()));
```

`build_memory_prompt_nonblocking()` 做两件事：

1. 从 `PENDING_MEMORY` 里取出上一轮后台计算好的结果；
2. 把当前 `messages` 和 `working_dir` 发给全局 `MemoryAgent`，让它为下一轮做准备。

源码注释写得很直白：

```rust
// Take pending memory if available (computed in background during last turn)
// Send context to memory agent for the NEXT turn (doesn't block current send)
```

也就是说，jcode 接受一个延迟：Memory 结果通常晚一轮生效。但换来的好处是主 Agent 不需要等 Memory。对 Coding Agent 来说，这个取舍很现实：多数跨会话记忆不是“必须当前毫秒可用”的硬依赖，而是类似人的背景知识——想起来很好，没想起来也不能卡住手头动作。

这里还有一个细节：它只在 fresh user turn 才消费 pending memory 和发送新的 context。工具执行续写、tool result 回来这些中间状态不会反复触发本地 embedding。这个设计能避免“每个 tool result 都让 Memory 系统忙一次”的浪费。

## 2. Memory 的存储不是一张表，而是 project/global 两套图

jcode 的 `MemoryManager` 有两个存储范围：

- **project memory**：按当前工作目录 hash 到 `~/.jcode/memory/projects/<hash>.json`；
- **global memory**：用户级 `~/.jcode/memory/global.json`。

这点比很多 Agent 记忆实现更工程化。Coding Agent 的记忆天然有作用域：

- “这个仓库用 pnpm、测试命令是 X”应该是项目级；
- “用户喜欢先给结论，再展开证据”更像全局偏好；
- “某个 bug 的根因在这个 repo 的某个模块”不应该污染另一个 repo。

`MemoryEntry` 的字段也不是只有 `content + embedding`。在 `crates/jcode-memory-types/src/lib.rs` 里，它包含：

```rust
pub struct MemoryEntry {
    pub id: String,
    pub category: MemoryCategory,
    pub content: String,
    pub tags: Vec<String>,
    pub search_text: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub access_count: u32,
    pub source: Option<String>,
    pub trust: TrustLevel,
    pub strength: u32,
    pub active: bool,
    pub superseded_by: Option<String>,
    pub reinforcements: Vec<Reinforcement>,
    pub embedding: Option<Vec<f32>>,
    pub embedding_model: Option<String>,
    pub confidence: f32,
}
```

几个字段很关键：

- `category`：`fact / preference / entity / correction / custom`；
- `trust`：high / medium / low；
- `strength` 和 `reinforcements`：同一事实反复出现时不是简单重复写入，而是强化；
- `active` 和 `superseded_by`：旧记忆可以被新记忆替代；
- `confidence`：会随时间、命中、拒绝而变化；
- `embedding_model`：记录向量来自哪个模型，避免不同 embedding 空间直接算 cosine。

这说明 jcode 的 Memory 更像一个会老化、会强化、会失效的知识状态，而不是 append-only 的文本列表。

![jcode Memory 存储模型：MemoryManager 按 working_dir 区分 project graph，同时保留 global graph；MemoryEntry、TagEntry、ClusterEntry 和多种边共同组成 JSON MemoryGraph](/images/jcode-memory-design/storage-graph-model.png)

## 3. Graph 设计：标签、关系、冲突和聚类都进了存储层

文档 `docs/MEMORY_ARCHITECTURE.md` 说 Memory 是 graph-based organization。实际代码没有使用文档里早期提到的 petgraph 结构，而是在 `crates/jcode-memory-types/src/graph.rs` 里实现了一个 JSON 友好的 HashMap 图：

```rust
pub struct MemoryGraph {
    pub graph_version: u32,
    pub memories: HashMap<String, MemoryEntry>,
    pub tags: HashMap<String, TagEntry>,
    pub clusters: HashMap<String, ClusterEntry>,
    pub edges: HashMap<String, Vec<Edge>>,
    pub reverse_edges: HashMap<String, Vec<String>>,
    pub metadata: GraphMetadata,
}
```

边类型包括：

```rust
pub enum EdgeKind {
    HasTag,
    InCluster,
    RelatesTo { weight: f32 },
    Supersedes,
    Contradicts,
    DerivedFrom,
}
```

这个设计解决的是“记忆之间的关系”问题。单条 memory 很容易失真，因为它脱离上下文后只剩一句话。图结构至少保留了几类关系：

- 这个记忆属于哪些 tag；
- 哪些记忆经常一起被召回；
- 哪条新记忆替代了旧记忆；
- 哪两条记忆互相矛盾；
- 哪些记忆是同一次抽取中共同产生的。

`cascade_retrieve()` 会从 embedding search 的 seed 出发，通过图边 BFS 扩展相关记忆。边有 traversal weight，例如 `HasTag` 是 0.8，`RelatesTo` 用自己的权重，`Contradicts` 只有 0.3。它不是简单地“相似就取”，而是允许一条直接不相似、但和命中记忆同 tag / 同关系的内容被带出来。

这对 Coding Agent 很重要。比如当前任务提到 “auth middleware”，向量检索可能只命中一条“用户偏好不要改登录态”的记忆，但图遍历可以顺手带出“这个项目的 auth 测试需要 mock cookie”或“上次该模块的失败和 session renewal 有关”。这类召回很难靠单条 embedding 完成。

不过也要注意边界：图关系质量取决于后续维护是否靠谱。如果所有 co-relevant 记忆都加 `RelatesTo`，图很快会变成“什么都相关”。jcode 在后面加了 confidence decay、gap logging、cluster refinement 和低置信度 pruning，正是为了解这个问题。

## 4. 写入：手动 memory tool + 自动抽取，两条路并存

jcode 里写 Memory 有两条路。

第一条是显式工具：`crates/jcode-app-core/src/tool/memory.rs` 暴露了 `memory` tool，支持：

```text
remember / recall / search / list / forget / tag / link / related
```

`remember` 默认写 project scope，也可以写 global scope。这里有一个很实用的修复注释：`MemoryTool::scoped_manager()` 会从 `ToolContext.working_dir` 里构造带项目目录的 `MemoryManager`，否则 project writes 会 silently no-op。这个注释说明 jcode 的 Memory 不是纯库设计，它踩过真实工具调用里的坑：Agent-facing tool 如果不知道当前 workdir，项目级记忆就没有落点。

第二条是自动抽取。`MemoryAgent` 会在两个时机抽取：

- **topic change**：当前上下文 embedding 和上一上下文相似度低于 `TOPIC_CHANGE_THRESHOLD = 0.3`；
- **periodic extraction**：同一话题太长时，每 `PERIODIC_EXTRACTION_INTERVAL = 12` turns 抽一次。

此外 session 结束也会触发 final extraction。抽取由 `Sidecar::extract_memories_with_existing()` 完成。它要求输出：

```text
CATEGORY|CONTENT|TRUST
```

并且 prompt 里明确禁止抽取：

- 临时调试细节；
- 具体 commit hash、git push 之类历史；
- 行级代码改动；
- 系统 prompt 已经有的自明项；
- 已知记忆的重复表达。

这套规则很像一个“记忆写入闸门”。它不是把每次完成的任务都写进长期记忆，而是问：几周后另一个话题里，开发者还会不会受益？这个判断很重要。Coding Agent 的工作流会产生大量中间状态，如果都进 Memory，后面检索再强也会被垃圾淹没。

![jcode Memory 写入与维护生命周期：手动 memory tool 和自动抽取进入 sidecar extraction；写入决策处理去重、强化和冲突，后续图维护再影响未来召回](/images/jcode-memory-design/write-maintenance-lifecycle.png)

## 5. 去重、强化和冲突：Memory 不是只增不改

写入路径里有三层控制。

第一层是存储层去重。`MemoryManager::remember_project()` 和 `remember_global()` 会先生成 embedding，然后在当前 store 和另一个 store 里找相似度超过 `STORAGE_DEDUP_THRESHOLD = 0.85` 的已有记忆。如果找到了，不新增，而是 `reinforce()` 旧记忆。

第二层是抽取前给 sidecar “Already known” 列表。`extract_memories_with_existing()` 会把最多 80 条已有记忆放进系统提示里，让模型不要重复抽取 close paraphrases。

第三层是冲突检测。增量抽取时，如果新记忆没有和旧记忆构成 0.90 以上的 duplicate，它还会找 0.5 以上的相似候选，并调用 `sidecar.check_contradiction()`。如果判断冲突，就：

- 新建 memory；
- 给新旧 memory 加 `Contradicts` 边；
- 旧 memory `supersede(new_id)`，变成 inactive。

这比“覆盖旧值”稳。工程知识经常不是静态事实：测试命令改了、项目依赖换了、用户偏好变了、某个模块从旧路径迁移到了新路径。直接删旧记忆会丢失演化证据；全都保留 active 又会让检索混乱。`Supersedes + Contradicts + active=false` 是比较清楚的折中。

## 6. 检索：dense + BM25 + RRF，先召回，再让 LLM 裁决

jcode 的 live retrieval 没有只用 embedding。`MemoryManager::find_similar_hybrid()` 明确写着：

> Hybrid retrieval: fuse dense (embedding cosine) and sparse (BM25 over memory search text) rankings with Reciprocal Rank Fusion.

原因也写在注释里：identifier、path、term-heavy memories 对 Coding Agent 很常见，lexical signal 很重要。比如：

- 文件路径 `crates/jcode-base/src/memory_agent.rs`；
- 工具名 `memory_recall_bench`；
- 配置项 `agents.memory_rerank_cadence`；
- 错误字符串、feature flag、crate name。

这些东西向量相似度未必强，但 BM25 会很敏感。jcode 先分别做 dense ranking 和 BM25，再用 RRF 融合。这里还有一个防坑设计：只有 `entry.effective_embedding_model() == active_model` 的记忆才参与 dense cosine。不同 embedding backend 产生的向量不在同一空间，不能硬算；但这些记忆不会消失，因为它们还能通过 BM25 进入候选池。

![jcode Memory 召回与裁决路径：Context Builder 生成 focused query，dense search 与 BM25 先拉候选，RRF 融合后交给 LLM consensus rerank，最后写入 PendingMemory](/images/jcode-memory-design/retrieval-rerank-pipeline.png)

这点很工程。很多 Agent memory 实现会在 embedding model 切换后出现“旧记忆突然检索质量变差”的问题。jcode 没有假装 vector space 可兼容，而是把 dense 和 lexical 分开处理。

## 7. LLM 不是负责“找”，而是负责“裁决”

jcode 的 Memory 有一个 sidecar LLM。它不是主 Agent，也不走完整 Agent SDK，而是轻量 completion client。`Sidecar::auto_select_backend()` 的优先级大致是：

1. Codex/OpenAI 凭据可用时，用 OpenAI sidecar；
2. Claude 凭据可用时，用 Claude Haiku；
3. 否则走当前 live provider；
4. 没有可用 LLM 时，按配置决定 dormancy 或显式 no-sidecar fallback。

Memory 的主路径默认依赖 LLM precision judge。`memory_sidecar_enabled()` 默认是 true；如果用户希望无 LLM hybrid path，要显式关闭。否则当 sidecar 模式开着但没有 LLM backend，系统不会悄悄退化到低精度路径，而是让 Memory dormant。

这个选择很有争议，但我认为对 Coding Agent 是对的。因为 Memory 注入的成本不只是 token，还是行为污染：一条不相关的“记忆”可能让 agent 改错文件、沿用旧假设或忽略当前证据。jcode 的注释也反复强调：LLM judge 是唯一允许把 memory 放到主 Agent 面前的东西；judge 失败时不能把 unvetted hybrid order 直接塞进去。

最新主路径在 `memory_agent.rs` 里是 listwise rerank：

- hybrid retrieval 拉出候选；
- `format_focused_query_for_relevance()` 从上下文里抽出更短的当前意图，去掉 tool noise 和 system-reminder；
- `memory_rerank::rerank_candidates_consensus_attributed()` 用 sidecar 对候选列表做排序和过滤；
- 只保留被 judge 认为 clearly useful 的 memory，最多 `MAX_MEMORIES_PER_TURN = 5`。

`memory_rerank.rs` 里有一段很关键的注释：

- hybrid pool 能拿到约 99% relevant memories，但排序差；
- top-5 recall 大约 0.53；
- listwise LLM reranker 能把 recall@5 提到 0.75，precision@5 从 0.23 到 0.35；
- consensus 两个 judge 都同意时，precision 能接近 1.0，但要多花 LLM call。

这些数字不一定能外推到所有用户，但它说明 jcode 的设计不是拍脑袋：它把 Memory 当成一个可回归评测的问题，而不是“感觉召回更智能”。

## 8. PendingMemory：真正的注入点其实是一段短生命周期缓存

`crates/jcode-base/src/memory/pending.rs` 是理解 jcode Memory 体验的关键。后台 MemoryAgent 找到结果后，不直接改当前 prompt，而是写入：

```rust
pub struct PendingMemory {
    pub prompt: String,
    pub display_prompt: Option<String>,
    pub computed_at: Instant,
    pub count: usize,
    pub memory_ids: Vec<String>,
}
```

这个 pending 结果有几个闸门：

- `is_fresh()`：超过 120 秒不用就丢弃；
- prompt signature 90 秒内重复就抑制；
- memory-id set 180 秒内高度重叠也抑制；
- 已注入 memory id 有 45 分钟 TTL，避免同一段记忆在一个长 session 里反复出现；
- 刚由本 session 抽取出来的 memory 会被 `mark_memories_known()` 标记为已知，避免“从这段对话抽出来，又马上注入回这段对话”。

这个部分非常值得学。很多 Memory 系统只关心 recall 质量，却忽视“召回结果如何进入对话”。jcode 把注入当成一个独立生命周期：pending、freshness、dedupe、known ids、display rendering、session record。这样做的好处是，即便后台检索偶尔抖动，也不会每轮都把相同记忆刷屏。

注入内容的格式也很克制：`format_relevant_prompt()` 最终变成：

```text
# Memory

## Corrections
1. ...

## Facts
1. ...

## Preferences
1. ...
```

它没有把元数据、分数、图边一股脑塞给模型。对主 Agent 来说，Memory 是一段简短的动态系统提示；复杂度留在后台维护系统里。

## 9. 后台维护：召回之后才修图、调置信度、打标签

MemoryAgent 在成功或失败检索后，会跑 `post_retrieval_maintenance()`。这部分不在主路径上，任务包括：

1. 对共同被验证 relevant 的 memories 建 `RelatesTo` 边；
2. 对 verified memories `boost_confidence(0.05)`；
3. 对 rejected memories `decay_confidence(0.02)`；
4. 如果候选很多但没有一个 relevant，记录 memory gap；
5. 每 50 次维护尝试 cluster refinement；
6. 多条 verified memory 没有共同 tag 时，从 context 里推一个 tag；
7. 每 250 次左右 prune 低置信度且足够老的 memory。

这里有个很小但很真实的性能注释：confidence 更新会一次 load/save project/global graph，而不是每个 id 都读写一次，因为 graph JSON 可能是 multi-MB。如果一个 Coding Agent 的 Memory 真的长期运行，这类 IO 细节比“算法看起来优雅”更重要。

## 10. 这套设计最值得借鉴的地方

我觉得 jcode Memory 有四个值得拿走的设计点。

第一，**异步一轮延迟换主路径稳定**。对交互式 Coding Agent 来说，Memory 不是越实时越好。把检索和裁决放到后台，当前轮用上一轮结果，可以让系统更像“背景想起”，而不是“每次先查数据库”。

第二，**召回和裁决分工清楚**。Dense、BM25、RRF 负责 recall；LLM listwise rerank 负责 precision。不要让 embedding 承担“是否该注入”的最终责任。

第三，**记忆写入要可撤销、可强化、可衰减**。`strength / confidence / superseded_by / Contradicts / active` 这组字段，说明 jcode 不把 Memory 当成永久真理。长期记忆如果不能失效，会比没有记忆更危险。

第四，**注入本身需要生命周期管理**。freshness、去重、已知标记、TTL、display-only prompt，这些看起来琐碎，但决定了 Memory 在真实长会话里是“有帮助”还是“刷屏”。

## 11. 它也有边界：不是所有东西都已经完全闭环

源码里也能看到一些边界。

第一，文档和实现有一点代际差。`docs/MEMORY_ARCHITECTURE.md` 还写着 petgraph / HDBSCAN 等规划式表达，实际代码已经是 HashMap-based JSON graph，并且 cluster refinement 更像基于 co-relevance 的轻量聚类。写文章或二次开发时不能只看文档，要以代码为准。

第二，Memory 质量高度依赖 sidecar LLM。jcode 有 no-sidecar fallback，但注释已经承认它不能真正做到 0-injection，precision 不如 LLM judge。也就是说，如果没有可用 sidecar，Memory 最好宁可少用，不要假装等价。

第三，图会不会越来越稠密，还要看真实长期使用。co-relevance 自动建边很方便，但如果某些热门记忆总是一起出现，`RelatesTo` 可能越来越多。jcode 通过 confidence decay、prune 和 cluster refinement 控制这个趋势，但这类机制最终还是要靠长期 telemetry 验证。

第四，Memory 抽取仍然是 prompt 约束。`extract_memories_with_existing()` 的规则写得不错，但 LLM 仍可能抽出过度具体、过期或不该长期保存的内容。工程上最好继续配合审计 UI、导出、删除、可视化和回归集。

## 12. 对我们做 Agent Memory 的启发

如果把 jcode 的设计抽象出来，我会把 Coding Agent Memory 分成四层：

| 层 | 责任 | jcode 对应实现 |
| --- | --- | --- |
| 写入层 | 从对话和工具结果里抽取长期有用信息 | `Sidecar::extract_memories_with_existing`、`memory` tool |
| 存储层 | 表达作用域、生命周期、关系和置信度 | `MemoryEntry`、`MemoryGraph`、project/global JSON |
| 召回层 | 拉出候选并做精确裁决 | hybrid retrieval、LLM consensus rerank |
| 注入层 | 控制何时、多少、如何进入 prompt | `PendingMemory`、TTL、dedupe、`# Memory` prompt |

很多系统的问题，是把这四层揉成一个“向量库查询”。jcode 的价值在于把它们拆开了：召回可以粗一点，因为后面有 judge；judge 可以贵一点，因为有 cadence 和 pending；写入可以慢一点，因为不阻塞主路径；图维护可以异步，因为它只是让未来更好。

这也是我对这套 Memory 设计的总体判断：**它不是一个追求“记住更多”的系统，而是一个尽量让记忆少打扰、少误伤、可演化的系统。** 对 Coding Agent 来说，这比“每轮多塞几条相关上下文”更重要。

真正好的 Agent Memory，不应该让模型感觉自己背着一大堆便签。它应该更像一个后台工程师：在合适的时候递上少数几条真的有用的上下文，并且知道旧结论什么时候该退场。jcode 已经把这个方向做得相当清楚。