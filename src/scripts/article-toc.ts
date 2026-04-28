import { getActiveHeadingId, getCenteredScrollTop } from "../lib/article-toc";

const tocRoot = document.querySelector<HTMLElement>("[data-article-toc]");
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-toc-link]")];

if (tocRoot && tocLinks.length > 0) {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const items = tocLinks
    .map((link) => {
      const id = decodeURIComponent(link.hash.slice(1));
      const heading = document.getElementById(id);

      if (!id || !heading) {
        return null;
      }

      return { id, link, heading };
    })
    .filter((item): item is { id: string; link: HTMLAnchorElement; heading: HTMLElement } => item !== null);

  let activeId = "";
  let frameId = 0;

  const setActiveLink = (nextId: string | null) => {
    if (!nextId || nextId === activeId) {
      return;
    }

    activeId = nextId;

    for (const item of items) {
      const isCurrent = item.id === nextId;
      item.link.classList.toggle("is-current", isCurrent);

      if (isCurrent) {
        item.link.setAttribute("aria-current", "location");
        tocRoot.scrollTo({
          top: getCenteredScrollTop(tocRoot.clientHeight, item.link.offsetTop, item.link.offsetHeight),
          behavior: prefersReducedMotion ? "auto" : "smooth"
        });
      } else {
        item.link.removeAttribute("aria-current");
      }
    }
  };

  const updateActiveLink = () => {
    const positions = items.map((item) => ({
      id: item.id,
      top: item.heading.getBoundingClientRect().top
    }));

    setActiveLink(getActiveHeadingId(positions, Math.max(120, window.innerHeight * 0.38)));
  };

  const requestUpdate = () => {
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(updateActiveLink);
  };

  updateActiveLink();
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  window.addEventListener("hashchange", requestUpdate);
}
