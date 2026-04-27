import { describe, expect, it } from "vitest";
import {
  INITIAL_SOLAR_CAMERA_POSITION,
  SOLAR_CAMERA_FOV,
  SOLAR_SYSTEM_VIEW_RADIUS,
  getPerspectiveHalfHeightAtTarget,
  getSolarRenderSize
} from "../src/lib/solar-system";

describe("solar system view", () => {
  it("starts far enough away to include the outer planet orbit", () => {
    const cameraDistance = Math.hypot(
      INITIAL_SOLAR_CAMERA_POSITION.x,
      INITIAL_SOLAR_CAMERA_POSITION.y,
      INITIAL_SOLAR_CAMERA_POSITION.z
    );

    expect(getPerspectiveHalfHeightAtTarget(cameraDistance, SOLAR_CAMERA_FOV)).toBeGreaterThanOrEqual(SOLAR_SYSTEM_VIEW_RADIUS);
  });

  it("falls back to a usable square render size while the stage layout is still settling", () => {
    expect(getSolarRenderSize(0, 0)).toEqual({ width: 360, height: 360 });
    expect(getSolarRenderSize(0, 360)).toEqual({ width: 360, height: 360 });
    expect(getSolarRenderSize(680, 0)).toEqual({ width: 680, height: 680 });
  });
});
