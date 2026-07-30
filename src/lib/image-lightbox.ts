export type Size = {
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

export type ScrollOffset = {
  left: number;
  top: number;
};

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

// 适配后还比原图小一截才值得给第二级缩放，否则点击只会原地闪一下
export function canZoomFurther(natural: Size, fitted: Size, threshold = 1.05): boolean {
  if (fitted.width <= 0) {
    return false;
  }

  return natural.width / fitted.width >= threshold;
}

// 放大到原始尺寸后，把点击处滚到视口中间，避免跳到图片左上角
export function getZoomScrollOffset(point: Point, ratio: number, stage: Size): ScrollOffset {
  return {
    left: Math.max(0, point.x * ratio - stage.width / 2),
    top: Math.max(0, point.y * ratio - stage.height / 2)
  };
}
