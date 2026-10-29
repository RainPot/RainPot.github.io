import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dom: JSDOM;
beforeEach(() => vi.resetModules());
afterEach(() => {
  dom?.window.close();
  vi.unstubAllGlobals();
});

describe("导航动作反馈", () => {
  it("收到导航后立即显示反馈，准备完成时仍保留到页面真正替换", async () => {
    const doc = await openPage();
    prepare(doc, new AbortController());
    expect(progress(doc).hidden).toBe(false);

    doc.dispatchEvent(new dom.window.Event("astro:after-preparation"));
    expect(progress(doc).hidden).toBe(false);
    doc.dispatchEvent(new dom.window.Event("astro:after-swap"));
    expect(progress(doc).hidden).toBe(true);
  });

  it("旧导航的取消不能清除新一次点击的反馈", async () => {
    const doc = await openPage();
    const first = new AbortController();
    const latest = new AbortController();
    prepare(doc, first);
    prepare(doc, latest);
    first.abort();

    expect(progress(doc).hidden).toBe(false);
    latest.abort();
    expect(progress(doc).hidden).toBe(true);
  });

  it("替换页面后操作新页面的反馈节点", async () => {
    const doc = await openPage();
    prepare(doc, new AbortController());
    doc.body.innerHTML = '<div data-navigation-progress></div>';
    doc.dispatchEvent(new dom.window.Event("astro:after-swap"));
    expect(progress(doc).hidden).toBe(true);

    prepare(doc, new AbortController());
    expect(progress(doc).hidden).toBe(false);
  });
});

async function openPage() {
  dom = new JSDOM('<div data-navigation-progress hidden></div>', { url: "https://rainpot.example/blog/" });
  vi.stubGlobal("document", dom.window.document);
  // 通过页面实际导入的入口验证自动注册，而不是只测辅助函数。
  await import("../src/scripts/navigation-status");
  return dom.window.document;
}

function prepare(doc: Document, controller: AbortController) {
  doc.dispatchEvent(Object.assign(new dom.window.Event("astro:before-preparation"), { signal: controller.signal }));
}

function progress(doc: Document) {
  return doc.querySelector<HTMLElement>("[data-navigation-progress]")!;
}
