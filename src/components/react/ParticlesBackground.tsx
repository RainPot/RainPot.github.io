import { useEffect, useRef, useState } from "react";
import { Camera, Geometry, Mesh, Program, Renderer } from "ogl";
import { getParticlesBackgroundConfig } from "../../lib/background";

const defaultColors = ["#ffffff", "#ffffff", "#ffffff"];

const vertexShader = /* glsl */ `
  attribute vec3 position;
  attribute vec4 random;
  attribute vec3 color;

  uniform mat4 modelMatrix;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uSpread;
  uniform float uBaseSize;
  uniform float uSizeRandomness;

  varying vec4 vRandom;
  varying vec3 vColor;

  void main() {
    vRandom = random;
    vColor = color;

    vec3 pos = position * uSpread;
    pos.z *= 10.0;

    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
    float t = uTime;
    modelPosition.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
    modelPosition.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
    modelPosition.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);

    vec4 modelViewPosition = viewMatrix * modelPosition;

    if (uSizeRandomness == 0.0) {
      gl_PointSize = uBaseSize;
    } else {
      gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(modelViewPosition.xyz);
    }

    gl_Position = projectionMatrix * modelViewPosition;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uAlphaParticles;
  varying vec4 vRandom;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord.xy;
    float distanceToCenter = length(uv - vec2(0.5));

    if (uAlphaParticles < 0.5) {
      if (distanceToCenter > 0.5) {
        discard;
      }
      gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), 1.0);
    } else {
      float circle = smoothstep(0.5, 0.4, distanceToCenter) * 0.8;
      gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), circle);
    }
  }
`;

function hexToRgb(hex: string): [number, number, number] {
  let normalized = hex.replace(/^#/, "");
  if (normalized.length === 3) {
    normalized = normalized
      .split("")
      .map((char) => char + char)
      .join("");
  }

  const int = Number.parseInt(normalized, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  return [r, g, b];
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

export default function ParticlesBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const config = getParticlesBackgroundConfig(prefersReducedMotion);
    const renderer = new Renderer({
      dpr: config.pixelRatio,
      depth: false,
      alpha: true
    });
    const gl = renderer.gl;

    gl.clearColor(0, 0, 0, 0);
    gl.canvas.className = "particles-background__canvas";
    container.appendChild(gl.canvas);

    const camera = new Camera(gl, { fov: 15 });
    camera.position.set(0, 0, config.cameraDistance);

    const mouse = { x: 0, y: 0 };

    const resize = () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      renderer.setSize(width, height);
      camera.perspective({ aspect: gl.canvas.width / Math.max(gl.canvas.height, 1) });
    };

    const handleMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      mouse.x = x;
      mouse.y = y;
    };

    const positions = new Float32Array(config.particleCount * 3);
    const randoms = new Float32Array(config.particleCount * 4);
    const colors = new Float32Array(config.particleCount * 3);
    const palette = config.particleColors.length > 0 ? config.particleColors : defaultColors;

    for (let index = 0; index < config.particleCount; index += 1) {
      let x = 0;
      let y = 0;
      let z = 0;
      let length = 0;

      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        length = x * x + y * y + z * z;
      } while (length > 1 || length === 0);

      const radius = Math.cbrt(Math.random());
      positions.set([x * radius, y * radius, z * radius], index * 3);
      randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], index * 4);
      colors.set(hexToRgb(palette[Math.floor(Math.random() * palette.length)]), index * 3);
    }

    const geometry = new Geometry(gl, {
      position: { size: 3, data: positions },
      random: { size: 4, data: randoms },
      color: { size: 3, data: colors }
    });

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uSpread: { value: config.particleSpread },
        uBaseSize: { value: config.particleBaseSize * config.pixelRatio },
        uSizeRandomness: { value: config.sizeRandomness },
        uAlphaParticles: { value: config.alphaParticles ? 1 : 0 }
      },
      transparent: true,
      depthTest: false
    });

    const particles = new Mesh(gl, { mode: gl.POINTS, geometry, program });

    let animationFrameId = 0;
    let lastTime = performance.now();
    let elapsed = 0;

    const render = (time: number) => {
      animationFrameId = window.requestAnimationFrame(render);
      const delta = time - lastTime;
      lastTime = time;
      elapsed += delta * config.speed;

      program.uniforms.uTime.value = elapsed * 0.001;

      if (config.moveParticlesOnHover) {
        particles.position.x = -mouse.x * config.particleHoverFactor;
        particles.position.y = -mouse.y * config.particleHoverFactor;
      } else {
        particles.position.x = 0;
        particles.position.y = 0;
      }

      if (!config.disableRotation) {
        particles.rotation.x = Math.sin(elapsed * 0.0002) * 0.1;
        particles.rotation.y = Math.cos(elapsed * 0.0005) * 0.15;
        particles.rotation.z += 0.01 * config.speed;
      }

      renderer.render({ scene: particles, camera });
    };

    resize();
    window.addEventListener("resize", resize);

    if (config.moveParticlesOnHover) {
      window.addEventListener("mousemove", handleMouseMove);
    }

    animationFrameId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      if (config.moveParticlesOnHover) {
        window.removeEventListener("mousemove", handleMouseMove);
      }
      if (container.contains(gl.canvas)) {
        container.removeChild(gl.canvas);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [prefersReducedMotion]);

  return <div ref={containerRef} className="particles-background" aria-hidden="true" />;
}
