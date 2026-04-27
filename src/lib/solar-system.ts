export const SOLAR_CAMERA_FOV = 46;
export const SOLAR_SYSTEM_VIEW_RADIUS = 19.5;
export const SOLAR_STAGE_FALLBACK_SIZE = 360;

export const INITIAL_SOLAR_CAMERA_POSITION = {
  x: 0,
  y: 28,
  z: 42
};

export function getPerspectiveHalfHeightAtTarget(cameraDistance: number, fovDegrees: number): number {
  return Math.tan((fovDegrees * Math.PI) / 360) * cameraDistance;
}

export function getSolarRenderSize(width: number, height: number, fallbackSize = SOLAR_STAGE_FALLBACK_SIZE) {
  if (width > 1 && height > 1) return { width, height };
  if (width > 1) return { width, height: width };
  if (height > 1) return { width: height, height };

  return { width: fallbackSize, height: fallbackSize };
}
