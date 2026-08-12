import {
  clamp,
  clampTransform,
  getFittedSize,
  getMaxScale,
  getNextIndex,
  zoomAt,
  IDENTITY_TRANSFORM,
  type Point,
  type Size,
  type Transform
} from "../lib/image-lightbox";

const article = document.querySelector<HTMLElement>(".markdown-content");
const images = article
  ? [...article.querySelectorAll<HTMLImageElement>("img")].filter((img) => !img.closest("a"))
  : [];

if (images.length > 0) {
  const AXIS_SLOP = 10; // 拖出这么多像素才判定方向，之前都还算「点了一下」
  const DISMISS_DISTANCE = 120; // 竖着拖过这个距离松手就关掉
  const SWIPE_DISTANCE = 70; // 横着拖过这个距离松手就翻页
  const TRANSFORM_EASING = "transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1)";

  const overlay = document.createElement("div");
  overlay.className = "image-lightbox";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "图片预览");
  overlay.innerHTML = `
    <div class="image-lightbox__backdrop"></div>
    <div class="image-lightbox__stage" data-lightbox-stage>
      <span class="image-lightbox__spinner" aria-hidden="true"></span>
      <img class="image-lightbox__image" data-lightbox-image alt="" draggable="false" />
    </div>
    <div class="image-lightbox__toolbar">
      <span class="image-lightbox__counter" data-lightbox-counter></span>
      <button type="button" class="image-lightbox__button" data-lightbox-close aria-label="关闭图片预览">✕</button>
    </div>
    <button type="button" class="image-lightbox__nav image-lightbox__nav--prev" data-lightbox-prev aria-label="上一张">‹</button>
    <button type="button" class="image-lightbox__nav image-lightbox__nav--next" data-lightbox-next aria-label="下一张">›</button>
  `;
  document.body.append(overlay);

  const stage = overlay.querySelector<HTMLElement>("[data-lightbox-stage]")!;
  const preview = overlay.querySelector<HTMLImageElement>("[data-lightbox-image]")!;
  const counter = overlay.querySelector<HTMLElement>("[data-lightbox-counter]")!;
  const closeButton = overlay.querySelector<HTMLButtonElement>("[data-lightbox-close]")!;
  const prevButton = overlay.querySelector<HTMLButtonElement>("[data-lightbox-prev]")!;
  const nextButton = overlay.querySelector<HTMLButtonElement>("[data-lightbox-next]")!;

  overlay.classList.toggle("is-single", images.length === 1);

  type Gesture = {
    id: number;
    start: Point;
    origin: Transform;
    axis: "none" | "pan" | "swipe" | "dismiss";
  };

  let index = 0;
  let fitted: Size = { width: 0, height: 0 };
  let maxScale = 1;
  let transform: Transform = { ...IDENTITY_TRANSFORM };
  let renderedSrc = "";
  let pendingFlip: HTMLImageElement | null = null;
  let lastFocused: HTMLElement | null = null;
  let closing = false;
  let closeTimer = 0;
  let suppressClick = false;

  const pointers = new Map<number, Point>();
  let gesture: Gesture | null = null;
  let pinch: { distance: number; origin: Transform; focal: Point } | null = null;

  const distanceBetween = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // 窄屏没有左右翻页按钮，边距也就不用给那么多
  const getMargin = (): Size =>
    window.innerWidth >= 768 ? { width: 128, height: 96 } : { width: 24, height: 84 };

  const stageSize = (): Size => ({ width: stage.clientWidth, height: stage.clientHeight });

  // 客户端坐标换算成相对舞台中心的偏移，和 transform 的平移量对齐
  const toFocal = (client: Point): Point => {
    const box = stage.getBoundingClientRect();
    return { x: client.x - (box.left + box.width / 2), y: client.y - (box.top + box.height / 2) };
  };

  const setDim = (value: number) => overlay.style.setProperty("--lightbox-dim", `${value}`);

  const applyTransform = (next: Transform, animate = false) => {
    transform = next;
    preview.style.transition = animate ? TRANSFORM_EASING : "none";
    preview.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    overlay.classList.toggle("is-zoomed", next.scale > 1.01);
  };

  const zoomTo = (scale: number, focal: Point, animate = false) => {
    const next = clamp(scale, 1, maxScale);
    // 缩回原尺寸时直接归位，免得反复缩放后图片停在偏心的位置
    const target = next <= 1.001 ? { ...IDENTITY_TRANSFORM } : zoomAt(transform, next, focal);
    applyTransform(clampTransform(target, fitted, stageSize()), animate);
  };

  const fitToStage = () => {
    const natural = { width: preview.naturalWidth, height: preview.naturalHeight };
    fitted = getFittedSize(natural, { width: window.innerWidth, height: window.innerHeight }, getMargin());

    if (fitted.width === 0) {
      return;
    }

    maxScale = getMaxScale(natural, fitted);
    preview.style.width = `${fitted.width}px`;
    preview.style.height = `${fitted.height}px`;
    overlay.classList.remove("is-loading");
    applyTransform({ ...IDENTITY_TRANSFORM });
  };

  // 从正文缩略图的位置放大过来，视觉上是同一张图被拎起来，而不是凭空盖一层
  const flipFrom = (source: HTMLImageElement) => {
    const rect = source.getBoundingClientRect();

    if (fitted.width === 0 || rect.width === 0) {
      return;
    }

    const box = stage.getBoundingClientRect();
    applyTransform({
      scale: rect.width / fitted.width,
      x: rect.left + rect.width / 2 - (box.left + box.width / 2),
      y: rect.top + rect.height / 2 - (box.top + box.height / 2)
    });

    void preview.offsetWidth; // 强制回流，让起始位置先落地再开始过渡
    applyTransform({ ...IDENTITY_TRANSFORM }, true);
  };

  const settle = () => {
    fitToStage();
    renderedSrc = preview.currentSrc || preview.src;

    if (pendingFlip) {
      flipFrom(pendingFlip);
      pendingFlip = null;
    } else {
      preview.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
    }
  };

  const render = (nextIndex: number, flipSource: HTMLImageElement | null = null) => {
    index = nextIndex;
    const source = images[index]!;

    counter.textContent = `${index + 1} / ${images.length}`;
    prevButton.disabled = index === 0;
    nextButton.disabled = index === images.length - 1;

    pendingFlip = flipSource;
    preview.alt = source.alt;
    overlay.classList.add("is-loading");
    preview.src = source.currentSrc || source.src;

    // 正文里多半已经加载过，能直接量尺寸就别等 load 事件空转一帧
    if (preview.complete && preview.naturalWidth > 0) {
      settle();
    }
  };

  const go = (delta: number) => {
    const next = getNextIndex(index, images.length, delta);

    if (next !== index) {
      render(next);
    }
  };

  const finishClose = () => {
    overlay.hidden = true;
    overlay.classList.remove("is-closing", "is-fading", "is-zoomed", "is-dragging");
    document.body.classList.remove("lightbox-open");
    preview.removeAttribute("src");
    renderedSrc = "";
    fitted = { width: 0, height: 0 };
    setDim(1);
    closing = false;
    lastFocused?.focus({ preventScroll: true });
    lastFocused = null;
  };

  const close = () => {
    if (overlay.hidden || closing) {
      return;
    }

    closing = true;
    const source = images[index];

    // 翻过页再关的话，正文要跟到对应的图，收起动画才有落点
    if (source) {
      const current = source.getBoundingClientRect();

      if (current.bottom < 0 || current.top > window.innerHeight) {
        source.scrollIntoView({ block: "center" });
      }
    }

    const rect = source?.getBoundingClientRect();
    const canFlip =
      !!rect && rect.width > 0 && fitted.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;

    overlay.classList.add("is-closing");
    overlay.classList.toggle("is-fading", !canFlip);
    setDim(0);

    if (canFlip) {
      const box = stage.getBoundingClientRect();
      applyTransform(
        {
          scale: rect!.width / fitted.width,
          x: rect!.left + rect!.width / 2 - (box.left + box.width / 2),
          y: rect!.top + rect!.height / 2 - (box.top + box.height / 2)
        },
        true
      );
    }

    closeTimer = window.setTimeout(finishClose, canFlip ? 240 : 180);
  };

  const open = (position: number) => {
    window.clearTimeout(closeTimer);
    closing = false;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    overlay.classList.remove("is-closing", "is-fading");
    overlay.hidden = false;
    setDim(1);
    document.body.classList.add("lightbox-open");

    render(position, images[position] ?? null);
    closeButton.focus({ preventScroll: true });
  };

  preview.addEventListener("load", () => {
    if (overlay.hidden || (preview.currentSrc || preview.src) === renderedSrc) {
      return;
    }

    settle();
  });

  preview.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    preview.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // 上一次手势如果被 pointercancel 打断，补的 click 不会来，这里清干净
    suppressClick = false;

    if (pointers.size === 2) {
      const [first, second] = [...pointers.values()] as [Point, Point];
      pinch = {
        distance: distanceBetween(first, second),
        origin: { ...transform },
        focal: toFocal(midpoint(first, second))
      };
      gesture = null;
      return;
    }

    gesture = {
      id: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: { ...transform },
      axis: "none"
    };
  });

  preview.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pinch && pointers.size >= 2) {
      const [first, second] = [...pointers.values()] as [Point, Point];
      const scale = clamp(pinch.origin.scale * (distanceBetween(first, second) / pinch.distance), 1, maxScale);
      applyTransform(clampTransform(zoomAt(pinch.origin, scale, pinch.focal), fitted, stageSize()));
      suppressClick = true;
      return;
    }

    if (!gesture || gesture.id !== event.pointerId) {
      return;
    }

    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;

    if (gesture.axis === "none") {
      if (Math.hypot(dx, dy) < AXIS_SLOP) {
        return;
      }

      // 放大状态下一律是平移；原尺寸时横向甩动翻页、纵向下拉关闭
      gesture.axis =
        gesture.origin.scale > 1.01
          ? "pan"
          : Math.abs(dx) > Math.abs(dy) && images.length > 1
            ? "swipe"
            : "dismiss";
      suppressClick = true;
      overlay.classList.add("is-dragging");
    }

    if (gesture.axis === "pan") {
      applyTransform(
        clampTransform(
          { scale: gesture.origin.scale, x: gesture.origin.x + dx, y: gesture.origin.y + dy },
          fitted,
          stageSize()
        )
      );
      return;
    }

    if (gesture.axis === "swipe") {
      // 到头了就加阻尼，手感上告诉用户没有下一张了
      const blocked = (dx > 0 && index === 0) || (dx < 0 && index === images.length - 1);
      applyTransform({ scale: 1, x: blocked ? dx * 0.25 : dx, y: 0 });
      return;
    }

    const progress = Math.min(1, Math.abs(dy) / 320);
    applyTransform({ scale: 1 - progress * 0.2, x: dx * 0.5, y: dy });
    setDim(1 - progress * 0.55);
  });

  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    overlay.classList.remove("is-dragging");

    if (preview.hasPointerCapture(event.pointerId)) {
      preview.releasePointerCapture(event.pointerId);
    }

    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        applyTransform(
          transform.scale <= 1.02
            ? { ...IDENTITY_TRANSFORM }
            : clampTransform(transform, fitted, stageSize()),
          true
        );
      }
      return;
    }

    if (!gesture || gesture.id !== event.pointerId) {
      return;
    }

    const finished = gesture;
    gesture = null;

    if (finished.axis === "none") {
      // 没挪动就是点了一下：在光标位置切换放大／还原
      zoomTo(transform.scale > 1.01 ? 1 : maxScale, toFocal({ x: event.clientX, y: event.clientY }), true);
      return;
    }

    // 平移在 move 里已经落位，松手保持现状，别把人拖过去的视野弹回来
    if (finished.axis === "pan") {
      return;
    }

    if (finished.axis === "swipe") {
      const dx = event.clientX - finished.start.x;

      if (Math.abs(dx) > SWIPE_DISTANCE) {
        go(dx < 0 ? 1 : -1);
        return;
      }
    }

    if (finished.axis === "dismiss" && Math.abs(event.clientY - finished.start.y) > DISMISS_DISTANCE) {
      close();
      return;
    }

    applyTransform({ ...IDENTITY_TRANSFORM }, true);
    setDim(1);
  };

  preview.addEventListener("pointerup", endPointer);
  preview.addEventListener("pointercancel", endPointer);
  preview.addEventListener("dragstart", (event) => event.preventDefault());

  stage.addEventListener(
    "wheel",
    (event) => {
      if (overlay.hidden) {
        return;
      }

      event.preventDefault();
      // 行模式的滚轮一格约等于 16px，换算后触控板和鼠标手感一致
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomTo(transform.scale * Math.exp(-delta * 0.0022), toFocal({ x: event.clientX, y: event.clientY }));
    },
    { passive: false }
  );

  closeButton.addEventListener("click", close);
  prevButton.addEventListener("click", () => go(-1));
  nextButton.addEventListener("click", () => go(1));

  // 点图片以外的地方一律关闭；拖动结束时浏览器补的那次 click 要跳过
  overlay.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }

    const target = event.target as HTMLElement;

    if (target !== preview && !target.closest("button")) {
      close();
    }
  });

  const trapFocus = (event: KeyboardEvent) => {
    const targets = [...overlay.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => !button.disabled
    );

    if (targets.length === 0) {
      return;
    }

    event.preventDefault();
    const current = targets.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.shiftKey ? -1 : 1;
    targets[(current + step + targets.length) % targets.length]!.focus();
  };

  document.addEventListener("keydown", (event) => {
    if (overlay.hidden) {
      return;
    }

    switch (event.key) {
      case "Escape":
        close();
        break;
      case "ArrowLeft":
        event.preventDefault();
        go(-1);
        break;
      case "ArrowRight":
        event.preventDefault();
        go(1);
        break;
      case "+":
      case "=":
        event.preventDefault();
        zoomTo(transform.scale * 1.6, { x: 0, y: 0 }, true);
        break;
      case "-":
      case "_":
        event.preventDefault();
        zoomTo(transform.scale / 1.6, { x: 0, y: 0 }, true);
        break;
      case "0":
        event.preventDefault();
        applyTransform({ ...IDENTITY_TRANSFORM }, true);
        break;
      // 预览层里只有这几个按钮可聚焦，把 Tab 焊在里面，避免焦点跑回被遮住的正文
      case "Tab":
        trapFocus(event);
        break;
    }
  });

  window.addEventListener("resize", () => {
    if (!overlay.hidden && !closing) {
      fitToStage();
    }
  });

  for (const [position, img] of images.entries()) {
    img.classList.add("is-zoomable");
    // 图片本身不可聚焦，补上按钮语义，键盘用户也能点开
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.addEventListener("click", () => open(position));
    img.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(position);
      }
    });
  }
}
