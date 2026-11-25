---
title: "拆解 Mobile Next 三款开源产品：从 mobilecli、mobile-mcp 到 Mobilewright，以及 Coding-First 的成本账怎么算"
description: "源码级拆解 Mobile Next 旗下的 mobilecli、mobile-mcp 与 Mobilewright 三款开源产品，还原其三层进程运行时、薄 MCP 编排、借壳 Playwright 与 Agent CLI 代码回显机制；最后直面“低成本小模型 + Harness 已经很准”的现实，给出 Coding-First 路线的全生命周期成本模型与混合路由建议。"
date: "2026-11-24"
tags: ["MobileUse", "GUI Agent", "Mobilewright", "mobile-mcp", "mobilecli", "Coding-First", "Mobile QA"]
draft: false
featured: true
readingTime: 22
---

在移动端自动化和 MobileUse 赛道里，很多团队的常规思路是做一套更强的多模态 Harness：截屏、标框、调视觉小模型、输出点击坐标，一步一步循环跑完。但 **Mobile Next**（`mobilenext.ai`）押的是另一条路——把“让 Agent 探索操作”和“让确定性代码执行”彻底拆开，并用三个开源仓库拼出了一整套从设备底座到 CI 回归的工具链：

1. **`mobilecli`**（Go，FSL-1.1，v1.0.24，commit `711cd15`）：整条栈唯一的设备运行时底座，试图用单个 Go 二进制替代 `adb`、`simctl`、`go-ios` 和 WebDriverAgent。
2. **`mobile-mcp`**（TypeScript，Apache-2.0，10.8k Star，commit `5cdc2f3`）：面向 Claude Code、Cursor、Codex 等客户端的薄 MCP 编排层，负责把真机和模拟器交到 Agent 手里。
3. **`mobilewright`**（TypeScript Monorepo，Apache-2.0，v0.0.72，commit `21710d5`）：直接复用 `@playwright/test` 的移动端测试框架，同时藏着一个比 MCP 更适合 Coding Agent 的子包 `@mobilewright/cli`。

这三个仓库拆开来看都够具体，合在一起看更能看出商业与架构上的精明之处。更关键的是，这套工具链把一个一线团队绕不开的成本问题推到了台面上：**现在用 7B–32B 轻量视觉模型配合精调 Harness，单次跑完一条 MobileUse 任务的准确率已经很可观，成本只要几分钱；那绕一圈用昂贵的强 Coding 模型走 Coding-First，到底划不划算？**

下面先基于三个仓库 2026 年 11 月的一手源码把机制拆透，最后把这笔成本账摊开算清楚。

## 目录

- [一、三款产品的真实分层与依赖拓扑](#一三款产品的真实分层与依赖拓扑)
- [二、底座 `mobilecli`：绕开 WDA 与 200ms `adb` 冷启动的设备运行时](#二底座-mobilecli绕开-wda-与-200ms-adb-冷启动的设备运行时)
- [三、入口 `mobile-mcp`：10.8k Star 背后的“薄编排层”与刻意克制](#三入口-mobile-mcp108k-star-背后的薄编排层与刻意克制)
- [四、编译层 `mobilewright`：借壳 Playwright 1.63 与 Agent CLI 代码回显](#四编译层-mobilewright借壳-playwright-163-与-agent-cli-代码回显)
- [五、成本算账：小模型 + Harness 已经很准了，Coding-First 还能赢吗？](#五成本算账小模型--harness-已经很准了coding-first-还能赢吗)
- [六、生产级建议：不要二选一，按频率与漂移率做三层混合路由](#六生产级建议不要二选一按频率与漂移率做三层混合路由)
- [七、源码阅读索引与结语](#七源码阅读索引与结语)

---

## 一、三款产品的真实分层与依赖拓扑

读官网宣传很容易误以为 `mobile-mcp` 是跑在 `mobilewright` 上面的，或者三者共享同一套定位与等待引擎。翻完源码才发现，真实关系比宣传页干脆得多：**`mobile-mcp` 和 `mobilewright` 根本不共享 Locator 或 Auto-Wait 引擎，它们只在最底层的 `mobilecli` 这一层合流。**

![Mobile Next 三款开源产品的真实架构分层与依赖拓扑](/images/mobilenext-three-oss-and-coding-first-cost/mobilenext-three-tier-architecture.drawio.png)

看这张图时重点盯三条线：

1. **左路（`mobile-mcp`）走的是 CLI 短命令**：默认实现 `MobileDevice` 通过 `execFileSync` 逐条调用 `mobilecli` 子进程；有意思的是，`mobile-mcp` 的 `package.json` 里并没直接声明 `mobilecli`，而是靠依赖 `mobilewright@0.0.71 → @mobilewright/driver-mobilecli → mobilecli@1.0.24` 把二进制“借”过来，源码里一行 `mobilewright` 的运行时 API 都没 import。
2. **右路（`mobilewright`）走的是 WebSocket 长连接**：`@mobilewright/driver-mobilecli` 默认连接 `ws://localhost:12000/ws`，用 JSON-RPC 2.0 驱动常驻的 `mobilecli server`，避免高频轮询 UI 树时的进程启动开销；切到云真机时，则无缝换为连接 `wss://api.mobilenext.ai/ws` 的 `driver-mobilenext`。
3. **底层（`mobilecli`）故意选了不同的开源协议**：上层负责引流和开发者习惯的 `mobile-mcp`、`mobilewright` 都是宽松的 Apache-2.0，唯独最难啃、最值钱的设备控制层 `mobilecli` 用了 **FSL-1.1（ALv2 Future License）**——允许内部使用和非竞争场景，禁止竞品拿去套壳做同类商业云真机服务，每个版本发布满两年后自动转为 Apache-2.0。

先用一张表把三款产品的基本盘和职责边界钉死：

| 维度 | `mobilecli` | `mobile-mcp` | `mobilewright` |
| --- | --- | --- | --- |
| 定位 | 跨平台设备运行时底座 | 面向 IDE / Agent 的 MCP 操控层 | 移动端 Playwright 测试框架 + Agent CLI |
| 语言与版本 | Go 1.26 (`v1.0.24`, `711cd15`) | TypeScript (`5cdc2f3`) | TypeScript Monorepo (`v0.0.72`, `21710d5`) |
| 开源协议 | **FSL-1.1**（2 年后转 Apache-2.0） | Apache-2.0 | Apache-2.0 |
| 与设备通信 | 常驻 Daemon + Android dex / iOS DeviceKit | `execFileSync` 调 `mobilecli`（Legacy 退为降级） | WS JSON-RPC 2.0 连 `mobilecli server` / 云 WSS |
| 语义定位与等待 | 仅提供 UI 树 dump 与 `@eN` 临时 ref | **无** auto-wait，**无**语义 Locator | 自研 Locator AST + 5s/100ms/50ms 稳定窗 |
| WebView 支持 | Android JVMTI/CDP + iOS machomap/WebInspector | 显式不支持（原生元素树为主） | 注入 Playwright `InjectedScript` 暴露 `Page` |

---

## 二、底座 `mobilecli`：绕开 WDA 与 200ms `adb` 冷启动的设备运行时

`mobilecli/ROADMAP.md` 开篇第一句就把自己的地位说透了：

> "`mobilecli` is the single device layer underneath the whole Mobile Next stack. Everything above it, Mobilewright for tests, Mobile MCP for agents, your own scripts and CI, talks to devices through this one API."

移动端自动化最磨人的脏活几乎都在这一层：Android 端 `adb shell input` 每次敲命令都要 fork 一个 JVM，动辄耗时 ~200ms；iOS 真机则是 iOS 17+ 强制 Tunnel、WebDriverAgent（WDA）编译签名地狱、以及多设备并发时的端口与句柄泄露。

`mobilecli` 用一套**三层进程模型**把这些坑全部封进了一个可分发的 Go 二进制里：

1. **宿主机薄 CLI**：`internal/cli/*.go` 里的命令基本只做参数解析，随后全部通过 `runViaDaemon()` 转发给本机常驻的 per-user daemon（Unix socket 位于 `~/.mobilecli/daemon.sock`），或由 `mobilecli server start` 暴露 HTTP `POST /rpc` 与 WebSocket `GET /ws`（完整规范定义在 `docs/openrpc.json`，OpenRPC 1.3.2，覆盖 60+ 个 `device.*` RPC 方法）。Daemon 负责保活 iOS tunnel、设备端代理和状态缓存，空闲 30 分钟自动退出。
2. **Android 侧常驻 `app_process` 代理**：不依赖反复执行 `adb shell input`，而是把 `go:embed` 内嵌的 `mobilecli.dex` 推到 `/data/local/tmp/mobilecli.dex`，拉起常驻进程并做端口转发（`internal/devices/android_device_server.go:204-205`）：

```go
launchCmd := fmt.Sprintf("CLASSPATH=%s nohup app_process / %s --idle-timeout-ms=%d >/dev/null 2>&1 &",
    androidDexPath, deviceServerClass, deviceServerIdleTimeout().Milliseconds())
```

设备端 Java 服务里有两个细节很能体现工程功底：
- **无 Instrumentation 取树**：`UiAutomationFactory.java` 反射调用 Android `@hide` API 直接创建 `UiAutomation`，不需要往手机上装额外的测试 APK；`UiTreeSerializer.java` 遍历所有 `AccessibilityWindowInfo`，默认剔除 SystemUI 噪声，并输出与 iOS 同构的 JSON。
- **实时多指手势与 Compose 适配**：`Gestures.java` 按 16ms/帧回放原生 `MotionEvent`，支持双指 pinch 和多点触控；输入文本时 `Input.java` 走无障碍 `ACTION_SET_TEXT`，源码注释专门提到这是为了绕开 Jetpack Compose 输入框的光标竞态；非 ASCII 字符则回退到剪贴板 + `KEYCODE_PASTE`。原有的 `adb exec-out uiautomator dump` 和 `screencap` 被保留作降级路径，而非主路径。

3. **iOS 侧彻底放弃 WDA，改用自研 Swift `devicekit-ios` + `go-ios`**：
   - 真机链路集成 `github.com/danielpaulus/go-ios v1.0.211`，针对 iOS 17+ 自动开启 userspace TUN（`tunnel.NewTunnelManager(pm, true)`），**宿主机不需要 `sudo` 权限**。
   - 设备端代理并非 Facebook/Appium 的 WDA，而是从 Maestro 谱系派生并自研演进的 Swift XCTest Runner（`agents/ios/devicekit/`），监听本地 HTTP/WS JSON-RPC 2.0，与 Android 端对齐同一套 `device.io.tap` / `device.dump.ui` / `device.screenshot` 方法名。`mobilecli agent install` 会下载锁死 SHA256 的 runner IPA，并调用 `ResignIPA` 自动解包改 Bundle ID、跳过钥匙串里已吊销的签名证书完成重签安装。
4. **最硬核的部分——跨平台 WebView 调试注入**：
   - Android 内嵌 WebView 通过 `run-as` 推入架构对应的 JVMTI `.so` + dex，执行 `am attach-agent <pid>` 在目标 App 进程内起抽象 socket；Chrome 前台则解析 `/proc/net/unix` 里的 `webview_devtools_remote_<pid>` 直连 CDP。
   - iOS 真机因为沙盒无法直接 `dlopen`，`internal/devices/ios_device_agent_native.go` 直接 attach CoreDevice debug proxy，用 `machomap` 把内嵌的 `agent-dev.dylib` 映射进前台 App 进程——利用 `CS_DEBUGGED` 标志豁免签名校验，从而在不重签业务 App 的前提下完成 `WKWebView` 的 JS 求值与键盘隐藏；Safari 则走 `com.apple.webinspector`。

当然，源码也诚实暴露了几个绕不过去的系统级约束：
- Android 上 `DeviceServer` 会**独占全系统唯一的 `UiAutomation` 句柄**，它活着的时候 Appium 或外部 `uiautomator dump` 会直接被踢掉。
- Android 的 `run-as`/JVMTI 注入与 iOS 真机的 `machomap` 注入（含 WebView 调试与隐藏键盘）都**严格要求被测 App 是 debuggable 包**，对线上商店的 Release 包无能为力；iOS 真机依然绕不开开发者证书和 Provisioning Profile 签名门槛。
- `mobilecli` 的 `@eN` 元素引用没有过期校验机制，每次按 ref 点击其实都是重 dump 一次树再取中心点坐标。

---

## 三、入口 `mobile-mcp`：10.8k Star 背后的“薄编排层”与刻意克制

`mobile-mcp` 是 Mobile Next 最早爆火的仓库（超过 1 万 Star），但打开它的 `src/` 目录（总计不到 5000 行 TypeScript），你会发现它非常克制——**它没有试图在 MCP Server 里塞一个复杂的 Agent 框架，而是把重心全放在“省 Token、防误操作、引导模型少走弯路”上。**

### 1. 架构切换与“借二进制”的小细节

老版本 `mobile-mcp` 自己实现了全套 `AndroidRobot`（调 `adb`）、`IosRobot`（调 `go-ios` + WDA）和 `Simctl`。到了当前主分支，这套直控代码已经退居 `MOBILEMCP_LEGACY_ROBOT=1` 降级开关后面，默认全部走 `MobileDevice` → `mobilecli` 子进程。

有意思的是它在 `src/mobilecli.ts:162-181` 解析二进制的写法：

```ts
// mobilecli comes in through mobilewright -> @mobilewright/driver-mobilecli, so with
// an isolated layout (pnpm) it is not next to us in node_modules. Walk the same
// dependency chain node would.
const mobilewright = createRequire(currentPath).resolve("mobilewright");
const driver = createRequire(mobilewright).resolve("@mobilewright/driver-mobilecli");
const mobilecli = createRequire(driver).resolve("mobilecli/package.json");
```

换句话说，`mobile-mcp` 依赖 `mobilewright` 只是为了在 pnpm 严格隔离布局下顺着依赖链摸到 `mobilecli` 的可执行文件，并没复用测试框架的任何能力。

### 2. 把 Prompt 当接口契约来写和测试

`src/server.ts` 注册了 24 个 MCP 工具（设备枚举、云设备申请释放、App 生命周期、点击/长按/拖拽/滑动/输入、元素树、截图、录屏、日志、崩溃、批处理），并在 `SERVER_INSTRUCTIONS` 里给 LLM 钉死了三条纪律：

1. **没有隐式当前设备**：每次调用必须显式传 `device` ID，防止多设备并行时点错手机。
2. **优先读文本树，最后才看截图**：`mobile_take_screenshot` 的描述里直接写着“如果元素在视图树里能找到，就必须改用 `mobile_list_elements_on_screen`”。
3. **已知连续步骤必须打包**：提供 `mobile_batch_commands`（支持插入 `delay` 虚拟步骤），且它在内部直接调用 `toolCallbacks` 绕过 MCP 传输层，把填表单这类连续操作折成单次往返。

更讲究的是，`test/server-tool-descriptions.test.ts` 里专门写了 12 个单元测试，把工具描述里的引导语当成契约来锁死，防止重构时不小心改坏对模型的约束。

### 3. 两个很实在的省 Token 工程细节

- **单行压缩无障碍树**：`src/format-elements.ts` 默认输出极简文本而非冗长 JSON，并且注释里直接写明“只输出非默认状态，免得干扰 LLM”（`src/format-elements.ts:40-57`）：

```ts
// only emit non-default states, otherwise don't confuse llm
if (element.focused) parts.push("focused");
if (element.selected) parts.push("selected");
if (element.checked) parts.push("checked");
if (element.enabled === false) parts.push("disabled");
return parts.join(" ");
```

最终每行只长这样：`@e5 Button text="Sign in" id="login" at=180,640 size=220x48`。

- **原生缩放 + 文本坐标换算**：`mobile_take_screenshot` 默认传 `format: "jpeg", quality: 75, maxSize: 1024`，缩放和区域裁剪（`clip`）全部交给 Go 写的 `mobilecli` 完成，JS 侧零 `sharp` 依赖。JS 只手工解析 PNG 的 IHDR 或 JPEG 的 SOFn 字节头拿到图片真实宽高，再由 `src/coordinate-mapping.ts` 生成一句纯文本算术指令塞在图片前面：

```text
Screenshot is 472x1024. Screen coordinates are 393x852.
To tap something you see in this screenshot, multiply its x by 0.8326 and y by 0.8320.
```

这样既把单张截图的视觉 Token 压了下来，又避免了 iOS 逻辑点（points）与截图物理像素错位导致的点击偏移。

### 4. `mobile-mcp` 刻意不做的事

`mobile-mcp` 几乎是无状态的（HTTP 模式甚至是 per-request 模型）：**没有 auto-wait，没有语义 Locator，不支持 WebView 内部 DOM，也不校验屏幕变化后 `@eN` 是否过期**。遇到“等接口加载完再点按钮”，只能靠模型自己轮询 `mobile_list_elements_on_screen` 或在 batch 里硬塞 `delay`。另外源码里还有一处细节错位：工具文档写 Android 默认滑动距离为屏幕的 30%，但新架构 `MobileDevice.swipe` 里实际写死了 `400` 像素（30% 的逻辑只留在 legacy `AndroidRobot` 里）。

这并非工程偷懒，而是 Mobile Next 明确的产品切分：**MCP 会话只适合拿来探索、排障和一次性驱动，不该直接拿去跑回归。**

---

## 四、编译层 `mobilewright`：借壳 Playwright 1.63 与 Agent CLI 代码回显

Mobile Next 在官方文档里写了句很直白的话：**“An agent session is not a test.”**（一次 Agent 会话不等于一条测试）。`mobilewright` 就是为了把 Agent 探索出来的交互过程，编译成“零模型调用、可进 Git Review、可在 CI 稳定重跑”的代码资产。

![Mobile Next 的 Coding-First 编译链路：从单次探索到零模型 CI 回放](/images/mobilenext-three-oss-and-coding-first-cost/mobilewright-coding-first-compile-loop.drawio.png)

### 1. 不是“致敬 Playwright”，而是直接站在 `@playwright/test 1.63.0` 身上

翻看 `packages/test/src/fixtures.ts` 和 `packages/mobilewright/src/cli.ts` 就能确认，Mobilewright 把能复用的测试底座全借了过来：

- `test` 直接就是 `@playwright/test` 的 `base.extend<MobilewrightTestFixtures>({ device, app, screen, ... })`，甚至连 `expect.soft` 报错挂接都直接调用了 Playwright 的私有方法 `_failWithError()`。
- `mobilewright test`、`show-report`、`merge-reports` 底层直接调用 `playwright/lib/runner` 和 `playwright/lib/program`；HTML 报告就是 Playwright 原生报告跑完后用 `brandReport()` 替换了一下标题和图标。
- 并行调度通过 Playwright `globalSetup` 拉起本地 `DevicePoolHttpServer`，各 Worker 里的 `device` fixture 向协调器申请/归还设备槽位，本地多台模拟器或云真机池走同一套排队协议。

最巧妙的借壳发生在 **WebView 自动化**（`screen.getByWebView().page()`）。很多人以为移动端测 WebView 必须另写一套 DOM 选择器引擎，Mobilewright 的做法是写了个同步脚本 `scripts/sync-playwright-injected-script.mjs`：

```js
// Extracts Playwright's browser-side InjectedScript engine source out of the
// installed playwright-core's opaque lib/coreBundle.js ... and writes it as a
// plain exported constant that packages/mobilewright-core can import.
const ANCHOR = '// packages/playwright-core/src/generated/injectedScriptSource.ts';
```

它直接把 `playwright-core@1.63.0` 编译包里的浏览器端 `InjectedScript` 抠出来，在运行时注入进移动端 WebView（挂到 `window.__mwInjected`），并在 `MobileWebViewLocator` 上实现了 Playwright 私有 `_expect` 钩子。执行点击和输入时则采用混合模式：**在 WebView DOM 里算好元素中心坐标和 iframe 偏移，换算回屏幕坐标系后交给原生驱动去点。** 这样既拿到和 Playwright 字节级一致的选择器与断言语义，又能触发真实的原生触摸事件。

### 2. 自研核心：跨平台语义归一化与 `resolveActionable`

原生界面没有 DOM，这部分必须自己写。`@mobilewright/core` 的设计非常干净：

- **惰性 Locator AST**：`getByRole`、`getByTestId`、`getByLabel`、`getByText`、`filter` 都只是拼接一棵策略树，真正执行动作或断言时才通过 WebSocket 调 `device.dump.ui` 拉取全量 `ViewNode`，在内存里跑 `queryAll`。
- **16 个跨平台角色与框架特例**：`query-engine.ts` 先用 `bareTypeName()` 剥掉前缀（`XCUIElementTypeTextField → textfield`、`android.widget.EditText → edittext`），再通过 `ROLE_TYPE_MAP` 归一为 `button`、`textfield`、`switch`、`list`、`alert` 等 16 个角色。针对跨端框架还补了脏活补丁：比如 React Native 万物皆 `ReactViewGroup`，只有带 `clickable/accessible` 才算 `button`；Jetpack Compose 按钮标题往往在子节点里，所以 `accessibleName()` 会递归收集子文本；遇到扁平化的 Android 视图树时，链式定位会退化到用 `bounds` 几何包含关系判断父子层级。
- **Auto-Waiting 与稳定性检查**：`locator.ts:455-500` 的 `resolveActionable()` 默认 5 秒超时、每 100ms 轮询一次视图树，依次检查：**元素存在 → 可见 → 可用 → 连续两次采样（间隔 50ms）的 `bounds` 坐标未发生漂移**（防动画未停就点歪）。不过受限于移动端无障碍树本身缺少遮挡层信息，这里没有浏览器里的 hit-target 遮挡检测，且超时最后一刻会容忍“未稳即点”。

### 3. Coding-First 真正的杀手锏：`@mobilewright/cli`

在拆解 `mobilewright` 之前，我以为官方主推的 Agent 入口是 `mobile-mcp`（毕竟 `@mobilewright/mcp` 也在仓库里）。但读源码发现，`@mobilewright/mcp` 被排除在 npm workspace 之外，整个 `index.js` 只有两行——就是把 `@mobilenext/mobile-mcp` 原样 re-export 了一下。

真正为 Coding-First 设计的入口，是仓库里专门写的 **`@mobilewright/cli`**（可执行命令 `mobilewright-cli`，灵感明显来自 Playwright CLI），附带一份直接装进 Claude Code / Codex 的 `SKILL.md`。它的工作方式非常贴合 Coding Agent 的胃口：

- 不需要往模型上下文里灌 24 个 MCP 工具的 JSON Schema，只占一个 `Bash(mobilewright-cli:*)` 权限。
- 每次执行交互命令后，把紧凑 YAML 视图树落盘到 `.mobilewright-cli/`（例如 `- button "Sign in" [ref=e9] [testid="login"]`），**同时直接在终端回显对应的 Mobilewright 确定性代码**（摘自 `packages/cli/skills/mobilewright-cli/SKILL.md:23-35`）：

````text
### Ran Mobilewright code
```js
await screen.getByRole('button', { name: 'Sign in' }).tap();
```
### Device
- Device ID: 6A557392-1480-4355-9EBC-B1D12A0F665D
- App: com.example.app
### Snapshot
- [Snapshot](.mobilewright-cli/screen-2026-09-14T20-13-21-867Z.yml)
````

派生逻辑复用 Inspector/Codegen 的同一套优先级（`TestId > Role > Label > Text`），且 `mobilewright-cli expect visible --text "..."` 直接复用核心库的 auto-wait 断言引擎。Agent 探索完一遍业务流，顺手把终端里攒下来的 `Ran Mobilewright code` 拼进 `tests/order.spec.ts`，再自己跑一遍 `npx mobilewright test` 修到全绿，就能提 PR。

### 4. 源码暴露的工程局限

这套实现虽然思路清晰，但处于 `v0.0.72` 阶段，边界同样明显：
- 抽取 Playwright 浏览器引擎强依赖 `coreBundle.js` 里的注释锚点，Playwright 升级随时可能破坏抽取脚本（CI 里专门加了 `sync:playwright && git diff --exit-code` 守门）。
- 跨 origin iframe 显式抛错不支持；Compose Dialog 检测依赖英文 `paneTitle === 'Dialog'`，源码里作者留了注释承认其他语言环境会漏检。
- 部分 Android 真机上 `device.apps.foreground` 返回不稳定，启动后只能打 warn 放行；云端 fleet 接口不允许 pin 指定 `deviceId`。
- 仓库自身的 GitHub Actions CI 只跑了单元测试，没有真机 E2E 矩阵，真实设备兼容性依赖手动矩阵验证。

---

## 五、成本算账：小模型 + Harness 已经很准了，Coding-First 还能赢吗？

拆完三款产品，回到最现实、也最扎心的成本问题：

> **既然现在用 7B–32B 专用视觉小模型（或 Gemini Flash / Qwen-VL 等轻量模型）配上一套打磨好的 Harness，单步准确率已经很高，跑一趟 MobileUse 只要一两美分，那我为什么还要花钱调昂贵的强 Coding 大模型（Claude Sonnet/Opus、GPT-5.x 等）走 Mobile Next 这套 Coding-First 路线？**

如果只盯着**“单次执行要花多少 Token 钱”**，质疑完全成立——强 Coding 模型裸跑一次 MCP 会话，账单能把人吓退。但放到真实研发与 QA 的**全生命周期**里，只算单次推理单价会漏掉三个决定胜负的变量：**重复执行次数 $K$、UI 漂移修复率 $\alpha$、以及按分钟计费的真机时长**。

![MobileUse 模型调用成本模型：Coding-First 编译路线 vs 小模型 + Harness 与三层混合路由](/images/mobilenext-three-oss-and-coding-first-cost/coding-first-vs-small-model-cost-model.drawio.png)

### 1. 用参数化估算模型把三条路线的总账摊开

下面以一条典型的 **15 步移动端核心业务流**（例如：启动 → 登录 → 搜索加购 → 结算校验）为例，基于 2026 年主流 API 定价量级与上下文消耗规律做一个透明的工程估算模型（注：以下数值为方便量级对比的工程参数假设，不同厂商定价、Prompt Cache 命中率和自建 GPU 折旧会带来 2–3 倍浮动，重点看结构与拐点）：

- **路线 A：小模型 + 精调 Harness（每次执行都推理）**
  - 每步输入一张 1024px 压缩截图或裁剪文本树 + 精简动作空间，约 2.5k–4k input tokens + 200 output tokens；15 步累计约 45k–60k input + 3k output。按轻量 API（或自托管 7B/32B GPU 折算）计算，单次成本 $C_{\text{small}}$ 约为 \$0.008–\$0.02（取中值 **\$0.015 / 次**）。
  - 总模型成本随执行次数 $K$ 线性增长（若算上偶发波动重试概率 $p_{\text{flake}}$，还会再叠加一层）：
    $$T_{\text{small}}(K) = K \cdot C_{\text{small}} + K \cdot p_{\text{flake}} \cdot C_{\text{retry}}$$

- **路线 B：强 Coding 大模型 + `mobile-mcp` 在线裸跑（不沉淀代码）**
  - 系统提示词 + 24 个 MCP 工具 Schema + 15 轮累积对话历史，哪怕吃满 Prompt Cache 折扣，单次仍轻松消耗 150k–350k 等效上下文，单次成本 $C_{\text{big}}$ 约为 \$0.15–\$0.80。
  - **结论非常干脆**：路线 B 比路线 A 贵 **15 到 50 倍**，在高频执行场景里毫无性价比。如果谁拿着 `mobile-mcp` 配强模型当 CI 用例天天跑，属于把最贵的模型用在了最错的地方。

- **路线 C：Mobile Next Coding-First 编译路线（探索生成 → `mobilewright` 零模型 CI + 漂移自愈）**
  - **一次性前置成本 $C_{\text{author}}$**：用强 Coding 模型配合 `mobilewright-cli` 探索 1 次、生成 `*.spec.ts` 并自跑修绿，按多轮探索 + 调试计，约消耗 **\$0.30–\$1.50**（取中值 **\$0.60 / 条**）。
  - **单次 CI 运行模型成本 = \$0**：上线进 Git 后，每次 PR 触发 `npx mobilewright test` 完全不调任何 LLM。
  - **UI 漂移维护成本 $\alpha \cdot C_{\text{heal}}$**：假设平均每运行 $\frac{1}{\alpha}$ 次 CI 就会遇到一次破坏 Locator 的 UI 改版，需要召回 Agent 读失败报告（截图 + 完整 AX JSON）修代码并跑绿，单次修复费 $C_{\text{heal}}$ 约为 \$0.20–\$0.60（取中值 **\$0.30 / 次**）。
  - 全生命周期总模型成本：
    $$T_{\text{coding}}(K) = C_{\text{author}} + \alpha \cdot K \cdot C_{\text{heal}}$$

### 2. 算出盈亏平衡点 $K^*$，也看清 Coding-First 什么时候必亏

令 $T_{\text{coding}}(K^*) = T_{\text{small}}(K^*)$（先忽略路线 A 的重试费，对小模型更宽松），解出盈亏平衡的执行次数：

$$K^* = \frac{C_{\text{author}}}{C_{\text{small}} - \alpha \cdot C_{\text{heal}}}$$

把不同业务形态带进去，优劣界限立刻清晰（以 $C_{\text{author}}$ = \$0.60、$C_{\text{small}}$ = \$0.015、$C_{\text{heal}}$ = \$0.30 为基准）：

| 业务场景 | UI 破坏频率 $\alpha$ | 摊销维护费 $\alpha \cdot C_{\text{heal}}$ | 盈亏平衡次数 $K^*$ | 跑 500 次模型总账（路线 A vs 路线 C） | 胜出路线 |
| --- | --- | --- | --- | --- | --- |
| **稳定核心主干**（登录/支付/下单） | 0.01（每百次修 1 次） | \$0.003 / 次 | **50 次** | \$7.50 vs **\$2.10** | **Coding-First 完胜** |
| **常规迭代模块**（列表/筛选/详情） | 0.025（每 40 次修 1 次） | \$0.0075 / 次 | **80 次** | \$7.50 vs **\$4.35** | **Coding-First 更省** |
| **高频改版页面**（活动页/大促运营位） | 0.06（每 16 次修 1 次） | \$0.018 / 次 | **无解（分母 < 0）** | **\$7.50** vs \$9.60 | **小模型 + Harness 完胜** |
| **一次性/低频探索**（临时巡检/C 端代办） | —（只跑 $K=1\text{--}10$ 次） | — | 远未到 $K^*$ | **\$0.015–\$0.15** vs \$0.60+ | **小模型 + Harness 完胜** |

这张表把很多争论直接终结了：
- **高频稳定流（如日活 PR 的 CI 回归）**：只要一条用例生命周期内能跑过 **50–80 次**（在几十人团队的每日 CI 里两周就跑满了），Coding-First 的模型总成本就能反超哪怕极便宜的小模型 Harness，跑得越久差距越大。
- **低频任务或高频变脸页面**：如果 $K$ 很小，或者 UI 改版快到 $\alpha \cdot C_{\text{heal}} \ge C_{\text{small}}$，Coding-First **永远回不了本**。这时候硬逼着模型先写代码再维护脚本，反而是在交智商税。

### 3. 三笔容易漏算的隐性账

除了表面上的 Token 账单，落到 MobileUse 工程里还有三笔经常左右最终决策的隐性成本：

1. **云真机分钟费放大器（经常比小模型 Token 贵）**
   小模型虽然单次推理便宜，但 15 步串行执行里，每一步都要“截屏/拉树 → 网络传输 → 模型推理 1–2.5 秒 → 下发动作”，整条用例很容易比本地确定性脚本多耗 **20–40 秒**。在 Mobile Next Cloud、BrowserStack 这类按分钟计费的云真机池里，**多占半分钟真机时间的费用，常常直接超过小模型省下来的 Token 费**。反观 `mobilewright` 零模型回放，官方案例里一条完整点单测试只要 8.7 秒，在真机时长和 CI 排队等待上省出的钱非常可观。
2. **Authoring 工具形态本身决定 $C_{\text{author}}$ 的高低**
   同样是走 Coding-First，用 `mobile-mcp` 让强模型写用例，和用 `mobilewright-cli` 写用例，前置成本并不一样：`mobile-mcp` 每次请求都要带着 24 个工具的 Schema 定义，且每轮树文本直接塞进对话历史；而 `mobilewright-cli` 只挂一个 Shell 工具、快照按需读磁盘文件、还自动吐出可复制的 `Ran Mobilewright code`，能把探索和调试轮数明显压下来，相当于直接把 $C_{\text{author}}$ 砍低一截，进而把盈亏平衡点 $K^*$ 往前拉。
3. **CI 门禁的“假红排查人力成本”**
   小模型 + Harness 即便单步做到 98% 准确率，15 步连乘也有 $(0.98)^{15} \approx 73.8\%$ 的单次全绿率；就算加了步级重试和验证器拉到 96%–98% 的任务通过率，在每天跑 500 条用例的 CI 里仍然意味着每天十几条随机抖动。工程师去排查“到底是代码出 Bug 还是模型抽风”的时间成本，往往远高于几美元的 API 账单。代码化断言把“业务失败”和“定位失败”分得清清楚楚，这才是 CI 场景里最值钱的确定性溢价。

---

## 六、生产级建议：不要二选一，按频率与漂移率做三层混合路由

把上面的源码机制和成本模型合在一起看，真正在企业 Mobile QA 或自动化平台里落地时，最合理的姿势**既不是全靠贵大模型写死代码，也不是全靠小模型从头点到尾**，而是把 Mobile Next 的代码化底座与低成本小模型 Harness 拼成一个**三层混合路由**：

- **L1：高频主干回归（占 CI 70%–85% 流量，$K \ge K^*$、低 $\alpha$）**
  用强 Coding 模型配 `mobilewright-cli`（或人工用 `mobilewright codegen`）一次性沉淀出标准 `*.spec.ts`，CI 里零 LLM 成本高速回放。这是确定性与单位成本的双重基石。
- **L2：运行时轻微漂移与突发弹窗兜底（占 10%–20%）**
  当 L1 的 `mobilewright` 用例抛出 `Locator` 超时时，**别一上来就唤起昂贵的强 Coding 模型重写测试**。先触发一个低成本小模型 + Harness 钩子，把 `mobilewright` 自动落盘的失败截图和完整 AX JSON 树喂给它：如果只是突发营销弹窗/权限弹窗，小模型点掉后继续跑；如果只是按钮改名或局部挪位，小模型产出候选 Locator 并记录下来，批量异步提轻修 PR。只有连续兜底失败、或涉及复杂业务断言重构时，才升级交给强 Coding 模型。
- **L3：一次探索、活动运营页、纯视觉/游戏自绘页（占 5%–10%，低 $K$ 或高 $\alpha$ 或无树）**
  明确放弃代码化沉淀，直接交给低成本小模型 + 精调 Harness 跑完出结论。遇到 Flutter Release 包、Canvas 自绘页、或者生命周期只有一周的大促活动页，硬写 Locator 只会制造维护债。

另外，如果你打算在团队内引入 Mobile Next 全家桶，有两个前置避坑点值得先核对：
1. **先盘点被测包的可调试性与无障碍质量**：`mobilecli` 的 WebView 注入、iOS 隐藏键盘依赖 debuggable 包；`mobilewright` 依赖角色、TestID 与文本树。如果业务 App 大量控件没标 `testID`/`accessibilityIdentifier`，先补齐核心页面的无障碍标识，收益比换任何大模型都大。
2. **留意 `mobilecli` 的 FSL-1.1 许可边界**：如果是企业内部研发和测试团队自用（包括内建内部测试平台），FSL-1.1 完全允许；但如果你本身在做对外售卖的商业云测平台或 Mobile Agent SaaS，直接打包分发 `mobilecli` 会触碰非竞争条款，需要评估替代驱动层或商业授权。

---

## 七、源码阅读索引与结语

如果想顺着本文的拆解继续深入源码，建议按下面这条顺序读，半天就能把三个仓库的骨架摸清：

1. **`mobilecli`**（设备运行时）：
   - `internal/server/dispatch.go` & `docs/openrpc.json`：全栈共享的 60+ RPC 契约总览。
   - `internal/devices/android_device_server.go` & `agents/android/java/UiAutomationFactory.java`：Android 常驻 `app_process` 代理与无障碍树提取。
   - `internal/devices/ios.go`、`internal/devices/ios_device_agent_native.go` & `agents/ios/devicekit/XCTestServer.swift`：iOS userspace TUN、DeviceKit 与 `machomap` 注入实现。
2. **`mobile-mcp`**（薄 MCP 编排层）：
   - `src/server.ts`：24 个工具注册、`SERVER_INSTRUCTIONS` 与 `mobile_batch_commands`。
   - `src/mobilecli.ts`、`src/format-elements.ts` & `src/coordinate-mapping.ts`：二进制发现链、文本树省 Token 裁剪与截图坐标换算。
3. **`mobilewright`**（确定性测试与 Agent CLI）：
   - `packages/test/src/fixtures.ts` & `packages/mobilewright/src/cli.ts`：如何复用 `@playwright/test` Runner 与 `DevicePoolHttpServer`。
   - `packages/mobilewright-core/src/query-engine.ts` & `locator.ts`：跨平台 16 角色归一化、RN/Compose 特例与 `resolveActionable` 稳定窗。
   - `scripts/sync-playwright-injected-script.mjs` & `packages/mobilewright-core/src/playwright-engine.ts`：WebView 注入 Playwright `InjectedScript` 的完整链路。
   - `packages/cli/src/cli.ts` & `packages/cli/skills/mobilewright-cli/SKILL.md`：Shell-First Agent 探索与 `Ran Mobilewright code` 回显设计。

Mobile Next 三款开源产品最有启发的地方，不在于哪一行代码有多炫技，而在于它把 **“AI 该待在研发流程的哪一段”** 切得非常干净：让最贵的智能停留在探索、代码生成与异常诊断这些低频高价值环节，把重复执行彻底交还给零 Token 的确定性代码与轻量设备运行时。至于“选 Coding-First 还是选小模型 + Harness”，答案从来不是信仰之争，而是把 $K$（运行频次）、$\alpha$（界面变更率）和设备时长放进同一张成本表里算出来的结果。
