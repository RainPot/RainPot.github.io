# React Bits 背景动效替换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将全站旧的宇宙星点背景替换为基于 React Bits `Threads` 的低干扰科技感背景，并保持 Astro 静态构建与 GitHub Pages 兼容。

**Architecture:** 通过 `@astrojs/react` 将背景实现从 Astro 外链脚本切换为 React island。保留 Astro 的全站布局与页面结构，只替换背景渲染层和相关样式，并移除旧的 `cosmos.js` 脚本注入。

**Tech Stack:** Astro 6、TypeScript、React、@astrojs/react、Vitest、OGL

---

## 文件结构

- 修改 `package.json`
  增加 React 与 Astro React 集成依赖，并补充背景运行依赖。
- 修改 `astro.config.mjs`
  注册 React 集成。
- 新增 `src/lib/background.ts`
  提供背景参数与“降低动效”媒体查询辅助函数，便于测试。
- 新增 `src/components/react/ThreadsBackground.tsx`
  封装 Threads 背景实现，负责浏览器侧初始化与渲染。
- 修改 `src/components/CosmicBackground.astro`
  切换为 React 背景入口，并保留扫描线覆盖层。
- 修改 `src/layouts/BaseLayout.astro`
  去除旧的 `cosmos.js` 脚本注入。
- 修改 `src/styles/global.css`
  调整背景层、扫描线层与降噪参数。
- 删除 `public/scripts/cosmos.js`
  移除旧的背景脚本。
- 新增 `tests/background.test.ts`
  覆盖背景配置与降级辅助逻辑，满足最小 TDD 闭环。

### Task 1: 为背景参数建立测试与辅助模块

**Files:**
- Create: `tests/background.test.ts`
- Create: `src/lib/background.ts`

- [ ] **Step 1: 写出失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THREADS_BACKGROUND,
  REDUCED_MOTION_THREADS_BACKGROUND,
  getThreadsBackgroundConfig
} from "../src/lib/background";

describe("threads background config", () => {
  it("uses a restrained default visual profile for article reading", () => {
    expect(DEFAULT_THREADS_BACKGROUND.color[0]).toBeCloseTo(0.3215686275);
    expect(DEFAULT_THREADS_BACKGROUND.color[1]).toBeCloseTo(0.8980392157);
    expect(DEFAULT_THREADS_BACKGROUND.color[2]).toBeCloseTo(1);
    expect(DEFAULT_THREADS_BACKGROUND.amplitude).toBe(0.65);
    expect(DEFAULT_THREADS_BACKGROUND.distance).toBe(0.1);
    expect(DEFAULT_THREADS_BACKGROUND.enableMouseInteraction).toBe(false);
  });

  it("further lowers motion when reduced motion is requested", () => {
    expect(REDUCED_MOTION_THREADS_BACKGROUND.amplitude).toBeLessThan(DEFAULT_THREADS_BACKGROUND.amplitude);
    expect(REDUCED_MOTION_THREADS_BACKGROUND.distance).toBeLessThanOrEqual(DEFAULT_THREADS_BACKGROUND.distance);
  });

  it("switches config based on reduced motion preference", () => {
    expect(getThreadsBackgroundConfig(false)).toBe(DEFAULT_THREADS_BACKGROUND);
    expect(getThreadsBackgroundConfig(true)).toBe(REDUCED_MOTION_THREADS_BACKGROUND);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- tests/background.test.ts`
Expected: FAIL，提示找不到 `../src/lib/background`。

- [ ] **Step 3: 写出最小实现**

```ts
export type ThreadsBackgroundConfig = {
  amplitude: number;
  distance: number;
  enableMouseInteraction: boolean;
  color: [number, number, number];
};

export const DEFAULT_THREADS_BACKGROUND: ThreadsBackgroundConfig = {
  amplitude: 0.65,
  distance: 0.1,
  enableMouseInteraction: false,
  color: [82 / 255, 229 / 255, 1]
};

export const REDUCED_MOTION_THREADS_BACKGROUND: ThreadsBackgroundConfig = {
  amplitude: 0.42,
  distance: 0.08,
  enableMouseInteraction: false,
  color: [82 / 255, 229 / 255, 1]
};

export function getThreadsBackgroundConfig(prefersReducedMotion: boolean): ThreadsBackgroundConfig {
  return prefersReducedMotion ? REDUCED_MOTION_THREADS_BACKGROUND : DEFAULT_THREADS_BACKGROUND;
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm test -- tests/background.test.ts`
Expected: PASS

### Task 2: 接入 React 与背景组件

**Files:**
- Modify: `package.json`
- Modify: `astro.config.mjs`
- Create: `src/components/react/ThreadsBackground.tsx`

- [ ] **Step 1: 安装依赖前先修改配置文件**

`package.json` 需要在 `dependencies` 中加入以下条目：

```json
"@astrojs/react": "^4.4.0",
"ogl": "^1.0.11",
"react": "^19.1.0",
"react-dom": "^19.1.0"
```

`astro.config.mjs` 需要改为：

```js
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://rainpot.github.io",
  base: process.env.BASE_PATH ?? "/",
  output: "static",
  integrations: [react()]
});
```

- [ ] **Step 2: 安装依赖**

Run: `npm install`
Expected: PASS，`package-lock.json` 更新且无安装错误。

- [ ] **Step 3: 创建 React 背景组件**

`src/components/react/ThreadsBackground.tsx` 需要实现以下结构：

```tsx
import { useEffect, useRef, useState } from "react";
import { Renderer, Program, Mesh, Color, Triangle } from "ogl";
import { DEFAULT_THREADS_BACKGROUND, getThreadsBackgroundConfig } from "../../lib/background";

const VERTEX_SHADER = `...`;
const FRAGMENT_SHADER = `...`;

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

export default function ThreadsBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const config = getThreadsBackgroundConfig(prefersReducedMotion);
    const renderer = new Renderer({ alpha: true, antialias: false, dpr: Math.min(window.devicePixelRatio, 1.5) });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: VERTEX_SHADER,
      fragment: FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [1, 1] },
        uColor: { value: new Color(...config.color) },
        uAmplitude: { value: config.amplitude },
        uDistance: { value: config.distance }
      }
    });

    const mesh = new Mesh(gl, { geometry, program });
    const canvas = gl.canvas;
    canvas.className = "threads-background__canvas";
    container.appendChild(canvas);

    let frameId = 0;

    const resize = () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
    };

    const render = (time: number) => {
      frameId = window.requestAnimationFrame(render);
      program.uniforms.uTime.value = time * 0.00025;
      renderer.render({ scene: mesh });
    };

    resize();
    frameId = window.requestAnimationFrame(render);
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [prefersReducedMotion]);

  return <div className="threads-background" ref={containerRef} aria-hidden="true" />;
}
```

实现要求：

- 着色器内容使用 Threads 所需的最小实现。
- 不加入鼠标交互分支。
- 组件必须只渲染背景容器，不输出额外文本节点。

- [ ] **Step 4: 运行背景测试确认未回归**

Run: `npm test -- tests/background.test.ts`
Expected: PASS

### Task 3: 接入全站背景并移除旧实现

**Files:**
- Modify: `src/components/CosmicBackground.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/styles/global.css`
- Delete: `public/scripts/cosmos.js`

- [ ] **Step 1: 切换 Astro 背景入口**

`src/components/CosmicBackground.astro` 改为：

```astro
---
import ThreadsBackground from "./react/ThreadsBackground";
---

<div class="cosmic-background" aria-hidden="true">
  <ThreadsBackground client:load />
</div>
<div class="scanline" aria-hidden="true"></div>
```

- [ ] **Step 2: 去掉旧脚本注入**

`src/layouts/BaseLayout.astro` 中删除：

```astro
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
```

以及：

```astro
<script src={asset("/scripts/cosmos.js")} defer></script>
```

- [ ] **Step 3: 更新全局样式以适配新背景**

`src/styles/global.css` 中至少做以下调整：

```css
.cosmic-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.threads-background,
.threads-background__canvas {
  width: 100%;
  height: 100%;
}

.threads-background__canvas {
  display: block;
  opacity: 0.62;
  filter: saturate(0.88) brightness(0.88);
}

.scanline {
  z-index: 1;
  background:
    linear-gradient(rgba(255, 255, 255, 0.02) 50%, rgba(0, 0, 0, 0) 50%),
    radial-gradient(circle at var(--cursor-x, 50%) var(--cursor-y, 40%), rgba(82, 229, 255, 0.08), transparent 18rem);
  background-size: 100% 4px, auto;
}
```

同时删除 `#cosmos` 的旧样式定义。

- [ ] **Step 4: 删除旧脚本文件**

Delete: `public/scripts/cosmos.js`

- [ ] **Step 5: 运行现有头部测试，确认样式修改未破坏其假设**

Run: `npm test -- tests/header.test.ts`
Expected: PASS

### Task 4: 全量验证

**Files:**
- Modify: `docs/superpowers/plans/2026-05-06-react-bits-background.md`

- [ ] **Step 1: 运行完整测试**

Run: `npm test`
Expected: PASS，所有测试通过。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`
Expected: PASS，Astro 静态构建完成。

- [ ] **Step 3: 记录计划执行结果**

在本计划文件末尾补充：

```md
## Execution Notes

- 背景已切换为 React Bits Threads 风格实现。
- 旧的 `public/scripts/cosmos.js` 已移除。
- 已运行 `npm test` 与 `npm run build` 作为完成验证。
```

## 自检

- Spec coverage：计划覆盖了依赖接入、React 组件引入、全站替换、旧脚本移除、测试与构建验证。
- Placeholder scan：未使用 TBD/TODO 等占位词，所有任务都绑定了具体文件和命令。
- Type consistency：`DEFAULT_THREADS_BACKGROUND`、`REDUCED_MOTION_THREADS_BACKGROUND`、`getThreadsBackgroundConfig` 在测试与实现中命名保持一致。

## Execution Notes

- 背景已切换为 React Bits `Threads` 风格实现，并按阅读场景收敛为低速、低对比版本。
- 旧的 `public/scripts/cosmos.js` 已移除，背景加载方式改为 Astro 中挂载 React island。
- 已运行 `npm test` 与 `npm run build`，两者均通过。
