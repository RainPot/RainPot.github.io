export function getPointerPercent(rect: DOMRect, clientX: number, clientY: number) {
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100
  };
}

export function initArticleCardSpotlight(root: ParentNode = document) {
  const cards = [...root.querySelectorAll<HTMLElement>("[data-spotlight-card]")];

  for (const card of cards) {
    card.addEventListener("pointermove", (event) => {
      const { x, y } = getPointerPercent(card.getBoundingClientRect(), event.clientX, event.clientY);
      card.style.setProperty("--spotlight-x", `${x}%`);
      card.style.setProperty("--spotlight-y", `${y}%`);
    });
  }
}

if (typeof document !== "undefined") {
  initArticleCardSpotlight();
}
