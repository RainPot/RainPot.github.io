import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getSolarRenderSize, INITIAL_SOLAR_CAMERA_POSITION, SOLAR_CAMERA_FOV } from "../lib/solar-system";

const root = document.querySelector<HTMLElement>("[data-solar-system]");
const stage = document.querySelector<HTMLElement>("[data-solar-stage]");
const timeNode = document.querySelector<HTMLElement>("[data-solar-time]");

if (root && stage && timeNode) {
  const rootEl: HTMLElement = root;
  const stageEl: HTMLElement = stage;
  const timeEl: HTMLElement = timeNode;
  const j2000 = Date.UTC(2000, 0, 1, 12);

  // ---------- procedural texture helpers ----------
  function hash2(x: number, y: number) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }

  function smoothNoise(x: number, y: number) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5) {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < octaves; i += 1) {
      sum += smoothNoise(x * frequency, y * frequency) * amplitude;
      max += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / max;
  }

  function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function rgb([r, g, b]: [number, number, number], a = 1) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
  }

  type Stop = { t: number; color: [number, number, number] };

  function sampleStops(stops: Stop[], t: number): [number, number, number] {
    if (t <= stops[0].t) return stops[0].color;
    if (t >= stops[stops.length - 1].t) return stops[stops.length - 1].color;
    for (let i = 0; i < stops.length - 1; i += 1) {
      const a = stops[i];
      const b = stops[i + 1];
      if (t >= a.t && t <= b.t) {
        const local = (t - a.t) / (b.t - a.t);
        return lerpColor(a.color, b.color, local);
      }
    }
    return stops[stops.length - 1].color;
  }

  function makePlanetTexture(
    key: string,
    width = 1024,
    height = 512
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const image = ctx.createImageData(width, height);
    const data = image.data;

    // shared bands of color stops per planet
    const palette: Record<string, Stop[]> = {
      mercury: [
        { t: 0, color: [70, 64, 58] },
        { t: 0.5, color: [148, 138, 124] },
        { t: 1, color: [220, 210, 196] }
      ],
      venus: [
        { t: 0, color: [120, 80, 36] },
        { t: 0.5, color: [220, 168, 92] },
        { t: 1, color: [255, 232, 170] }
      ],
      earth: [
        { t: 0, color: [9, 30, 70] },
        { t: 0.46, color: [16, 76, 142] },
        { t: 0.5, color: [22, 110, 168] },
        { t: 0.55, color: [38, 110, 60] },
        { t: 0.72, color: [102, 154, 80] },
        { t: 0.92, color: [220, 210, 188] },
        { t: 1, color: [255, 252, 240] }
      ],
      mars: [
        { t: 0, color: [70, 24, 16] },
        { t: 0.5, color: [186, 92, 56] },
        { t: 0.85, color: [232, 156, 110] },
        { t: 1, color: [248, 230, 200] }
      ],
      jupiter: [
        { t: 0, color: [80, 50, 30] },
        { t: 0.35, color: [196, 138, 92] },
        { t: 0.55, color: [240, 210, 168] },
        { t: 0.8, color: [200, 138, 88] },
        { t: 1, color: [255, 240, 210] }
      ],
      saturn: [
        { t: 0, color: [120, 90, 50] },
        { t: 0.5, color: [222, 188, 132] },
        { t: 1, color: [255, 236, 192] }
      ],
      uranus: [
        { t: 0, color: [120, 200, 210] },
        { t: 0.6, color: [170, 232, 230] },
        { t: 1, color: [220, 248, 246] }
      ],
      neptune: [
        { t: 0, color: [16, 42, 110] },
        { t: 0.5, color: [38, 90, 196] },
        { t: 1, color: [150, 196, 246] }
      ]
    };

    const stops = palette[key] ?? palette.mercury;

    // sample noise shaped per-planet
    for (let y = 0; y < height; y += 1) {
      const v = y / height;
      // mercator-ish latitude bias, more contrast near poles
      const lat = (v - 0.5) * Math.PI;
      const latBand = Math.cos(lat);

      for (let x = 0; x < width; x += 1) {
        const u = x / width;

        // wrap-friendly noise coords
        const angle = u * Math.PI * 2;
        const nx = Math.cos(angle) * 2;
        const ny = Math.sin(angle) * 2;

        let value = 0.5;

        if (key === "mercury") {
          const base = fbm(nx * 3.2 + 7, ny * 3.2 + lat * 1.3, 5, 2.1, 0.55);
          const craters = fbm(nx * 14 + 3, ny * 14 + lat * 4, 4, 2.2, 0.45);
          value = base * 0.7 + craters * 0.3;
        } else if (key === "venus") {
          const sw1 = fbm(nx * 1.2 + lat * 0.3, ny * 1.2 + 11, 5, 2.1, 0.55);
          const sw2 = fbm(nx * 4 + sw1 * 2.4, ny * 4 + sw1 * 2.4 + lat * 0.6, 4, 2.0, 0.5);
          value = sw1 * 0.55 + sw2 * 0.45;
        } else if (key === "earth") {
          // continent mask via warped fbm; ocean below, land above
          const warpX = fbm(nx * 1.4 + 19, ny * 1.4 + 7, 4) * 1.6;
          const warpY = fbm(nx * 1.4 + 41, ny * 1.4 + 23, 4) * 1.6;
          const continents = fbm(nx * 2.1 + warpX, ny * 2.1 + warpY + lat * 0.4, 5, 2.1, 0.55);
          const detail = fbm(nx * 8 + 5, ny * 8 + lat, 4, 2.2, 0.5);
          // pole snow
          const polar = Math.pow(1 - latBand, 6);
          value = Math.min(1, Math.max(0, continents * 0.85 + detail * 0.15));
          // remap so 0..0.5 ocean, 0.5+ land
          if (value < 0.5) value = 0.4 + (value / 0.5) * 0.1; // ocean variance
          else value = 0.55 + (value - 0.5) * 0.9;
          value = Math.min(1, value + polar * 0.55);
        } else if (key === "mars") {
          const base = fbm(nx * 2.4 + 13, ny * 2.4 + lat * 0.6, 5, 2.1, 0.55);
          const dust = fbm(nx * 9 + 7, ny * 9, 4, 2.2, 0.5);
          const polar = Math.pow(1 - latBand, 8);
          value = Math.min(1, base * 0.78 + dust * 0.22 + polar * 0.6);
        } else if (key === "jupiter") {
          // banded with turbulence, GRS hint
          const turbulence = fbm(nx * 3 + 2, ny * 0.6 + lat * 0.4, 5, 2.1, 0.55) - 0.5;
          const band = Math.sin(lat * 8.0 + turbulence * 1.6) * 0.5 + 0.5;
          const swirl = fbm(nx * 6 + band * 2, ny * 6, 4, 2.0, 0.5);
          // great red spot center near (u=0.65, v=0.6)
          const grsDx = (u - 0.66) * 2.4;
          const grsDy = (v - 0.62) * 5.0;
          const grs = Math.exp(-(grsDx * grsDx + grsDy * grsDy) * 2.0);
          value = band * 0.78 + swirl * 0.22;
          value = Math.min(1, value + grs * 0.6);
        } else if (key === "saturn") {
          const turbulence = fbm(nx * 3 + 5, ny * 0.5 + lat * 0.3, 4, 2.1, 0.55) - 0.5;
          const band = Math.sin(lat * 10.0 + turbulence * 1.2) * 0.5 + 0.5;
          value = band * 0.85 + fbm(nx * 5, ny * 5, 3) * 0.15;
        } else if (key === "uranus") {
          const haze = fbm(nx * 1.4 + 3, ny * 1.4 + lat * 0.4, 4, 2.0, 0.55);
          const band = Math.sin(lat * 4.0) * 0.05 + 0.5;
          value = haze * 0.4 + band * 0.6;
        } else if (key === "neptune") {
          const swirl = fbm(nx * 2.0 + 2, ny * 2.0 + lat * 0.4, 5, 2.1, 0.55);
          const streak = fbm(nx * 6 + swirl * 2, ny * 1.6 + 9, 4, 2.0, 0.5);
          const spotDx = (u - 0.3) * 3;
          const spotDy = (v - 0.55) * 5;
          const spot = Math.exp(-(spotDx * spotDx + spotDy * spotDy) * 2);
          value = swirl * 0.7 + streak * 0.3;
          value = Math.min(1, value + spot * 0.32);
        }

        const col = sampleStops(stops, Math.max(0, Math.min(1, value)));

        // subtle limb darkening per pixel via latitude
        const shade = 0.78 + 0.22 * latBand;

        const idx = (y * width + x) * 4;
        data[idx] = col[0] * shade;
        data[idx + 1] = col[1] * shade;
        data[idx + 2] = col[2] * shade;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function makeRadialGlow(stops: Array<[number, string]>) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [t, color] of stops) gradient.addColorStop(t, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function makeRingTexture() {
    const w = 1024;
    const h = 64;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(w, h);
    const data = image.data;
    for (let x = 0; x < w; x += 1) {
      const t = x / w;
      // gap structure: 0..0.18 inner clear, dense bright bands, Cassini gap near 0.62
      const inner = Math.max(0, t - 0.05);
      const cassini = 1 - Math.exp(-Math.pow((t - 0.62) / 0.025, 2));
      const noise = fbm(t * 20, 1.3, 4, 2.0, 0.5);
      let alpha = Math.max(0, Math.min(1, inner * 1.4)) * cassini;
      alpha *= 0.7 + 0.3 * noise;
      // outer fade
      alpha *= Math.max(0, 1 - Math.pow((t - 1) / 0.4, 2));
      const tint: [number, number, number] = lerpColor(
        [196, 162, 110],
        [248, 232, 196],
        0.4 + 0.5 * noise
      );
      for (let y = 0; y < h; y += 1) {
        const idx = (y * w + x) * 4;
        data[idx] = tint[0];
        data[idx + 1] = tint[1];
        data[idx + 2] = tint[2];
        data[idx + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  // ---------- planet definitions ----------
  type PlanetSpec = {
    key: string;
    name: string;
    radius: number;
    size: number;
    period: number;
    l0: number;
    color: number;
    tilt: number;
    spin: number;
    atmosphere?: { color: number; intensity: number };
  };

  const planetSpecs: PlanetSpec[] = [
    { key: "mercury", name: "水星", radius: 4, size: 0.24, period: 87.969, l0: 252.25084, color: 0xb8b1a4, tilt: 0.03, spin: 0.004 },
    { key: "venus", name: "金星", radius: 5.7, size: 0.4, period: 224.701, l0: 181.97973, color: 0xf4c989, tilt: 0.04, spin: -0.002, atmosphere: { color: 0xffd9a0, intensity: 0.55 } },
    { key: "earth", name: "地球", radius: 7.4, size: 0.43, period: 365.256, l0: 100.46435, color: 0x4a8fd1, tilt: 0.41, spin: 0.012, atmosphere: { color: 0x6fb8ff, intensity: 0.8 } },
    { key: "mars", name: "火星", radius: 9.1, size: 0.34, period: 686.98, l0: 355.45332, color: 0xd97a55, tilt: 0.44, spin: 0.011 },
    { key: "jupiter", name: "木星", radius: 11.4, size: 0.92, period: 4332.589, l0: 34.40438, color: 0xe5c39a, tilt: 0.05, spin: 0.022 },
    { key: "saturn", name: "土星", radius: 13.6, size: 0.78, period: 10759.22, l0: 49.94432, color: 0xead7a4, tilt: 0.47, spin: 0.02 },
    { key: "uranus", name: "天王星", radius: 15.5, size: 0.56, period: 30685.4, l0: 313.23218, color: 0xb6e4e0, tilt: 1.71, spin: 0.014, atmosphere: { color: 0x9be8e0, intensity: 0.45 } },
    { key: "neptune", name: "海王星", radius: 17.3, size: 0.56, period: 60189, l0: 304.88003, color: 0x4b7bd6, tilt: 0.49, spin: 0.014, atmosphere: { color: 0x7aa6ff, intensity: 0.55 } }
  ];

  // ---------- scene setup ----------
  const scene = new Scene();
  const camera = new PerspectiveCamera(SOLAR_CAMERA_FOV, 1, 0.1, 200);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  const controls = new OrbitControls(camera, renderer.domElement);
  const solarGroup = new Group();
  const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  stageEl.append(renderer.domElement);
  camera.position.set(INITIAL_SOLAR_CAMERA_POSITION.x, INITIAL_SOLAR_CAMERA_POSITION.y, INITIAL_SOLAR_CAMERA_POSITION.z);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 14;
  controls.maxDistance = 70;
  controls.target.set(0, 0, 0);

  scene.add(new AmbientLight(0x6f8cc8, 0.45));
  const sunLight = new PointLight(0xffe2a8, 1400, 80, 1.6);
  scene.add(sunLight, solarGroup);

  // ---------- sun ----------
  const sunMaterial = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      uniform float uTime;

      // hashed value noise
      float hash(vec2 p){return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);}
      float noise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0; float a = 0.5;
        for(int i=0;i<5;i++){ v += a*noise(p); p*=2.05; a*=0.55; }
        return v;
      }

      void main(){
        vec2 uv = vUv;
        vec2 q = uv * 4.0;
        // domain warp for plasma
        vec2 warp = vec2(fbm(q + uTime*0.07), fbm(q + 13.0 - uTime*0.05));
        float n = fbm(q + warp*1.6 + uTime*0.05);
        float granules = fbm(uv*36.0 + uTime*0.4);

        vec3 deep   = vec3(0.55, 0.10, 0.02);
        vec3 mid    = vec3(1.00, 0.46, 0.06);
        vec3 hot    = vec3(1.00, 0.84, 0.30);
        vec3 white  = vec3(1.00, 0.96, 0.78);
        vec3 col = mix(deep, mid, smoothstep(0.25, 0.55, n));
        col = mix(col, hot, smoothstep(0.55, 0.78, n));
        col = mix(col, white, smoothstep(0.78, 0.95, n));
        col *= 0.85 + 0.15 * granules;

        // sunspots — subtractive
        float spots = smoothstep(0.18, 0.0, fbm(uv*8.0 + 5.0));
        col *= 1.0 - spots*0.45;

        // limb brighten (chromosphere edge)
        float rim = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 1.5);
        col += vec3(1.0, 0.55, 0.2) * rim * 0.55;

        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const sun = new Mesh(new SphereGeometry(1.4, 96, 48), sunMaterial);
  const sunCorona = new Sprite(
    new SpriteMaterial({
      map: makeRadialGlow([
        [0, "rgba(255, 245, 200, 0.95)"],
        [0.18, "rgba(255, 200, 100, 0.7)"],
        [0.45, "rgba(255, 130, 50, 0.25)"],
        [1, "rgba(255, 90, 30, 0)"]
      ]),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  const sunHalo = new Sprite(
    new SpriteMaterial({
      map: makeRadialGlow([
        [0, "rgba(255, 220, 160, 0.4)"],
        [0.4, "rgba(255, 140, 60, 0.12)"],
        [1, "rgba(255, 80, 30, 0)"]
      ]),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  sunCorona.scale.set(4.6, 4.6, 1);
  sunHalo.scale.set(9, 9, 1);
  solarGroup.add(sunHalo, sunCorona, sun);

  // ---------- starfield ----------
  function buildStarfield() {
    const count = 1200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      // distribute on a thick shell
      const r = 60 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = (Math.random() - 0.5) * 60; // flatten slightly
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // color tint — mostly white-blue, occasional warm
      const warm = Math.random() > 0.85;
      const hue = warm ? new Color(1.0, 0.82, 0.6) : new Color(0.78, 0.86, 1.0);
      const brightness = 0.5 + Math.random() * 0.5;
      colors[i * 3] = hue.r * brightness;
      colors[i * 3 + 1] = hue.g * brightness;
      colors[i * 3 + 2] = hue.b * brightness;

      sizes[i] = Math.random() < 0.04 ? 1.4 : 0.4 + Math.random() * 0.6;
    }
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(positions, 3));
    geom.setAttribute("color", new BufferAttribute(colors, 3));
    geom.setAttribute("aSize", new BufferAttribute(sizes, 1));

    const mat = new ShaderMaterial({
      uniforms: { uPixel: { value: 1 } },
      vertexShader: `
        attribute float aSize;
        varying vec3 vColor;
        uniform float uPixel;
        void main(){
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / -mv.z) * uPixel;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: AdditiveBlending
    });
    return new Points(geom, mat);
  }
  scene.add(buildStarfield());

  // ---------- atmosphere shader (fresnel) ----------
  function makeAtmosphereMaterial(hex: number, intensity: number) {
    return new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(hex) },
        uIntensity: { value: intensity }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        uniform vec3 uColor;
        uniform float uIntensity;
        void main(){
          float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.4);
          gl_FragColor = vec4(uColor, rim * uIntensity);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: BackSide,
      depthWrite: false
    });
  }

  // ---------- build planets ----------
  type Planet = PlanetSpec & {
    label: HTMLSpanElement;
    group: Group;
    mesh: Mesh;
    atmosphere?: Mesh;
    ring?: Mesh;
    row: HTMLElement | null;
    baseSize: number;
    baseOrbit: number;
    angle: number;
  };

  const planets: Planet[] = planetSpecs.map((spec) => {
    const label = document.createElement("span");
    label.className = "planet-label";
    label.textContent = spec.name;
    label.dataset.planet = spec.key;
    stageEl.append(label);

    const group = new Group();
    const tiltGroup = new Group();
    tiltGroup.rotation.z = spec.tilt;
    group.add(tiltGroup);
    const mesh = new Mesh(
      new SphereGeometry(spec.size, 64, 32),
      new MeshStandardMaterial({
        color: spec.color,
        map: makePlanetTexture(spec.key),
        roughness: 0.86,
        metalness: 0.03,
        emissive: new Color(spec.color).multiplyScalar(0.04),
        emissiveIntensity: 0.5
      })
    );
    mesh.userData.planetKey = spec.key;
    tiltGroup.add(mesh);

    let atmosphere: Mesh | undefined;
    if (spec.atmosphere) {
      atmosphere = new Mesh(
        new SphereGeometry(spec.size * 1.14, 48, 24),
        makeAtmosphereMaterial(spec.atmosphere.color, spec.atmosphere.intensity)
      );
      tiltGroup.add(atmosphere);
    }

    let ring: Mesh | undefined;
    if (spec.key === "saturn") {
      const ringGeom = new RingGeometry(spec.size * 1.45, spec.size * 2.6, 128, 4);
      // remap UV so x runs across radius
      const uv = ringGeom.attributes.uv;
      const pos = ringGeom.attributes.position;
      for (let i = 0; i < uv.count; i += 1) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const r = Math.sqrt(x * x + y * y);
        const t = (r - spec.size * 1.45) / (spec.size * 2.6 - spec.size * 1.45);
        uv.setXY(i, t, 0.5);
      }
      uv.needsUpdate = true;
      ring = new Mesh(
        ringGeom,
        new MeshBasicMaterial({
          map: makeRingTexture(),
          side: DoubleSide,
          transparent: true,
          depthWrite: false
        })
      );
      ring.rotation.x = Math.PI * 0.5;
      tiltGroup.add(ring);
    }

    solarGroup.add(group);

    return {
      ...spec,
      label,
      group,
      mesh,
      atmosphere,
      ring,
      row: root.querySelector<HTMLElement>(`[data-planet-row="${spec.key}"]`),
      baseSize: spec.size,
      baseOrbit: spec.radius,
      angle: 0
    };
  });

  // orbit lines (after planets so we can match colors / fade with focus)
  const orbitLines: LineLoop[] = planets.map((planet) => {
    const points: Vector3[] = [];
    for (let i = 0; i < 240; i += 1) {
      const angle = (i / 240) * Math.PI * 2;
      points.push(new Vector3(Math.cos(angle) * planet.baseOrbit, 0, Math.sin(angle) * planet.baseOrbit));
    }
    const orbit = new LineLoop(
      new BufferGeometry().setFromPoints(points),
      new LineBasicMaterial({ color: 0x9dbeff, transparent: true, opacity: 0.18 })
    );
    orbit.userData.planetKey = planet.key;
    solarGroup.add(orbit);
    return orbit;
  });

  // ---------- focus state ----------
  let focused: Planet | null = null;
  // 0 = idle, 1 = fully focused on a planet
  let focusBlend = 0;
  let focusTarget = 0;

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "solar-back";
  backButton.textContent = "← 返回全景";
  backButton.setAttribute("aria-label", "返回全景");
  backButton.style.opacity = "0";
  backButton.style.pointerEvents = "none";
  stageEl.append(backButton);

  const focusCard = document.createElement("div");
  focusCard.className = "solar-focus-card";
  focusCard.setAttribute("aria-live", "polite");
  focusCard.style.opacity = "0";
  focusCard.style.pointerEvents = "none";
  stageEl.append(focusCard);

  const planetFacts: Record<string, { tagline: string; rows: Array<[string, string]> }> = {
    mercury: { tagline: "最接近太阳的岩石世界", rows: [["半径", "2 440 km"], ["公转周期", "88 d"], ["距日", "0.39 AU"]] },
    venus: { tagline: "炙热的硫酸云之星", rows: [["半径", "6 052 km"], ["公转周期", "225 d"], ["表面", "464 °C"]] },
    earth: { tagline: "我们脚下的蓝色行星", rows: [["半径", "6 371 km"], ["公转周期", "365.25 d"], ["卫星", "1 颗"]] },
    mars: { tagline: "锈红色的沙漠世界", rows: [["半径", "3 389 km"], ["公转周期", "687 d"], ["卫星", "2 颗"]] },
    jupiter: { tagline: "气态巨行星之王", rows: [["半径", "69 911 km"], ["公转周期", "11.86 y"], ["卫星", "95+ 颗"]] },
    saturn: { tagline: "拥有最华丽光环", rows: [["半径", "58 232 km"], ["公转周期", "29.46 y"], ["卫星", "146+ 颗"]] },
    uranus: { tagline: "侧躺自转的冰巨星", rows: [["半径", "25 362 km"], ["公转周期", "84 y"], ["自转轴倾角", "98°"]] },
    neptune: { tagline: "深蓝色的风暴世界", rows: [["半径", "24 622 km"], ["公转周期", "164.8 y"], ["大黑斑", "时速 2 100 km"]] }
  };

  function setFocus(planet: Planet | null) {
    focused = planet;
    focusTarget = planet ? 1 : 0;
    if (planet) {
      controls.enabled = false;
      backButton.style.opacity = "1";
      backButton.style.pointerEvents = "auto";
      const fact = planetFacts[planet.key];
      focusCard.innerHTML = `
        <p class="solar-focus-name">${planet.name}</p>
        <p class="solar-focus-tagline">${fact?.tagline ?? ""}</p>
        <dl class="solar-focus-stats">
          ${(fact?.rows ?? []).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}
        </dl>
      `;
      focusCard.style.opacity = "1";
      for (const row of rootEl.querySelectorAll<HTMLElement>("[data-planet-row]")) {
        row.classList.toggle("is-focused", row.dataset.planetRow === planet.key);
      }
    } else {
      controls.enabled = true;
      backButton.style.opacity = "0";
      backButton.style.pointerEvents = "none";
      focusCard.style.opacity = "0";
      for (const row of rootEl.querySelectorAll<HTMLElement>("[data-planet-row]")) {
        row.classList.remove("is-focused");
      }
    }
  }

  backButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setFocus(null);
  });

  // ---------- pointer interaction ----------
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let pointerDown: { x: number; y: number } | null = null;

  function getPointerNDC(event: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickPlanet(): Planet | null {
    raycaster.setFromCamera(pointer, camera);
    const meshes = planets.map((p) => p.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const key = hits[0].object.userData.planetKey;
    return planets.find((p) => p.key === key) ?? null;
  }

  const canvasEl = renderer.domElement as HTMLCanvasElement;
  canvasEl.addEventListener("pointerdown", (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  });
  canvasEl.addEventListener("pointerup", (event: PointerEvent) => {
    if (!pointerDown) return;
    const dx = event.clientX - pointerDown.x;
    const dy = event.clientY - pointerDown.y;
    pointerDown = null;
    if (Math.hypot(dx, dy) > 6) return;
    getPointerNDC(event);
    const hit = pickPlanet();
    if (hit) setFocus(hit);
    else if (focused) setFocus(null);
  });
  canvasEl.addEventListener("pointermove", (event: PointerEvent) => {
    if (focused) {
      canvasEl.style.cursor = "default";
      return;
    }
    getPointerNDC(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(planets.map((p) => p.mesh), false)[0];
    canvasEl.style.cursor = hit ? "pointer" : "grab";
  });

  // ---------- main loop ----------
  function normalizeAngle(value: number) {
    return ((value % 360) + 360) % 360;
  }

  function placePlanets(now: number) {
    const days = (now - j2000) / 86400000;
    for (const planet of planets) {
      const angle = normalizeAngle(planet.l0 + (days / planet.period) * 360);
      planet.angle = angle;
      const radians = (angle * Math.PI) / 180;
      // when focused on this planet, ease its orbit radius to 0 (pull to center)
      const focusOnThis = focused?.key === planet.key ? focusBlend : 0;
      const radius = planet.baseOrbit * (1 - focusOnThis);
      planet.group.position.set(Math.cos(radians) * radius, 0, Math.sin(radians) * radius);
      planet.mesh.rotation.y += planet.spin;
      if (planet.row) {
        const valueNode = planet.row.querySelector("b");
        if (valueNode) valueNode.textContent = `${angle.toFixed(1)}°`;
      }
    }
    timeEl.textContent = timeFormatter.format(new Date(now));
  }

  function applyFocusTransitions() {
    // ease blend toward target
    focusBlend += (focusTarget - focusBlend) * 0.07;

    for (const planet of planets) {
      const isFocus = focused?.key === planet.key;
      const t = isFocus ? focusBlend : 0;
      // grow focused planet up to ~3x base size for outer/0.7x for inner mini ones
      const growth = 1 + t * (planet.baseSize < 0.45 ? 3.6 : 1.7);
      planet.group.scale.setScalar(growth);

      // dim non-focused planets when something is focused
      const others = focused && !isFocus ? focusBlend : 0;
      const material = planet.mesh.material as MeshStandardMaterial;
      material.transparent = others > 0.001;
      material.opacity = 1 - others * 0.78;
      if (planet.ring) {
        const rm = planet.ring.material as MeshBasicMaterial;
        rm.opacity = 1 - others * 0.85;
      }
    }

    for (const orbit of orbitLines) {
      const m = orbit.material as LineBasicMaterial;
      const isFocusedOrbit = focused?.key === orbit.userData.planetKey;
      const target = focused ? (isFocusedOrbit ? 0.35 : 0.04) : 0.18;
      m.opacity += (target - m.opacity) * 0.1;
    }

    const targetSun = focused ? 0.55 : 1;
    const coronaMat = sunCorona.material as SpriteMaterial;
    const haloMat = sunHalo.material as SpriteMaterial;
    coronaMat.opacity += (targetSun - coronaMat.opacity) * 0.1;
    haloMat.opacity += (targetSun - haloMat.opacity) * 0.1;
  }

  // smooth camera while focused
  const tmpFocusPos = new Vector3();
  const tmpCamPos = new Vector3();
  const baseCamPos = new Vector3(
    INITIAL_SOLAR_CAMERA_POSITION.x,
    INITIAL_SOLAR_CAMERA_POSITION.y,
    INITIAL_SOLAR_CAMERA_POSITION.z
  );
  const tmpDir = new Vector3();
  const originTarget = new Vector3(0, 0, 0);
  function updateCamera() {
    if (focused) {
      focused.group.getWorldPosition(tmpFocusPos);
      tmpDir.subVectors(camera.position, controls.target).normalize();
      const distance = focused.baseSize * 6 + 2.6;
      tmpCamPos.copy(tmpFocusPos).addScaledVector(tmpDir, distance);
      camera.position.lerp(tmpCamPos, 0.06);
      controls.target.lerp(tmpFocusPos, 0.08);
    } else if (focusBlend > 0.001) {
      camera.position.lerp(baseCamPos, 0.05);
      controls.target.lerp(originTarget, 0.06);
    }
  }

  const labelPosition = new Vector3();
  function placeLabels() {
    const width = stageEl.clientWidth;
    const height = stageEl.clientHeight;
    for (const planet of planets) {
      planet.group.getWorldPosition(labelPosition);
      labelPosition.project(camera);
      const x = (labelPosition.x * 0.5 + 0.5) * width;
      const y = (-labelPosition.y * 0.5 + 0.5) * height;
      const inFront = labelPosition.z > -1 && labelPosition.z < 1;
      const inBox = x > -40 && x < width + 40 && y > -40 && y < height + 40;
      const isFocus = focused?.key === planet.key;
      const visible = inFront && inBox && (!focused || isFocus);
      planet.label.style.opacity = visible ? (isFocus ? "1" : "0.85") : "0";
      planet.label.classList.toggle("is-focus", !!isFocus);
      planet.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -150%)`;
    }
  }

  function resize() {
    const { width, height } = getSolarRenderSize(stageEl.clientWidth, stageEl.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function render() {
    const now = Date.now();
    sunMaterial.uniforms.uTime.value = now * 0.001;
    sun.rotation.y += 0.0025;
    placePlanets(now);
    applyFocusTransitions();
    updateCamera();
    controls.update();
    renderer.render(scene, camera);
    placeLabels();
    requestAnimationFrame(render);
  }

  new ResizeObserver(resize).observe(stageEl);
  resize();
  requestAnimationFrame(resize);
  window.addEventListener("load", resize, { once: true });
  window.addEventListener("resize", resize, { passive: true });
  document.fonts?.ready.then(resize).catch(() => {});
  render();
}
