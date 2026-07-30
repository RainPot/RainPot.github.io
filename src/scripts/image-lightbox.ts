import { canZoomFurther, getFittedSize, getZoomScrollOffset, type Size } from "../lib/image-lightbox";

const article = document.querySelector<HTMLElement>(".markdown-content");
const images = article
  ? [...article.querySelectorAll<HTMLImageElement>("img")].filter((img) => !img.closest("a"))
  : [];

if (images.length > 0) {
  // 预览层四周要留出关闭按钮和图注的位置，适配尺寸按这个余量算
  const MARGIN: Size = { width: 72, height: 148 };

  const overlay = document.createElement("div");
  overlay.className = "image-lightbox";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "图片预览");
  overlay.innerHTML = `
    <button type="button" class="image-lightbox__close" data-lightbox-close aria-label="关闭图片预览">✕</button>
    <div class="image-lightbox__stage" data-lightbox-stage>
      <img class="image-lightbox__image" data-lightbox-image alt="" />
    </div>
    <p class="image-lightbox__caption" data-lightbox-caption></p>
  `;
  document.body.append(overlay);

  const stage = overlay.querySelector<HTMLElement>("[data-lightbox-stage]")!;
  const preview = overlay.querySelector<HTMLImageElement>("[data-lightbox-image]")!;
  const caption = overlay.querySelector<HTMLElement>("[data-lightbox-caption]")!;
  const closeButton = overlay.querySelector<HTMLButtonElement>("[data-lightbox-close]")!;

  let lastFocused: HTMLElement | null = null;
  let fitted: Size = { width: 0, height: 0 };
  let zoomable = false;
  let zoomed = false;

  const naturalSize = (): Size => ({ width: preview.naturalWidth, height: preview.naturalHeight });

  const applyFit = () => {
    const natural = naturalSize();
    fitted = getFittedSize(natural, { width: window.innerWidth, height: window.innerHeight }, MARGIN);
    if (fitted.width === 0) {
      return;
    }

    preview.style.width = `${fitted.width}px`;
    preview.style.height = `${fitted.height}px`;
    stage.scrollTo(0, 0);

    zoomed = false;
    zoomable = canZoomFurther(natural, fitted);
    overlay.classList.remove("is-loading", "is-zoomed");
    overlay.classList.toggle("is-zoomable", zoomable);
  };

  const zoomIn = (event: MouseEvent) => {
    const natural = naturalSize();
    const rect = preview.getBoundingClientRect();
    const ratio = natural.width / fitted.width;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    preview.style.width = `${natural.width}px`;
    preview.style.height = `${natural.height}px`;

    const offset = getZoomScrollOffset(point, ratio, { width: stage.clientWidth, height: stage.clientHeight });
    stage.scrollLeft = offset.left;
    stage.scrollTop = offset.top;

    zoomed = true;
    overlay.classList.add("is-zoomed");
  };

  const close = () => {
    if (overlay.hidden) {
      return;
    }

    overlay.hidden = true;
    document.body.classList.remove("lightbox-open");
    preview.removeAttribute("src");
    lastFocused?.focus();
    lastFocused = null;
  };

  const open = (source: HTMLImageElement) => {
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // 换图时先藏起来：新图的 load 回调算出适配尺寸之前，会短暂带着上一张的宽高
    overlay.classList.add("is-loading");
    preview.style.removeProperty("width");
    preview.style.removeProperty("height");

    preview.src = source.currentSrc || source.src;
    preview.alt = source.alt;
    caption.textContent = source.alt;
    caption.hidden = source.alt.trim() === "";

    overlay.hidden = false;
    document.body.classList.add("lightbox-open");

    // 原图多半已在正文里加载过，complete 时可以直接量尺寸，否则等 load
    if (preview.complete && preview.naturalWidth > 0) {
      applyFit();
    }

    closeButton.focus();
  };

  for (const img of images) {
    img.classList.add("is-zoomable");
    // 图片本身不可聚焦，补上按钮语义，键盘用户也能点开
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.addEventListener("click", () => open(img));
    img.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(img);
      }
    });
  }

  preview.addEventListener("load", applyFit);

  preview.addEventListener("click", (event) => {
    if (!zoomable) {
      close();
      return;
    }

    if (zoomed) {
      applyFit();
    } else {
      zoomIn(event);
    }
  });

  // 点图片以外的区域（背景、舞台留白、图注）一律关闭
  overlay.addEventListener("click", (event) => {
    if (event.target !== preview) {
      close();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (overlay.hidden) {
      return;
    }

    if (event.key === "Escape") {
      close();
      return;
    }

    // 预览层里只有关闭按钮可聚焦，把 Tab 焊在上面，避免焦点跑回被遮住的正文
    if (event.key === "Tab") {
      event.preventDefault();
      closeButton.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (!overlay.hidden) {
      applyFit();
    }
  });
}
