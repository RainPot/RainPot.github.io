export type HeadingPosition = {
  id: string;
  top: number;
};

export function getActiveHeadingId(headings: readonly HeadingPosition[], threshold = 140): string | null {
  if (headings.length === 0) {
    return null;
  }

  let activeId = headings[0].id;

  for (const heading of headings) {
    if (heading.top <= threshold) {
      activeId = heading.id;
      continue;
    }

    break;
  }

  return activeId;
}

export function getCenteredScrollTop(containerHeight: number, itemTop: number, itemHeight: number): number {
  return Math.max(0, itemTop - (containerHeight / 2) + (itemHeight / 2));
}
