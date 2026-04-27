import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
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
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const root = document.querySelector<HTMLElement>("[data-solar-system]");
const stage = document.querySelector<HTMLElement>("[data-solar-stage]");
const timeNode = document.querySelector<HTMLElement>("[data-solar-time]");

if (root && stage && timeNode) {
  const j2000 = Date.UTC(2000, 0, 1, 12);

  function makeGlowTexture(inner: string, outer: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(0.28, inner);
    gradient.addColorStop(0.58, outer);
    gradient.addColorStop(1, "rgba(255, 120, 40, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function makeTexture(key: string, base: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(0.18, base);
    gradient.addColorStop(0.82, base);
    gradient.addColorStop(1, "#080b13");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const spot = (x: number, y: number, rx: number, ry: number, color: string, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    if (key === "mercury") {
      for (let i = 0; i < 42; i += 1) {
        const x = (i * 73) % 512;
        const y = 28 + ((i * 37) % 200);
        const r = 5 + (i % 9);
        spot(x, y, r, r * 0.72, i % 2 ? "#626a72" : "#d1d4d8", 0.42);
      }
    } else if (key === "venus") {
      ctx.strokeStyle = "rgba(255, 244, 180, 0.42)";
      ctx.lineWidth = 12;
      for (let y = 28; y < 250; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(120, y - 28, 250, y + 34, 512, y - 12);
        ctx.stroke();
      }
    } else if (key === "earth") {
      ctx.fillStyle = "#174c95";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 12; i += 1) {
        const x = (i * 89) % 512;
        const y = 44 + ((i * 31) % 150);
        spot(x, y, 46 + (i % 3) * 16, 18 + (i % 4) * 8, i % 2 ? "#2fbf71" : "#78c66d", 0.9);
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
      ctx.lineWidth = 5;
      for (let y = 36; y < 230; y += 54) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(150, y + 20, 260, y - 26, 512, y + 12);
        ctx.stroke();
      }
    } else if (key === "mars") {
      for (let i = 0; i < 16; i += 1) {
        spot((i * 97) % 512, 36 + ((i * 43) % 182), 24 + (i % 5) * 7, 10 + (i % 3) * 5, "#733827", 0.46);
      }
      spot(256, 20, 90, 16, "#ffd8bd", 0.74);
      spot(252, 235, 76, 14, "#ffe2c9", 0.62);
    } else if (key === "jupiter" || key === "saturn") {
      const bands = key === "jupiter"
        ? ["#d9b785", "#8d5b3e", "#f0d8a8", "#b36c45", "#fff1c9", "#7d5138"]
        : ["#e9d390", "#b99c62", "#fff0bd", "#c8ab6b", "#f6dd9d"];
      for (let y = 0; y < 256; y += 18) {
        ctx.fillStyle = bands[Math.floor(y / 18) % bands.length];
        ctx.fillRect(0, y, 512, 18);
      }
      if (key === "jupiter") spot(362, 146, 54, 24, "#c65b42", 0.86);
    } else if (key === "uranus") {
      ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
      for (let y = 40; y < 230; y += 34) ctx.fillRect(0, y, 512, 5);
    } else if (key === "neptune") {
      ctx.fillStyle = "rgba(65, 170, 255, 0.28)";
      for (let y = 34; y < 230; y += 36) ctx.fillRect(0, y, 512, 7);
      spot(340, 122, 54, 25, "#172e7a", 0.72);
      spot(168, 72, 34, 12, "#7fc8ff", 0.5);
    }

    for (let i = 0; i < 260; i += 1) {
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.045)";
      ctx.fillRect((i * 47) % 512, (i * 83) % 256, 1 + (i % 3), 1 + (i % 2));
    }

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  const planets = [
    { key: "mercury", name: "水星", radius: 4, size: 0.24, period: 87.969, l0: 252.25084, color: 0xaeb7c2, base: "#9fa8b2" },
    { key: "venus", name: "金星", radius: 5.7, size: 0.4, period: 224.701, l0: 181.97973, color: 0xffd08a, base: "#d99942" },
    { key: "earth", name: "地球", radius: 7.4, size: 0.43, period: 365.256, l0: 100.46435, color: 0x52e5ff, base: "#2878c8" },
    { key: "mars", name: "火星", radius: 9.1, size: 0.34, period: 686.98, l0: 355.45332, color: 0xff806b, base: "#c85835" },
    { key: "jupiter", name: "木星", radius: 11.4, size: 0.92, period: 4332.589, l0: 34.40438, color: 0xe5c39a, base: "#d5a56d" },
    { key: "saturn", name: "土星", radius: 13.6, size: 0.78, period: 10759.22, l0: 49.94432, color: 0xd9c27c, base: "#d3b875" },
    { key: "uranus", name: "天王星", radius: 15.5, size: 0.56, period: 30685.4, l0: 313.23218, color: 0x80fff0, base: "#5dd8d8" },
    { key: "neptune", name: "海王星", radius: 17.3, size: 0.56, period: 60189, l0: 304.88003, color: 0x7ca8ff, base: "#315bcb" }
  ].map((planet) => {
    const label = document.createElement("span");
    label.className = "planet-label";
    label.textContent = planet.name;
    stage.append(label);

    return {
      ...planet,
      label,
      mesh: new Mesh(
        new SphereGeometry(planet.size, 48, 24),
        new MeshStandardMaterial({
          color: planet.color,
          map: makeTexture(planet.key, planet.base),
          roughness: 0.48,
          metalness: 0.08,
          emissive: planet.color,
          emissiveIntensity: 0.08
        })
      ),
      row: root.querySelector<HTMLElement>(`[data-planet-row="${planet.key}"] b`)
    };
  });

  const scene = new Scene();
  const camera = new PerspectiveCamera(46, 1, 0.1, 120);
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
  stage.append(renderer.domElement);
  camera.position.set(0, 18, 26);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 16;
  controls.maxDistance = 42;

  scene.add(new AmbientLight(0x8fb4ff, 0.35));
  const sunLight = new PointLight(0xffd166, 860, 60, 1.4);
  scene.add(sunLight, solarGroup);

  const sunMaterial = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      uniform float uTime;

      float ring(vec2 uv, vec2 center, float radius, float width) {
        float distanceValue = distance(uv, center);
        return 1.0 - smoothstep(width, width + 0.018, abs(distanceValue - radius));
      }

      void main() {
        vec2 uv = vUv;
        float flowA = sin((uv.x * 34.0) + sin(uv.y * 18.0 + uTime * 0.8) * 4.0 + uTime * 0.9);
        float flowB = sin((uv.y * 42.0) + cos(uv.x * 16.0 - uTime * 0.7) * 3.2);
        float cells = sin((uv.x + uv.y) * 58.0 + uTime * 1.4) * sin((uv.x - uv.y) * 41.0 - uTime * 1.1);
        float heat = clamp(0.5 + flowA * 0.22 + flowB * 0.16 + cells * 0.18, 0.0, 1.0);

        vec3 deep = vec3(0.74, 0.13, 0.02);
        vec3 orange = vec3(1.0, 0.42, 0.04);
        vec3 gold = vec3(1.0, 0.82, 0.12);
        vec3 whiteHot = vec3(1.0, 0.96, 0.56);
        vec3 color = mix(deep, orange, heat);
        color = mix(color, gold, smoothstep(0.46, 0.82, heat));
        color = mix(color, whiteHot, smoothstep(0.78, 1.0, heat));

        float filament = ring(uv, vec2(0.33 + sin(uTime * 0.23) * 0.035, 0.44), 0.18, 0.012);
        filament += ring(uv, vec2(0.67 + cos(uTime * 0.19) * 0.04, 0.58), 0.14, 0.01);
        color += vec3(1.0, 0.62, 0.08) * filament * 0.42;

        float spotA = 1.0 - smoothstep(0.018, 0.062, distance(uv, vec2(0.42 + sin(uTime * 0.18) * 0.03, 0.52)));
        float spotB = 1.0 - smoothstep(0.012, 0.044, distance(uv, vec2(0.72 + cos(uTime * 0.13) * 0.025, 0.36)));
        color *= 1.0 - clamp(spotA * 0.58 + spotB * 0.44, 0.0, 0.72);

        float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0), 1.8);
        color += vec3(1.0, 0.38, 0.05) * rim * 0.7;
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
  const sun = new Mesh(new SphereGeometry(1.28, 96, 48), sunMaterial);
  const sunInnerGlow = new Sprite(
    new SpriteMaterial({
      map: makeGlowTexture("rgba(255, 247, 157, 0.92)", "rgba(255, 131, 43, 0.36)"),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  const sunOuterGlow = new Sprite(
    new SpriteMaterial({
      map: makeGlowTexture("rgba(255, 190, 58, 0.28)", "rgba(255, 77, 24, 0.16)"),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false
    })
  );
  sunInnerGlow.scale.set(4.4, 4.4, 1);
  sunOuterGlow.scale.set(7, 7, 1);
  solarGroup.add(sunOuterGlow, sunInnerGlow, sun);

  const starGeometry = new BufferGeometry();
  const starPositions = new Float32Array(540);
  for (let i = 0; i < starPositions.length; i += 3) {
    starPositions[i] = (Math.random() - 0.5) * 62;
    starPositions[i + 1] = (Math.random() - 0.5) * 30;
    starPositions[i + 2] = (Math.random() - 0.5) * 62;
  }
  starGeometry.setAttribute("position", new BufferAttribute(starPositions, 3));
  scene.add(new Points(starGeometry, new PointsMaterial({ color: 0xbfdcff, size: 0.045, transparent: true, opacity: 0.62 })));

  for (const planet of planets) {
    const orbitPoints = [];
    for (let i = 0; i < 160; i += 1) {
      const angle = (i / 160) * Math.PI * 2;
      orbitPoints.push(new Vector3(Math.cos(angle) * planet.radius, 0, Math.sin(angle) * planet.radius));
    }
    const orbit = new LineLoop(
      new BufferGeometry().setFromPoints(orbitPoints),
      new LineBasicMaterial({ color: 0x9dbeff, transparent: true, opacity: 0.2 })
    );
    solarGroup.add(orbit, planet.mesh);

    if (["venus", "earth", "uranus", "neptune"].includes(planet.key)) {
      const atmosphere = new Mesh(
        new SphereGeometry(planet.size * 1.08, 48, 24),
        new MeshBasicMaterial({
          color: planet.color,
          transparent: true,
          opacity: planet.key === "venus" ? 0.16 : 0.2,
          blending: AdditiveBlending,
          side: BackSide,
          depthWrite: false
        })
      );
      planet.mesh.add(atmosphere);
    }

    if (planet.key === "saturn") {
      const ring = new Mesh(
        new RingGeometry(planet.size * 1.42, planet.size * 2.65, 96),
        new MeshBasicMaterial({ color: 0xffe39a, side: DoubleSide, transparent: true, opacity: 0.72 })
      );
      ring.rotation.x = Math.PI * 0.42;
      planet.mesh.add(ring);
    }
  }

  function normalizeAngle(value: number) {
    return ((value % 360) + 360) % 360;
  }

  function placePlanets(now: number) {
    const days = (now - j2000) / 86400000;

    for (const planet of planets) {
      const angle = normalizeAngle(planet.l0 + (days / planet.period) * 360);
      const radians = (angle * Math.PI) / 180;

      planet.mesh.position.set(Math.cos(radians) * planet.radius, 0, Math.sin(radians) * planet.radius);
      planet.mesh.rotation.y += 0.01;
      if (planet.row) planet.row.textContent = `${angle.toFixed(1)}°`;
    }

    timeNode.textContent = timeFormatter.format(new Date(now));
  }

  const labelPosition = new Vector3();

  function placeLabels() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;

    for (const planet of planets) {
      planet.mesh.getWorldPosition(labelPosition);
      labelPosition.project(camera);
      const x = (labelPosition.x * 0.5 + 0.5) * width;
      const y = (-labelPosition.y * 0.5 + 0.5) * height;
      const visible = labelPosition.z > -1 && labelPosition.z < 1 && x > -40 && x < width + 40 && y > -40 && y < height + 40;

      planet.label.style.opacity = visible ? "1" : "0";
      planet.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -125%)`;
    }
  }

  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function render() {
    const now = Date.now();
    sunMaterial.uniforms.uTime.value = now * 0.001;
    sun.rotation.y += 0.004;
    placePlanets(now);
    controls.update();
    renderer.render(scene, camera);
    placeLabels();
    requestAnimationFrame(render);
  }

  new ResizeObserver(resize).observe(stage);
  resize();
  render();
}
