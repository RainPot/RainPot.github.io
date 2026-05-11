#!/usr/bin/env node
// Download solarsystemscope 2K textures into public/textures/planets/.
// CC-BY 4.0 — credit Solar System Scope (https://www.solarsystemscope.com/textures/) in your site.
// Usage: node scripts/fetch-solar-textures.mjs

import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "textures", "planets");

const files = [
  "2k_sun.jpg",
  "2k_mercury.jpg",
  "2k_venus_surface.jpg",
  "2k_earth_daymap.jpg",
  "2k_earth_clouds.jpg",
  "2k_mars.jpg",
  "2k_jupiter.jpg",
  "2k_saturn.jpg",
  "2k_saturn_ring_alpha.png",
  "2k_uranus.jpg",
  "2k_neptune.jpg",
  "2k_moon.jpg",
  "2k_stars_milky_way.jpg"
];

const base = "https://www.solarsystemscope.com/textures/download/";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchOne(name) {
  const dest = join(outDir, name);
  if (await exists(dest)) {
    console.log(`✓ ${name} (already downloaded)`);
    return;
  }
  process.stdout.write(`→ ${name} `);
  const res = await fetch(base + name, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; rainpot-blog-build)"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`(${(buf.length / 1024).toFixed(0)} KB)`);
}

await mkdir(outDir, { recursive: true });
for (const f of files) {
  try {
    await fetchOne(f);
  } catch (err) {
    console.error(`✗ ${f}: ${err.message}`);
  }
}
console.log(`\nDone. Files in ${outDir}`);
console.log(
  "Remember to credit Solar System Scope (CC-BY 4.0) — see https://www.solarsystemscope.com/textures/"
);
