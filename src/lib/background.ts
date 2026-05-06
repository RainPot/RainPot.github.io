export type ParticlesBackgroundConfig = {
  particleCount: number;
  particleSpread: number;
  speed: number;
  particleColors: string[];
  moveParticlesOnHover: boolean;
  particleHoverFactor: number;
  alphaParticles: boolean;
  particleBaseSize: number;
  sizeRandomness: number;
  cameraDistance: number;
  disableRotation: boolean;
  pixelRatio: number;
};

const SHARED_PARTICLE_COLORS = ["#ffffff"];

export const DEFAULT_PARTICLES_BACKGROUND: ParticlesBackgroundConfig = {
  particleCount: 500,
  particleSpread: 10,
  speed: 0.1,
  particleColors: SHARED_PARTICLE_COLORS,
  moveParticlesOnHover: true,
  particleHoverFactor: 1,
  alphaParticles: false,
  particleBaseSize: 100,
  sizeRandomness: 1,
  cameraDistance: 20,
  disableRotation: false,
  pixelRatio: 1
};

export const REDUCED_MOTION_PARTICLES_BACKGROUND: ParticlesBackgroundConfig = {
  particleCount: 72,
  particleSpread: 10,
  speed: 0.08,
  particleColors: SHARED_PARTICLE_COLORS,
  moveParticlesOnHover: false,
  particleHoverFactor: 0,
  alphaParticles: true,
  particleBaseSize: 72,
  sizeRandomness: 0.45,
  cameraDistance: 20,
  disableRotation: true,
  pixelRatio: 1
};

export function getParticlesBackgroundConfig(prefersReducedMotion: boolean): ParticlesBackgroundConfig {
  return prefersReducedMotion ? REDUCED_MOTION_PARTICLES_BACKGROUND : DEFAULT_PARTICLES_BACKGROUND;
}
