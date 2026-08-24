export const HEADER_CONDENSE_ENTER = 96;
export const HEADER_CONDENSE_EXIT = 48;

export function getHeaderCondensedState(scrollY: number, isCondensed: boolean): boolean {
  return isCondensed ? scrollY > HEADER_CONDENSE_EXIT : scrollY >= HEADER_CONDENSE_ENTER;
}

export function updateHeaderCondense() {
  const isCondensed = document.body.classList.contains("header-condensed");
  document.body.classList.toggle("header-condensed", getHeaderCondensedState(window.scrollY, isCondensed));
}

export function initHeaderCondense() {
  updateHeaderCondense();
  window.addEventListener("scroll", updateHeaderCondense, { passive: true });
}

if (typeof window !== "undefined") {
  initHeaderCondense();
  // ClientRouter SPA 导航不重跑本模块，导航后滚动位置可能被恢复，补一次状态刷新
  document.addEventListener("astro:page-load", updateHeaderCondense);
}
