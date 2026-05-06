import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARTICLES_BACKGROUND,
  REDUCED_MOTION_PARTICLES_BACKGROUND,
  getParticlesBackgroundConfig
} from "../src/lib/background";

describe("particles background config", () => {
  it("matches the requested particles profile for the site background", () => {
    expect(DEFAULT_PARTICLES_BACKGROUND.particleColors).toEqual(["#ffffff"]);
    expect(DEFAULT_PARTICLES_BACKGROUND.particleCount).toBe(500);
    expect(DEFAULT_PARTICLES_BACKGROUND.particleSpread).toBe(10);
    expect(DEFAULT_PARTICLES_BACKGROUND.speed).toBe(0.1);
    expect(DEFAULT_PARTICLES_BACKGROUND.moveParticlesOnHover).toBe(true);
    expect(DEFAULT_PARTICLES_BACKGROUND.particleHoverFactor).toBe(1);
    expect(DEFAULT_PARTICLES_BACKGROUND.alphaParticles).toBe(false);
    expect(DEFAULT_PARTICLES_BACKGROUND.disableRotation).toBe(false);
    expect(DEFAULT_PARTICLES_BACKGROUND.particleBaseSize).toBe(100);
    expect(DEFAULT_PARTICLES_BACKGROUND.pixelRatio).toBe(1);
  });

  it("further lowers motion when reduced motion is requested", () => {
    expect(REDUCED_MOTION_PARTICLES_BACKGROUND.particleCount).toBeLessThan(DEFAULT_PARTICLES_BACKGROUND.particleCount);
    expect(REDUCED_MOTION_PARTICLES_BACKGROUND.speed).toBeLessThan(DEFAULT_PARTICLES_BACKGROUND.speed);
    expect(REDUCED_MOTION_PARTICLES_BACKGROUND.moveParticlesOnHover).toBe(false);
    expect(REDUCED_MOTION_PARTICLES_BACKGROUND.pixelRatio).toBeLessThanOrEqual(DEFAULT_PARTICLES_BACKGROUND.pixelRatio);
  });

  it("switches config based on reduced motion preference", () => {
    expect(getParticlesBackgroundConfig(false)).toBe(DEFAULT_PARTICLES_BACKGROUND);
    expect(getParticlesBackgroundConfig(true)).toBe(REDUCED_MOTION_PARTICLES_BACKGROUND);
  });

  it("tracks mouse movement from the window so the fixed background still reacts under pointer-transparent layers", () => {
    const source = readFileSync("src/components/react/ParticlesBackground.tsx", "utf8");

    expect(source).toContain('window.addEventListener("mousemove", handleMouseMove');
    expect(source).not.toContain('container.addEventListener("mousemove", handleMouseMove');
  });
});
