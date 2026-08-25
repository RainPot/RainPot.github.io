---
title: "分布式雷达 dradar：一套众包模型 IQ 评测体系的机制拆解"
description: "拆解 codex-radar/dradar 开源客户端与 deng.codexradar.com 主站：格子调度、客户端跑题取证、服务端独立判分，以及从通过率/Macro-F1 到 150 分制 IQ 的完整换算体系。"
date: "2026-08-25"
tags: ["AI 评测", "Benchmark", "Codex", "分布式", "DRadar"]
draft: false
featured: true
readingTime: 22
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

## DeepSWE：一道题怎么跑、怎么判

"服务端重跑 verifier"具体长什么样？DeepSWE 的任务仓库是公开的（[datacurve-ai/deep-swe](https://github.com/datacurve-ai/deep-swe)），113 道题（TypeScript 35、Python 34、Go 34、Rust 5、JavaScript 5，服务端当前在线 112 道），全部取材于活跃开源仓库的真实演进任务。每道题的目录长这样：

```text
tasks/<task-id>/
├── task.toml        # 元数据：仓库、base commit、语言、镜像、超时、资源配额
├── instruction.md   # agent 看到的题面
├── environment/     # Dockerfile，复现预构建镜像
├── tests/           # 判分入口、隐藏测试（test.patch）、grader 配置
└── solution/        # 参考答案：判分时永远不用，只供人工抽查
```

题面不是"修个 bug"一句话。拿真实任务 `abs-module-cache-flags`（Go，改的是 abs 语言的模块加载）来说，instruction.md 列了一二十条"预期行为"：模块解析的查找顺序、缓存去重规则、要新增的三个 API 的字段和语义、CLI 标志在 script mode 下的行为……判分器验证的只是**这些可观察行为**，README 原话是 "accepts any solution whose observable behavior is correct, regardless of internal symbol names or structure"——不管你内部怎么写，行为对就算过。

task.toml 把执行约束写死了（关键字段摘自真实任务）：

```toml
[verifier]
network_mode = "no-network"      # 判分容器同样断网
environment_mode = "separate"    # 判分环境与 agent 环境分离
timeout_sec = 1800.0             # 判分限时 30 分钟

[[verifier.collect]]
command = "cd /app && ... git diff --binary <base_commit> HEAD > /logs/artifacts/model.patch"

[agent]
network_mode = "no-network"      # agent 全程断网
timeout_sec = 5400.0             # 90 分钟限时（部分任务 120 分钟）
[environment]
docker_image = "public.ecr.aws/.../<task-hash>-v1.1"   # 每题固定预构建镜像
cpus = 2
memory_mb = 8192
```

![DeepSWE 单次判分流水线](/images/dradar-iq-eval/deepswe-grading.png)

*图 3：一次 DeepSWE 判分的完整流水线。左：agent 在一次性容器里自由解题并 commit；中：collect 钩子用 git diff 提取 patch，这是唯一的判分依据；右：patch 在 pristine verifier 容器里重放，注入隐藏测试后按 F2P/P2P 白名单出分。*

**执行是三段式的。** 第一段，agent 容器从固定 base commit 启动，断网、限时内自由工作——读代码、改代码、用仓库自带测试自查，完成后 git commit。第二段，`[[verifier.collect]]` 钩子执行 `git diff --binary base..HEAD`，把 agent 的全部工作浓缩成 model.patch——这正是上一节客户端上传的那个文件。第三段，服务端在一个全新的 pristine 容器里重放这个 patch 判分。

**判分逻辑每道题自带，且完全公开**，在 tests/ 目录的五件套里：Dockerfile、config.json（测试白名单）、grader.py（判分器）、test.patch（隐藏测试补丁）、test.sh（入口脚本）。核心是与 SWE-Bench 一脉相承的 F2P/P2P 双白名单：

```python
# tests/grader.py —— 每个任务自带
binary = 1 if (len(f2p) > 0 and ff == 0 and pf == 0) else 0
```

- **F2P（fail-to-pass）**：修复前失败、修复后必须通过的测试——证明问题真的被解决，上面那道 ABS 任务有 19 条；
- **P2P（pass-to-pass）**：原本就通过、修复后仍必须通过的测试——证明没把别的东西改坏，同题 3 条；
- **reward = 1 的条件**：F2P 非空、F2P 全过、P2P 无一失败，缺一条就是 0。

判分时序上有两个关键设计。其一，verifier 容器先在 base 状态应用 model.patch，应用失败直接写 `reward: 0, apply_failed: 1`，连测试套件都不跑。其二，patch 应用成功后，才应用 **test.patch 注入隐藏测试**——这些测试只存在于判分环境，agent 的容器里根本没有，想针对判分测试做特化也无从下手。最后跑完整套件，产出 ctrf 格式的机器可读报告，grader.py 按白名单统计出分。

几个防呆细节值得单独说：

- **worst-status-wins**：同一测试出现在多份报告里时取最差状态（failed > skipped > passed）；
- **缺席即失败**：白名单里的测试没出现在报告里（没跑到、没产出结果）按 failed 计，堵"让测试跑不起来"这种侧门；
- **基础设施错误有独立哨兵**：判分器自己崩了会写 `reward.txt = -1`，与"模型没做出来"（reward 0）区分开，不污染统计；
- **作弊信号只记录不改判**：test.sh 会扫描依赖清单改动、vendored 依赖、模型自加 TestMain 劫持测试二进制这类信号，记录下来供审计，当场不改 reward——"判分"和"反作弊"两层职责分得很清。

除 binary reward 外，reward.json 还带连续部分分（`f2p` / `p2p` / `partial` 通过率）用于诊断展示，**排名口径只认 0/1**。每次判分的完整产物——reward.json、ctrf.json、test-stdout.txt、run.log、reports/——服务端全部存档，失败测试的逐条原因也会回显给志愿者。

## 分数可信的五层防线

众包评测最怕的是有人伪造提交。这套系统的防线是从环境到人工复核一层层叠的：

![五层信任防线](/images/dradar-iq-eval/trust-layers.png)

*图 4：五层防线及各自的责任方。前三层主要发生在志愿者机器上，后两层在服务端。*

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

单次判分只产出一个 0/1（DeepSWE）或一个 F1（庞贝）。从单次判分到榜单上的 IQ，中间隔着三层聚合，每层的口径都有公开证据。

### 第一层：格子聚合——每题最近 3 次有效判分，等权平均

同一道题会被多个志愿者反复跑，每次产生一个独立判分样本；但**只有最近 3 次有效判分进入统计，等权平均**。这不是我推断的，服务端公开接口直接给了参数：大表接口返回 `scoring_mode`（DeepSWE 为 `binary-majority`，庞贝为 `continuous-macro`）、`rolling_window: 3`、`reopen_after_hours: 60`（有效判分后格子冷却 60 小时再重开），判分数据接口的 `mode` 字段就叫 `equal_latest_3`，方法字段写得更直白：

```text
"iq": "equal-weight latest three valid samples per task; pass_rate * 150"
```

这个设计的两个直接效果：单次运气好坏被摊薄（一题至少 3 票）；模型变化后，旧样本最多再撑 3 次新判分就被顶出窗口，榜单跟得上模型当前状态——这也是"降智预警"（相对 24/48 小时均值持续下滑）能工作的机制基础。聚合策略本身带版本号（`benchmark_policy_version: deepswe-equal-iq-v2`），口径迭代有迹可查。

### 第二层：频道聚合——两种口径，一个公式

- **DeepSWE**：每题通过率（最近 3 次里通过的比例）跨题平均，得到频道平均通过率；
- **庞贝壁画**：模型看碎片图、输出它判断的无向直接邻接边；隐藏评分器把预测边与标准邻接图逐条比对，算 TP/FP/FN 得出每题 F1；每题最近 3 次等权平均，再跨 86 题平均，得到 Macro-F1（87 个 RP group 留 1 个做公开示例，其余 86 个各出 1 道正式题）。绝对坐标、画布尺度、旋转、拼图图像本身都不参与第一版判分。

两个频道的百分比乘以 150 就是各自的 IQ。用服务端数据接口的真实快照验一遍（2026-08-25），`passed ÷ total × 150` 与公布的 IQ 严丝合缝：

| 档位（gpt-5.6-sol） | DeepSWE passed/total | 工程 IQ | 庞贝 ΣF1/total | 视觉 IQ |
|---|---|---|---|---|
| low | 181/336 | 80.8 | 96.60/177 | 81.9 |
| medium | 199/336 | 88.8 | 125.24/200 | 93.9 |
| high | 206/336 | 92.0 | 125.07/191 | 98.2 |
| ultra | — | — | 182.09/258 | 105.9 |

注意 total 的构成：DeepSWE 满值 336 = 112 题 × 3 个采样位，庞贝满值 258 = 86 题 × 3。total 小于满值，说明该档位还有格子没跑满 3 次——**样本量本身就是"这个 IQ 有多可信"的指示器**。这组数据还顺带回答了"effort 有没有用"：庞贝从 low 的 81.9 一路到 ultra 的 105.9（xhigh 有一次小幅回落），推理档位的收益清晰可见。

### 第三层：综合智能——两个维度等权算术平均

主站当前的口径原文："综合智能的 IQ、费用与耗时均取软件工程能力和视觉空间推理两个维度的**等权算术平均值，即两项相加后除以 2**；只纳入两个维度均有有效成绩的同一模型档位。"公式汇总：

```text
软件工程能力 IQ = DeepSWE 平均通过率 × 150
视觉空间推理 IQ = 庞贝壁画 Macro-F1 × 150
综合智能 = ( 工程 IQ + 视觉 IQ ) ÷ 2    # 等权算术平均
```

举个例子：某档位 DeepSWE 平均通过率 60%、壁画 Macro-F1 86%，则工程 IQ = 90、视觉 IQ = 129，综合智能 = 109.5。

一个值得留意的细节：本文写作当天，主站这处文案刚从"等权几何平均"改成"等权算术平均"。几何平均会重罚偏科（一个维度趋零，综合分被拉垮），算术平均则允许强项补弱项——两种口径下排名可能不同。策略带版本号、会迭代，跨时间读榜单时值得对一眼当前口径。

### IQ 之外的同源指标

同一份 latest-3 采样还产出效能侧指标：API 等价均价（DeepSeek 按峰/谷价段折算，Codex 订阅按实际折算成本）、平均耗时、agent steps、cache 命中率、总 tokens，主站可按这些维度做历史曲线对比，还有一个把均价和耗时合成指数的"综合成本 × IQ"效能排行。指标口径同样写在接口的 `method` 字段里，公开可查。

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
- IQ 换算系数 ×150 是对齐满分的人为约定，跨基准可比性依赖 Macro-F1 和通过率两个口径各自的稳定性；庞贝只有 86 题、每题仅取最近 3 个有效样本，单题噪声对 F1 的影响不小；DeepSWE 的 binary 判分还丢弃了 partial 部分分携带的信息量——"修对一半"和"完全没修"同记 0；
- 聚合策略在演进（几何平均刚改成算术平均），跨时间段比较 IQ 时要留意 `benchmark_policy_version`；
- DeepSWE 成绩天然绑定 harness 版本（Codex CLI、Pier、Docker 镜像都在变），所以才有强制验版、任务哈希校验这些"防漂移"措施，这也让跨时间段比较需要多看一眼版本标记。

## 可以借鉴的做法

如果你想自己搭一套可信的众包评测，这套系统里可以直接搬走的点：

1. **判分权和执行权分离**：执行端 `--disable-verification`，证据（patch/轨迹/运行记录）和结论分开传，结论只能由判分端产出；
2. **F2P/P2P 双白名单 + 隐藏测试**：判分测试只存在于判分环境，agent 看不到；"证明解决了"（F2P）和"证明没改坏"（P2P）分开列；缺席的白名单测试按失败计；
3. **每题多次采样 + 滚动窗口**：单次判分噪声大，最近 N 次等权平均既摊薄运气，又让指标对模型变化保持敏感；
4. **成本也不让客户端自报**：传 token 桶原始计数，价格表留在服务端复算；
5. **上传先登记内容清单**：所有产物的 SHA-256 先建 intent，防重放也防半截上传污染数据；
6. **任务内容哈希只覆盖该覆盖的部分**：题面和环境要一致，答案和测试本来就不该进哈希；
7. **用租约时间差、轨迹审计这类旁路信号做冻结依据**，先冻结再复核，比先计分再追回对榜单的污染小得多；
8. **判分与反作弊职责分离**：作弊信号只记录不改判，交给独立审计流程处理，判分器保持简单可审计。

## 源码阅读索引

按这个顺序读最省力：

1. `README.md`（dradar）—— 产品规则的唯一权威说明（格子状态、倍率、积分、错误码都在这）；
2. `src/dradar/cells.py` —— 格子表结构与筛选逻辑（约 200 行）；
3. `src/dradar/api_client.py` —— 全部服务端端点，claim/checkout/submissions/intents；
4. `src/dradar/runner.py` —— `build_pier_command`（L945）与 `run_trial`（L3040），看 `--disable-verification` 和各 harness 分支；
5. `src/dradar/runloop.py` —— `_run_and_submit`（L2136）与 `_upload_trial`（L1423），看脱敏、intent、幂等补传；
6. `src/dradar/scrub.py` + `artifact_staging.py` + `submission_intent.py` —— 上传可信链三件套；
7. `src/dradar/pier_checkpoint.py` —— 30 秒 checkpoint 与恢复校验；
8. `docker/egress-proxy/start-squid.sh` —— 网络白名单的实际形态；
9. deep-swe 任务仓库的 `tasks/<task-id>/tests/` —— `grader.py`、`config.json`、`test.sh`，判分逻辑全公开。

服务端的 IQ 聚合、积分倍率、降智预警实现不在开源仓库内，但关键口径可以从公开接口直接读到：大表 `https://api.codexradar.com/api/v1/table`（scoring_mode、rolling_window、策略版本），判分数据 `https://api.codexradar.com/api/v1/intelligence-efficiency`（mode、method、逐档位 IQ 与样本数）。

## 参考链接

- dradar 开源仓库：https://github.com/codex-radar/dradar
- 任务大表与领取：https://deng.codexradar.com
- IQ 榜单主站：https://codexradar.com
- DeepSWE 任务仓库：https://github.com/datacurve-ai/deep-swe
