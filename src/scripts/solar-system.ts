import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Layers,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Points,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { getSolarRenderSize, INITIAL_SOLAR_CAMERA_POSITION, SOLAR_CAMERA_FOV } from "../lib/solar-system";

const root = document.querySelector<HTMLElement>("[data-solar-system]");
const stage = document.querySelector<HTMLElement>("[data-solar-stage]");
const timeNode = document.querySelector<HTMLElement>("[data-solar-time]");

if (root && stage && timeNode) {
  const rootEl: HTMLElement = root;
  const stageEl: HTMLElement = stage;
  const timeEl: HTMLElement = timeNode;
  const j2000 = Date.UTC(2000, 0, 1, 12);

  // ---------- procedural texture helpers (fallback when CDN textures missing) ----------
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
  function makeProceduralPlanetTexture(key: string, width = 1024, height = 512) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(width, height);
    const data = image.data;
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
        { t: 0.5, color: [22, 110, 168] },
        { t: 0.55, color: [38, 110, 60] },
        { t: 0.92, color: [220, 210, 188] },
        { t: 1, color: [255, 252, 240] }
      ],
      mars: [
        { t: 0, color: [70, 24, 16] },
        { t: 0.5, color: [186, 92, 56] },
        { t: 1, color: [248, 230, 200] }
      ],
      jupiter: [
        { t: 0, color: [80, 50, 30] },
        { t: 0.55, color: [240, 210, 168] },
        { t: 1, color: [255, 240, 210] }
      ],
      saturn: [
        { t: 0, color: [120, 90, 50] },
        { t: 0.5, color: [222, 188, 132] },
        { t: 1, color: [255, 236, 192] }
      ],
      uranus: [
        { t: 0, color: [120, 200, 210] },
        { t: 1, color: [220, 248, 246] }
      ],
      neptune: [
        { t: 0, color: [16, 42, 110] },
        { t: 1, color: [150, 196, 246] }
      ]
    };
    const stops = palette[key] ?? palette.mercury;
    for (let y = 0; y < height; y += 1) {
      const v = y / height;
      const lat = (v - 0.5) * Math.PI;
      const latBand = Math.cos(lat);
      for (let x = 0; x < width; x += 1) {
        const u = x / width;
        const angle = u * Math.PI * 2;
        const nx = Math.cos(angle) * 2;
        const ny = Math.sin(angle) * 2;
        let value = 0.5;
        if (key === "earth") {
          const warpX = fbm(nx * 1.4 + 19, ny * 1.4 + 7, 4) * 1.6;
          const warpY = fbm(nx * 1.4 + 41, ny * 1.4 + 23, 4) * 1.6;
          const continents = fbm(nx * 2.1 + warpX, ny * 2.1 + warpY + lat * 0.4, 5, 2.1, 0.55);
          const polar = Math.pow(1 - latBand, 6);
          value = continents < 0.5 ? 0.4 + (continents / 0.5) * 0.1 : 0.55 + (continents - 0.5) * 0.9;
          value = Math.min(1, value + polar * 0.55);
        } else if (key === "jupiter" || key === "saturn") {
          const turbulence = fbm(nx * 3 + 2, ny * 0.6 + lat * 0.4, 5, 2.1, 0.55) - 0.5;
          const band = Math.sin(lat * (key === "jupiter" ? 8 : 10) + turbulence * 1.4) * 0.5 + 0.5;
          const swirl = fbm(nx * 6, ny * 6, 4);
          value = band * 0.78 + swirl * 0.22;
        } else {
          value = fbm(nx * 3 + 7, ny * 3 + lat, 5, 2.1, 0.55);
        }
        const col = sampleStops(stops, Math.max(0, Math.min(1, value)));
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
    texture.colorSpace = SRGBColorSpace;
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
  function makeProceduralRingTexture() {
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
      const inner = Math.max(0, t - 0.05);
      const cassini = 1 - Math.exp(-Math.pow((t - 0.62) / 0.025, 2));
      const noise = fbm(t * 20, 1.3, 4, 2.0, 0.5);
      let alpha = Math.max(0, Math.min(1, inner * 1.4)) * cassini * (0.7 + 0.3 * noise);
      alpha *= Math.max(0, 1 - Math.pow((t - 1) / 0.4, 2));
      const tint = lerpColor([196, 162, 110], [248, 232, 196], 0.4 + 0.5 * noise);
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
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // ---------- texture asset loader (graceful fallback if file missing) ----------
  const textureLoader = new TextureLoader();
  function tryLoadTexture(url: string): Promise<Texture | null> {
    return new Promise((resolve) => {
      textureLoader.load(
        url,
        (tex: Texture) => {
          tex.colorSpace = SRGBColorSpace;
          tex.anisotropy = 8;
          resolve(tex);
        },
        undefined,
        () => resolve(null)
      );
    });
  }
  const TEXTURE_BASE = "/textures/planets/";
  const textureAssets: Record<string, string> = {
    sun: `${TEXTURE_BASE}2k_sun.jpg`,
    mercury: `${TEXTURE_BASE}2k_mercury.jpg`,
    venus: `${TEXTURE_BASE}2k_venus_surface.jpg`,
    earth: `${TEXTURE_BASE}2k_earth_daymap.jpg`,
    earthClouds: `${TEXTURE_BASE}2k_earth_clouds.jpg`,
    mars: `${TEXTURE_BASE}2k_mars.jpg`,
    jupiter: `${TEXTURE_BASE}2k_jupiter.jpg`,
    saturn: `${TEXTURE_BASE}2k_saturn.jpg`,
    saturnRing: `${TEXTURE_BASE}2k_saturn_ring_alpha.png`,
    uranus: `${TEXTURE_BASE}2k_uranus.jpg`,
    neptune: `${TEXTURE_BASE}2k_neptune.jpg`,
    moon: `${TEXTURE_BASE}2k_moon.jpg`,
    milkyway: `${TEXTURE_BASE}2k_stars_milky_way.jpg`
  };
  const loaded: Record<string, Texture | null> = {};

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
    { key: "jupiter", name: "木星", radius: 12.4, size: 0.92, period: 4332.589, l0: 34.40438, color: 0xe5c39a, tilt: 0.05, spin: 0.022 },
    { key: "saturn", name: "土星", radius: 14.6, size: 0.78, period: 10759.22, l0: 49.94432, color: 0xead7a4, tilt: 0.47, spin: 0.02 },
    { key: "uranus", name: "天王星", radius: 16.5, size: 0.56, period: 30685.4, l0: 313.23218, color: 0xb6e4e0, tilt: 1.71, spin: 0.014, atmosphere: { color: 0x9be8e0, intensity: 0.45 } },
    { key: "neptune", name: "海王星", radius: 18.3, size: 0.56, period: 60189, l0: 304.88003, color: 0x4b7bd6, tilt: 0.49, spin: 0.014, atmosphere: { color: 0x7aa6ff, intensity: 0.55 } }
  ];

  // ---------- scene boilerplate ----------
  const BLOOM_LAYER = 1;
  const bloomLayer = new Layers();
  bloomLayer.set(BLOOM_LAYER);

  const scene = new Scene();
  const camera = new PerspectiveCamera(SOLAR_CAMERA_FOV, 1, 0.1, 400);
  camera.layers.enable(BLOOM_LAYER);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  stageEl.append(renderer.domElement);

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

  camera.position.set(INITIAL_SOLAR_CAMERA_POSITION.x, INITIAL_SOLAR_CAMERA_POSITION.y, INITIAL_SOLAR_CAMERA_POSITION.z);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 14;
  controls.maxDistance = 80;
  controls.target.set(0, 0, 0);

  scene.add(new AmbientLight(0x6f8cc8, 0.35));
  const sunLight = new PointLight(0xffe2a8, 1800, 120, 1.6);
  scene.add(sunLight, solarGroup);

  // ---------- sun ----------
  const sunMaterial = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: null as Texture | null } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main(){
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
      uniform sampler2D uMap;

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
        // animated plasma flow uv offset
        vec2 q = uv * 4.0;
        vec2 warp = vec2(fbm(q + uTime*0.07), fbm(q + 13.0 - uTime*0.05));
        float n = fbm(q + warp*1.6 + uTime*0.05);
        float granules = fbm(uv*36.0 + uTime*0.4);

        vec3 col;
        // sample real texture if provided
        vec3 texCol = texture2D(uMap, uv + warp*0.02).rgb;
        bool hasTex = max(max(texCol.r, texCol.g), texCol.b) > 0.001;

        if (hasTex) {
          col = texCol * (0.85 + 0.25 * granules);
          // boost saturation a little
          col = pow(col, vec3(0.92));
        } else {
          vec3 deep = vec3(0.55, 0.10, 0.02);
          vec3 mid  = vec3(1.00, 0.46, 0.06);
          vec3 hot  = vec3(1.00, 0.84, 0.30);
          vec3 white = vec3(1.00, 0.96, 0.78);
          col = mix(deep, mid, smoothstep(0.25, 0.55, n));
          col = mix(col, hot, smoothstep(0.55, 0.78, n));
          col = mix(col, white, smoothstep(0.78, 0.95, n));
          col *= 0.85 + 0.15 * granules;
          float spots = smoothstep(0.18, 0.0, fbm(uv*8.0 + 5.0));
          col *= 1.0 - spots*0.45;
        }

        float rim = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 1.5);
        col += vec3(1.0, 0.55, 0.2) * rim * 0.55;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
  const sun = new Mesh(new SphereGeometry(1.4, 96, 48), sunMaterial);
  sun.layers.enable(BLOOM_LAYER); // sun glows with bloom
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
  sunCorona.layers.enable(BLOOM_LAYER);
  sunHalo.layers.enable(BLOOM_LAYER);
  solarGroup.add(sunHalo, sunCorona, sun);

  // ---------- starfield: HDR equirectangular sphere (fallback to procedural points) ----------
  function buildProceduralStarPoints() {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const r = 80 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const warm = Math.random() > 0.85;
      const hue = warm ? new Color(1.0, 0.82, 0.6) : new Color(0.78, 0.86, 1.0);
      const brightness = 0.5 + Math.random() * 0.5;
      colors[i * 3] = hue.r * brightness;
      colors[i * 3 + 1] = hue.g * brightness;
      colors[i * 3 + 2] = hue.b * brightness;
      sizes[i] = Math.random() < 0.04 ? 1.6 : 0.4 + Math.random() * 0.7;
    }
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(positions, 3));
    geom.setAttribute("color", new BufferAttribute(colors, 3));
    geom.setAttribute("aSize", new BufferAttribute(sizes, 1));
    const mat = new ShaderMaterial({
      vertexShader: `
        attribute float aSize;
        varying vec3 vColor;
        void main(){
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(c));
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

  // ---------- atmosphere shader (Rayleigh-style fresnel) ----------
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
          // soft inner falloff so the limb isn't a hard line
          float bandShift = pow(1.0 - max(dot(vNormal, vView), 0.0), 4.0);
          gl_FragColor = vec4(uColor + bandShift * 0.25, rim * uIntensity);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      side: BackSide,
      depthWrite: false
    });
  }

  // ---------- planet builder ----------
  type Planet = PlanetSpec & {
    label: HTMLSpanElement;
    group: Group;
    mesh: Mesh;
    cloudMesh?: Mesh;
    moon?: Mesh;
    moonAngle?: number;
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
        map: makeProceduralPlanetTexture(spec.key), // replaced async later
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
      const ringGeom = new RingGeometry(spec.size * 1.45, spec.size * 2.6, 192, 4);
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
          map: makeProceduralRingTexture(),
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
      row: rootEl.querySelector<HTMLElement>(`[data-planet-row="${spec.key}"]`),
      baseSize: spec.size,
      baseOrbit: spec.radius,
      angle: 0
    };
  });

  // earth gets clouds + moon attached after async load
  const earth = planets.find((p) => p.key === "earth");

  // ---------- orbit lines ----------
  const orbitLines: LineLoop[] = planets.map((planet) => {
    const points: Vector3[] = [];
    for (let i = 0; i < 256; i += 1) {
      const angle = (i / 256) * Math.PI * 2;
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

  // ---------- asteroid belt between mars (9.1) and jupiter (12.4) ----------
  function buildAsteroidBelt() {
    const count = 2200;
    const inner = 9.9;
    const outer = 11.7;
    const geom = new SphereGeometry(0.05, 6, 4);
    const mat = new MeshStandardMaterial({ color: 0xa39684, roughness: 1, metalness: 0 });
    const mesh = new InstancedMesh(geom, mat, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const dummy = new Object3D();
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = inner + Math.random() * (outer - inner);
      const y = (Math.random() - 0.5) * 0.35;
      dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      const s = 0.4 + Math.random() * 1.4;
      dummy.scale.setScalar(s);
      dummy.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.userData.beltSpin = 0.0006;
    return mesh;
  }
  const asteroidBelt = buildAsteroidBelt();
  solarGroup.add(asteroidBelt);

  // ---------- focus state + UI ----------
  let focused: Planet | null = null;
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

  const credit = document.createElement("a");
  credit.className = "solar-credit";
  credit.href = "https://www.solarsystemscope.com/textures/";
  credit.target = "_blank";
  credit.rel = "noopener noreferrer";
  credit.textContent = "纹理 © Solar System Scope · CC-BY 4.0";
  stageEl.append(credit);

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

  // ---------- camera tween (cinematic cubic ease) ----------
  type Tween = {
    fromCam: Vector3;
    fromTarget: Vector3;
    start: number;
    duration: number;
    // when followPlanet is set, toCam/toTarget are recomputed each frame from
    // the planet's current world position so we never tween to a stale spot.
    followPlanet?: Planet;
    toCam?: Vector3;
    toTarget?: Vector3;
  };
  let activeTween: Tween | null = null;
  let followedPlanet: Planet | null = null;
  // last known planet world position; used to translate camera + target each
  // frame so the user can still orbit around the focused planet via OrbitControls.
  const lastFollowPos = new Vector3();
  function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  const tmpWorld = new Vector3();
  function computeFocusCamPos(planet: Planet, out: Vector3) {
    planet.group.getWorldPosition(out);
    const dir = out.clone().normalize();
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    const lateral = new Vector3(-dir.z, 0, dir.x).multiplyScalar(planet.baseSize * 4 + 0.6);
    const approach = out.clone().add(lateral).add(new Vector3(0, planet.baseSize * 4 + 0.8, 0));
    const camOffset = out.clone().sub(approach).normalize().multiplyScalar(-(planet.baseSize * 7 + 2.6));
    return out.clone().add(camOffset).add(new Vector3(0, planet.baseSize * 2.4, 0));
  }
  function startTweenToPlanet(planet: Planet, duration = 1100) {
    activeTween = {
      fromCam: camera.position.clone(),
      fromTarget: controls.target.clone(),
      start: performance.now(),
      duration,
      followPlanet: planet
    };
  }
  function startTweenToFixed(toCam: Vector3, toTarget: Vector3, duration = 1100) {
    activeTween = {
      fromCam: camera.position.clone(),
      fromTarget: controls.target.clone(),
      start: performance.now(),
      duration,
      toCam: toCam.clone(),
      toTarget: toTarget.clone()
    };
  }
  function tickTween(now: number) {
    if (activeTween) {
      const tw = activeTween;
      const t = Math.min(1, (now - tw.start) / tw.duration);
      const e = easeInOutCubic(t);
      let camDest: Vector3;
      let targetDest: Vector3;
      if (tw.followPlanet) {
        tw.followPlanet.group.getWorldPosition(tmpWorld);
        targetDest = tmpWorld.clone();
        camDest = computeFocusCamPos(tw.followPlanet, new Vector3());
      } else {
        camDest = tw.toCam!;
        targetDest = tw.toTarget!;
      }
      camera.position.lerpVectors(tw.fromCam, camDest, e);
      controls.target.lerpVectors(tw.fromTarget, targetDest, e);
      if (t >= 1) {
        activeTween = null;
        if (tw.followPlanet) {
          tw.followPlanet.group.getWorldPosition(lastFollowPos);
          controls.enabled = true;
        }
      }
      return;
    }
    // tween done — translate both camera and target by the planet's per-frame
    // delta. This keeps the planet centered while preserving any user-driven
    // rotation/zoom done via OrbitControls.
    if (followedPlanet) {
      followedPlanet.group.getWorldPosition(tmpWorld);
      const dx = tmpWorld.x - lastFollowPos.x;
      const dy = tmpWorld.y - lastFollowPos.y;
      const dz = tmpWorld.z - lastFollowPos.z;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        camera.position.x += dx;
        camera.position.y += dy;
        camera.position.z += dz;
        controls.target.x += dx;
        controls.target.y += dy;
        controls.target.z += dz;
        lastFollowPos.copy(tmpWorld);
      }
    }
  }

  function setFocus(planet: Planet | null) {
    focused = planet;
    followedPlanet = planet;
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
      startTweenToPlanet(planet, 1100);
    } else {
      controls.enabled = true;
      backButton.style.opacity = "0";
      backButton.style.pointerEvents = "none";
      focusCard.style.opacity = "0";
      for (const row of rootEl.querySelectorAll<HTMLElement>("[data-planet-row]")) {
        row.classList.remove("is-focused");
      }
      startTweenToFixed(
        new Vector3(
          INITIAL_SOLAR_CAMERA_POSITION.x,
          INITIAL_SOLAR_CAMERA_POSITION.y,
          INITIAL_SOLAR_CAMERA_POSITION.z
        ),
        new Vector3(0, 0, 0),
        1100
      );
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

  // ---------- selective bloom postprocessing ----------
  const composer = new EffectComposer(renderer);
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  const renderPass = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(new Vector2(1, 1), 1.1, 0.85, 0.0);
  // strength, radius, threshold — threshold=0 means keep everything in the bloom layer

  bloomComposer.addPass(renderPass);
  bloomComposer.addPass(bloomPass);

  const finalShader = {
    uniforms: {
      baseTexture: { value: null as Texture | null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture }
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main(){
        vec4 base = texture2D(baseTexture, vUv);
        vec4 bloom = texture2D(bloomTexture, vUv);
        gl_FragColor = base + bloom;
      }
    `
  };
  const finalPass = new ShaderPass(
    new ShaderMaterial({
      uniforms: finalShader.uniforms,
      vertexShader: finalShader.vertexShader,
      fragmentShader: finalShader.fragmentShader,
      defines: {}
    }),
    "baseTexture"
  );
  finalPass.needsSwap = true;
  composer.addPass(renderPass);
  composer.addPass(finalPass);

  // ---------- selective bloom: hide non-glowy via material swap ----------
  const darkMaterial = new MeshBasicMaterial({ color: 0x000000 });
  const materialMemory = new Map<string, MeshStandardMaterial | MeshBasicMaterial | ShaderMaterial>();
  function isInBloomLayer(obj: Object3D) {
    return obj.layers.test(bloomLayer);
  }
  function darkenForBloom(obj: Object3D) {
    type Drawable = Object3D & {
      isMesh?: boolean;
      isSprite?: boolean;
      isLine?: boolean;
      material?: MeshStandardMaterial | MeshBasicMaterial | ShaderMaterial | LineBasicMaterial | SpriteMaterial;
    };
    const m = obj as Drawable;
    if ((m.isMesh || m.isSprite || m.isLine) && m.material && !isInBloomLayer(obj)) {
      materialMemory.set(obj.uuid, m.material as MeshStandardMaterial);
      m.material = darkMaterial;
    }
  }
  function restoreFromBloom(obj: Object3D) {
    const stored = materialMemory.get(obj.uuid);
    if (stored) {
      (obj as Mesh).material = stored;
      materialMemory.delete(obj.uuid);
    }
  }

  // ---------- animation tick ----------
  function normalizeAngle(value: number) {
    return ((value % 360) + 360) % 360;
  }
  function placePlanets(now: number) {
    const days = (now - j2000) / 86400000;
    for (const planet of planets) {
      const angle = normalizeAngle(planet.l0 + (days / planet.period) * 360);
      planet.angle = angle;
      const radians = (angle * Math.PI) / 180;
      const radius = planet.baseOrbit;
      planet.group.position.set(Math.cos(radians) * radius, 0, Math.sin(radians) * radius);
      planet.mesh.rotation.y += planet.spin;
      if (planet.cloudMesh) planet.cloudMesh.rotation.y += planet.spin * 0.3;
      if (planet.moon) {
        planet.moonAngle = (planet.moonAngle ?? 0) + 0.012;
        const mr = planet.size * 2.4;
        planet.moon.position.set(Math.cos(planet.moonAngle) * mr, 0, Math.sin(planet.moonAngle) * mr);
        planet.moon.rotation.y += 0.004;
      }
      if (planet.row) {
        const valueNode = planet.row.querySelector("b");
        if (valueNode) valueNode.textContent = `${angle.toFixed(1)}°`;
      }
    }
    asteroidBelt.rotation.y += (asteroidBelt.userData.beltSpin as number) ?? 0;
    timeEl.textContent = timeFormatter.format(new Date(now));
  }
  function applyFocusTransitions() {
    focusBlend += (focusTarget - focusBlend) * 0.08;
    for (const planet of planets) {
      const isFocus = focused?.key === planet.key;
      const t = isFocus ? focusBlend : 0;
      const growth = 1 + t * (planet.baseSize < 0.45 ? 3.6 : 1.7);
      planet.group.scale.setScalar(growth);
      const others = focused && !isFocus ? focusBlend : 0;
      const material = planet.mesh.material as MeshStandardMaterial;
      material.transparent = others > 0.001;
      material.opacity = 1 - others * 0.78;
      if (planet.cloudMesh) {
        const cm = planet.cloudMesh.material as MeshStandardMaterial;
        cm.opacity = (1 - others * 0.78) * 0.65;
      }
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
    const beltMat = asteroidBelt.material as MeshStandardMaterial;
    const beltTarget = focused ? 0.25 : 1;
    beltMat.transparent = true;
    beltMat.opacity += (beltTarget - beltMat.opacity) * 0.08;

    const targetSun = focused ? 0.55 : 1;
    const coronaMat = sunCorona.material as SpriteMaterial;
    const haloMat = sunHalo.material as SpriteMaterial;
    coronaMat.opacity += (targetSun - coronaMat.opacity) * 0.1;
    haloMat.opacity += (targetSun - haloMat.opacity) * 0.1;
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
    composer.setSize(width, height);
    bloomComposer.setSize(width, height);
    bloomPass.setSize(width, height);
  }

  function render() {
    const now = Date.now();
    sunMaterial.uniforms.uTime.value = now * 0.001;
    sun.rotation.y += 0.0025;
    placePlanets(now);
    applyFocusTransitions();
    tickTween(now);
    controls.update();

    // pass 1: bloom-only render
    scene.traverse(darkenForBloom);
    bloomComposer.render();
    scene.traverse(restoreFromBloom);
    // pass 2: full render with bloom additive
    composer.render();

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

  // ---------- async asset loading: replace materials in place ----------
  (async () => {
    const keys = Object.keys(textureAssets);
    await Promise.all(
      keys.map(async (k) => {
        loaded[k] = await tryLoadTexture(textureAssets[k]);
      })
    );

    // sun
    if (loaded.sun) {
      sunMaterial.uniforms.uMap.value = loaded.sun;
      sunMaterial.needsUpdate = true;
    }

    // milky way background sphere
    if (loaded.milkyway) {
      const bgGeom = new SphereGeometry(180, 64, 32);
      const bgMat = new MeshBasicMaterial({
        map: loaded.milkyway,
        side: BackSide,
        depthWrite: false
      });
      // soften so the milky way doesn't overpower planets
      (bgMat as MeshBasicMaterial).color = new Color(0x4a5a78);
      const bg = new Mesh(bgGeom, bgMat);
      bg.rotation.y = Math.PI * 0.2;
      scene.add(bg);
    } else {
      scene.add(buildProceduralStarPoints());
    }

    // planets — apply textures where available
    for (const planet of planets) {
      const tex = loaded[planet.key];
      if (tex) {
        const mat = planet.mesh.material as MeshStandardMaterial;
        if (mat.map) mat.map.dispose?.();
        mat.map = tex;
        mat.color = new Color(0xffffff); // texture is the source of truth
        mat.emissive = new Color(0x000000);
        mat.emissiveIntensity = 0;
        mat.needsUpdate = true;
      }
    }

    // saturn ring real texture
    const saturn = planets.find((p) => p.key === "saturn");
    if (saturn?.ring && loaded.saturnRing) {
      const rm = saturn.ring.material as MeshBasicMaterial;
      if (rm.map) rm.map.dispose?.();
      rm.map = loaded.saturnRing;
      rm.needsUpdate = true;
    }

    // earth: clouds + moon
    if (earth && loaded.earthClouds) {
      const cloudMat = new MeshStandardMaterial({
        map: loaded.earthClouds,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
        alphaMap: loaded.earthClouds
      });
      const clouds = new Mesh(new SphereGeometry(earth.size * 1.015, 64, 32), cloudMat);
      // attach to same tilt group as the earth mesh
      (earth.mesh.parent as Group).add(clouds);
      earth.cloudMesh = clouds;
    }
    if (earth && loaded.moon) {
      const moonMat = new MeshStandardMaterial({ map: loaded.moon, roughness: 1 });
      const moon = new Mesh(new SphereGeometry(earth.size * 0.27, 32, 16), moonMat);
      moon.userData.planetKey = "moon";
      (earth.mesh.parent as Group).add(moon);
      earth.moon = moon;
      earth.moonAngle = 0;
    }
  })().catch(() => {
    /* silent: scene still renders with procedural assets */
  });

}
