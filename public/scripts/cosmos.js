const canvas = document.querySelector("#cosmos");

if (canvas) {
  const ctx = canvas.getContext("2d");
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer = {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.45,
    tx: window.innerWidth * 0.5,
    ty: window.innerHeight * 0.45,
    active: false
  };

  let width = 0;
  let height = 0;
  let stars = [];
  let rafId = 0;

  function createStar() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      z: Math.random() * 0.7 + 0.3,
      r: Math.random() * 1.45 + 0.35,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      hue: Math.random() > 0.78 ? 315 : Math.random() > 0.48 ? 178 : 210
    };
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(220, Math.max(90, Math.floor((width * height) / 9500)));
    stars = Array.from({ length: count }, createStar);
  }

  function drawNebula() {
    const glow = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, Math.min(width, height) * 0.58);
    glow.addColorStop(0, "rgba(82, 229, 255, 0.18)");
    glow.addColorStop(0.34, "rgba(255, 107, 214, 0.08)");
    glow.addColorStop(1, "rgba(5, 8, 20, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  function drawConnections() {
    for (let i = 0; i < stars.length; i += 1) {
      const a = stars[i];
      const dxp = a.x - pointer.x;
      const dyp = a.y - pointer.y;
      const pointerDistance = Math.hypot(dxp, dyp);

      if (pointerDistance < 175) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(pointer.x, pointer.y);
        ctx.strokeStyle = `rgba(82, 229, 255, ${0.2 * (1 - pointerDistance / 175)})`;
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }
  }

  function render() {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(5, 8, 20, 0.36)";
    ctx.fillRect(0, 0, width, height);
    pointer.x += (pointer.tx - pointer.x) * 0.075;
    pointer.y += (pointer.ty - pointer.y) * 0.075;
    root.style.setProperty("--cursor-x", `${pointer.x}px`);
    root.style.setProperty("--cursor-y", `${pointer.y}px`);
    drawNebula();

    for (const star of stars) {
      const dx = pointer.x - star.x;
      const dy = pointer.y - star.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = pointer.active ? Math.min(1.8, 120 / distance) : Math.min(0.8, 44 / distance);

      if (!reduceMotion && distance < 260) {
        star.x -= (dx / distance) * force * star.z;
        star.y -= (dy / distance) * force * star.z;
      }

      star.x += star.vx * star.z;
      star.y += star.vy * star.z;

      if (star.x < -20) star.x = width + 20;
      if (star.x > width + 20) star.x = -20;
      if (star.y < -20) star.y = height + 20;
      if (star.y > height + 20) star.y = -20;

      const twinkle = 0.42 + Math.sin(performance.now() * 0.0014 + star.x) * 0.18;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * star.z, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${star.hue}, 95%, 72%, ${twinkle})`;
      ctx.fill();
    }

    drawConnections();
    rafId = requestAnimationFrame(render);
  }

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("pointermove", (event) => {
    pointer.tx = event.clientX;
    pointer.ty = event.clientY;
    pointer.active = true;
  }, { passive: true });
  window.addEventListener("pointerleave", () => {
    pointer.active = false;
  });
  window.addEventListener("blur", () => {
    pointer.active = false;
  });
  window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(rafId);
  });

  resizeCanvas();
  render();
}
