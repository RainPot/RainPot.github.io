export const HEADER_CONDENSE_ENTER = 96;
export const HEADER_CONDENSE_EXIT = 48;

export function getHeaderCondensedState(scrollY: number, isCondensed: boolean): boolean {
  return isCondensed ? scrollY > HEADER_CONDENSE_EXIT : scrollY >= HEADER_CONDENSE_ENTER;
}

export function initHeaderCondense() {
  const updateHeaderState = () => {
    const isCondensed = document.body.classList.contains("header-condensed");
    document.body.classList.toggle("header-condensed", getHeaderCondensedState(window.scrollY, isCondensed));
  };

  updateHeaderState();
  window.addEventListener("scroll", updateHeaderState, { passive: true });
}

if (typeof window !== "undefined") {
  initHeaderCondense();
}
