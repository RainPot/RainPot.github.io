---
title: "AJ-Bench：让 Judge Agent 进入环境，而不是只读轨迹"
description: "拆解 AJ-Bench 如何评测 Agent-as-a-Judge：从 Search、DS、GUI 三类数据构造，到代码里的 pipeline、MCP 工具、轨迹回放、桌面环境交互和 F1 聚合。"
date: "2026-07-01"
tags: ["AI Agent", "Agent-as-a-Judge", "Benchmark", "GUI Agent", "源码拆解"]
draft: false
featured: false
readingTime: 18
---

AJ-Bench 关注的不是“模型能不能给回答打分”，而是另一个更难的问题：当被评估对象是一条 agent 轨迹时，judge 能不能自己进入环境、调用工具、拿到证据，再判断这条轨迹到底成没成功。

这和常见的 LLM-as-a-Judge 有本质差别。LLM-as-a-Judge 通常只读题目、回答或轨迹文本；AJ-Bench 里的 Agent-as-a-Judge 会访问网页、文件系统、数据库或桌面环境。它要判断的不是文本像不像正确答案，而是环境状态、过程证据和最终结果能不能支撑这个判断。

源码版本固定在 [aj-bench/AJ-Bench](https://github.com/aj-bench/AJ-Bench) `main` 分支 commit `e93f3cdc2aeadda11176526ac46cc4c2c9614aa9`，提交时间是 `2026-04-21 14:55:58 +0800`。论文页面是 [AJ-Bench: Benchmarking Agent-as-a-Judge for Environment-Aware Evaluation](https://aj-bench.github.io/)，arXiv 版本是 [`2604.18240`](https://arxiv.org/abs/2604.18240)，官方页面标注为 ACL Findings 2026。

先放两张论文官方图。第一张是论文 Figure 1：同一个问题里，LLM-as-a-Judge 因为没有外部证据只能保守判断；Agent-as-a-Judge 会调用浏览器拿证据，再给出和环境证据一致的结论。

<div style="margin: 24px 0;">
  <img alt="AJ-Bench 论文 Figure 1：Agent-as-a-Judge 通过工具和环境反馈验证答案" src="/images/aj-bench/official/aj-bench-paper-figure-1.png" style="display: block; width: 760px; max-width: 100%; margin: 0 auto;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：AJ-Bench paper Figure 1，来自 AJ-Bench 官方仓库 assets。</p>
</div>

这篇按三条线拆：

1. benchmark 本身怎么构造：Search、DS、GUI 三个域分别在验证什么；
2. 代码怎么跑：统一入口、domain pipeline、task/state manager、agent、结果聚合；
3. 它暴露了什么结论：工具交互比单纯提高 reasoning effort 更关键，但环境稳定性和模态选择仍是难点。

第二张是论文 Figure 2，也是官方 README 首图。它把 benchmark 构造和 evaluation process 放在一张图里：上半部分是任务设计、轨迹收集和标注；下半部分是环境初始化、轨迹回放和三种验证模式。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AJ-Bench 论文 Figure 2：benchmark 构造和评测流程" src="/images/aj-bench/official/aj-bench-paper-figure-2.png" style="width: 960px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：Overview of the benchmark and evaluation pipeline，来自 AJ-Bench 官方仓库 assets / README。</p>
</div>

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AJ-Bench 环境感知 Agent-as-a-Judge 评测框架" src="/images/aj-bench/aj-bench-overview.drawio.png" style="width: 960px; max-width: none; margin: 0;" />
</div>

## 1. AJ-Bench 评测的不是回答，而是“判断能力”

AJ-Bench 的数据规模不算巨大，但覆盖面很有针对性：

```text
Search：Wide 9 个任务，Deep 52 个任务，183 条 item/trajectory 级标注
DS：FileSystem 24 个任务，Postgres 18 个任务，229 条轨迹
GUI：PPT 21 个任务，Word 12 个任务，Excel 19 个任务，104 条轨迹
总计：155 个任务，516 条标注轨迹，60 个工具
```

官方 README 里给出的表格也是这个数字：

```text
Task Count:       9 + 52 + 24 + 18 + 21 + 12 + 19 = 155
Trajectory Count: 27 + 156 + 129 + 100 + 42 + 24 + 38 = 516
Tool Count:       Search 22, DS 14/9, GUI 15
```

这三个域对应三类不同的 judge 能力。

Search 看的是信息获取。给定查询和候选回答，judge 不能只凭模型内部知识判断，需要打开网页、搜索外部来源、逐项核对证据。

DS 看的是状态验证。文件系统和 PostgreSQL 任务不能靠轨迹里“我完成了”来判断，必须检查文件、目录、数据库表、查询结果等最终环境状态。

GUI 看的是过程和最终状态。Word、PPT、Excel 任务里，截图、accessibility tree、轨迹回放都可能有用；但最终判断仍要落到真实桌面环境的最终状态。

论文里最直接的实验结论是：同一个底座模型开启 Agent-as-a-Judge 后，整体 F1 明显高于只读文本的 LLM-as-a-Judge。官网 leaderboard 当前显示，`gpt-5-mini-low` 从 `59.00` 提升到 `72.41`，整体提升 `+13.41`；`deepseek-v3.2` 从 `64.49` 提升到 `77.34`，整体提升 `+12.85`。这说明它测的不是“模型会不会说理”，而是模型能不能把工具和环境证据用起来。

## 2. 仓库结构：Search、DS、GUI 是三条不同 pipeline

仓库入口很清楚：

```text
agent_judge_pipeline.py          统一分发入口
agent_judge_search_pipeline.py   Search 域 Agent-as-a-Judge
agent_judge_ds_pipeline.py       DS 域 Agent-as-a-Judge
agent_judge_gui_pipeline.py      GUI 域 Agent-as-a-Judge
src/agent_judge_search_evaluator.py
src/agent_judge_ds_evaluator.py
src/agent_judge_gui_evaluator.py
src/agents/
src/mcp_services/
src/data/
tasks/agent_as_a_judge/
```

统一入口只是按第一个参数分发：

```python
_MODULE_MAP = {
    "ds": "agent_judge_ds_pipeline",
    "gui": "agent_judge_gui_pipeline",
    "search": "agent_judge_search_pipeline",
}

mod = importlib.import_module(module_name)
mod.main()
```

这个入口没有把三类评测强行抽成完全一样的流程。Search 复用 MCP evaluator 主链路；DS 有轨迹回放和 judge prompt；GUI 则另起一套桌面环境、AWS worker、截图和 a11y tree 处理逻辑。

原因也很直接：这三个域的“证据”不一样。

```text
Search：网页内容、来源链接、候选 item 是否被证据支持
DS：messages.json 轨迹 + 文件/数据库最终状态
GUI：task json + traj.jsonl + screenshot + a11y tree + live desktop
```

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="AJ-Bench 代码运行链路" src="/images/aj-bench/aj-bench-runtime-flow.drawio.png" style="width: 960px; max-width: none; margin: 0;" />
</div>

这张图里的关键点是：三条 pipeline 最后都会落到结构化结果，但中间拿证据的方式完全不同。

## 3. 基础执行链路：Setup、Execute、Verify、Cleanup

Search 和普通 MCP 评测复用 `MCPEvaluator` 的四阶段结构。核心代码在 `src/evaluator.py` 和 `src/agent_judge_search_evaluator.py`：

```python
setup_success = self.state_manager.set_up(task)
task_instruction = self.task_manager.get_task_instruction(task)
agent_result = self.agent.execute_sync(task_instruction, str(execution_log_path))
self.state_manager.set_verification_environment(str(messages_path))
result = self.task_manager.execute_task(task, agent_result)
self.state_manager.clean_up(task)
```

这个流程把 agent 执行和任务验证分开。模型先通过 MCP 工具完成或判断任务，生成 `messages.json`；验证阶段再由 `task_manager.execute_task(...)` 跑验证脚本，或从结果中解析 label。

`BaseTaskManager.execute_task()` 有一个值得注意的选择：即使 agent 执行失败，也会继续跑验证。

```python
agent_success = agent_result.get("success", False)

if not agent_success:
    agent_error = agent_result.get("error", "Agent execution failed")

verify_result = self.run_verification(task)
verification_success = verify_result.returncode == 0
```

这样做是合理的。评测系统关心的是“环境最终是否满足要求”或“judge 输出是否匹配标签”，而不是 agent 自己报告成功与否。模型中途报错但留下了可验证结果，仍然应该由 verifier 决定；反过来，模型说成功也不能直接算成功。

## 4. Search：先抽证据，再判 item

Search 域有两个来源：Mind2Web-2 和 WideSearch。数据文件在：

```text
src/data/Search/deep_llm_judge_origin.jsonl
src/data/Search/deep_llm_judge_single_row.json
src/data/Search/wide_llm_judge_single_row.jsonl
tasks/agent_as_a_judge/ground_truth/
```

Search 的麻烦在于，回答通常不是单个 yes/no，而是一个长列表或表格。AJ-Bench 会把候选回答拆成 single-row，再逐项验证。对应的 prompt 在 `tasks/agent_as_a_judge/prompt.py`：

```python
SINGLE_ROW_SUMMARY_PROMPT = """
You are an assistant specialized in evidence extraction from web pages.

Your task is NOT to answer the Query, and NOT to validate Single-Row.
Your task is to extract evidence from the Page Content ...
"""
```

这段 prompt 的约束很关键：摘要模型不是直接当 judge，而是先从网页内容里抽和 query、single-row 相关的证据。也就是说，Search pipeline 把问题拆成两步：

```text
1. 用 Playwright/MCP 打开网页，收集候选证据；
2. 对 single-row 输出 0/1 标签，再和 ground truth 对比。
```

验证脚本 `tasks/agent_as_a_judge/verify.py` 只认一种最终格式：

```python
LABEL_PATTERN = r"Response:\s*\[([01])\]"

extracted_label = extract_label(combined_content)
if int(extracted_label) == int(ground_truth_label):
    return True
```

这里没有让模型输出一篇开放式评语，而是强制落到 `[0]` 或 `[1]`。Search 的 F1 也是从这些 item 级标签聚合出来的。

这点比 leaderboard 更值得看。AJ-Bench 并不是让 judge 模型“凭感觉比较两个回答”，而是把回答拆成可核对的最小单元，要求它给出能和人工标注对齐的二值判断。

## 5. DS：回放轨迹后检查文件和数据库状态

DS 数据在：

```text
src/data/DS/filesystem
src/data/DS/postgres
```

本地数据里可以看到成功和失败轨迹是成对保留的：

```text
src/data/DS/filesystem/.../success/<model_run>/messages.json
src/data/DS/filesystem/.../fail/<model_run>/messages.json
src/data/DS/postgres/.../success/<model_run>/messages.json
src/data/DS/postgres/.../fail/<model_run>/messages.json
```

`src/agent_judge_ds_evaluator.py` 的类注释把流程说得很直接：

```text
1. Collect trajectories
2. Set up the environment state
3. Replay the trajectory
4. Create judge agent with verification prompt
5. Extract verdict from judge output
```

DS judge 的系统 prompt 也很明确：

```python
JUDGE_SYSTEM_PROMPT = """
You are a verification agent.
You have access to the same tools as the original agent.
Use these tools to inspect the current state of the environment ...
"""
```

这就是 Agent-as-a-Judge 和 LLM-as-a-Judge 的分界。LLM judge 只能看轨迹文本；DS judge 会拿到同样的 MCP 工具，去检查文件或数据库。

文件系统任务由 `FilesystemStateManager` 做隔离。它不会直接在原始目录上操作，而是给每个任务创建 backup 环境：

```python
self._set_dynamic_test_root(task)
self._create_backup(task)
self.current_task_dir = self.backup_dir
os.environ["FILESYSTEM_TEST_DIR"] = str(self.current_task_dir)
```

Postgres 任务则会为任务创建独立数据库。如果存在模板库，就从模板复制：

```python
db_name = f"mcpmark_{task.category_id}_{task.task_id}_{self._get_timestamp()}"

if self._database_exists(task.category_id):
    self._create_database_from_template(db_name, task.category_id)
else:
    self._create_empty_database(db_name)
```

这类隔离对 judge benchmark 很重要。否则评测过程中一次错误写入可能污染后续任务，最后测到的就不是 judge 能力，而是环境残留。

## 6. GUI：不是看轨迹描述，而是进入桌面最终状态

GUI 是 AJ-Bench 里最接近真实 agent 评测的一部分。数据结构是：

```text
src/data/GUI/PPT/<task_id>/true/traj.jsonl
src/data/GUI/PPT/<task_id>/false/traj.jsonl
src/data/GUI/Word/<task_id>/true/traj.jsonl
src/data/GUI/Excel/<task_id>/false/traj.jsonl
```

每个任务通常有 `true` 和 `false` 两条轨迹，并保留截图、`traj.jsonl`、任务 JSON 和结果文件。本地统计也能对上 README：

```text
PPT：21 个任务，42 条轨迹
Word：12 个任务，24 条轨迹
Excel：19 个任务，38 条轨迹
```

GUI 的单条评测入口在 `src/agent_judge_gui_evaluator.py`：

```python
self.load_task_data(pairs_root_dir, task_id, trajectory_type)
self.initialize_environment()
self.replay_trajectory()
result = self.start_evaluation()
self._cleanup_environment()
```

这段流程说明 GUI judge 不是只读 `traj.jsonl`。它会先加载任务和轨迹，再初始化真实环境，回放轨迹，把环境推进到执行后的最终状态，然后开始交互式验证。

GUI prompt 里有几条规则写得很重：

```text
PRIORITIZE evidence gathered via DIRECT INTERACTION with the live environment
VIEW_TRAJECTORY_STEP is SUPPLEMENTARY
Your final judgment should be based on the CURRENT/FINAL environment state
```

这几句抓住了 GUI 验证最容易出错的地方：中间步骤可能失败后又被修正，a11y tree 可能截断，截图可能只显示当前页，目标对象可能在另一个 sheet、tab 或 slide。只看轨迹文本很容易误判。

所以 GUI action space 也不是普通工具调用，而是桌面操作：

```text
CLICK / DOUBLE_CLICK / RIGHT_CLICK / SCROLL
TYPING / PRESS / HOTKEY
VIEW_TRAJECTORY_STEP
DONE
```

并且 prompt 要求每轮只输出一个 `ACTION` 和一个 `REASONING`。这能让系统逐步执行、返回观察，再由 judge 继续决策。评测逻辑更像一个“验证 agent”，不是一次性分类器。

## 7. LLM-as-a-Judge 基线为什么吃亏

仓库里也提供了 LLM-as-a-Judge 脚本，例如：

```text
src/llm-judge/DS/llm_judge_evaluator.py
src/llm-judge/GUI/llm_judge_evaluator.py
src/llm-judge/Search/
```

DS 的 LLM judge prompt 明确限制了输入来源：

```python
DEFAULT_AGENT_JUDGE_WIDESEARCH_PROMPT = """
Base your judgment only on the information provided
in the Task Description and the Agent Trajectory.
"""
```

这就是它的天花板。对于简单格式错误或明显漏步骤，文本 judge 可以发现；但对以下问题，它天然缺证据：

```text
文件有没有真的写到目标目录；
数据库表里最终行数或字段值是否正确；
网页来源是否支持某个 single-row；
PPT/Word/Excel 当前 UI 状态是否满足任务要求；
轨迹中间错误是否已经在后续被修正。
```

AJ-Bench 的实验结果和代码结构是一致的：当任务需要外部证据时，只读轨迹文本的 judge 会不稳定；能进环境的 judge 才有机会把判断落到状态和证据上。

## 8. 结果聚合：最后仍是二分类指标

虽然中间流程很复杂，最终指标还是二分类：judge 输出和人工标注是否一致。

DS 的 `JudgeStats` 里直接维护混淆矩阵：

```python
true_positives: int = 0
true_negatives: int = 0
false_positives: int = 0
false_negatives: int = 0
```

F1 的计算也就是标准公式：

```python
return 2 * (self.precision * self.recall) / (self.precision + self.recall)
```

Search 的 `deep_eval.py` 和 `wide_eval.py` 会从 `verification_summary.json` 读取 `match`，再按 task 和 model 聚合。GUI 的 `gui_eval.py` 会读取 `unified_evaluation_result.json`，按 PPT、Word、Excel 统计 precision、recall 和 F1。

所以 AJ-Bench 的复杂度不在指标，而在“如何让 judge 得到可靠证据”。指标保持简单，反而方便比较不同模型和不同交互设置。

## 9. 两个消融结论：多想不一定有用，多交互通常有用

论文里的 ablation 结论很值得和代码一起看。

第一，提高 reasoning effort 不等于 judge 能力提升。论文表格显示，`gpt-5-mini` 的 medium 通常比 low 好，但 high 不稳定；`deepseek-v3.2` 的 thinking 版本整体还略低于 no-thinking。论文给出的解释是：更强的内部推理能力，不等价于更好地调用工具、分析工具输出和做可靠决策。

这和代码结构对得上。`AgentJudgeSearch`、`SingleJudgeAgentMCP` 这类 agent 的关键能力不只是多生成 reasoning token，而是：

```text
什么时候该调用工具；
调用哪个工具；
怎么从工具输出里抽证据；
证据不足时是否继续交互；
最终如何把证据转成二值判断。
```

第二，交互轮数通常更有用。论文里 interaction turns ablation 显示，增加最大交互轮数会提升 F1，尤其是初始预算较小时。GUI 的 Word 和 PPT 更敏感，因为它们经常需要翻页、选中对象、打开菜单或切换视图。

这也解释了 GUI prompt 里为什么反复强调“先探索所有相关 sheet/tab/view，再判断失败”。很多 GUI 任务的失败不是模型不会推理，而是证据没看全。

## 10. 工程取舍和边界

AJ-Bench 的工程实现有几个明显取舍。

第一，它复用了 MCPMark 的基础设施。README 也明确说明代码基于 MCPMark。这样能直接获得 MCP service、task manager、state manager、结果报告等组件，但代价是仓库里保留了不少通用服务代码，比如 Notion、GitHub、Supabase、Playwright WebArena 等，并不是所有都服务于 AJ-Bench 主实验。

第二，三类 domain 没有强行统一。Search、DS、GUI 的 evaluator 代码重复了一些 pipeline 参数和结果保存逻辑，但这换来了更明确的领域逻辑。GUI 尤其特殊，直接接 OSWorld 风格桌面环境和 AWS worker，很难塞进普通 MCP evaluator。

第三，环境依赖较重。Search 需要 Playwright 和外部网页；GUI 需要 AWS 环境；Postgres 需要数据库模板和 `pg_restore`；文件系统任务还可能下载测试环境。这些让 benchmark 更接近真实 agent 评测，也让复现实验更麻烦。

第四，Search 受网页稳定性影响。论文 limitations 也提到外部 web 环境和网络连通性会影响可靠性。对于公开 benchmark，这不是小问题：网页内容、反爬、区域化、页面结构变化都会影响 judge 拿到的证据。

第五，GUI 模态没有单一最优。论文的 multimodal ablation 说明，a11y tree、screenshot、mixed 在不同子域表现不同。混合模态在 Excel 上更有帮助，但也可能给简单场景引入噪声。这提醒我们，给 judge 更多输入不一定更好，输入要能帮助定位证据。

## 11. 可以借鉴的地方

AJ-Bench 最值得借鉴的不是 leaderboard，而是它把“评测 agent 行为”拆成了几件可工程化的事：

```text
轨迹要保留成功和失败样本；
标签要能回到可验证证据；
judge 要能访问和任务一致的环境；
执行环境要隔离，避免状态污染；
最终输出要收敛到可聚合标签；
LLM judge 和 Agent judge 要在同一批标注上对比。
```

这套思路适合很多内部 agent 评测。比如代码 agent、办公自动化 agent、数据分析 agent，都不应该只看最终回答。更可靠的方式是：保留轨迹，重建环境，让 judge agent 去检查最终状态，并把判断和人工标签对齐。

## 12. 阅读顺序

如果要继续读源码，可以按这个顺序：

```text
1. README.md
2. agent_judge_pipeline.py
3. agent_judge_search_pipeline.py
4. src/agent_judge_search_evaluator.py
5. tasks/agent_as_a_judge/prompt.py
6. tasks/agent_as_a_judge/verify.py
7. agent_judge_ds_pipeline.py
8. src/agent_judge_ds_evaluator.py
9. src/mcp_services/filesystem/*_manager.py
10. src/mcp_services/postgres/*_manager.py
11. agent_judge_gui_pipeline.py
12. src/agent_judge_gui_evaluator.py
13. src/agents/prompt/prompt_gui.py
14. src/eval/Search/*.py 和 src/eval/GUI/gui_eval.py
```

读完这些文件，AJ-Bench 的主线就比较清楚了：它不是在问“哪个模型更会当裁判”，而是在问“当裁判必须进入环境时，模型能不能拿到证据、理解证据，并做出和人工一致的二值判断”。

这个问题会越来越重要。Agent 训练和评测继续往真实环境走，reward 和 verifier 也不能只停留在文本层。AJ-Bench 给出的方向是：让 judge 也成为 agent。它会带来环境依赖、成本和稳定性问题，但这是评测真实 agent 行为绕不开的一步。
