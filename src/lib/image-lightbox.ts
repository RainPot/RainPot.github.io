export type Size = {
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

// 预览层里图片的位置状态：先按 fitted 尺寸摆在舞台中心，再套这层 transform
export type Transform = {
  scale: number;
  x: number;
  y: number;
};

export const IDENTITY_TRANSFORM: Transform = { scale: 1, x: 0, y: 0 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// 预览层里的适配尺寸：等比缩进视口，且不把图片放大到超过原始像素
export function getFittedSize(natural: Size, viewport: Size, margin: Size = { width: 0, height: 0 }): Size {
  if (natural.width <= 0 || natural.height <= 0) {
    return { width: 0, height: 0 };
  }

  const availableWidth = Math.max(1, viewport.width - margin.width);
  const availableHeight = Math.max(1, viewport.height - margin.height);
  const ratio = Math.min(availableWidth / natural.width, availableHeight / natural.height, 1);

  return {
    width: Math.round(natural.width * ratio),
    height: Math.round(natural.height * ratio)
  };
}

// 放大上限：以看到 100% 原始像素为准，小图也保底给 2 倍，再往上只剩糊成一片的噪点
export function getMaxScale(natural: Size, fitted: Size, ceiling = 6): number {
  if (natural.width <= 0 || fitted.width <= 0) {
    return 1;
  }

  return clamp(natural.width / fitted.width, 2, ceiling);
}

// 放大后超出舞台的那部分，就是允许拖动的余量；图片没撑满舞台时不给拖
export function getPanBounds(fitted: Size, scale: number, stage: Size): Size {
  return {
    width: Math.max(0, (fitted.width * scale - stage.width) / 2),
    height: Math.max(0, (fitted.height * scale - stage.height) / 2)
  };
}

export function clampTransform(transform: Transform, fitted: Size, stage: Size): Transform {
  const bounds = getPanBounds(fitted, transform.scale, stage);

  return {
    scale: transform.scale,
    x: clamp(transform.x, -bounds.width, bounds.width),
    y: clamp(transform.y, -bounds.height, bounds.height)
  };
}

// 以锚点缩放：锚点下的那块像素在缩放前后停在原地，滚轮、双指、点击放大都用它
// 坐标系是「相对舞台中心的偏移」，和 transform 的平移量同一套
export function zoomAt(current: Transform, nextScale: number, focal: Point): Transform {
  const ratio = nextScale / current.scale;

  return {
    scale: nextScale,
    x: focal.x - (focal.x - current.x) * ratio,
    y: focal.y - (focal.y - current.y) * ratio
  };
}

// 翻页不循环：到头就停在两端，配合按钮的禁用态给出边界感
export function getNextIndex(current: number, total: number, delta: number): number {
  return clamp(current + delta, 0, Math.max(0, total - 1));
}
