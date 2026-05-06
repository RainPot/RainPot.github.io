import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

  it("uses viewport-aware hero sizing and a blurred translucent stage shell on the home page", () => {
    const css = readFileSync("src/styles/global.css", "utf8");
    const mainRules = css.match(/\.home-main \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";
    const sectionRules = css.match(/\.solar-system-section \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";
    const layoutRules = css.match(/\.solar-system \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";
    const stageRules = css.match(/\.solar-stage \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";
    const panelRules = css.match(/\.solar-panel \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";
    const footerRules = css.match(/\.footer \{(?<rules>[^}]+)\}/)?.groups?.rules ?? "";

    expect(mainRules).toContain("min-height: 0");
    expect(mainRules).toContain("justify-content: space-between");
    expect(sectionRules).toContain("min-height: 0");
    expect(sectionRules).toContain("flex: 1");
    expect(layoutRules).toContain("gap: clamp(18px, 4vw, 56px)");
    expect(layoutRules).toContain("min-height: min(760px, calc(100svh - 132px))");
    expect(stageRules).toContain("width: min(100%, 64vw, 72svh, 760px)");
    expect(stageRules).toContain("backdrop-filter: blur(18px)");
    expect(stageRules).toContain("background: rgba(8, 10, 18, 0.42)");
    expect(panelRules).toContain("align-self: center");
    expect(panelRules).toContain("width: min(100%, 320px)");
    expect(footerRules).toContain("padding: 6px 0 12px");
  });
});
