import type { TransitionBeforePreparationEvent } from "astro:transitions/client";

if (typeof document !== "undefined") {
  let activeSignal: AbortSignal | null = null;
  const showProgress = (visible: boolean) => {
    const progress = document.querySelector<HTMLElement>("[data-navigation-progress]");
    if (progress) progress.hidden = !visible;
  };

  document.addEventListener("astro:before-preparation", rawEvent => {
    const { signal } = rawEvent as TransitionBeforePreparationEvent;
    activeSignal = signal;
    showProgress(true);
    signal.addEventListener("abort", () => {
      // 旧请求晚到的取消信号，不能覆盖用户随后点击的新目标。
      if (activeSignal !== signal) return;
      activeSignal = null;
      showProgress(false);
    }, { once: true });
  });

  document.addEventListener("astro:after-swap", () => {
    activeSignal = null;
    showProgress(false);
  });
}
