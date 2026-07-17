---
title: "Persome 源码拆解：屏幕活动如何变成可追溯的 HUMAN.md"
description: "固定到 Intuition-Lab/personal-model 的一个真实 commit，拆解 Persome 如何采集 Mac 活动、按分钟和会话形成状态、用证据门控生成 Point/Line/Face/Volume/Root，再通过 HUMAN.md 与 MCP 交给人和 Agent 使用。"
date: "2026-07-17"
tags: ["AI Agent", "Personal Model", "MCP", "Agent Memory", "源码拆解"]
draft: false
featured: true
readingTime: 22
---

许多 AI 产品把“记忆”做成聊天记录旁的一叠便签：从对话里抽出几条事实，下次再塞回上下文。Persome 选择了另一种形态。它是一个常驻 Mac 的本地 Runtime，持续接收屏幕活动，把短时记录逐层整理成长期模型，最后生成一份人能读的 `HUMAN.md`，也允许受信 Agent 通过 MCP 搜索、核对和纠错。

从源码看，Persome 最值得研究的并不是 Point、Line、Face、Volume、Root 这五个名词，而是它如何约束推断：LLM 负责语义判断，代码负责时间边界、水位、身份、证据、重试和降级。每次抽象都可以出错，但错误不该悄悄变成“系统已经知道的事实”。

本文固定在 [Intuition-Lab/personal-model](https://github.com/Intuition-Lab/personal-model) 的 commit [`fb3986d`](https://github.com/Intuition-Lab/personal-model/commit/fb3986d863ef4a20c1df3cf3103b84672957257b)。此时包版本是 `0.3.2`，要求 Python `3.12–3.13`、macOS 13+，项目分类仍是 Alpha。下面是一次源码剖面，不是安全审计，也不是对最终建模质量的背书。

我本地用仓库自带的假 LLM 跑了与本文主线直接相关的测试：合成演示、采集到模型的 E2E、`HUMAN.md`、MCP、Root 合成、`memory_delta` 和 delta apply，共 `100 passed in 34.47s`。这不是全量测试套件，但能覆盖文章引用的主要机制。

## 1. Personal Model 和常见聊天记忆有什么不同

可以先用一张表划清范围。这里的“聊天记忆”指常见的对话摘要或事实条目实现，并不代表所有记忆系统。

| 维度 | 常见聊天记忆 | Persome 的 Personal Model |
| --- | --- | --- |
| 输入 | 对话消息 | 屏幕活动、可信导入、移动端观察 |
| 时间组织 | 一轮对话或一次总结 | 对齐到墙上时钟的分钟窗口、确定性会话、五分钟增量水位 |
| 长期结构 | 若干文本事实 | Point → Line → Face → Volume → Root |
| 证据 | 可能只保留原文片段 | 对象携带 receipt，可沿成员链回查 |
| 生命周期 | 写入、召回 | 形成、强化、修订、冲突、失效、重建 |
| 消费方式 | 拼进下一次 prompt | JSON Snapshot、`HUMAN.md`、MCP、`/model` viewer |

这意味着 Persome 处理的不是“下一轮该记住哪句话”这一件事，而是三类连续变化：刚刚发生了什么、哪些观察可以成为长期事实、这些事实之间是否形成了稳定结构。

五层几何可以先这样理解：

| 层 | 作用 |
| --- | --- |
| Point | 一条有来源的观察、事实或事件 |
| Line | Point 的演化关系，或实体之间的语义关系 |
| Face | 多条相关证据支持的稳定模式 |
| Volume | 跨项目、跨领域的更高阶结构 |
| Root | 当前唯一的全局画像；源码要求最多一个 live Root |

关键是“当前”。新证据可以强化旧结论，也可以修订或推翻它。Personal Model 更接近一个持续重算的状态系统，而不是只增不改的个人档案。

## 2. 先看合成演示，但别把它当成完整 E2E

仓库提供了不读取真实个人数据的演示：

```bash
git clone https://github.com/Intuition-Lab/personal-model.git
cd personal-model
uv run python scripts/sample_demo.py --showcase
```

脚本会使用临时 `PERSOME_ROOT`，在 `127.0.0.1:8743/model` 打开本地 viewer，退出后删除临时数据。我的本地实测结构是：

```text
424 Points
145 evolution Lines + 1 relation Line
12 Faces
4 Volumes
1 Root
425 receipts
```

但这个演示有一个很容易被忽略的边界：[`scripts/sample_demo.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/scripts/sample_demo.py) 会直接播种合成的模型几何。它证明 snapshot、搜索、receipt 和 viewer 能接起来，不证明真实 Mac 事件已经经过采集、分钟归一化、会话归约和语义抽取。

仓库另有 [`test_runtime_model_e2e.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/tests/test_runtime_model_e2e.py)，用假 LLM 覆盖可信导入 → timeline → session → model build/export。两者放在一起看，演示负责“看见模型”，测试负责“约束链路”，证明范围更清楚。

## 3. 总览：LLM 被放进一条有边界的流水线

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="Persome Runtime 从活动采集到 Personal Model 的完整流水线" src="/images/persome-personal-model/persome-runtime-overview.drawio.png" style="width: 760px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">基于 daemon、timeline、session、writer 与 model 源码整理。分钟时间线和五分钟 reducer 都会调用受限 LLM，确定性主要来自外围的窗口、水位、gate、持久化与回退。</p>
</div>

整条链路可以压成四段：

1. AX 事件、可信导入或移动端观察进入采集层，经过隐私 gate、去重和 S1 结构化。
2. Timeline 只处理已经闭合的分钟窗口；Session Manager 用确定性规则决定会话边界；Reducer 每五分钟只读取新窗口。
3. `memory_delta` 让 LLM 提议实体、事实、关系和事件，再由代码检查引用、身份、谓词和置信度，最后 apply 成 Point / Line。
4. 结构构建把重复、稳定的证据组织成 Face / Volume / Root，再投影为 JSON、`HUMAN.md`、MCP 和 viewer。

这套设计并没有把 LLM 伪装成确定性函数。Timeline、Reducer、`memory_delta`、高层结构归纳和 Root 合成都可能调用模型。源码真正做的是缩小每次调用能看的窗口，并把“是否接受、处理到哪里、失败后怎么办”留给代码。

## 4. 采集层：先判断能不能收，再决定收多少

采集主路径在 [`capture/scheduler.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/capture/scheduler.py)，事件节流在 [`capture/event_dispatcher.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/capture/event_dispatcher.py)。它不是固定频率截图器，而是用 AX 事件和心跳触发采集，再做最小间隔、事件类型去重和同窗口去重。静止不变的屏幕不会一直刷新会话的活跃时间。

一条 S1 记录主要保留：

```text
window_meta       应用、窗口标题、bundle id
focused_element   当前焦点元素、是否可编辑、输入值
visible_text      从 AX 树整理出的可见文本
url               能识别到的页面地址
trigger           点击、输入、窗口切换等触发信息
screenshot        可选像素数据
```

原始 AX 树在 Electron 应用里可能达到数百 KB，因此 S1 会先把它变成有上限的文本投影。对于 AX 信息贫乏的应用，系统可以提交本地 OCR；OCR 放在隔离子进程里，worker 崩溃时当前识别退化为空，下次再拉起，不拖垮 daemon。OCR 结束后，临时 JPEG 不作为另一份原图继续保存。

隐私规则比字段解析更早生效：

- 用户暂停采集时直接跳过。
- 屏幕锁定或睡眠时跳过；锁屏状态无法确认时按“不可采集”处理。
- 焦点落在 secure input 时，同时丢弃截图和 AX 快照，也不再走 OCR。
- 默认要求截图落盘加密；密钥缺失时省略像素，但仍可保留非像素的 AX 文本和窗口元数据。
- FTS 是可重建投影，索引写入失败不会把规范数据一起判死。

这些失败策略并不完全相同。隐私判断偏保守，宁可少采；OCR 和派生索引偏可用性，单个组件失败时让主链继续。把失败语义按数据风险拆开，比统一写一句“异常后降级”更可靠。

## 5. Timeline 与 Session：先保真，再压缩

Timeline 是原始采集与会话摘要之间的强制中间层。默认窗口严格对齐墙上时钟：`[10:00, 10:01)`、`[10:01, 10:02)`，而不是从 daemon 某次启动时间滚动计算。数据库对 `(start_time, end_time)` 做唯一约束，重启或手工补跑时可以保持幂等。

它只生产已经闭合的窗口。当前还没走完的一分钟继续留在 capture buffer，避免模型对半截输入下结论。

Timeline 会调用 LLM，但 prompt 第一段把任务写得很窄：

```text
Your job is normalization, NOT summarization.
Authored text, URLs, window titles, file paths, and quoted evidence
MUST appear verbatim in your output.
```

也就是说，这一层主要去 UI chrome、合并重复快照、区分同一应用里的不同对话或标签页。用户输入的原文、URL、窗口标题、文件路径和专有名词要继续向下传。若模型超时、JSON 解析失败或返回空条目，代码会根据 S1 记录生成 heuristic entry，仍然写入这个窗口，不让一分钟活动无声消失。

真正的压缩发生在 Session Reducer。会话边界由 [`session/manager.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/session/manager.py) 的状态机判断，默认有三条规则：

- 空闲超过 5 分钟，硬切。
- 切到一个无关应用并持续超过 3 分钟，软切；最近两分钟频繁跨应用时仍视为同一任务。
- 单次会话最长 2 小时。

Manager 每 30 秒检查一次边界。活跃会话每 5 分钟执行增量 reduce，结束时再做 terminal reduce。两个水位很重要：

```text
flush_end   reducer 已经处理到哪里
delta_end   Point / Line 建模已经成功 apply 到哪里
```

下一轮只读取水位之后的新 Timeline Blocks。活跃窗口的 reducer 失败后，下一次 flush 会覆盖更大的未处理区间；终态 reducer 则按 5、15、30、60、120 分钟退避重试，耗尽后写 heuristic 结果并标记完成。水位让“至少再试一次”和“不要重复计算同一段”可以同时成立。

## 6. `memory_delta`：让模型提议，让代码验收

Reducer 得到的是“这段时间做了什么”。要进入长期模型，还需要判断哪些内容值得留下。[`writer/memory_delta.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/writer/memory_delta.py) 会让 LLM 返回五类数组：

```text
owner_alias_candidates
entities
assertions
relations
events
```

Prompt 要求每个条目附带一段从会话文本中逐字复制的 `quote`。模型的输出不会直接写成事实，随后还有确定性 gate：

```python
return _norm_ws(quote) in session_text_norm

item.get("predicate") in _PREDICATES
subject is not None
conf_ok(item)
```

完整检查包括：

- `quote` 必须是会话文本的子串，没有引用就丢弃。
- 已知身份必须从 roster 里选择；`new_entity` 必须逐字出现在会话文本中。
- 关系只能使用闭合谓词集合，如 `participates_in`、`part_of`、`reports_to`、`knows`、`about`、`depends_on`。
- 置信度低于配置阈值的条目丢弃。
- 记忆所有者使用特殊的 `self`，不能因为屏幕上频繁出现某个名字就把它猜成用户本人。

通过 gate 的 delta 会先持久化，再 apply。数据库记录 `pending / applied / failed` 状态。若 apply 失败，下次复用已经保存的 payload，只重试确定性 apply，不再调用一次 LLM，也不会重复强化同一条关系。

这是一处很实用的边界：LLM 负责开放式判断“可能有什么事实”，代码回答“证据是否真的出现、身份是否合法、类型是否受支持、这一窗口是否已经处理过”。引用并不能证明推断必然正确，但它至少保留了质疑和纠错的入口。

## 7. 从 Point 到 Root：抽象越高，门槛也越高

Point / Line 形成后，模型构建器会在跨进程文件锁下执行结构阶段。源码包含基线演化、可选增强、schema miner、跨域归并、Root 合成和向量回填。结构变脏时触发刷新，每日安全网还会处理遗漏的工作。

Schema miner 默认要求同一 bundle 至少有 4 条事实，少于这个数量就不做可证伪的泛化。Face 表示较稳定的主题模式，Volume 把多个 Face 组织成跨领域结构。Root 则把活动 Volume、若干 Face 和持久 profile 压成唯一的顶层画像。

Root 并不是每次都强行更新。[`writer/root_synthesis.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/writer/root_synthesis.py) 有几条明确的保留旧值规则：

```python
if not bodies and not profile:
    return RootResult(None, "skip_empty_input")

if not apex:
    return RootResult(None, "skip_empty_output")

if not root_entities.issubset(input_entities):
    return RootResult(None, "skip_hallucination")
```

输出还要经过确定性的 token budget 裁剪。若新 Root 提到了输入中没有的已知身份，本次合成作废，继续保留先前 Root。

构建完成后，系统会检查 Point、Line、Face、Volume、Root 是否齐全。缺层不会伪造对象来凑“成功”，而是在 build manifest 的 `degraded_stages` 追加 `model_contract`。这也解释了为什么新用户可能先看到“模型仍在形成”：没有足够证据时，缺失结构就是更诚实的状态。

## 8. Receipt 如何穿过多层抽象

模型层数增加后，最怕的是只剩一段漂亮的总结，却找不到原始依据。Persome 的 snapshot 会让 Face、Volume、Root 沿成员链继承 `source_receipts`。Point 保存原始 receipt，Line 保存演化或关系来源，高层对象再汇总成员的 receipts。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="Persome 从 Point 到 Root 的 receipt 继承，以及 resolve_evidence 的三类返回结果" src="/images/persome-personal-model/persome-evidence-geometry.drawio.png" style="width: 760px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">高层对象继承成员证据；查询时，直接来源、邻近上下文和版本历史被刻意分开。</p>
</div>

统一入口 [`resolve_evidence`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/evidence.py) 接受 receipt 或对象 ID，返回三组链接：

- `sources`：对象明确记录的直接来源或推导成员。
- `context`：时间上邻近的 capture，帮助用户调查，但不声称它就是推导输入。
- `history`：前一版本、后一版本等演化链。

把 `context` 单列非常重要。“同一时间附近出现在屏幕上”只是线索，不等于“这条内容证明了模型结论”。很多记忆产品把相关性和证据混成一个检索结果，Persome 至少在接口合同上要求消费者区分它们。

Receipt 也不是永久可用的原文副本。原始 capture 可能已经按保留策略删除；解析器会返回 `source_not_found_or_retained`，同时保留 receipt 本身。它提供的是可追溯性和缺失状态，不是假装所有底层数据永远都在。

## 9. `HUMAN.md` 是阅读视图，JSON 才是机器合同

模型构建结束后，[`model/human.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/model/human.py) 从同一份 snapshot 生成 `~/.persome/HUMAN.md`。渲染函数的注释很直接：

```python
def render_human_markdown(snapshot, *, redacted=False):
    """Render a deterministic, compact Markdown view without another LLM call."""
```

它不会为了“写得更像人”再调用一次模型。内容主要包括：

- 当前 Root 画像。
- 最多 8 个稳定 Face。
- 最多 8 个跨领域 Volume。
- build id、状态、几何数量、receipt 数量和降级阶段。

若还没有 Root，文件会明确写出尚未形成验证过的画像，而不是填一段模板人格。它的 frontmatter 标记 `visibility: owner-only`、`redacted: false`。名字虽然叫 `HUMAN.md`，却是原始的本机阅读面，不能当成可公开分享的匿名报告。

覆盖规则也很谨慎：只有带有 Persome projection 标记、能确认由系统管理的普通文件才会被替换。未知格式、用户自己创建的 `HUMAN.md`、链接或竞态变化都会触发冲突，不会直接覆盖。

`HUMAN.md` 适合人读，但不是稳定的机器协议。真正的机器合同是带 `schema_version` 的 JSON snapshot；MCP 的 `get_model_snapshot`、CLI export 和 viewer 都建立在同一投影上。把“可读文档”和“版本化合同”分开，可以让文字布局继续演化，而不逼客户端解析 Markdown 标题。

## 10. MCP 让 Agent 使用模型，但不替 Agent 操作电脑

[`mcp/server.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/mcp/server.py) 暴露的能力大致分四组：

```text
搜索：search、search_captures、current_context
读取：read_memory、read_receipt、get_model_snapshot
核对：resolve_evidence、verify_fact、related_events
纠错：correct_memory
```

面向本机 Agent，更隔离的接法是 stdio：每个客户端按需启动独立 MCP 进程，不需要把 HTTP bearer 复制进配置。daemon 的默认配置也能提供 `127.0.0.1:8742` 上的 streamable HTTP，要求 bearer，并有 Host、DNS rebinding 和 CSRF 防护；非 loopback 绑定会被拒绝。

MCP 只提供个人模型的读取、证据回查和显式纠错，没有点击、输入或接管 Mac 的工具。README 里“Agent 可以继续工作”的执行动作仍由连接它的 Codex、Claude Code 或其他 Agent 完成，权限也属于那个 Agent。

这并不让 MCP 变成低风险接口。它返回的是个人数据，甚至可能包含屏幕上的第三方文本和 prompt injection。连接一个 MCP 客户端，等于授予它读取相应个人数据的能力；客户端随后是否把内容发给自己的模型供应商，已经越过 Persome 的本机边界。

## 11. “本地优先”不等于“永不离开电脑”

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="Persome 本机数据、MCP、HTTP 和可选模型供应商之间的访问与隐私边界" src="/images/persome-personal-model/persome-access-boundary.drawio.png" style="width: 760px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">绿色区域是本机 Runtime；黄色虚线是启用语义模型后的可选外发；红色路径表示非 loopback HTTP 被拒绝。</p>
</div>

Persome 的“local-first”主要体现在存储和控制面：

- 默认数据根是 `~/.persome`，目录权限为 `0700`，数据库、capture、日志、snapshot、`HUMAN.md` 等敏感文件为 `0600`。
- capture 默认保留 168 小时；截图默认 24 小时后从 JSON 中剥离，AX 文本可以继续保留。可执行线索可能受扩展保留策略影响。
- 本地 OCR 不需要把图片发给 OCR 服务。
- 没有 telemetry 或更新 phone-home。
- capture 和 BM25 检索在没有模型凭证时仍能工作；依赖 LLM 的阶段会报告 degraded。

但配置 hosted provider、Agent CLI 或远程 embedding 后，相应语义阶段的 prompt 或 embedding 输入会外发。Persome 也支持借用 Codex、Claude Code、Cursor Agent 等已有订阅来跑后台阶段，并用每日调用账本限制次数；这仍然是明确的网络边界变化，不应被“密钥没有复制给 Persome”掩盖。

安全文档还给出两个现实限制。第一，同一用户下的恶意本机进程不在主要威胁模型内；文件权限挡不住拥有同等用户权限的进程。第二，默认 export 会移除可检测的 secret、PII 类别和本地路径，但不保证人物、组织、项目或写作风格已经匿名。真实 snapshot 仍需单独审查，不能直接发布。

## 12. 这套设计最值得借鉴的部分

Persome 的优势和代价都很鲜明。

我认为最可复用的有四点：

1. **用确定性外壳限制概率模型。** 时间窗口、会话边界、水位、身份解析、谓词集合和 apply 幂等性都由代码掌握。
2. **先持久化提议，再改变长期状态。** `memory_delta` 的 persist-before-apply 让失败可重试，也留下了审计面。
3. **把“没有形成”当作正常状态。** 缺 Root、模型阶段失败或证据不足时报告 degraded，不补造一个看似完整的结果。
4. **让抽象继承证据，同时区分来源、上下文和历史。** 高层画像依然可以回到 receipt，邻近内容不会被冒充成直接证明。

代价也很具体：

- macOS 权限、Swift helper、Python daemon、SQLite/WAL、OCR worker、模型 provider、MCP 和 viewer 共同构成了不小的运维面。
- Timeline 和 Reducer 都可能调用模型，持续运行会带来延迟、费用与外发权衡。
- “引用存在”只说明输出有文本依据，不说明推断一定合理。身份合并、稳定模式和 Root 画像仍需要用户纠错。
- 原始 capture 会过期，receipt 可能只能告诉你曾经有来源，却无法继续展开全文。
- 项目仍处在 Alpha，接口与模型语义都可能变化。

如果只想给聊天机器人增加几条偏好，整套 Runtime 很重；如果目标是让多个 Agent 共用一份可演化、可检查、可纠错的个人上下文，这些复杂度才开始有意义。

## 13. 推荐的源码阅读顺序

想继续读仓库，可以按下面的顺序走，避免一开始陷进 OCR 或安装脚本：

| 顺序 | 文件 | 先回答的问题 |
| --- | --- | --- |
| 1 | [`daemon.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/daemon.py) | Runtime 实际启动了哪些任务？ |
| 2 | [`capture/scheduler.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/capture/scheduler.py) | 一条 S1 记录如何形成，隐私 gate 在哪里？ |
| 3 | [`timeline/aggregator.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/timeline/aggregator.py) 与 [`timeline_block.system.md`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/prompts/timeline_block.system.md) | 分钟窗口如何保真归一化？ |
| 4 | [`session/manager.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/session/manager.py) 与 [`writer/session_reducer.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/writer/session_reducer.py) | 会话怎么切，`flush_end` 怎么推进？ |
| 5 | [`writer/memory_delta.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/writer/memory_delta.py) | LLM 输出通过哪些 gate 才能进入长期状态？ |
| 6 | [`model/build.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/model/build.py)、[`model/snapshot.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/model/snapshot.py) | 五层几何如何构建并形成版本化合同？ |
| 7 | [`evidence.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/evidence.py)、[`model/human.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/model/human.py)、[`mcp/server.py`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/src/persome/mcp/server.py) | 人和 Agent 最终拿到什么？ |
| 8 | [`SECURITY_PRIVACY.md`](https://github.com/Intuition-Lab/personal-model/blob/fb3986d863ef4a20c1df3cf3103b84672957257b/SECURITY_PRIVACY.md) | 数据留多久、何时外发、哪些威胁不在范围内？ |

回到开头的问题：屏幕活动为什么最后能变成一份 `HUMAN.md`？不是因为某次 prompt 足够聪明，而是因为中间有一连串可检查的状态变化：采集先过隐私 gate，Timeline 保真，Session 划边界，Reducer 推水位，`memory_delta` 绑定引用，几何层继承 receipt，最后才把同一份版本化模型投影给人和 Agent。

如果要从 Persome 借走一个设计原则，我会选这句：让模型提出解释，让代码决定这份解释有没有资格成为长期状态。
