---
title: "分布式雷达 dradar：一套众包模型 IQ 评测体系的机制拆解"
description: "拆解 codex-radar/dradar 开源客户端与 deng.codexradar.com 主站：格子调度、客户端跑题取证、服务端独立判分，以及从通过率/Macro-F1 到 150 分制 IQ 的完整换算体系。"
date: "2026-08-25"
tags: ["AI 评测", "Benchmark", "Codex", "分布式", "DRadar"]
draft: false
featured: true
readingTime: 16
---

> 项目：[codex-radar/dradar](https://github.com/codex-radar/dradar)（README 内镜像地址 SecurityMind/dradar）
> 分析版本：main 分支 `f88a8a6`，CLI 版本 0.5.102，368 次提交
> 站点：[deng.codexradar.com](https://deng.codexradar.com)（任务大表与领取）/ [codexradar.com](https://codexradar.com)（IQ 榜单发布）
> 一句话结论：**这是一套用"客户端只取证、服务端才判分"来解决众包跑分信任问题的评测系统，最终的 IQ 分只是整条可信链路的最后一个环节。**

## 它要解决什么问题

模型榜单的信任问题一直没被真正解决：厂商自报的跑分没法复核，志愿者帮忙跑的分没法防伪，截图成绩更是全靠自觉。分布式雷达的思路是把评测拆成两半——**跑题这件事交给志愿者各自的机器和订阅账号，判分这件事收归服务端独立完成**。

目前主站接了两个基准频道：

- **DeepSWE**：软件工程能力，模型在容器里修真实 GitHub issue，产出 patch；
- **庞贝壁画邻接恢复**：视觉空间推理，模型看壁画碎片图，输出它判断存在的无向直接邻接边。

两个频道成绩分开统计，最后各自换算成 IQ 分。参与方式是让本机已登录的 Codex、Claude、Kimi、Grok、ZCode 等工具在 Docker 容器里跑题，订阅凭据全程不出本机。

![分布式雷达评测体系总览](/images/dradar-iq-eval/overview.png)

*图 1：整体分工。左侧志愿者机器负责跑题和取证，右侧服务端负责裁决领取、独立判分和发布成绩，底部是 IQ 换算。注意中间箭头的方向：向右走的是查询、领取和证据上传，向左回流的只有格子快照与判分状态，分数只从服务端流出。*

## 最小参与链路

从官网 GitHub 登录拿 token 之后，CLI 一侧的典型流程是：

```bash
dradar login --server https://api.codexradar.com --token <TOKEN>
dradar doctor                    # 体检：Docker / Pier / 模型 CLI / 任务仓库
dradar cells --available         # 只看可领取的格子，不占位
dradar go --auto 3               # 自动选到总计 3 题，串行跑完并上传
dradar status                    # 回查自己的提交与服务端判分
```

`dradar go` 内部做的事（`runloop.py` 的 `cmd_go` → `_run_and_submit`）依次是：补传上次残留的结果、恢复本地 checkpoint、领取任务、用 Pier 起 Docker 跑题、脱敏、上传。每一步失败都有对应的续跑命令，这是它能跑在志愿者千差万别的网络环境里的前提。

## 格子：评测的最小调度单元

整套系统的调度单位是**格子（cell）**，一个格子就是 `任务 × 模型 × 推理档位` 这个三元组。`cells.py` 里解析服务端大表的代码很直白：

```python
# src/dradar/cells.py:42-55
for key, value in (table.get("cells") or {}).items():
    try:
        task_id, model, effort = key.split("|", 2)
    except ValueError:
        continue
```

每个格子带一组服务端下发的字段：`st`（状态）、`mult`（当前积分倍率）、`total_n`（历史测试总数）、`rate`（滚动窗口通过率）、`min` / `cost`（预估耗时与成本）、`suggest_priority`（推荐优先级）。客户端对这张表是**只读**的，只能筛选、排序、展示，真正的裁决全部在服务端。

格子的状态机是理解整个评测节奏的关键：

![格子状态机与判分生命周期](/images/dradar-iq-eval/cell-lifecycle.png)

*图 2：格子的五个状态与判分的三种结局。注意 `queued` 向下分出的三个分支——有效、invalid、审计命中，只有"有效判分"会进入积分和通过率统计；审计命中的提交先冻结，人工复核后要么原数奉还，要么清零封号。*

几个值得说的细节：

- **领取是原子裁决**。`dradar cells` 看到的 `open` 只是快照，真正领取走 `POST /api/v1/assignment/claim`（`api_client.py:214`），冲突统一返回 409 和稳定错误码：`cell_unavailable`（格子没了）、`claim_limit_reached`（你拿满了）、`invalid_cell`（格子配置已下线）、`run_limit_reached`（运行并发到顶）。前三种发生在建租约之前，不会启动容器，也就不会烧额度。
- **多 worker 安全靠 checkout**。并行跑题时父进程统一认领，子进程通过 `POST /api/v1/assignment/checkout` 原子分题（`api_client.py:248-269`），N 个并发调用拿到 N 个不同的格子，客户端不需要自己实现分锁。
- **通过率是滚动窗口不是终身**。README 明确写 `PASS` 列"不等于终身通过率"——这是降智预警能成立的前提：只有窗口够短，模型最近的下滑才看得见。
- **冷却期与倍率联动**。有效判分后格子进入 `cooldown`，重新开放后积分倍率随空闲时间上涨（规则见后文），用激励引导志愿者去补测长期没人碰的格子。

## 一次判分：客户端取证，服务端重跑

这是整套体系最核心的一句话，写在 `runner.py` 的模块 docstring 里：

```python
# src/dradar/runner.py:1-6
"""Run one benchmark trial locally via pier and collect submission artifacts.

The volunteer client runs agent-only (`--disable-verification`); grading is
server-side. model.patch is produced inside the container by the task's own
pre_artifacts.sh, then downloaded by pier into the trial dir.
"""
```

构造 Pier 命令时，`--disable-verification` 被显式写死（`runner.py:1052-1062`）：客户端跑题时**根本不运行任务自带的 verifier**，本地不产生任何 pass/fail 结论。上传到 `POST /api/v1/submissions` 的只有三样证据加一份诊断元数据：

| 产物 | 路径 | 内容 |
|---|---|---|
| `model.patch` | `<trial>/artifacts/model.patch` | 容器内 `pre_artifacts.sh` 生成的 unified diff |
| `trajectory.json` | `<trial>/agent/trajectory.json` | ATIF-v1.7 格式的 agent 轨迹 |
| `result.json` | `<trial>/result.json` | Pier 的运行记录：phase 时间戳、异常信息、token 计数 |

元数据里有个刻意的设计：客户端会把 `cost_usd` 置空再上传。

```python
# src/dradar/runloop.py:925-938
# Clearing cost_usd is intentional: the server owns the model
# price table and recomputes the cost from these normalized
# aggregate token counters.
agent_result["cost_usd"] = None
```

也就是说，连"这道题花了多少钱"都不让客户端自己报——token 桶计数交上去，价格表在服务端，成本由服务端复算。提交成功后的回执也不是分数：

```python
# src/dradar/runloop.py:1827
print(f"submitted: {ack['submission_id']} (grading happens server-side)")
```

服务端在干净容器里用任务自带 verifier 重放 patch，得到的 pass/fail 才进入统计。补丁要是被打上 `invalid` 或异常标记，客户端 `status` 里能看到状态，但积分不会到账。

## 分数可信的五层防线

众包评测最怕的是有人伪造提交。这套系统的防线是从环境到人工复核一层层叠的：

![五层信任防线](/images/dradar-iq-eval/trust-layers.png)

*图 3：五层防线及各自的责任方。前三层主要发生在志愿者机器上，后两层在服务端。*

**第一层，执行环境隔离。** 每道题在独立的一次性 Docker 容器里跑，出站网络走一个固定 SHA-256 的 Squid egress 代理，默认只放行白名单域名（`docker/egress-proxy/start-squid.sh` 里就是 `http_access allow authenticated allowed_domains` 加 `deny all`）。Codex 的 web_search、apps、remote plugin 在生成给容器用的配置层直接关闭（`runner.py:94-102` 的 `ALLOWLIST_TOML`），同一行注释说得很坦白：

```python
# src/dradar/runner.py:94
# Server-side trajectory audit is the backstop if a client tampers with this.
```

**第二层，客户端不判分。** 如前所述，本地只产证据不产结论。

**第三层，上传链路可信。** 这一层措施最密集：

- patch 在本地维护**双副本加 SHA-256 清单**（`artifact_staging.py`），两份摘要对不上就保留现场、拒绝上传，不猜也不覆盖；
- `scrub.py` 对 patch 只允许改 unified diff 的新增行，元信息和上下文行里发现密钥直接判 `unsafe` 拒传；脱敏后还要过 `git apply --numstat` 结构校验加二次扫描；
- 上传前先向 `/api/v1/submission-upload-intents` 登记所有文件的 SHA-256 清单（`submission_intent.py`，协议版本 `dradar-submission-upload-v2`），内容对不上或重复提交都会被服务端拒掉；
- 服务端按 assignment 幂等接收，网络断了走 `pending_uploads.json` 账本补传，409 "already submitted" 直接本地销账。

**第四层，服务端独立重判**，外加一个容易忽略的开关：任务内容哈希。`manifest.py` 只对 `instruction.md`、`task.toml` 和 `environment/` 算哈希，刻意不含 `solution/` 和 `tests/`——本地题面和服务端不一致时 CLI 默认拒绝开跑（`--allow-task-drift` 可以强行放行，但这类运行会被明确标记为不可比）。这个设计堵的是"改题面让题变简单"这条作弊路径。

**第五层，审计与复核兜底。** 服务端做租约时间差校验和轨迹审计；可疑提交先冻结——积分暂扣、不上榜、不计晋升——人工复核后误伤的原数奉还，坐实的清零封号。`status` 命令会把 `flags` 和 `grade_status` 原样展示给志愿者。

## IQ 换算：从单格判分到 150 分制

到这里才轮到"IQ"出场。换算规则本身出奇地简单，全部复杂度都花在保证输入数据可信上了。

**两个基准各产出一个百分比：**

- DeepSWE 频道：格子的判分结果是 pass/fail，按模型档位聚合出**平均通过率**；
- 庞贝壁画频道：隐藏评分器把模型提交的邻接边与标准邻接图逐条比对，算 TP/FP/FN，得到每题的 Precision/Recall/F1；总榜主分是 **86 道题的 Macro-F1**（每题 F1 等权平均，87 个 RP group 中留 1 个做公开示例，其余 86 个各出 1 道正式题）。绝对坐标、画布尺度、旋转、拼图图像本身都不参与第一版判分——评的是"碎片之间的邻接拓扑"这个纯推理结果。

**百分比乘以 1.5 得到 IQ**，满分对齐 150：

```text
软件工程能力 IQ = DeepSWE 平均通过率 × 150
视觉空间推理 IQ = 庞贝壁画 Macro-F1 × 150
综合智能 = √(工程 IQ × 视觉 IQ)    # 等权几何平均
```

综合智能只纳入**两个维度都有有效成绩的同一模型档位**，缺一个维度就不参与综合排名。几何平均的取法意味着偏科会被惩罚：一个维度接近 0，综合分就被拉下来，这比算术平均更能逼出"水桶型"模型。

例子：某档位 DeepSWE 平均通过率 60%、壁画 Macro-F1 86%，则工程 IQ = 90，视觉 IQ = 129，综合智能 = √(90×129) ≈ 107.8。

**在 IQ 之上还有两个动态信号：**

- **降智预警**：只展示相对 24/48 小时均值持续明显下滑的模型档位。它依赖前文说的滚动窗口通过率——窗口短，才对"模型今天变笨了"这类社区体感敏感。
- **历史对比**：主站可以按 IQ、费用、耗时、agent steps、cache 命中率、总 tokens 对多个模型档位做历史曲线对比。

## 积分体系：和 IQ 分开的另一本账

容易混淆的一点是：**志愿者拿的积分和模型的 IQ 是两本账**。IQ 只反映模型表现；积分是给贡献算力的人的激励，规则围绕"补测稀缺数据"设计：

- 基础分是服务端锁定的 **API 等价成本**：Kimi Code、ZCode、Grok 等订阅类 harness 按完整 token 账本和官网 API 单价折算，账单不完整的有效判分会明确标"兜底估价"，不拿未核验用量冒充真实成本。DeepSeek 按每条请求发生时的北京时间峰/谷价复算（工作日 09:00–12:00、14:00–18:00 为高峰）；GLM 的峰段是每天 14:00–18:00，同样按请求发生时间分别计价。
- **动态倍率**奖励补测冷门格子：普通 Codex 格子 1×–2×（越久没实测越高）；庞贝全新格固定 5× 开荒价，完成一两次后从 2.5× 起涨回 5×，三次后回归普通倍率；DeepSeek/DSH 格子 100× 起步、每空闲一小时加 20×、封顶 200×；Kimi/ZCode 5×–10×；Grok 额外乘 2.5 订阅奖励。
- 另有连续贡献奖励（每天有效判分 +5，连签 3/7/14/30 天再加 5/15/30/60）和月榜排名解锁的并发档位（前 10 名 20 并发，11–50 名 10 并发，其余 5 并发）。

客户端代码里找不到任何倍率数值——`mult` 字段完全由服务端下发，CLI 只负责展示和筛选。这本账的所有参数可以随时调而不需要志愿者升级客户端，是刻意的服务端集权设计。

## 工程细节里值得单独提的

**checkpoint 每 30 秒落盘一次**（`pier_checkpoint.py:1686`），内容是工作区 diff、未跟踪文件、去凭据后的 provider session、usage 状态和心跳时间戳，TTL 7 天。恢复时严格核对 assignment、任务、模型、档位、provider 和精确 agent 版本，任何一项不匹配就拒绝恢复——不兼容的现场会保留为 terminal evidence，而不是默默重跑一遍烧掉额度。

**Codex 容器版本永远追最新稳定版**。每道 Codex 任务启动前，CLI 都会从 npm 确认 `latest` 对应的精确版本号再交给 Pier 构建；本机 npm 不可达时只接受服务端最近确认过的版本，两边都确认不了就不启动、不消耗额度。这条规则保证不同志愿者跑出来的成绩基于同一个 agent 版本，是可比较的前提。

**多 harness 统一抽象**。Codex、Claude、DeepSeek、DSH、Grok、Kimi、ZCode 在 runner 层收敛到同一条 Pier 执行路径，但各自固定 CLI 版本（如 Kimi Code 0.36.1、Grok 1.0.3）、各自的 effort 档位集合（DeepSeek 的 `off` 会严格转成 Responses API 的 `reasoning.effort=none`）、各自的凭据隔离目录。格子层面它们是可比较的，实现层面互不干扰。

## 设计取舍与局限

这套设计的目标函数很明确：**宁可让流程变重，也不让任何一环可以自说自话**。代价也是实打实的：

- 志愿者体验链路长（登录、体检、领取、跑题、等判分），20 分钟未启动就放回格子这种规则本质上是在用租约压力换大表数据的实时性；
- 判分、积分、榜单逻辑全部在服务端闭源，开源仓库只能验证"客户端没有作弊能力"，没法验证"服务端没有暗箱"——它用冻结-复核-奉还的纠错机制替代了完全透明；
- IQ 换算系数 ×1.5 是对齐"150 满分"的人为约定，跨基准的可比性依赖 Macro-F1 和通过率这两个口径各自的稳定性；壁画频道只有 86 题，单题噪声对 F1 的影响不小；
- DeepSWE 成绩天然绑定 harness 版本（Codex CLI、Pier、Docker 镜像都在变），所以才有强制验版、任务哈希校验这些"防漂移"措施，这也让跨时间段比较需要多看一眼版本标记。

## 可以借鉴的做法

如果你想自己搭一套可信的众包评测，这套系统里可以直接搬走的点：

1. **判分权和执行权分离**：执行端 `--disable-verification`，证据（patch/轨迹/运行记录）和结论分开传，结论只能由判分端产出；
2. **成本也不让客户端自报**：传 token 桶原始计数，价格表留在服务端复算；
3. **上传先登记内容清单**：所有产物的 SHA-256 先建 intent，防重放也防半截上传污染数据；
4. **任务内容哈希只覆盖该覆盖的部分**：题面和环境要一致，答案和测试本来就不该进哈希；
5. **用租约时间差、轨迹审计这类旁路信号做冻结依据**，先冻结再复核，比先计分再追回对榜单的污染小得多；
6. **滚动窗口通过率**比终身通过率更适合做"降智预警"这类时效性信号。

## 源码阅读索引

按这个顺序读客户端仓库最省力：

1. `README.md` —— 产品规则的唯一权威说明（格子状态、倍率、积分、错误码都在这）；
2. `src/dradar/cells.py` —— 格子表结构与筛选逻辑（约 200 行）；
3. `src/dradar/api_client.py` —— 全部服务端端点，claim/checkout/submissions/intents；
4. `src/dradar/runner.py` —— `build_pier_command`（L945）与 `run_trial`（L3040），看 `--disable-verification` 和各 harness 分支；
5. `src/dradar/runloop.py` —— `_run_and_submit`（L2136）与 `_upload_trial`（L1423），看脱敏、intent、幂等补传；
6. `src/dradar/scrub.py` + `artifact_staging.py` + `submission_intent.py` —— 上传可信链三件套；
7. `src/dradar/pier_checkpoint.py` —— 30 秒 checkpoint 与恢复校验；
8. `docker/egress-proxy/start-squid.sh` —— 网络白名单的实际形态。

IQ 换算、积分倍率、降智预警的实现不在开源仓库内，规则以主站 FAQ 和榜单页说明为准。

## 参考链接

- dradar 开源仓库：https://github.com/codex-radar/dradar
- 任务大表与领取：https://deng.codexradar.com
- IQ 榜单主站：https://codexradar.com
- DeepSWE 任务仓库：https://github.com/datacurve-ai/deep-swe
