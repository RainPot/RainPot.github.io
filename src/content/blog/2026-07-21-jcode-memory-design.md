---
title: "jcode 源码拆解：Coding Agent 的 Memory 不该只是一个向量库"
description: "固定到 1jehuang/jcode 的 ccf6153 commit，拆解 jcode 如何把 Memory 做成异步旁路：项目/全局图存储、hybrid retrieval、LLM listwise rerank、pending memory 注入、增量抽取与图维护。"
date: "2026-07-21"
tags: ["Coding Agent", "Agent Memory", "源码拆解", "RAG", "Rust"]
draft: false
featured: true
readingTime: 20
---

Coding Agent 里的 Memory 很容易被做成一个"高级剪贴板"：把对话总结成几条事实，塞进向量库，下次相似查询再取出来。这条路能很快跑通 demo，但到了真实编码任务，会遇到几个硬问题：记忆是不是和当前任务真相关？会不会在每轮都塞进一堆噪声？新记忆和旧记忆冲突怎么办？长期会不会越存越乱？最关键的是，Memory 检索如果挡在主请求前面，TUI 的响应速度会不会被拖垮？

[jcode](https://github.com/1jehuang/jcode) 对这个问题的处理比较有意思。它不是把 Memory 简化成"embedding search + top-k prompt injection"，而是把 Memory 做成一个**异步旁路系统**：主 Agent 每轮只消费上一轮已经算好的 pending memory；当前轮上下文被送到后台 `MemoryAgent`，由它做检索、LLM 裁决、去重和图维护，结果留给下一轮使用。

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

为了不让下面这些机制停留在名词层面，后文会反复用同一个场景来对照：假设你在用 jcode 维护一个 Rust 项目，最近几次会话都在处理这个项目的 auth middleware（认证中间件）——你提到过"不要动登录态相关代码"这类偏好，也提到过项目的测试命令，后来这个测试命令还从 `cargo test` 改成了 `cargo nextest run`。这条主线会贯穿写入、存储、召回、裁决、注入几个环节，方便把抽象的字段和阈值对应到"具体会发生什么"。

## 1. 先看核心判断：Memory 被放在主循环之外

jcode 的 README 说它面向 multi-session workflows 和性能。这个定位会直接影响 Memory 设计：如果每轮用户输入都要先同步做 embedding、BM25、LLM relevance judge、再拼 prompt，那么 Memory 越"聪明"，交互越慢。jcode 的解法是反过来：**Memory 不阻塞当前请求。**

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

拿轮次编号对照会更直观：假设你已经和 jcode 聊到了第 5 轮（turn N），这一轮实际注入的 pending memory，其实是后台在第 4 轮（turn N-1）结束时就算好的结果——不是现算的。与此同时，第 5 轮你刚说的内容（比如又补充了一句 auth middleware 的新细节）会被送去后台，为第 6 轮（turn N+1）准备。也就是说，你现在看到的记忆，永远是"上一轮算好的答案"，不是"这一轮现算的答案"——这是这个设计明确接受的一轮延迟。

换来的好处是主 Agent 不需要等 Memory。对 Coding Agent 来说，这个取舍很现实：多数跨会话记忆不是"必须当前毫秒可用"的硬依赖，而是类似人的背景知识——想起来很好，没想起来也不能卡住手头动作。

这里还有一个容易被忽略的细节：只有 fresh user turn 才会消费 pending memory、发送新的 context。举个例子，如果第 N 轮里 Agent 连续调用了三次工具（读文件、跑测试、再读一次文件），期间你没有再输入新内容，这三次工具调用都不算"新的一轮"，不会触发新的 embedding 计算或新的后台请求；只有你重新开口说话，才会被当成一次 fresh user turn，触发"取上一轮 pending + 为下一轮准备"这套流程。这个设计能避免"每个 tool result 都让 Memory 系统忙一次"的浪费。

## 2. Memory 的存储不是一张表，而是 project/global 两套图

jcode 的 `MemoryManager` 有两个存储范围：

- **project memory**：按当前工作目录 hash 到 `~/.jcode/memory/projects/<hash>.json`；
- **global memory**：用户级 `~/.jcode/memory/global.json`。

这点比很多 Agent 记忆实现更工程化。Coding Agent 的记忆天然有作用域：回到前面的例子，"这个项目的测试命令是 cargo nextest run"只对当前 repo 有意义，应该落进 project memory；如果你还说过"回复先给结论，再展开证据"这种跨项目都成立的偏好，就应该落进 global memory——哪怕你换到另一个仓库，这条偏好依然找得到。反过来，"某个 bug 的根因在这个 repo 的某个模块"这类结论，也不应该跑去污染另一个项目。

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

几个字段很关键，用前面的例子对应着看会更清楚：

- `category`：`fact / preference / entity / correction / custom`。"测试命令是 cargo nextest run" 是 fact；"不要动登录态相关代码" 是 preference；如果它纠正了此前一个错误的假设，就会是 correction；
- `trust`：high / medium / low，标记这条记忆的可信程度；
- `strength` 和 `reinforcements`：同一件事被反复验证时，不是叠出好几条几乎一样的记录，而是同一条记忆的强度往上涨——比如你在三次不同会话里都确认过测试命令是 `cargo nextest run`，这条记忆会被强化三次，而不是变成三条内容雷同的记录；
- `active` 和 `superseded_by`：旧记忆可以被新记忆替代——测试命令从 `cargo test` 改成 `cargo nextest run` 之后，旧记录不会被直接删掉，而是被标记为"已被取代"，仍然留着演化痕迹；
- `confidence`：会随时间、命中、拒绝而涨跌，不是写入时就一锤定音；
- `embedding_model`：记录这条记忆的向量来自哪个模型，避免不同 embedding 空间的向量被直接拿来算 cosine 相似度。

这说明 jcode 的 Memory 更像一个会老化、会强化、会失效的知识状态，而不是 append-only 的文本列表。

![jcode Memory 存储模型：MemoryManager 按 working_dir 区分 project graph，同时保留 global graph；MemoryEntry、TagEntry、ClusterEntry 和多种边共同组成 JSON MemoryGraph](/images/jcode-memory-design/storage-graph-model.png)

## 3. Graph 设计：标签、关系、冲突和聚类都进了存储层

这里说的"图"不是给人看的可视化图表，而是一种组织记忆之间关系的方式：每条记忆是图上的一个节点，节点之间用有类型、有权重的边连起来，用来表示"这两条记忆之间是什么关系"。

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

这个设计解决的是"记忆之间的关系"问题。单条 memory 很容易失真，因为它脱离上下文后只剩一句话。图结构至少保留了几类关系：

- 这个记忆属于哪些 tag；
- 哪些记忆经常一起被召回；
- 哪条新记忆替代了旧记忆；
- 哪两条记忆互相矛盾；
- 哪些记忆是同一次抽取中共同产生的。

真正做检索扩展的是 `cascade_retrieve()`，可以拆成三步看：

1. 先用 embedding 检索出几条最相似的记忆，作为起点（seed）；
2. 从这些起点出发，沿着图上的边做小范围 BFS 扩展，把和它们有关系（同 tag、同 cluster、`RelatesTo` 等）的记忆也一并带出来；
3. 不同边的权重不一样：`HasTag` 是 0.8，说明"同标签"是比较值得沿着走的关系；`Contradicts` 只有 0.3，说明"互相矛盾"带来的关联性很弱，扩展时优先级更低。`RelatesTo` 自带一个权重字段，权重是多少由建边时的场景决定。

也就是说，它不是简单地"相似就取"，而是允许一条本身和查询不那么相似、但和已命中记忆同 tag、同关系的内容被顺带带出来。回到前面的例子：如果这一轮任务提到了"auth middleware"，向量检索可能只精确命中一条"不要动登录态相关代码"的偏好；但图遍历可以顺着 tag 或 `RelatesTo` 关系，把"这个项目的 auth 测试需要 mock cookie"或者"测试命令改成了 cargo nextest run"这类字面上不那么像、但确实相关的记忆也一起带出来。这类召回很难只靠单条 embedding 相似度做到。

不过也要注意边界：图关系的质量取决于后续维护是否靠谱。如果所有 co-relevant 的记忆都无差别地加 `RelatesTo` 边，图很快会变成"什么都相关"，检索反而失去区分度。jcode 在后面加了 confidence decay、gap logging、cluster refinement 和低置信度 pruning（第 9 节会展开），正是为了控制这个风险。

## 4. 写入：手动 memory tool + 自动抽取，两条路并存

jcode 里写 Memory 有两条路。

第一条是显式工具：`crates/jcode-app-core/src/tool/memory.rs` 暴露了 `memory` tool，支持：

```text
remember / recall / search / list / forget / tag / link / related
```

`remember` 默认写 project scope，也可以写 global scope。这里有一个很实用的修复注释：`MemoryTool::scoped_manager()` 会从 `ToolContext.working_dir` 里构造带项目目录的 `MemoryManager`，否则 project writes 会 silently no-op。这个注释说明 jcode 的 Memory 不是纯库设计，它踩过真实工具调用里的坑：Agent-facing tool 如果不知道当前 workdir，项目级记忆就没有落点，会悄悄写失败却不报错。

第二条是自动抽取，不需要你专门开口要求。拿测试命令的例子来说：如果你是专门调用 `memory remember` 工具说"记住，测试命令改成了 cargo nextest run"，走的就是第一条手动路径，会立刻写入；但如果你只是在正常聊天里顺嘴提了一句，没有特意要求记住，就要靠自动抽取在合适的时机把它捞出来。`MemoryAgent` 会在两个时机触发自动抽取：

- **topic change**：当前上下文 embedding 和上一上下文的相似度低于 `TOPIC_CHANGE_THRESHOLD = 0.3`，也就是话题明显切换的时候；
- **periodic extraction**：同一话题持续太久，每 `PERIODIC_EXTRACTION_INTERVAL = 12` turns 抽一次，避免一个长话题一直不落盘。

此外 session 结束也会触发一次 final extraction。抽取由 `Sidecar::extract_memories_with_existing()` 完成，它要求模型按固定格式输出：

```text
CATEGORY|CONTENT|TRUST
```

并且 prompt 里明确禁止抽取：

- 临时调试细节；
- 具体 commit hash、git push 之类历史；
- 行级代码改动；
- 系统 prompt 已经有的自明项；
- 已知记忆的重复表达。

这套规则很像一个"记忆写入闸门"：它不是把每次完成的任务都写进长期记忆，而是先问一句——几周后另一个话题里，开发者还会不会受益？这个判断很重要。Coding Agent 的工作流会产生大量中间状态，如果都进 Memory，后面检索再强也会被垃圾淹没。

![jcode Memory 写入与维护生命周期：手动 memory tool 和自动抽取进入 sidecar extraction；写入决策处理去重、强化和冲突，后续图维护再影响未来召回](/images/jcode-memory-design/write-maintenance-lifecycle.png)

## 5. 去重、强化和冲突：Memory 不是只增不改

写入路径不是简单的"不存在就新建"，而是叠了三层判断。继续用测试命令的例子走一遍：第一次会话里你说"这个项目用 cargo test"，几周后的另一次会话里，测试命令变成了"cargo nextest run"。

**第一层：存储层去重，相似度超过 0.85 就 reinforce，不新建。** `MemoryManager::remember_project()` 和 `remember_global()` 在写入前会先生成 embedding，然后在当前 store 和另一个 store 里找相似度超过 `STORAGE_DEDUP_THRESHOLD = 0.85` 的已有记忆。如果找到了，不会新增一条记录，而是对旧记忆调用 `reinforce()`。举例来说：如果你在两次对话里几乎用同样的话又说了一遍"这个项目用 cargo test"，第二次不会变成一条新记录，而是给第一条记忆做一次强化——这正好对应第 2 节提到的 `strength`/`reinforcements` 字段。

**第二层：抽取前先给 sidecar 看"已知列表"，减少重复表达。** `extract_memories_with_existing()` 会把最多 80 条已有记忆放进系统提示里，让模型在抽取新内容时，不要把已经记录过的事情换个说法再抽一遍。

**第三层：相似度落在 0.5～0.90 之间时，专门做一次冲突检测。** 这是最关键、也最容易看漏的一层：如果新内容和旧内容相似度超过 0.90，会直接按第一层处理，判定成同一句话的重复；但如果相似度只落在 0.5 到 0.90 之间——比如新旧两条记忆都在说"测试命令是什么"，但具体内容已经不一样了（`cargo test` 变成了 `cargo nextest run`）——系统会专门调用 `sidecar.check_contradiction()`，让模型判断这到底是"同一件事的另一种说法"还是"内容真的变了、构成矛盾"。一旦判断为冲突，会：

- 新建一条记忆（"测试命令是 cargo nextest run"）；
- 给新旧两条记忆之间打上 `Contradicts` 边；
- 旧记忆调用 `supersede(new_id)`，标记为被取代，并把 `active` 置为 `false`。

注意旧记忆并没有被物理删除，只是不再作为 `active` 记忆参与后续检索的默认展示——这比"直接覆盖旧值"要稳。工程知识经常不是静态事实：测试命令改了、项目依赖换了、用户偏好变了、某个模块从旧路径迁移到了新路径。直接删掉旧记忆会丢失演化证据；全都保留 `active` 又会让检索结果新旧混杂、互相打架。`Supersedes + Contradicts + active=false` 是一个比较清楚的折中：既保留了历史，又不让过期信息干扰当前判断。

## 6. 检索：dense + BM25 + RRF，先召回，再让 LLM 裁决

jcode 的 live retrieval 没有只用 embedding。`MemoryManager::find_similar_hybrid()` 明确写着：

> Hybrid retrieval: fuse dense (embedding cosine) and sparse (BM25 over memory search text) rankings with Reciprocal Rank Fusion.

原因也写在注释里：identifier、path、term-heavy memories 对 Coding Agent 很常见，lexical signal 很重要。比如：

- 文件路径 `crates/jcode-base/src/memory_agent.rs`；
- 工具名 `memory_recall_bench`；
- 配置项 `agents.memory_rerank_cadence`；
- 错误字符串、feature flag、crate name。

这些东西向量相似度未必强，但 BM25 这种基于关键词匹配的检索方式会很敏感。回到 auth middleware 的例子：如果你问"我们上次说 auth 测试要怎么处理 cookie"，这句话里 `auth`、`mock cookie` 这类词，BM25 能精确命中；即使这句话和记忆库里那条记录在 embedding 语义相似度上没有特别高，混合检索也不会把它漏掉。

jcode 先分别做 dense ranking 和 BM25 ranking，再用 RRF（Reciprocal Rank Fusion，一种不需要对齐分数量纲、只看排名位置来融合多路排序结果的方法）把两条排序合并。这里还有一个防坑设计：只有 `entry.effective_embedding_model() == active_model` 的记忆才参与 dense cosine 计算。不同 embedding backend 产生的向量并不在同一个向量空间里，不能硬算相似度；但这些记忆并不会因此消失——它们仍然可以通过 BM25 进入候选池，只是不参与向量这一路的打分。

这点很工程。很多 Agent memory 实现会在 embedding model 切换后出现"旧记忆突然检索质量变差"的问题。jcode 没有假装 vector space 可兼容，而是把 dense 和 lexical 分开处理，各走各的路，再融合。

![jcode Memory 召回与裁决路径：Context Builder 生成 focused query，dense search 与 BM25 先拉候选，RRF 融合后交给 LLM consensus rerank，最后写入 PendingMemory](/images/jcode-memory-design/retrieval-rerank-pipeline.png)

## 7. LLM 不是负责"找"，而是负责"裁决"

jcode 的 Memory 有一个 sidecar LLM。它不是主 Agent，也不走完整 Agent SDK，而是一个轻量的 completion client，专门用来做记忆相关的小任务。`Sidecar::auto_select_backend()` 的优先级大致是：

1. Codex/OpenAI 凭据可用时，用 OpenAI sidecar；
2. Claude 凭据可用时，用 Claude Haiku；
3. 否则走当前 live provider；
4. 没有可用 LLM 时，按配置决定进入 dormancy（休眠、暂停 Memory 功能）或显式启用 no-sidecar fallback（一条更简单、精度更低的路径）。

Memory 的主路径默认依赖 LLM 做精度判断：`memory_sidecar_enabled()` 默认是 `true`；如果用户希望完全不用 LLM、走纯 hybrid 检索路径，需要显式关闭。也就是说，当 sidecar 模式开着、但当前又没有可用的 LLM backend 时，系统不会悄悄退化成一条低精度路径糊弄过去，而是让 Memory 直接 dormant（暂停生效）。

这个选择乍看有点保守，但我认为对 Coding Agent 是对的。因为 Memory 注入的成本不只是 token，还是行为污染：一条不相关的"记忆"可能让 agent 改错文件、沿用旧假设，或者忽略当前证据去相信一条过时的记忆。jcode 的注释也反复强调：LLM judge 是唯一被允许把 memory 摆到主 Agent 面前的机制；judge 失败时，绝不能把未经审核的 hybrid 排序结果直接塞进去。

具体来说，`memory_agent.rs` 里的主路径是一次 listwise rerank（把候选列表整体交给模型排序、筛选，而不是逐条打分）：

- hybrid retrieval 先拉出一批候选；
- `format_focused_query_for_relevance()` 从当前上下文里抽出更短的"当前意图"，去掉 tool noise 和 system-reminder 这类干扰信息；
- `memory_rerank::rerank_candidates_consensus_attributed()` 用 sidecar 对候选列表整体做排序和过滤；
- 最终只保留被 judge 认为"clearly useful"的记忆，最多 `MAX_MEMORIES_PER_TURN = 5` 条。

在解读 `memory_rerank.rs` 里那段注释给出的数字之前，先说清楚两个指标的意思：**recall@5** 衡量的是，在所有真正相关的记忆里，最终呈现的前 5 条覆盖了其中的多少比例——这个数字越高，说明"该出现的记忆有没有被漏掉"；**precision@5** 衡量的是反过来，呈现出来的前 5 条里，有多少条是真的有用的，而不是凑数占位——这个数字越高，说明"塞给模型的记忆有没有掺水"。

带着这两个定义再看注释里的数字：

- hybrid pool 能拿到约 99% relevant memories，但排序很差；
- 如果直接拿 hybrid 排序的 top-5 用，recall@5 大约只有 0.53；
- 经过 listwise LLM reranker 之后，recall@5 能提到 0.75，precision@5 从 0.23 提到 0.35；
- 如果用两个 judge 做 consensus（都同意才算数），precision 能接近 1.0，但代价是要多花一次 LLM call。

这些数字不一定能外推到所有用户，但它说明 jcode 的设计不是拍脑袋："召回阶段本来就该覆盖得广一点、准确率低一点没关系，因为后面有 judge 兜底；judge 阶段才是决定最终精度的地方。"

## 8. PendingMemory：真正的注入点其实是一段短生命周期缓存

`crates/jcode-base/src/memory/pending.rs` 是理解 jcode Memory 体验的关键。后台 `MemoryAgent` 找到结果后，不会直接改当前 prompt，而是写入一个结构体：

```rust
pub struct PendingMemory {
    pub prompt: String,
    pub display_prompt: Option<String>,
    pub computed_at: Instant,
    pub count: usize,
    pub memory_ids: Vec<String>,
}
```

这个 pending 结果不是"算出来就一直有效、随时能用"，它身上叠了好几层保鲜期和去重规则。继续用 auth middleware 的例子，把一个真实会话的时间线走一遍：

1. **`is_fresh()`，120 秒过期。** 假设后台在第 4 轮结束时算好了一份关于 auth middleware 的 pending memory，准备给第 5 轮用。如果你隔了很久（超过 120 秒）才发出第 5 轮消息，这份结果会被判定为"不新鲜了"，直接丢弃——宁可这一轮没有记忆，也不用过期的内容开场；
2. **prompt 签名 90 秒内重复抑制。** 如果连续几轮算出来的记忆内容几乎一样（比如反复都是那几条 auth middleware 笔记），90 秒内不会把同样的内容再展示一遍；
3. **memory-id 集合 180 秒内高度重叠抑制。** 即便这次的措辞和上次不完全一样，只要背后引用的其实是同一批记忆 id，180 秒内同样会被压下来；
4. **单条记忆 45 分钟 TTL。** 一条记忆一旦在这个会话里展示过，45 分钟内即使它又被检索命中，也不会重复展示——避免长会话里同一条笔记反复刷屏；
5. **`mark_memories_known()` 防止自己喂自己。** 如果这一轮的自动抽取，正好从当前这段对话里现抽出了一条新记忆（比如你刚讨论完 auth middleware，这段讨论就被抽取成了新记忆），这条记忆会立刻被标记为"已知"，防止它前脚刚被抽出来，后脚又被当成"新发现"重新推给你。

这部分非常值得学。很多 Memory 系统只关心 recall 质量，却忽视"召回结果具体要怎么进入对话"这件事。jcode 把注入本身当成一个独立的生命周期来管理：pending、freshness、去重、known ids、display rendering、session record，缺一环都会导致体验变差——要么记忆经常"迟到失效"，要么同样的内容在长会话里反复刷屏。

注入内容的格式也很克制。`format_relevant_prompt()` 最终变成：

```text
# Memory

## Corrections
1. ...

## Facts
1. ...

## Preferences
1. ...
```

它没有把元数据、分数、图边一股脑塞给模型。对主 Agent 来说，Memory 只是一段简短的动态系统提示；真正的复杂度，都被留在了后台维护系统里。

## 9. 后台维护：召回之后才修图、调置信度、打标签

`MemoryAgent` 在成功或失败检索之后，都会跑一次 `post_retrieval_maintenance()`。这部分完全不在主路径上，不会拖慢当前这一轮，但决定了 Memory 系统能不能长期维持质量。它做的事情大致可以分成三类。

**第一类，置信度调节**——因为一条记忆的可信度不该是写入时就一锤定音，而应该跟着实际使用效果涨跌：

- 被验证为 relevant 的记忆，`boost_confidence(0.05)`，置信度往上调；
- 被拒绝的记忆，`decay_confidence(0.02)`，置信度往下调；
- 每 250 次左右维护，会把足够老、又长期低置信度的记忆 prune 掉——这是防止图长期越滚越大的关键动作。

**第二类，图关系维护**——因为记忆之间的关系不应该只在写入那一刻确定，用得越多，关系应该越清楚：

- 对同一轮里共同被验证为 relevant 的记忆，建立 `RelatesTo` 边；
- 每 50 次左右维护，做一次 cluster refinement（聚类微调）；
- 如果多条 verified 记忆之间没有共同的 tag，会尝试从当前上下文里推断一个 tag 补上。

**第三类，缺口记录**——用来帮后续排查"是召回没做好，还是这类信息压根没存过"：

- 如果某一轮候选很多，但没有一条被判定为 relevant，就记录一次 memory gap。

这里还有一个很小但很真实的性能注释：置信度更新会一次性 load/save 整个 project/global graph，而不是每个 id 单独读写一次，因为 graph JSON 文件可能是 multi-MB 级别的。如果一个 Coding Agent 的 Memory 真的长期运行、记忆条数不断增长，这类 IO 细节往往比"算法看起来优不优雅"更能决定它能不能撑住。

## 10. 这套设计最值得借鉴的地方

我觉得 jcode Memory 有四个值得拿走的设计点。

第一，**异步一轮延迟，换主路径稳定**。对交互式 Coding Agent 来说，Memory 不是越实时越好。把检索和裁决放到后台，当前轮用上一轮算好的结果，可以让系统更像"背景里想起了什么"，而不是"每次先停下来查一遍数据库"。

第二，**召回和裁决分工清楚**。Dense、BM25、RRF 负责把候选拉宽、拉全，尽量不漏；LLM listwise rerank 负责在候选里做精细取舍。不要让 embedding 相似度单独承担"这条记忆到底该不该注入"的最终责任——第 7 节的 recall@5/precision@5 数字已经说明，这两件事分开做，效果比只做一件明显更好。

第三，**记忆写入要可撤销、可强化、可衰减**。`strength / confidence / superseded_by / Contradicts / active` 这组字段说明，jcode 不把 Memory 当成永久真理。长期记忆如果不能被修正、不能失效，会比压根没有记忆更危险——它会让 Agent 死守一个早已过时的结论。

第四，**注入本身需要生命周期管理**。freshness、去重、已知标记、TTL、display-only prompt，这些细节看起来琐碎，但决定了 Memory 在真实长会话里到底是"恰到好处地帮了一把"，还是"刷屏式地添乱"。

## 11. 它也有边界：不是所有东西都已经完全闭环

源码里也能看到一些边界，读这套设计时最好一起记住。

第一，文档和实现有一点代际差。`docs/MEMORY_ARCHITECTURE.md` 里还写着 petgraph、HDBSCAN 这类规划式表达，但实际代码已经是 HashMap-based 的 JSON graph，cluster refinement 也更像是基于 co-relevance 的轻量聚类，而不是真正跑了 HDBSCAN。这意味着，如果要基于这份文档做二次开发或者写介绍文章，不能只看文档，要以代码为准。

第二，Memory 质量高度依赖 sidecar LLM 是否可用。jcode 提供了 no-sidecar fallback，但源码注释已经承认，这条 fallback 路径没法真正做到零误伤，precision 也比不上有 LLM judge 兜底的正常路径。换句话说，如果 sidecar 长期不可用，Memory 最好宁可少展示一些，也不要假装这条降级路径和正常路径等价。

第三，图会不会随着长期使用越来越稠密，目前还只能靠真实场景观察。co-relevance 自动建 `RelatesTo` 边很方便，但如果某些热门记忆总是一起被召回，边的数量可能持续增长。jcode 通过 confidence decay、prune 和 cluster refinement 来控制这个趋势，但这类机制最终有没有效，还是要靠长期 telemetry 才能验证，从源码本身还看不出结论。

第四，Memory 抽取仍然是 prompt 约束出来的行为，不是硬性保证。`extract_memories_with_existing()` 里的规则写得不错，但 LLM 仍然可能抽出过度具体、已经过期，或者本不该长期保存的内容。工程上最好继续配合审计 UI、导出、删除、可视化和回归测试集，把"抽取质量"当成一个需要持续观测的指标，而不是一次写好就不用管了。

## 12. 对我们做 Agent Memory 的启发

如果把 jcode 的设计抽象出来，我会把 Coding Agent 的 Memory 分成四层：

| 层 | 责任 | jcode 对应实现 |
| --- | --- | --- |
| 写入层 | 从对话和工具结果里抽取长期有用的信息 | `Sidecar::extract_memories_with_existing`、`memory` tool |
| 存储层 | 表达作用域、生命周期、关系和置信度 | `MemoryEntry`、`MemoryGraph`、project/global JSON |
| 召回层 | 拉出候选，再做精确裁决 | hybrid retrieval、LLM consensus rerank |
| 注入层 | 控制何时、多少、如何进入 prompt | `PendingMemory`、TTL、去重、`# Memory` prompt |

很多系统的问题，是把这四层揉成了一个"向量库查询"：一次 embedding 检索，直接决定了抽取什么、存成什么样、召回哪几条、以什么形式塞进 prompt。jcode 的价值在于把它们拆开了——召回可以粗一点，因为后面有 judge 兜底；judge 可以贵一点，因为它有 cadence 控制，不用每轮都跑；写入可以慢一点，因为不阻塞主路径；图维护可以完全异步，因为它只是让未来的召回更好，不影响当前这一轮。

这也是我对这套 Memory 设计的总体判断：**它不是一个追求"记住更多"的系统，而是一个尽量让记忆少打扰、少误伤、可演化的系统。** 对 Coding Agent 来说，这比"每轮多塞几条相关上下文"更重要。

真正好的 Agent Memory，不应该让模型感觉自己背着一大堆便签走路。它应该更像一个后台工程师：在合适的时候递上少数几条真的有用的上下文，并且清楚旧结论什么时候该退场。jcode 已经把这个方向做得相当清楚。
