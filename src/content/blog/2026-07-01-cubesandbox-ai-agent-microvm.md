---
title: "CubeSandbox：把 Agent 代码执行放进可治理的 MicroVM"
description: "基于 TencentCloud/CubeSandbox 最新 master commit，说明它如何用 E2B 兼容 API、KVM MicroVM、CubeCoW、CubeVS/eBPF、CubeEgress 和 CubeProxy sidecar 组成面向 AI Agent 的沙箱运行平台。"
date: "2026-07-01"
tags: ["AI Agent", "Sandbox", "KVM", "eBPF", "E2B", "源码阅读"]
draft: false
featured: false
readingTime: 18
---

CubeSandbox 值得看，不是因为它又做了一个代码执行沙箱，而是它把 Agent 跑代码时最麻烦的几件事放在同一套运行平台里：启动要快，隔离要硬，文件状态要能快照，网络出站要能管，凭证还不能进入沙箱。

官方 README 对它的定位很直接：基于 RustVMM 和 KVM，兼容 E2B SDK，可以在 60ms 内创建硬件隔离沙箱，单实例内存开销低于 5MB。这里的关键不只是快，而是它没有把“快”建立在共享内核容器上，而是用 MicroVM 做隔离，再用快照、reflink、eBPF 和代理把启动和治理成本压下来。

源码版本固定在 [TencentCloud/CubeSandbox](https://github.com/TencentCloud/CubeSandbox) `master` 分支 commit `336ddbac56b6a60fd0f610bb18ca23107ec1fe01`，提交时间是 `2026-07-01 20:07:52 +0800`。最新提交是：

```text
feat(sdk): align with e2b — complete filesystem API (#678)
```

GitHub Releases 页面当前最新 release 是 `v0.4.0`，发布时间显示为 `2026-06-15`。这篇文章只讨论我读到的这个 commit，不把后续版本的变化算进去。

先放官方架构图。它把 CubeSandbox 分成控制面和数据面：`CubeAPI`、`CubeMaster`、`Redis` 是控制入口和元数据层；`Cubelet`、`CubeShim`、`CubeHypervisor`、`CubeCoW`、`CubeVS`、`CubeEgress`、`CubeProxy` 处理真实沙箱、网络、代理和生命周期。

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="CubeSandbox 官方架构图" src="/images/cubesandbox/official/cube-sandbox-arch.png" style="width: 960px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：CubeSandbox architecture，来自 TencentCloud/CubeSandbox docs/assets。</p>
</div>

官方图更像产品组件图。读源码时，我更关心一条真实请求怎么走完：

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="CubeSandbox 创建沙箱源码链路图" src="/images/cubesandbox/cubesandbox-create-flow.drawio.png" style="width: 960px; max-width: none; margin: 0;" />
</div>

这条链路里最重要的点是：CubeSandbox 没把“创建沙箱”塞进一个本地进程调用，而是拆成 API 兼容层、调度层、节点执行层、虚拟化层、网络层和代理层。这样做会增加组件数量，但也让集群调度、节点 failover、网络策略、生命周期恢复各自有清楚边界。

## 1. 仓库结构：不是单点沙箱，而是一套运行平台

仓库根目录已经能看出设计重心：

```text
CubeAPI          E2B 兼容 REST API
CubeMaster       调度、元数据、生命周期控制
Cubelet          节点侧沙箱生命周期执行
CubeShim         containerd Shim v2 和 hypervisor 的桥
CubeNet          CubeVS eBPF 网络数据面
CubeEgress       OpenResty/Lua 出网安全代理
CubeProxy        反向代理和 auto resume sidecar
cubecow          reflink Copy-on-Write 快照引擎
network-agent    节点网络意图落地，注册 TAP 和推送 egress policy
sdk              Python / Go SDK
web              管理控制台
```

官方文档把设计原则写成几条：Agent 优先、硬件隔离、毫秒级启动、零信任出网、无状态控制面、高效存储。对应到代码里，基本可以映射成下面几组机制：

```text
E2B 兼容：CubeAPI + SDK
硬隔离：CubeShim + CubeHypervisor + KVM MicroVM
快启动：template snapshot + CubeCoW reflink
网络隔离：CubeVS eBPF
出网治理：CubeEgress + network-agent policy push
访问路由：CubeProxy + Redis proxy map
空闲生命周期：CubeProxy sidecar + CubeMaster pause/resume/kill
```

所以读这个项目不能只看 `CubeAPI` 或 SDK。它的核心价值在运行时控制面和节点数据面之间的接缝：请求怎么调度到节点，节点怎么把 rootfs、tap、MicroVM 和代理状态凑齐，沙箱运行后出网和暂停恢复又怎么被治理。

## 2. CubeAPI：E2B 外壳，CubeMaster 请求体

`POST /sandboxes` 的入口在 `CubeAPI/src/handlers/sandboxes.rs`。handler 本身很薄，只做请求体接收和 service 调用：

```rust
pub async fn create_sandbox(
    State(state): State<AppState>,
    Json(body): Json<NewSandbox>,
) -> AppResult<impl IntoResponse> {
    let created = state.services.sandboxes.create_sandbox(body).await?;
    Ok((StatusCode::CREATED, Json(created)))
}
```

真正有信息量的是 `CubeAPI/src/services/sandboxes.rs`。这里把 E2B 风格的 `template_id`、`timeout`、`lifecycle`、`network`、`env_vars` 翻译成 CubeMaster 的 gRPC 请求：

```rust
let (auto_pause, auto_resume) = lifecycle.as_ref().map(|lc| {
    use crate::models::SandboxOnTimeout;
    (matches!(lc.on_timeout, SandboxOnTimeout::Pause), lc.auto_resume)
}).unwrap_or((false, false));

let req = CreateSandboxRequest {
    request_id: new_request_id(),
    instance_type: self.instance_type.clone(),
    network_type: Some("tap".to_string()),
    cube_network_config,
    auto_pause,
    auto_resume,
    ...
};
```

这段代码说明 CubeAPI 的定位不是“业务逻辑中心”，而是兼容层和边界校验层。E2B 迁移时，调用方看到的是熟悉的 sandbox API；进入 CubeSandbox 内部后，请求变成带 `network_type=tap`、`cube_network_config`、`auto_pause`、`auto_resume` 的调度请求。

这里还有一个细节：`env_vars` 会先被 `validate_env_vars` 校验，再进入创建请求。对 Agent 沙箱来说，这类 guard 很重要，因为环境变量既可能影响运行时，也可能变成凭证泄漏入口。

## 3. CubeMaster：调度、重试和 Redis 元数据写入

CubeMaster 的创建入口在 `CubeMaster/pkg/service/sandbox/sandbox_run.go`。它不是同步直连某个 Cubelet，而是先构造 `CreateContext`，再交给 scheduler：

```go
if config.GetConfig().Common.MockCreateDirectHandle {
    createCtx.Handle()
} else {
    scheduler.AddBufferTask(createCtx, req.InstanceType)
}
createCtx.Wait()
```

调度后会调用 Cubelet。如果节点返回可熔断错误，CubeMaster 会把该节点加入坏节点列表并继续重试：

```go
if c.callCubelet() {
    c.retryCost += c.cubeletEndTime.Sub(c.cubeletStartTime)
    c.retryTimes++
    if errorcode.IsCircutBreakCode(errorcode.MasterCode(
        c.cubeletRsp.GetRet().GetRetCode())) {
        c.selctx.AddLastBadNode(c.selectHost)
    }
    continue
}
c.dealSuccResult()
```

创建成功后，CubeMaster 至少要做两类写入：一类是给 CubeProxy 用的代理元数据，一类是沙箱 spec / lifecycle 状态。代理映射里能看到 host、sandbox IP、默认端口、public access 和 traffic token：

```go
proxy := &proxytypes.SandboxProxyMap{
    HostIP: c.selectHost.HostIP(),
    SandboxID: c.masterRsp.SandboxID,
    SandboxIP: c.masterRsp.SandboxIP,
    SandboxPort: "8080",
    AllowPublicTraffic: allowPublic,
    TrafficAccessToken: token,
}
```

Redis key 也被集中定义在 `CubeMaster/pkg/base/rediskey/rediskey.go`：

```go
SandboxProxy: cube:v1:shared:sandbox:proxy:{sandboxID}
SandboxLifecycleMeta: cube:v1:shared:sandbox:lifecycle:meta
SandboxLifecycleEvents: cube:v1:shared:sandbox:lifecycle:events
SandboxLifecycleState: cube:v1:shared:sandbox:lifecycle:state:{sandboxID}
```

这个设计让 `CubeAPI` 和 `CubeMaster` 保持无状态，Redis 成了沙箱元数据和生命周期事件的共享事实源。代价也很明显：Redis 的一致性、TTL 和事件消费正确性会直接影响代理路由和 auto pause/resume。

## 4. Cubelet：节点侧把 rootfs、tap 和 MicroVM 串起来

Cubelet 的创建入口在 `Cubelet/services/cubebox/service.go`。它会设置默认值，再根据 runtime 走 Cube runtime 或其他 runtime：

```go
SetRunCubeSandboxRequestDefaultValue(req)
createInfo := &workflow.CreateContext{ReqInfo: req, Failover: true}

if constants.IsCubeRuntime(ctx) {
    createErr = s.engine.Create(ctx, createInfo)
} else {
    createInfo.SandboxID = utils.GenerateID()
    createErr = s.otherRuntime.Create(ctx, createInfo)
}
```

默认网络类型在这里落成 `tap`。但 Cubelet 自己不直接处理所有 eBPF 细节，而是把网络意图交给 `network-agent`：

```go
cubeNetworkConfigBeforeDNS := buildNetworkAgentCubeNetworkConfig(request)
resolvedDNSServers, err := localnetfile.ResolveEffectiveDNSServers(request)
cubeNetworkConfig, dnsAllowOutCIDRs := mergeDNSAllowOutCIDRs(
    ctx, cubeNetworkConfigBeforeDNS, resolvedDNSServers)
ensureReq := l.buildEnsureNetworkRequestFromIntent(
    opts.SandboxID, request.GetRequestID(), request.ExposedPorts, req, cubeNetworkConfig)
ensureResp, naErr := l.networkAgentClient.EnsureNetwork(ctx, ensureReq)
```

这层拆分很实际。Cubelet 管沙箱生命周期，network-agent 管节点网络状态。这样 `EnsureNetwork` 可以同时处理 tap、端口映射、DNS allow list、CubeVS 注册和 CubeEgress policy push，不把网络数据面塞回 Cubelet。

## 5. CubeCoW：快照快，不靠复制大文件

官方文档里说模板生命周期分三步：先用镜像或 Dockerfile 打包 rootfs，再把 rootfs 放进 MicroVM 冷启动并打内存/状态快照，最后注册 Rootfs + Snapshot，后续热启动复用。

文件系统快照这部分落在 `cubecow`。它当前的核心实现是 XFS reflink：普通文件承载 volume/snapshot，内核 `FICLONE` ioctl 做 copy-on-write 克隆。`cubecow/src/engine/reflink.rs` 里这段注释很关键：

```rust
// a filesystem mounted on a reflink-capable layout offers the same O(1)
// clone semantics at the file layer, via the `FICLONE` ioctl...
// All metadata is reconstructable from the layout itself...
// No on-disk ledger is required.
const FICLONE: libc::c_ulong = 0x40049409;
```

创建 snapshot 时，代码先在内存索引里占住名字，再调用 `ficlone`：

```rust
let dst = self.snap_file(&ultimate_origin, snapshot_name);
let src_file = File::open(&source_path).map_err(...)?;
ficlone(&src_file, &dst).map_err(|errno| { ... })?;
let _ = fsync_dir(&self.vol_dir(&ultimate_origin));
```

所以 CubeCoW 的快，不是“复制优化得比较快”，而是根本不复制数据块。它借文件系统 COW 语义让 snapshot/clone 变成元数据操作，真正写入时才分裂数据块。边界也随之明确：底层文件系统必须支持 reflink，生产部署不能把这个条件当成可选项。

## 6. CubeVS：用 eBPF 接管沙箱网络数据面

CubeSandbox 没用 Linux bridge / OVS / iptables NAT 做主数据面，而是实现了 CubeVS。文档里把它拆成三个 BPF 程序：

```text
from_cube   TAP TC ingress，沙箱到宿主机，SNAT、策略、ARP 代理
from_world  宿主机网卡 TC ingress，外部到宿主机，反向 NAT、端口映射
from_envoy  cube-dev TC egress，代理到沙箱，DNAT、透明代理支持
```

这张图把 eBPF 和 L7 出网代理之间的关系展开：

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="CubeSandbox CubeVS 和 CubeEgress 出网治理路径图" src="/images/cubesandbox/cubesandbox-egress-network.drawio.png" style="width: 960px; max-width: none; margin: 0;" />
</div>

网络策略的核心判断在 `CubeNet/src/mvmtap.bpf.c`：

```c
/*
 * Priority: allow_out_v2 > deny_out > default allow
 */
inner_map = bpf_map_lookup_elem(&allow_out_v2, &ifindex);
if (inner_map) {
    value = bpf_map_lookup_elem(inner_map, &key);
    if (value && (value->expires_at_ns == 0 ||
                  value->expires_at_ns > bpf_ktime_get_ns())) {
        *policy_value = *value;
        return true;
    }
}
```

没有 allow 命中时，才查 `deny_out`；仍然没命中则默认放行：

```c
inner_map = bpf_map_lookup_elem(&deny_out, &ifindex);
if (inner_map) {
    if (bpf_map_lookup_elem(inner_map, &key))
        return false;
}
return true;
```

如果 policy value 上有 L7 标记，且目标端口是 80 或 443，流量会被导到 L7 代理路径：

```c
if (!(policy_value->flags & NET_POLICY_FLAG_L7_REQUIRED))
    return false;

return l4->dest == bpf_htons(80) || l4->dest == bpf_htons(443);
```

`network-agent/internal/service/local_service.go` 负责把 API 层传来的 `CubeNetworkConfig` 翻译成 CubeVS 能消费的 `MVMOptions`。这里能看到 L3/L4 策略和 L7 规则的分工：

```go
// cubevs enforces L3/L4 allow_internet_access / allow_out / deny_out,
// and it also receives network targets extracted from L7 rules as L7 allow targets.
// The complete L7 rules are still pushed to CubeEgress separately.
func cubeVSTapRegistration(cfg *CubeNetworkConfig) cubevs.MVMOptions {
    ...
}
```

换句话说，CubeVS 负责高速路径和粗粒度网络边界；CubeEgress 负责 HTTP/HTTPS 语义、域名、凭证和审计。这个分工比“全部丢给代理”更适合高密度沙箱，因为绝大多数包不需要走 L7 解释器。

## 7. CubeEgress：凭证不进沙箱，但请求还能带凭证

Agent 经常需要访问外部 API。直接把 API key 放进沙箱环境变量里，风险很高：LLM 生成代码可以读 env、写日志、上传文件、打印异常。CubeEgress 的处理方式是：沙箱按普通请求访问外部 API，代理在宿主侧按策略注入 header，密钥不进入沙箱。

`CubeEgress/nginx.conf` 里可以看到 OpenResty 的几个关键 phase：

```nginx
ssl_certificate_by_lua_block { ... }
access_by_lua_block { require("access_phase").decide() }
log_by_lua_block { audit.write_one() }
```

`CubeEgress/lua/access_phase.lua` 的文件头把决策过程写得很清楚：根据 sandbox IP 查 policy，按规则顺序 first-match-wins，允许时再做注入，拒绝时直接 403。

```lua
--   2. Look up the policy for the sandbox source IP.
--   3. Walk policy.rules in order, first-match-wins.
--   4. On allow: enforce gates G1 (https only) and G4 (Host == SNI),
--      then for each inject{header, secret, format} run ngx.req.set_header.
```

真正值得注意的是注入前的防伪造逻辑。规则准备注入某个 header 时，代理会先清掉沙箱自己带来的同名 header：

```lua
for _, inj in ipairs(injects) do
    if type(inj.header) == "string" and inj.header ~= "" then
        pcall(ngx.req.clear_header, inj.header)
    end
end
```

这避免了一个常见问题：如果 Host/SNI 校验失败，代理没有注入真实密钥，但沙箱自己伪造的 `Authorization` header 被原样转发。CubeEgress 的策略是先清，再按 gate 决定是否写入真实值。

管理 API 也专门做了 GET 脱敏。`CubeEgress/lua/admin.lua` 里，读取 policy 时会把 `inject[].secret` 替换成固定标记：

```lua
if inj.secret ~= nil then
    inj.secret = "***REDACTED***"
end
inj.secret_ref_synthetic = nil
```

这说明 CubeEgress 不只是“代理转发”，它是出网安全边界：policy 未就绪时失败关闭，没有 policy 时默认拒绝，命中 deny 规则直接 403，允许规则也要过注入 gate。

## 8. CubeProxy sidecar：让空闲沙箱 pause，再按请求恢复

CubeSandbox 的生命周期不是简单 timeout kill。它支持 `on_timeout=pause` 和 `auto_resume=true`，也就是空闲时暂停，下一次流量进来再恢复。

CubeProxy 的 Lua gate 在 `CubeProxy/lua/sandbox_state.lua`：

```lua
if state == "pausing" then
    ngx.header["Retry-After"] = "2"
    utils:respond_unavailable()
end

if state == "killing" or state == "killed" then
    ngx.var.cube_retcode = "310410"
    ngx.exit(410)
end
```

如果状态是 `paused`，CubeProxy 不直接转发请求，而是发内部 subrequest 给 sidecar：

```lua
local res = ngx.location.capture("/_sidecar_resume", {
    method = ngx.HTTP_POST,
    args = args,
    body = "",
})
```

sidecar 里的 `resumer` 会合并同一个 sandbox 的并发恢复请求，避免一个流量尖峰触发多次 CubeMaster RPC：

```go
if c, ok := r.calls[sandboxID]; ok {
    r.mu.Unlock()
    select {
    case <-c.done:
        return c.err
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

暂停则由 `sweeper` 定期扫 registry。它取 `LastActiveMs`、`CreatedAt` 和 timeout 做 idle 判断；如果 sandbox 开了 auto pause，就调用 CubeMaster pause，否则按 timeout kill：

```go
switch {
case e.Meta.AutoPause:
    if err := s.tryPause(ctx, e); err != nil {
        s.pauseFailed.Add(1)
    }
default:
    if err := s.tryKill(ctx, e); err != nil {
        s.killFailed.Add(1)
    }
}
```

这里的工程难点不是 pause/resume RPC 本身，而是状态竞争。源码里把 `cube:v1:shared:sandbox:lifecycle:state:<id>` 同时用作终态标记和迁移锁，`paused/running`、`pausing/resuming` 共用一个 key。`resumer` 的注释也直接承认这是一个“state-key conflict”，通过 GET 当前值再 SET `resuming` 解决所有权判断。

这类设计不漂亮，但很工程化：它把并发恢复、跨 sidecar 协调、proxy 本地状态和 Redis 状态统一压在同一个状态机里，避免每个组件各自猜沙箱是否可用。

## 9. 官方性能图怎么读

官方 README 里放了创建速度和内存开销图。我把两张图也贴出来：

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="CubeSandbox 官方创建速度图" src="/images/cubesandbox/official/readme-speed-zh.png" style="width: 760px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：CubeSandbox 创建速度 benchmark，来自 README_zh。</p>
</div>

<div style="overflow-x: auto; margin: 24px 0;">
  <img alt="CubeSandbox 官方内存开销图" src="/images/cubesandbox/official/readme-overhead-zh.png" style="width: 760px; max-width: none; margin: 0;" />
  <p style="margin: 8px 0 0; font-size: 0.9em; color: #666;">官方图：CubeSandbox 沙箱内存开销 benchmark，来自 README_zh。</p>
</div>

这组数字要结合实现理解。CubeSandbox 能把创建压低，主要靠三件事：

```text
1. 模板预启动和快照，避免每次从空 rootfs 冷启动完整系统。
2. CubeCoW reflink，避免 clone/snapshot 复制大文件。
3. eBPF 数据面和 Redis 元数据，让代理路由、网络策略和状态同步不阻塞创建主链路。
```

但这些 benchmark 不应该被理解成“任何环境稳定 60ms”。它依赖 KVM、文件系统 reflink、节点热状态、模板预热、网络组件正常、Redis 正常，以及 workload 规格。源码能解释为什么它有机会快，也能解释为什么部署条件会影响结果。

## 10. 这个架构的取舍

CubeSandbox 最值得借鉴的地方，是它没有把 Agent 沙箱问题简化成“容器里跑代码”。AI Agent 的代码执行环境有几个传统容器平台不太顺手的问题：

```text
不可信代码需要硬隔离；
代码常常短生命周期、高并发；
任务过程需要 snapshot/clone/rollback；
访问外部服务要注入凭证，但凭证不能暴露给沙箱；
空闲环境不能一直占资源，但恢复又不能太慢；
对外 API 最好兼容已有 E2B 生态。
```

CubeSandbox 的回答是多组件组合：

```text
KVM MicroVM 解决隔离；
template snapshot + CubeCoW 解决启动和克隆；
CubeVS 解决高密度网络数据面；
CubeEgress 解决 L7 出网、凭证和审计；
CubeProxy sidecar 解决按请求恢复；
CubeAPI 解决 E2B 迁移成本。
```

代价也很清楚。

第一，部署前提不轻。它需要 Linux x86_64、KVM、合适内核能力、reflink 文件系统、eBPF/TC 环境、OpenResty、Redis 和多个本地组件配合。macOS 本地基本只能读代码或跑部分单元测试，跑不出完整数据面。

第二，网络语义有分层边界。CubeVS 负责 L3/L4 和 NAT，CubeEgress 只覆盖被标记走 L7 的 HTTP/HTTPS 路径。非 80/443 或非 HTTP 语义流量，主要还是靠 CubeVS 的 allow/deny 约束。

第三，出网代理需要处理证书和信任。HTTPS 透明代理要现场签发 leaf 证书，模板里必须配好 CA 信任链。否则安全策略还在，应用请求可能因为证书校验失败而不可用。

第四，Redis 是关键事实源。proxy map、lifecycle meta、events、state 都在 Redis 上协作。它让控制面无状态，但也把生命周期正确性放到了 Redis key、TTL、stream 和 sidecar 消费逻辑上。

第五，组件边界清楚，不代表调试简单。一次创建失败可能发生在 CubeAPI 参数、CubeMaster 调度、Cubelet engine、network-agent、CubeCoW、CubeShim、CubeHypervisor、CubeVS 或 Redis 写入任意一环。好处是每环都有独立日志和测试，坏处是排障路径更长。

## 11. 推荐阅读顺序

如果要继续读源码，我建议按这条线走：

```text
README_zh.md
docs/zh/architecture/overview.md
CubeAPI/src/services/sandboxes.rs
CubeMaster/pkg/service/sandbox/sandbox_run.go
CubeMaster/pkg/service/sandbox/util.go
Cubelet/services/cubebox/service.go
Cubelet/network/plugin_tap.go
network-agent/internal/service/local_service.go
cubecow/src/engine/reflink.rs
CubeNet/src/mvmtap.bpf.c
CubeEgress/lua/access_phase.lua
CubeProxy/lua/sandbox_state.lua
CubeProxy/sidecar/internal/resumer/resumer.go
CubeProxy/sidecar/internal/sweeper/sweeper.go
```

这条顺序基本跟一次 sandbox 创建和后续访问一致：API 进来，Master 调度，Cubelet 落地 rootfs 和网络，Shim/Hypervisor 拉起 MicroVM，CubeVS/CubeEgress 管出网，CubeProxy 和 sidecar 管访问路由与暂停恢复。

## 12. 小结

CubeSandbox 的核心不是某一个单点优化，而是把 Agent 沙箱拆成了几条可以独立演进的通道：API 兼容、调度、虚拟化、存储快照、网络数据面、L7 出网治理和生命周期恢复。

这个组合让它比普通容器沙箱复杂很多，但复杂度有明确来源。只要 Agent 能执行模型生成的代码，并且这段代码需要访问互联网、处理凭证、保存过程状态、并发创建环境，单靠一个轻量容器就很难同时满足隔离、速度和治理。CubeSandbox 的价值就在这里：它把“快启动沙箱”做成了一个可调度、可审计、可暂停恢复的运行系统。

参考链接：

- [TencentCloud/CubeSandbox](https://github.com/TencentCloud/CubeSandbox)
- [Architecture Overview](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/zh/architecture/overview.md)
- [Network Architecture](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/zh/architecture/network.md)
- [Security Proxy Guide](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/zh/guide/security-proxy.md)
- [Lifecycle Guide](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/zh/guide/lifecycle.md)
- [Snapshot / Rollback / Clone Guide](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/zh/guide/snapshot-rollback-clone.md)
- [Templates Guide](https://github.com/TencentCloud/CubeSandbox/blob/master/docs/zh/guide/templates.md)
