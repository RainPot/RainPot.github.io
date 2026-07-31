---
title: "Claude Code 记忆机制拆解：没有向量库，只有文件和加载时机"
description: "固定到 2.1.145 版本，拆开 Claude Code 的记忆实现：CLAUDE.md 四层拼接与真实注入形态、auto memory 的两种模式与全量扫描式召回、compact 之后哪些记忆回得来、以及藏在 bundle 里那个每晚跑一次的 dream 整理任务。"
date: "2026-07-31"
tags: ["Claude Code", "Agent Memory", "Coding Agent", "源码拆解", "上下文工程"]
draft: false
featured: true
readingTime: 22
---

长会话里有个现象很常见：同一条规则，前半段模型守得好好的，后半段忽然就不守了。翻回去看 `CLAUDE.md`，规则白纸黑字写着，一个字没改。

这种事通常被归到"模型注意力衰减"头上。但在 Claude Code 里，相当一部分情况有更朴素的解释——那条规则**确实已经不在上下文里了**。它被一次你没注意到的上下文压缩悄悄踢了出去，而系统不会告诉你。

把 Claude Code 的记忆实现拆开看，会发现它和当下流行的 Agent Memory 方案几乎是反着走的：没有向量库，没有 embedding，没有相似度检索，甚至没有一个能称之为"检索"的步骤。所有记忆都是磁盘上的 markdown 文件，全部工程复杂度只压在一件事上——**哪个文件，在什么时候，被读进上下文**。

![Claude Code 记忆机制全景图。左侧是磁盘上的记忆文件，分三类：A 类是人写的 CLAUDE.md 家族，包含企业托管策略、用户级、项目级、本地级、路径条件规则和子目录指令共六种；B 类是模型写给自己的 auto memory，位于 projects 目录下的 memory 子目录，以及子代理的独立记忆目录；C 类是会话流水、历史记录、计划稿等不进上下文的运行时状态。右侧是上下文窗口，展示了启动时装载的各部分及其 token 占用：系统提示 4200、auto memory 680、环境信息 280、MCP 工具名 120、skill 描述 450、用户 CLAUDE.md 320、项目 CLAUDE.md 1800，合计约 7.8K。中间用五条箭头连接，分别标注启动全量、索引前 200 行、按需读取、路径触发、不进上下文五种加载时机。底部图例列出这五种时机的颜色约定。](/images/claude-code-memory-mechanism/overview.png)

下面的内容固定在 **2.1.145**，结论来自官方文档、本机磁盘状态，以及对打包产物的反编译。凡是文档里没写、只在二进制里能看到的部分，会明确标注出来。

---

## 一、两套记忆，一套人写，一套模型写

Claude Code 的"记忆"不是一个系统，是两个：

**`CLAUDE.md` 家族**是人写的。它更接近配置而不是记忆——你把项目约定、代码风格、禁止事项写进去，希望模型每次都遵守。它的价值在于稳定，而不在于智能。

**auto memory** 是模型写给自己的。它在会话过程中调工具往磁盘写笔记，下一次会话开始时读回来。这一套才是通常意义上的"记忆"。

两套都是 markdown 文件，都躺在明面上，都能用文本编辑器打开。区别只在谁来写、以及什么时候被读。

先看第一套。

---

## 二、CLAUDE.md：四层拼接，没有仲裁

### 发现是一次向上走的目录遍历

启动时，Claude Code 从当前工作目录开始逐级向上走到文件系统根，每到一个目录就检查有没有 `CLAUDE.md` / `CLAUDE.local.md` / `.claude/rules/*.md`。找到的全部收集起来，按"根 → 工作目录"的顺序拼接，越靠近工作目录的排得越后。

![CLAUDE.md 从磁盘走到上下文的完整链路图，分四段。第一栏「发现」画了一棵目录树，从企业托管目录、用户目录、祖先目录一路到当前工作目录，实线框标注启动时装载的文件，虚线框标注带 paths 前置条件的 rules 和子目录 CLAUDE.md，它们启动时不装。第二栏「排序拼接」列出五级优先级顺序，配一条自上而下的箭头；下半部分列出五个展开与清洗步骤：@path 导入按引用文件位置解析、最多四跳、跳过代码块中的 at 符号、外部导入需要一次性批准、剥离块级 HTML 注释。第三栏「包装」用深色代码框展示模型实际收到的 system-reminder 消息形态，下方红框强调它是系统提示之后的一条用户消息而非系统提示本身，绿框给出真要强制该用什么机制。底部横跨全图的面板列出这条链路上最容易踩的四件事。](/images/claude-code-memory-mechanism/claudemd-pipeline.png)

这里有个容易被忽略的点：**祖先目录的 `CLAUDE.md` 也会被装**。如果在 `~/Documents/project/learning/` 下启动，那么 `~/Documents/project/CLAUDE.md` 同样会进上下文。在把多个项目放在同一个父目录下的机器上，这经常导致上下文里混进了完全不相干的项目约定。

`@path` 语法可以把文件拆开维护，最多允许 4 跳嵌套。有一点需要说清楚：**拆分省的是维护成本，不是 token**。被导入的文件在启动时一样全量展开，上下文占用完全相同。想省 token 得换机制，后面会讲。

### 它到底以什么形式进上下文

这一段是文档里没有明说、但影响很大的部分。

`CLAUDE.md` 不是系统提示的一部分。它是**系统提示之后的一条普通用户消息**。写这篇文章的会话里，那条消息长这样（路径已脱敏）：

```text
<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
Codebase and user instructions are shown below. Be sure to adhere to these
instructions. IMPORTANT: These instructions OVERRIDE any default behavior
and you MUST follow them exactly as written.

Contents of /Users/<user>/.claude/CLAUDE.md (project instructions, checked
into the codebase):

Always respond in Chinese-simplified.
Always write code comments in Chinese but don't write "中文注释：".
Always write git commit in Chinese like feat: 参数展示优化.
# currentDate
Today's date is 2026-07-31.

      IMPORTANT: this context may or may not be relevant to your tasks. You
      should not respond to this context unless it is highly relevant to
      your task.
</system-reminder>
```

三个细节值得停一下。

**第一，标签是套模板套错的。** 这份文件是 `~/.claude/CLAUDE.md`，货真价实的用户级配置，但它被标成了 `(project instructions, checked into the codebase)`。拼接时的来源标注是按模板生成的，并没有真正区分层级。模型看到的"这是项目里签入的规则"，实际上是用户全局配置。

**第二，同一条消息里有两句互相打架的话。** 开头说 `IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written`，结尾说 `IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task`。一句要求无条件严格执行，一句要求判断相关性后再决定要不要理会。它们被塞在同一个 `<system-reminder>` 容器里，中间只隔了几行。

这不是抠字眼。它直接解释了一个很常见的困惑：为什么 `CLAUDE.md` 里的规则有时候生效、有时候不生效。因为**从消息层面看，模型收到的指令本身就是模棱两可的**。

**第三，`MUST` 和 `OVERRIDE` 这些大写词没有任何强制力。** 它们是措辞，不是机制。这条消息在模型眼里和你手打的任何一句话地位相同。想要真正的强制，只有两条路：`PreToolUse` hook 用代码在工具执行前拦截，与模型意愿无关；`--append-system-prompt` 把内容真正写进系统提示。指望在 `CLAUDE.md` 里多写几个大写单词来提高遵守率，收益非常有限。

### 想省 token，用带 `paths:` 的 rules

`.claude/rules/*.md` 支持一段 frontmatter：

```markdown
---
paths:
  - "**/*.test.ts"
  - "src/api/**"
---

这里的内容只有在模型读到匹配上面 glob 的文件时，才会被追加进上下文。
```

不带 `paths:` 的 rules 等同于项目级 `CLAUDE.md`，启动时全量装。带 `paths:` 的是条件加载，展开后的模式总数上限 1,000 条、总体积上限 4 MiB。

这是唯一真正能省上下文的机制。代价在下一节。

---

## 三、auto memory：一次全量扫描，没有检索

`CLAUDE.md` 是人写的，auto memory 是模型自己写的。默认开启，可以在 settings 里用 `autoMemoryEnabled` 关掉。

![auto memory 的目录形态、两种模式与召回逻辑图。左侧模式 A 是官方文档描述的形态：memory 目录下有 MEMORY.md 索引和若干话题文件，只有索引在启动时装且限制在前 200 行或 25KB，话题文件由模型按需读取；下方三个说明框分别讲索引超限的处理、门限只统计真正会被加载的内容、写入时自动补 modified 时间戳。中间模式 B 是 tiny_memory：深色代码框展示单条记忆的文件格式，包含 name、description、metadata.type 三个 frontmatter 字段和用双方括号互链的正文；下方列出 type 字段仅有的四个取值 user、feedback、project、reference 及各自含义。右侧是团队记忆的分流规则：user 永远私有、feedback 默认私有、project 和 reference 默认进团队目录，并用红框强调提示词里写死的一条约束——绝不要把密钥凭证写进团队目录。底部横跨全图的深色代码框展示从压缩产物还原的召回函数原文，右侧四个彩色框逐条解释这段代码说明的四件事。](/images/claude-code-memory-mechanism/auto-memory.png)

### 目录结构就是全部数据结构

记忆落在 `~/.claude/projects/<项目标识>/memory/` 下。项目标识由 git 仓库路径推导，同一仓库的所有 worktree 共用一份。这份记忆是机器本地的，不跨机同步。

目录里 `MEMORY.md` 是索引，也是**唯一在启动时自动进上下文的文件**，且只装前 200 行或 25KB，以先到者为准。其余话题文件启动时一律不装，等模型自己判断需要时再用 Read 去取。

200 这个数字不是文档里的软建议，是二进制里的常量：

```js
var Kf = "MEMORY.md", s9H = 200
```

有个设计得挺细的地方：这个门限只统计**真正会被加载的内容**。YAML frontmatter 和块级 HTML 注释会先被剥掉，再数行数和字节。所以在记忆文件里写注释不占预算。

### 文档里没写的第二种模式

bundle 里这三个常量是并排放着的：

```js
ob1 = "memory", ab1 = "tiny_memory", tb1 = "MEMORY.md"
```

`tiny_memory` 官方文档里查不到，但它的提示词和一整套常量都在二进制里。它的形态和模式 A 完全不同：**一个文件只装一条事实**，靠 frontmatter 描述自己，靠 `[[wiki-link]]` 互相引用。

```markdown
---
name: git-c-instead-of-cd
description: 用 git -C 替代 cd && git 组合命令
metadata:
  type: feedback
---

Claude Code 对 `cd /path && git ...` 有硬编码安全拦截，无法通过 settings 绕过。

**Why:** 防止裸仓库攻击。
**How to apply:** 写 `git -C /path/to/repo log`，不要写 `cd /path && git log`。

相关：[[shell-command-conventions]]
```

`metadata.type` 只有四个合法取值，语义划分得相当克制：`user` 记用户是谁，`feedback` 记他给过的工作方式反馈（要求连原因一起记），`project` 记进行中的工作和约束，`reference` 记外部资源指针。

在这套写法下 `MEMORY.md` 退化成纯索引，一条记忆一行 `- [标题](file.md) — 钩子句`。

顺带一提，写这篇文章的会话本身就跑在 `tiny_memory` 模式下——那套提示词此刻就在当前会话的系统提示里，这大概是最直接的一手证据。

### 召回代码：readdir、排序、切片

这是整套机制里最值得看的一段。从压缩产物还原，变量名保持原样：

```js
async function gP_(H, _) {
  let q = wj(),                      // 是否 tiny_memory 模式
      K = q ? y93 : v93;             // 单文件读取字节上限，两种模式不同

  let T = (await fs.readdir(H, { recursive: true }))
        .filter(A => A.endsWith('.md') && basename(A) !== 'MEMORY.md');

  let z = (await Promise.allSettled(T.map(async A => {
        let { content: w, mtimeMs: j } = await SwH(join(H, A), 0, K, ...);
        let { frontmatter: J, body: D } = epH(w, Y);
        let f = H7H(J, 'created');
        return {
          filename: A, filePath: Y,
          mtimeMs: (q ? h93(f) : null) ?? j,     // tiny 用 created，否则用 mtime
          description: J.description,
          type: ZN9(H7H(J, 'type')),
          created: f, last_read: H7H(J, 'last_read'),
          content: q ? D.trim() || null : null,  // 只有 tiny 模式带正文
        };
      }))).filter(A => A.status === 'fulfilled').map(A => A.value)
        .sort((A, Y) => Y.mtimeMs - A.mtimeMs)   // 新的排前面
        .slice(0, q ? N93 : V93);                // 条数上限，两种模式不同

  EH('memory_scan');
  return z;
}
```

**这里没有检索。** 整个目录 `readdir` 一遍，读每个文件的 frontmatter，按时间倒序排，截前 N 条。没有查询词，没有 embedding，没有相似度，没有 rerank。一条记忆会不会被拿出来，只取决于它新不新。

两种模式的差别全在几个常量上——读取字节上限、返回条数上限、排序依据、带不带正文，全是同一个布尔量 `q` 的三元表达式。同一份代码，两种粒度。

还有一点值得注意：非 `tiny_memory` 模式下 `content` 恒为 `null`。**模型拿到的只有文件名和 `description`**，想看正文得自己再 Read 一次。这意味着 `description` 写得准不准，直接决定了模型会不会去读那个文件——它是这套系统里唯一的路标。

### 团队记忆：靠提示词自觉

二进制里 `team-memory` 出现了 81 次，配套还有 sync、watcher、search 和一个服务端状态字段。记忆可以分流到一个共享目录，索引仍然只有一份放在私有目录，团队记忆在索引里用 `team/` 路径前缀区分。

分流规则按 type 走：`user` 永远私有，`feedback` 默认私有，`project` 和 `reference` 默认进团队目录。

提示词里有一条硬约束值得单独拎出来：

> You MUST avoid saving sensitive data within shared team memories. For example, never save API keys or user credentials.

注意这是**提示词层面的约束，不是代码拦截**。没有任何机制阻止模型把一个 token 写进共享目录，只有一句"你必须避免"。如果团队记忆真的要在生产环境用起来，这一层得自己补——至少加一个 `PreToolUse` hook 做正则扫描。

### 一个真实的数据对比

本机的实际状态：

```console
$ du -sh ~/.claude/projects
157M    /Users/<user>/.claude/projects

$ find ~/.claude/projects -name '*.jsonl' | wc -l
      28

$ find ~/.claude/projects -path '*/memory/*.md'
/Users/<user>/.claude/projects/-Users-<user>-Documents-project-<proj>/memory/MEMORY.md

$ wc -c ~/.claude/projects/*<proj>/memory/MEMORY.md
     545
```

**157 MB 的会话流水，28 个会话文件，5 个项目，最终沉淀下来 545 字节。**

这 545 字节的内容质量倒是相当高——它记的是一条真实踩过的坑：

```markdown
### 始终用 `git -C <path>` 替代 `cd && git`

Claude Code 对 `cd /path && git ...` 组合命令有**硬编码安全拦截**（防止裸仓库攻击），
无法通过 settings 绕过，会强制要求用户手动确认。

**正确写法：** git -C /path/to/repo log --oneline -20
**禁止写法：** cd /path/to/repo && git log --oneline -20
```

这个比例说明的事情比任何架构图都直白：**在真实使用中，自动沉淀下来的记忆量根本不到需要"检索"的规模**。全量扫描能 work，不是因为实现偷懒，是因为在这个量级上，检索是个不存在的问题。

---

## 四、compact 这道坎：谁回得来，谁回不来

回到开头那个现象。

上下文接近上限时会触发 compact。它不是简单地"把上下文缩小"，而是：把对话摘要成一段，然后**从磁盘重新装一遍记忆**。关键在于，重新装的那一遍并不完整。

![上下文压缩前后的记忆存活对照图，分三栏。左栏列出 compact 之前一个长会话里的上下文构成：系统提示与工具定义、用户和项目 CLAUDE.md、触发装入的子目录 CLAUDE.md 和 paths rules、三个 skill 正文、auto memory 索引与读过的话题文件、几十轮对话，底部红框标注 token 逼近上限触发 compact。中栏列出 compact 的四个动作：摘要对话、重建系统层、从磁盘重读记忆、触发态一律清空，并用橙框单独说明 skill 正文的预算规则是单个 5000 token、合计 25000 token、超出按加载顺序丢弃最早的。右栏用对勾、叉号、约等号三种标记列出九项内容各自的命运：系统提示、CLAUDE.md、无 paths 的 rules、auto memory 索引四项从磁盘重新注入；子目录 CLAUDE.md、paths rules、已读话题文件三项消失；skill 正文和对话历史两项以裁剪或摘要形式部分保留。底部三个彩色面板给出由此推出的三条写法取舍，最下方一栏对比 /clear、自动 compact 和 /compact 带指令三者的区别。](/images/claude-code-memory-mechanism/compact-survival.png)

能回来的，是那些**能被无条件重新发现**的文件：用户和项目根的 `CLAUDE.md`、不带 `paths:` 的 rules、auto memory 的索引。

回不来的，是所有靠"读到某个文件"才装进来的东西：带 `paths:` 的 rules、子目录 `CLAUDE.md`、已经读过的话题文件正文。系统里**没有任何地方记录它们曾经被触发过**，所以重装时它们不在名单上。

skill 正文的情况居中：会重装，但受预算约束——单个 skill 截到 5,000 token，所有 skill 合计 25,000 token，超了按加载顺序丢最早的那批。

这套规则直接推出三条写法上的取舍。

**必须常驻的规则，不要放进带 `paths:` 的文件。** "提交前必须跑 lint"、"禁止直连生产库"这类规则一旦写进带 `paths:` 的 rules，compact 之后就静默失效了，而且没有任何提示。长会话里这是最隐蔽的一类事故：同一条规则前半段遵守、后半段不遵守，表现出来就像模型"变笨了"。放进项目根 `CLAUDE.md`，或者干脆做成 hook。

**monorepo 里子目录 `CLAUDE.md` 的收益要打折。** 它的卖点是按需加载、省 token，但生命周期只到下一次 compact。跨越多次 compact 的长任务里，同一份子目录说明可能被反复重新装载，省下来的 token 又以另一种形式还了回去。高频目录的关键约定，值得上提到项目根。

**auto memory 是唯一能可靠穿越 compact 的"会话内所得"。** 对话细节会被摘要吃掉，读过的文件内容会消失，但写进 `memory/` 的东西下一轮还在。所以长任务里主动说一句"把这个结论记下来"不是锦上添花——那是在 compact 到来之前，把易失的上下文换成不易失的磁盘状态。

顺带澄清一个常见混淆：`/clear` 和 compact 不是一回事。`/clear` 是上下文清空、从头重装记忆，会话历史不再进上下文，但 `.jsonl` 流水还在磁盘上，`--resume` 仍可回放。自动 compact 是模型摘要对话后按上面的规则重装，触发时机由 token 用量决定，**你不一定会注意到它发生了**。想要可控一点，可以主动用 `/compact <指令>` 指定摘要时重点保留什么。

---

## 五、它其实也有 consolidation，只是写成了一段提示词

写到这里，结论看起来是"Claude Code 完全不做记忆整理"。这个判断不准确。

bundle 里有一段 scaffold 函数，会一次性写出一整套文件，其中包括三个 `recurring` 且 `permanent` 的定时任务：

```js
tasks: [
  { id: "catch-up",        cron: "0 */2 * * *", prompt: "/catch-up" },
  { id: "morning-checkin", cron: bu3(),         prompt: "/morning-checkin" },
  { id: <random>,          cron: Iu3(),         prompt: "/dream" },
]

function Iu3() { let H = 60  + Math.floor(Math.random() * 240); return `${H%60} ${Math.floor(H/60)} * * *` }
function bu3() { let H = 420 + Math.floor(Math.random() * 120); return `${H%60} ${Math.floor(H/60)} * * *` }
```

`Iu3()` 生成的是 01:00–04:59 之间的随机一分钟，`bu3()` 是 07:00–08:59 之间的随机一分钟。刻意避开整点——如果全世界的客户端都在凌晨三点整醒来打 API，那一秒会很难看。这个细节做得很到位。

第三个任务叫 `dream`。

![assistant 模式下记忆的自我维护流程图，分三栏。左栏列出初始化时一次性写出的六类文件：settings.local.json 把 autoMemoryDirectory 指向项目 memory 目录、项目 CLAUDE.md 写入 About The User 空白档案、用户级 assistant.md、四个 skill 的 SKILL.md、scheduled_tasks.json、catch-up-state.json，并标注写入使用 wx 标志因此不会覆盖已有文件；底部红框强调 MEMORY_ROOT 就是 auto memory 那个目录，不是另起一套。中栏列出三个 permanent 定时任务及其 cron 表达式，catch-up 每两小时固定整点，morning-checkin 在早上七点到九点之间随机，dream 在凌晨一点到五点之间随机，并解释随机打散的原因和 context fork 的含义。右栏逐条直译 dream 提示词的四个阶段：准备阶段回顾当天记忆日志与会话记录、提炼话题阶段抽出 topic 文件并解决矛盾、规则与教训阶段记录当天痛苦低效的事、排序剪枝阶段把 MEMORY.md 压回 200 行以内，末尾单独引出提示词的结语「所有这些记忆文件都是给你自己的」。底部面板对比 Codex 把整理逻辑写在代码里与 Claude Code 把整理逻辑写在提示词里的差别。](/images/claude-code-memory-mechanism/dream-consolidation.png)

`dream` 是一个 `SKILL.md`，`context: fork`，每晚跑一次。提示词开头写着"这是一份家务活，除非发现值得说的事，否则不要打扰用户"。它做四件事：

1. **准备**——读当天的记忆日志和会话记录，先看已经有哪些话题，要改进已有的，不要造重复的
2. **提炼话题**——把重要事件、教训、决策、洞察抽成顶层的 `<topic-slug>.md`，并解决其中的矛盾
3. **规则与教训**——回顾当天哪些事痛苦或低效（提示词里举的例子是"项目编译不过、测试跑不起来"），哪些让用户不耐烦了，写进 `learnings/<slug>.md`
4. **排序与剪枝**——把 `MEMORY.md` 压回 200 行以内，太长的只留要点、正文挪到话题文件，变陈旧的删掉，变重要的加进来

结尾一句是这么写的：

> Remember — all of these memory files are *for you*. This is to help you situate and orient yourself in the future, after session context has been lost.

模板里的 `{{MEMORY_ROOT}}` 会被替换成 `projects/<project>/memory/`——**和 auto memory 是同一个目录**。这不是另起一套记忆，就是给那批文件做夜间保养。

把这段和 Codex 的做法摆在一起看，差别不在做不做，而在**写在哪**。

Codex 的两阶段管线是编译进去的：rollout extraction 负责抽取，consolidation agent 负责归并。行为稳定、可测试，但你改不动——想调整"什么算值得记的"，只能等官方改。

Claude Code 的 `dream` 是一个落在你磁盘上的 markdown 文件，可以直接打开改。想让它多关注编译失败、少关注闲聊，把第 3 阶段那两行改掉就行。代价是行为没有代码那么确定。

这个选择贯穿了整套设计：规则是文件，记忆是文件，连整理记忆的逻辑也是文件。

还有个容易被忽略的细节——这套 scaffold 最后写的是一份 `CLAUDE.md`，内容是「About The User」空白档案：称呼、代词、时区、主力仓库、作息、沟通偏好，全是空的，等着模型在往后的会话里一点点填。

连"这个人是谁"这种最像用户画像、最该进数据库的东西，Claude Code 也选择让它是一个你能打开、能改、能提交进 git 的 markdown 文件。整条链路从头到尾只有一种数据结构。

---

## 六、和 Codex、jcode 摆在一起

之前拆过 [Codex 的 Memory 实现](/blog/2026-07-21-codex-memory-implementation) 和 [jcode 的 Memory 设计](/blog/2026-07-21-jcode-memory-design)。三家放在一起对比，复杂度差了两个数量级。

![三种 Coding Agent 记忆哲学的横向对比表。表头三列分别是 Claude Code 的文件加上加载时机、Codex 的离线蒸馏加摘要注入、jcode 的图存储加混合检索加 LLM 裁决。表格纵向有八个对比维度：谁来写、存成什么、怎么召回、注入到哪、冲突怎么办、时间成本落在哪、典型失效模式、它到底在解什么。Claude Code 一列的要点是 markdown 文件即全部数据结构、召回是全量扫描没有查询词、注入为系统提示后的一条用户消息、运行时不仲裁而把整理推迟到夜间任务、时间成本几乎为零、典型失效是文件攒多后噪声稀释注意力和 compact 后触发态静默消失。Codex 一列的要点是模型离线写入、本地 store 加索引文件、先注入摘要再按需搜索、consolidation 阶段离线合并且逻辑写死在代码里。jcode 一列的要点是 project 和 global 两套图、dense 加 BM25 加 RRF 混合召回后由 LLM 做 listwise rerank、PendingMemory 作为注入缓存、写入即处理冲突并有置信度反馈。底部三条结论说明这不是谁更先进的问题。](/images/claude-code-memory-mechanism/comparison.png)

**jcode** 把记忆当成一个**检索问题**：project/global 两套图，标签、关系、冲突、聚类都是存储层的一等公民，召回走 dense + BM25 + RRF 混合，再让 LLM 做 listwise rerank——LLM 负责裁决而不是查找。整条链路不挡主请求，但要维护向量、倒排、图结构和一个 rerank 模型。

**Codex** 把记忆当成**历史的产物**：会话结束后从 rollout 流水里抽取，交给 consolidation agent 整理成条目，下次会话开头注入 summary，细节按需搜索。复杂度落在会话之外，不影响当前这轮交互。

**Claude Code** 把记忆当成**配置的延伸**：可读、可 diff、可进 git、可 code review。它连"检索"这一步都省了，因为在它假设的使用规模下，这一步不必要。

这里可以推出三条判断。

**记忆的绝大部分价值，来自人主动写下的那几十行，而不是系统自动攒出来的那几百条。** Claude Code 把赌注全押在前者上：它宁可让你手写 `CLAUDE.md`，也不替你猜该记什么。前面那个 157 MB 对 545 字节的比例，是这个赌注的直接证据。

**自动记忆的收益，与"记忆条数"不成正比，与"description 写得准不准"成正比。** 非 tiny 模式下模型拿到的只有文件名和描述，描述写歪了，正文写得再好也不会被读到。

**复杂检索是有前提的：先有足够多的记忆，才轮得到讨论怎么找。** 全量扫描居然够用，恰恰说明大多数项目的记忆量根本不到需要检索的规模。在那之前，一个能被 git 追踪、能被人 review 的 markdown 文件，收益比向量库高得多。

---

## 七、落到实际怎么写

把上面的机制翻译成几条可执行的取舍。

**分层要按变化频率分，不按内容类型分。** 用户级放跨项目不变的偏好（回复语言、commit message 风格），项目级放团队约定，`CLAUDE.local.md` 放个人临时开关。经常改的东西放进用户级，等于每个项目都在承担你的实验成本。

**别指望长度换遵守率。** 200 行是官方建议值不是硬限制，写多长就装多长，只会安静地吃上下文并稀释注意力。真正决定遵守率的是位置（越靠后越近）和是否可执行，不是篇幅。

**必须强制的事情别写在 `CLAUDE.md` 里。** 上下文里的一句话，模型可以不照做，而且不会告诉你。做成 `PreToolUse` hook，用代码拦截，与模型意愿无关。

**长任务里主动落盘。** 每当出现一个"下次不该再踩"的结论，就让它写进记忆。这不是为了让模型显得更聪明，是为了让这条结论能活过下一次 compact。前面那 545 字节就是个好例子——短、具体、有正误对照。

**定期读一读 `memory/` 目录。** 它是模型写给自己的，但你能看。看它记了什么、漏了什么、记歪了什么。这批文件在整个系统里没有任何一层加密或抽象——这是 Claude Code 这套设计最大的好处，别浪费。

---

## 小结

Claude Code 的记忆机制没有任何一个环节称得上复杂：目录遍历、字符串拼接、按时间排序、切片。真正的设计密度全在**加载时机**上——启动全量、路径触发、模型按需、compact 重注入，四种时机决定了每个文件的命运。

它做的不是"更聪明的记忆"，而是"更可控的记忆"。代价是需要人参与——你得自己想清楚哪条规则该常驻、哪条可以按需、哪条值得写进磁盘。收益是整个系统没有黑盒，出问题时能一层层看下去，看到底。

对做 Agent 的人来说，这里最值得借鉴的可能不是任何一个技术细节，而是那个反直觉的前提：**在给记忆加检索之前，先确认自己真的有足够多的记忆需要被检索**。大多数时候答案是没有，而全量扫描一个目录，比维护一套向量库便宜得多。
