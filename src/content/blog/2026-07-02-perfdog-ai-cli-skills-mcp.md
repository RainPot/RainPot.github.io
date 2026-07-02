---
title: "PerfDog AI 工具体系拆解：CLI、MCP 与 Skills 是怎么接起来的"
description: "基于 PerfDog 当前官方 CLI、远程 MCP schema 和三套 Skills，拆解它如何把本地采集、云端报告分析和 Agent SOP 接成一条性能测试闭环。"
date: "2026-07-02"
tags: ["PerfDog", "MCP", "Skills", "CLI", "性能测试", "源码拆解"]
draft: false
featured: false
readingTime: 15
---

采集时间：2026-07-02

PerfDog 当前提供的 AI 工具能力不是一个孤立功能，而是一套面向 Agent 的性能测试工具链：CLI 负责把本地设备测试自动化，MCP 负责把云端报告开放成可查询的数据接口，Skills 负责把测试和分析流程固化成 Agent 可执行的 SOP 与约束。

三类组件的分工如下：

- `perfdog-service-cli`：本地采集控制面，入口命令是 `perfdog-service`，通过 gRPC 连接本机 PerfDog Service。
- `https://perfdog.qq.com/mcp`：远程 MCP 服务，暴露 15 个报告查询、诊断、对比、分享工具。
- `perfdog-performance` / `perfdog-report-analysis` / `perfdog-service-test`：三套 Skills，把自然语言任务路由到 CLI 或 MCP，并约束 Agent 不编造命令、不编造指标。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="PerfDog AI 工具体系总览" src="/images/perfdog-ai-tooling/perfdog-ai-tooling-overview.drawio.png" style="width: 100%; max-width: 100%; height: auto; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">图中需要关注三层边界：Skills 只做路由和约束，CLI 连接本地 Service 采集，MCP 读取云端报告。</p>
</div>

## 能力来源和分析对象

本文基于官方首页、三篇官方说明、PyPI 上的 CLI wheel、三个 Skills zip，以及 MCP 的 `initialize` 和 `tools/list` 返回进行分析。

| 类型 | 来源 | 本地文件 |
| --- | --- | --- |
| CLI 文档 | `https://perfdog.qq.com/article_detail?id=10282&issue_id=0&plat_id=1` | `sources/article_10282.txt` |
| MCP 文档 | `https://perfdog.qq.com/article_detail?id=10280&issue_id=0&plat_id=1` | `sources/article_10280.txt` |
| Skills 文档 | `https://perfdog.qq.com/article_detail?id=10281&issue_id=0&plat_id=1` | `sources/article_10281.txt` |
| CLI 包 | PyPI `perfdog-service-cli==1.0.1` | `downloads/perfdog_service_cli-1.0.1-py3-none-any.whl` |
| CLI 解包源码 | wheel 解压 | `downloads/perfdog_service_cli-1.0.1/` |
| Skills 包 | `https://down.perfdog.qq.com/skills/*.zip` | `downloads/perfdog-*.zip` |
| MCP schema | `https://perfdog.qq.com/mcp` | `sources/mcp_tools_list.sse` |

需要先明确边界：MCP 是远程 SSE 服务，不存在可下载的“本地 MCP 包”。本文分析的是远程 MCP 服务的协议握手信息和工具 schema。PerfDog Service 本体也不在本文范围内，CLI 只是通过本地 Service 完成真实采集。

## CLI：面向自动化的 Service 控制面

官方 CLI 包名是 `perfdog-service-cli`。公开 PyPI 当前版本为 `1.0.1`，wheel 上传时间是 `2026-06-10T06:53:15Z`，包大小 81835 字节，入口点是：

```ini
[console_scripts]
perfdog-service = perfdog_service_cli.cli.main:main
```

CLI 的职责边界比较清晰：命令层用 Click 定义参数和输出格式，业务动作交给 `service_ops.py`，再由 `service_client.py` 通过 gRPC 调本地 PerfDog Service。它不是直接采集性能数据的二进制探针，而是 PerfDog Service 的自动化控制面。

### 安装口径有一个不一致点

官方 CLI 文档写的是 Python 3.7+：

```bash
pip install perfdog-service-cli
```

但 wheel 的 `METADATA` 写的是：

```text
Requires-Python: >=3.10
```

实际落地时应以包元数据为准，至少准备 Python 3.10。Skills 文档里还出现了带腾讯 PyPI 镜像鉴权的安装示例；公开 PyPI 当前也能直接安装 `1.0.1`。

### 配置模型：命令行参数 > 环境变量 > 本地配置

CLI 的配置文件放在：

```text
~/.perfdog/config.yaml
```

关键配置包括：

- `service_token`：PerfDog Service Token。
- `service_path`：PerfDog Service 可执行文件路径。
- `port`：本地 Service gRPC 端口，默认 `23456`。

对应环境变量是：

```text
PERFDOG_SERVICE_TOKEN
PERFDOG_SERVICE_PATH
PERFDOG_SERVICE_PORT
```

常见初始化命令是：

```bash
perfdog-service config set token YOUR_SERVICE_TOKEN
perfdog-service config set path "/path/to/PerfDogService"
perfdog-service config show
perfdog-service connect
perfdog-service devices
```

如果本地 Service 没启动，但已经配置了 `service_path`，CLI 会尝试用 `subprocess.Popen([service_path, str(port)])` 拉起 Service，再重试登录。登录动作本质上是向本地 gRPC 调 `loginWithToken`。

### 命令面：一键测试和手动编排都保留

`perfdog-service --help` 当前暴露 45 个顶层命令。可以按用途分成几类：

| 类型 | 代表命令 |
| --- | --- |
| 连接与状态 | `connect`、`disconnect`、`ping`、`devices`、`status` |
| 设备初始化与查询 | `init-device`、`apps`、`app-processes`、`processes`、`device-info`、`cpu-info` |
| 一键采集 | `test-app`、`test-windows`、`test-console`、`test-network` |
| 手动采集 | `start`、`label`、`note`、`stop`、`save` |
| 弱网与采集配置 | `network-templates`、`change-network-template`、`set-screenshot-interval`、`set-memory-freq` |
| 归档与分享 | `create-task`、`archive-case`、`share-case` |
| 远程与主机 | `add-console`、`launch-remote-collector`、`refresh-remote` |

一键命令适合 CI/CD 或简单场景：传入设备、包名和时长后，CLI 负责完成连接、初始化、采集、停止和保存。手动命令适合真实业务流：先 `start`，在关键操作点打 `label` 或 `note`，最后 `stop` 和 `save`。

源码里有一个重要细节：`start`、`stop`、`save` 可能由不同 Agent 调用或不同 shell 进程执行，所以 CLI 不只在进程内保存会话，还会写：

```text
~/.perfdog/sessions.json
```

这使跨进程测试流程可以恢复上下文。对 Agent 来说，这比依赖长驻 CLI 进程更可靠，因为 Agent 调用工具通常是离散命令。

### 实时输出是面向 Agent 做过优化的

CLI 支持实时打印性能数据，默认格式是 `toon`，也支持 `structured` JSONL、`single-line` 和 `table`。指标类型覆盖 `fps`、`cpu`、`memory`、`gpu`、`jank`、`network`、`all`。

`toon` 默认值不是面向人工阅读表格，而是面向大模型上下文压缩的 Token-Oriented Object Notation。CLI 不只支持脚本调用，也考虑了 Agent 读取流式结果时的 token 成本。

## MCP：不是采集器，是云端报告数据接口

官方 MCP 地址是：

```text
https://perfdog.qq.com/mcp
```

它是远程 SSE MCP 服务。无合适 `Accept` 头时会返回 406；带上 `application/json, text/event-stream` 后，`initialize` 返回：

```text
serverInfo.name = PerfDogMcpTools
serverInfo.version = 1.27.0
protocolVersion = 2024-11-05
```

官方文档要求在 MCP 客户端里配置 `Mcp_token`：

```json
{
  "mcpServers": {
    "perfdog-mcp-tools": {
      "url": "https://perfdog.qq.com/mcp",
      "headers": {
        "Mcp_token": "YOUR_MCP_TOKEN"
      }
    }
  }
}
```

Token 在 PerfDog 的 token 页面获取，文档描述为 `mcp_` 开头的字母数字 token。该凭证需要和 CLI 使用的 Service Token 区分开：CLI 控本地 Service，MCP 读云端报告，两者不是同一个凭证。

### 15 个工具分成五类

`tools/list` 返回 15 个工具：

| 类别 | 工具 |
| --- | --- |
| 查找入口 | `perfdog_list_projects`、`perfdog_get_filter_options`、`perfdog_search_cases`、`perfdog_list_tasks` |
| 报告主数据 | `perfdog_get_metrics`、`perfdog_get_report_data`、`perfdog_get_time_series`、`perfdog_get_time_range_detail`、`perfdog_list_labels` |
| 下降与根因 | `perfdog_get_drop_context`、`perfdog_analyze_root_cause` |
| 对比与分享 | `perfdog_compare_reports`、`perfdog_create_compare`、`perfdog_gen_snapshot` |
| 展示模板 | `perfdog_custom_template` |

该分组基本对应一次报告分析的路径：

1. 不知道 `case_id` 时，先从项目、任务、筛选项里找报告。
2. 知道 `case_id` 后，先 `get_metrics` 确认有哪些指标。
3. 用 `get_report_data` 获取统计、趋势、相关性、异常点。
4. 发现问题后，再拉时序、时间段详情、下降上下文或根因分析。
5. 需要复盘或协作时，生成对比链接或 snapshot。

MCP 的 schema 不只包含参数定义，还包含大量“AI 分析引导”：比如只使用工具返回的数据、每个结论要有证据、相关性不代表因果、未返回指标不能分析。由此可见，PerfDog 把 MCP 定位成 Agent 数据分析接口，而不是普通 HTTP API 的简单转译。

### MCP 的边界

MCP 不负责本地设备采集，也不启动 PerfDog Service。它只面向已经上传到 PerfDog 云端的报告工作。`case_id` 是 CLI 和 MCP 串联的关键：CLI 采集并保存后拿到 `case_id`，MCP 再用该 `case_id` 读取和分析云端报告。

无效 token 也能拿到 `tools/list` 的 schema，但这只能说明工具描述公开可见；真正调用报告数据仍应使用合法 MCP Token。

## Skills：把专家 SOP 写成 Agent 可执行规则

官方提供了三个 Skills zip：

| Skill | 作用 | 依赖 |
| --- | --- | --- |
| `perfdog-performance` | 全流程入口，串联设备测试和报告分析 | CLI + MCP |
| `perfdog-report-analysis` | 只分析云端已有报告 | MCP |
| `perfdog-service-test` | 只控制本地设备采集 | CLI |

其中 `perfdog-performance` 是推荐入口。它的 `SKILL.md` 明确把用户意图分成配置引导、设备测试、报告分析、对比分析、全流程串联几类，然后决定应该走 CLI 还是 MCP。它已经包含另外两个 Skill 的能力，所以大多数用户不需要同时装三个。

### report-analysis：核心是防幻觉的数据分析流程

`perfdog-report-analysis` 的 `SKILL.md` 有 792 行。它把 MCP 工具按任务拆开，并规定了不知道 `case_id` 时的查找链路：

- 已知项目名：先 `perfdog_list_projects`。
- 条件模糊：先 `perfdog_get_filter_options`，再 `perfdog_search_cases`。
- 已知任务：先 `perfdog_list_tasks`，再按任务找 case。

拿到报告后，它要求按渐进式路径分析：先确认指标，再看报告主数据，再按需看时序、时间段、标签、下降上下文、根因和对比。更关键的是，它反复强调“只用工具返回的数据”。这类规则的作用是约束 Agent 不要凭经验写“FPS 波动可能是 CPU 导致”的空泛结论。

### service-test：核心是把 CLI 命令变成可执行测试 SOP

`perfdog-service-test` 的 `SKILL.md` 有 1113 行，是三者里最长的。它做的事情不是再实现一个采集器，而是规定 Agent 如何安全地调用 `perfdog-service`：

- 只能使用真实 CLI 子命令和参数。
- 必须先 `connect`。
- 查应用、进程、状态前必须先 `init-device`。
- 设备 ID、包名、PID 必须从命令输出里拿，不能猜。
- `case_id` 必须从 `save` 或一键测试输出里拿，不能编。
- USB 和 WIFI 同设备同时出现时，优先 USB，并统一加 `--conn-type USB`。

该 Skill 还把 Android/iOS App、Windows 进程、PlayStation/Xbox、弱网、多场景标签、远程 Windows 等场景拆成不同路径。它的价值在于把性能测试中的前置检查、命令顺序和边界条件沉淀为 Agent 可加载的规则包。

### performance：组合路由层

`perfdog-performance` 负责把两条线串起来：

1. 新建测试并分析某个 App：先走 CLI，采集保存后拿 `case_id`。
2. 分析已有报告：跳过采集，直接走 MCP。
3. 对比不同版本或设备：用 MCP 的搜索、对比和报告数据工具。
4. 配置缺失时：引导分别配置 Service Token、MCP Token、Service 路径。

PerfDog Skills 的定位不是执行引擎，而是行为层。真正执行动作的是 CLI 和 MCP；Skills 负责告诉 Agent 在什么时候调用哪个工具、调用前要检查什么、输出时必须给哪些证据。

## 全流程：case_id 是唯一纽带

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="PerfDog 全流程执行链路" src="/images/perfdog-ai-tooling/perfdog-ai-tooling-flow.drawio.png" style="width: 100%; max-width: 100%; height: auto; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">图中需要关注 `case_id` 的位置：它把本地采集结果和云端 MCP 分析链路接起来。</p>
</div>

完整链路可以拆成两条：

- 没有报告：自然语言目标进入 `perfdog-performance`，配置凭证，CLI 连接本地 Service，选择设备和应用，开始采集，保存到云端，得到 `case_id`。
- 已有报告：自然语言目标直接进入 MCP 分析链路，用 `case_id` 拉指标、统计、时序、标签、根因和对比。

`case_id` 是整个体系里最重要的连接点。CLI 端所有采集动作最终要落到云端报告，MCP 端所有分析动作都从云端报告开始。没有 `case_id`，MCP 就必须先用项目、任务、设备、版本等条件查找；没有上传报告，MCP 就没有可分析的数据。

## 工程判断

这套设计的关键取舍是边界清楚。

CLI 不试图分析云端历史数据，它专注本地采集控制；MCP 不试图控制设备，它专注报告数据读取和诊断；Skills 不试图替代工具实现，它专注流程路由和行为约束。三者放在一起，才构成“自然语言发起性能测试并自动分析”的闭环。

它适合这些场景：

- CI/CD 里做单设备或少量设备的自动化性能采集。
- 测试完成后立刻把报告交给 Agent 做指标解释。
- 已有 PerfDog 云端报告，需要自然语言查询、对比、生成结论。
- 团队希望把性能测试 SOP 固化到 Agent，而不是靠人工记命令。

它不适合这些场景：

- 没有 PerfDog Service 或没有合法 Service Token。
- 报告不上传云端，只想离线分析本地原始数据。
- 期望 MCP 直接控制设备采集。
- 期望工具内置多设备并发调度系统。CLI 有原子命令，但并发编排仍要由 CI 或上层脚本负责。

落地时需要关注三个容易混淆的问题：

1. Python 版本：官方说明写 Python 3.7+，但当前 wheel 要求 `>=3.10`。
2. Token 混淆：Service Token 给 CLI，用来连接本地 Service；MCP Token 给 MCP，用来读云端报告。
3. 误解 Skills：Skills 不是二进制工具，也不会自己采集或分析数据；它是 Agent 的规则、流程和安全边界。

## 证据索引

本文保留了本地证据，便于复核。站点内发布图片和图源放在 `public/images/perfdog-ai-tooling/`，原始资料和解包文件保留在写作工作区：

- 官网首页和前端资源：`sources/home.html`、`sources/js/chunk-36434a98.caa11161.js`
- 官方说明正文：`sources/article_10280.txt`、`sources/article_10281.txt`、`sources/article_10282.txt`
- PyPI 元数据：`sources/pypi_perfdog_service_cli.json`
- CLI 入口点：`downloads/perfdog_service_cli-1.0.1/perfdog_service_cli-1.0.1.dist-info/entry_points.txt`
- CLI 核心源码：`downloads/perfdog_service_cli-1.0.1/perfdog_service_cli/cli/main.py`、`downloads/perfdog_service_cli-1.0.1/perfdog_service_cli/service/service_client.py`、`downloads/perfdog_service_cli-1.0.1/perfdog_service_cli/service/service_ops.py`、`downloads/perfdog_service_cli-1.0.1/perfdog_service_cli/service/perf_data_printer.py`
- MCP 工具 schema：`sources/mcp_tools_list.sse`
- Skills 解包目录：`downloads/skills/perfdog-performance/`、`downloads/skills/perfdog-report-analysis/`、`downloads/skills_fixed/perfdog-service-test/`
- 图源与导出图：`public/images/perfdog-ai-tooling/drawio/perfdog-ai-tooling-overview.drawio`、`public/images/perfdog-ai-tooling/drawio/perfdog-ai-tooling-flow.drawio`、`public/images/perfdog-ai-tooling/*.png`
