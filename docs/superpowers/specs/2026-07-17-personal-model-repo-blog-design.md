# Persome Personal Model 源码拆解博客设计

## 目标

基于 `Intuition-Lab/personal-model` 当前 `main` 分支源码，写一篇面向 AI Agent 工程读者的中文博客。读者可以读少量代码，但不需要预先了解 Persome。文章要回答一个具体问题：macOS 上零散的屏幕活动，怎样经过确定性的状态整理、带证据的语义建模，最终变成可阅读的 `HUMAN.md`，并通过 MCP 提供给 Codex、Claude Code 等可信 Agent。

文章发布到 RainPotBlog，完成本地构建、图片和最终页面验收后，提交并推送当前 `main` 分支。

## 版本边界

- 源码仓库：`Intuition-Lab/personal-model`
- 固定版本：`main@fb3986d`
- Python 包版本：`0.3.2`
- 博客仓库：`RainPot/RainPot.github.io`
- 发布分支：`main`
- 分析结论只描述上述源码版本，不把 README 的产品表述当作实现事实；核心判断需要回到代码、配置、测试或运行结果。

## 叙事方案

写作前比较三种方案：

1. **执行链路方案：从屏幕活动到 `HUMAN.md`。** 优点是读者能沿一条真实数据流理解各模块，也能自然带出证据、隐私和 MCP；缺点是需要控制模块数量，避免写成目录导览。
2. **隐私与安全方案：本地优先到底做了什么。** 优点是主题集中，适合讨论权限、加密、loopback API 和模型 egress；缺点是难以解释 Personal Model 本体如何形成。
3. **Agent 接入方案：把 Persome 当作 MCP 记忆层。** 优点是离 Codex、Claude Code 的使用场景近；缺点是容易只写工具表，弱化采集、状态形成和 provenance。

采用方案 1。方案 2 和方案 3 分别成为“隐私边界”和“MCP 如何消费模型”两节，确保文章有一条主线，同时保留读者最关心的工程问题。

## 核心判断

文章围绕以下结论组织，并逐条寻找证据：

1. Persome 不是把屏幕截图直接交给 LLM 总结；采集、分钟级时间线、确定性会话切分与五分钟 reducer 先把状态整理出来，LLM 只进入后续语义建模阶段。
2. `Point → Line → Face → Volume → Root` 不是装饰性的命名，而是不同层级、不同来源约束的数据结构；重要结论保留 receipt，可以沿模型向证据回查。
3. `HUMAN.md` 是对已有模型快照的确定性阅读视图，不是第二套模型，也不是机器接口；版本化 JSON snapshot 才是机器契约。
4. “本地优先”不等于“永不出网”：采集、存储和 BM25 可以本地运行，但启用语义建模时，配置的 LLM provider 或显式授权的 Agent CLI 会接收阶段 prompt。
5. MCP 暴露的是读取、证据解析和显式纠错，不包含点击、输入、接管设备等 computer-use 动作；连接 MCP 等于授予个人数据访问能力。
6. 项目仍是 Alpha，真实采集依赖 macOS 13+；模型稀疏或 provider 不可用时，Runtime 会报告 degraded，而不是补造 Face、Volume 或 Root。

## 文章结构

1. 标题、摘要和一句话结论：先说明 Persome 的准确定位与版本。
2. 为什么需要 Personal Model：解释“记住聊天”与“建立可审计的个人模型”的区别。
3. 五分钟合成演示：给出不会读取真实个人数据的最小命令，并说明它能证明什么、不能证明什么。
4. 总览图：活动输入如何经过 capture、timeline、session、reducer、model build，最终到达 snapshot、`HUMAN.md`、MCP 和 viewer。
5. 状态形成：S0/S1、分钟块、会话切分、五分钟 reducer 与尾窗 finalizer 的职责边界。
6. 几何模型与证据链：解释 Point、Line、Face、Volume、Root、receipt、bitemporal history 和 correction。
7. 构建与降级：`ModelBuildCoordinator` 的阶段顺序、锁、manifest、degraded 语义和 Root 保护。
8. `HUMAN.md` 与 JSON snapshot：面向人和面向机器的两个视图为何分开。
9. MCP 接入：搜索、读取 receipt、解析证据、纠错，以及 stdio/HTTP 的安全边界。
10. 本地优先的真实边界：权限、数据目录、截图策略、LLM egress、prompt injection 和导出风险。
11. 工程取舍：确定性状态整理与 LLM 语义建模分层、Markdown/SQLite 双重可读性与一致性成本、证据链收益与复杂度。
12. 适用与不适用场景、源码阅读索引和收束结论。

## 图表设计

所有机制图使用 draw.io，保留 `.drawio` 源文件并导出可嵌入编辑信息的 `.drawio.png`。博客正文实际宽度按约 760px 验收。

1. **Runtime 总览图**：唯一目标是展示从输入到输出的完整数据流。采用自上而下分层布局，控制在八个主节点以内，长解释移到图注。
2. **模型证据链图**：唯一目标是解释 Point、Line、Face、Volume、Root 怎样聚合，以及 receipt 如何反向回查。颜色之外同时使用层级和标签表达语义。
3. **访问与隐私边界图**：唯一目标是区分本机数据面、MCP 客户端、loopback HTTP 与可选 LLM egress。外部系统使用虚线边框，出网路径明确标注“仅配置后”。

图中不放长函数名；源码路径、配置名和边界说明留给正文。每张图都要在源尺寸和约 760px 最终展示尺寸下目检，检查裁切、文字、对比度和箭头通道。

## 证据策略

- 入口证据：CLI、daemon、capture scheduler、timeline/session tick、model build coordinator、MCP server。
- 触发条件：一分钟 timeline block、五分钟 active reducer、session-end trailing window、build lock、degraded guard。
- 数据流：`capture-buffer/`、`memory/*.md`、`index.db`、`model-build.json`、`HUMAN.md`、snapshot/export。
- Prompt 与策略：只引用能说明证据约束、禁止臆造、分类或结构合成的短 prompt；每段不超过 12 行。
- Provenance：receipt、source triplet、evolution history、resolve_evidence 的 `sources/context/history` 区分。
- 复用路径：MCP `search`、`read_receipt`、`resolve_evidence`、`get_model_snapshot`、`correct_memory`。
- 边界证据：安全文档与实际 guard、测试、错误分支交叉核对；README 与实现不一致时以代码为准并明确指出。

## 失败处理

- 合成 demo 如果因环境、依赖或端口失败，不写成“项目不可运行”；记录具体失败，改用对应单测和静态源码证明，并在文章中收窄结论。
- 真实采集需要 macOS 权限，不在写作过程中请求访问用户真实屏幕或 `~/.persome`；演示只使用仓库自带合成数据。
- draw.io CLI 如果不可用或异常退出，保留 `.drawio`，改用 skill 规定的浏览器回退；没有完成 PNG 目检就不引用图片。
- 构建或页面检查发现图片加载失败、代码块溢出、标题错误时，修复后重新执行完整构建和页面验收。
- 推送前若远端出现新提交，先停止写入远端并检查差异；不强推、不覆盖他人修改。

## 验收标准

- 文章固定源码 commit 和包版本，并给出最小合成演示。
- 至少三张机制图均保留 `.drawio` 与 PNG，最终页面可加载且正文宽度下可读。
- 每个核心判断都有源码、配置、测试、文档或运行结果支撑；引用短且后面有解释。
- 明确说明 macOS、Alpha、LLM egress、degraded、MCP 数据访问和导出匿名化等边界。
- 中文表达像工程复盘，不使用宣传稿式夸大、强行升华或虚构体验。
- `npm test -- --run`、图片检查脚本与 `npm run build` 通过。
- 浏览器打开生成页，逐图检查加载和可读性，并检查移动端或窄视口没有明显横向溢出。
- Git 变更只包含本次设计、计划、文章和图片；使用中文 commit message，推送到 `origin/main`。
