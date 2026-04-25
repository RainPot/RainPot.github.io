import fs from "node:fs";
import path from "node:path";

const sourceDir = "/Users/zhangyu2333/Documents/project/RainPotBlog/content/blog";
const targetDir = "/Users/zhangyu2333/Documents/project/RainPot2026Blog/src/content/blog";

function quoteYaml(value) {
  return JSON.stringify(String(value ?? ""));
}

function slugifyFilename(filename) {
  return filename
    .replace(/\.md$/i, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[+]/g, "")
    .replace(/[()（）]/g, "")
    .replace(/[，,]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") + ".md";
}

function getString(frontmatter, key, fallback = "") {
  const match = frontmatter.match(new RegExp(`^${key}\\s*=\\s*"(.*?)"\\s*$`, "m"));
  return match?.[1] ?? fallback;
}

function getNumber(frontmatter, key, fallback = 6) {
  const match = frontmatter.match(new RegExp(`^${key}\\s*=\\s*(\\d+)\\s*$`, "m"));
  return match ? Number(match[1]) : fallback;
}

function getArray(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*$`, "m"));
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function normalizeBody(body) {
  return body
    .replaceAll("](/images/", "](../../images/")
    .replaceAll("src=\"/images/", "src=\"../../images/")
    .replaceAll("src='/images/", "src='../../images/");
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

for (const entry of fs.readdirSync(sourceDir).sort()) {
  if (!entry.endsWith(".md")) continue;
  const raw = fs.readFileSync(path.join(sourceDir, entry), "utf8");
  const match = raw.match(/^\+\+\+\n([\s\S]*?)\n\+\+\+\n?([\s\S]*)$/);
  const frontmatter = match?.[1] ?? "";
  const body = match?.[2] ?? raw;
  const title = getString(frontmatter, "title", entry.replace(/\.md$/i, ""));
  const description = getString(frontmatter, "description", title);
  const date = getString(frontmatter, "date", "2024-01-01");
  const tags = getArray(frontmatter, "tags");
  const readingTime = getNumber(frontmatter, "readingtime", 6);
  const yaml = [
    "---",
    `title: ${quoteYaml(title)}`,
    `description: ${quoteYaml(description || title)}`,
    `date: ${quoteYaml(date)}`,
    `tags: [${tags.map(quoteYaml).join(", ")}]`,
    "draft: false",
    "featured: false",
    `readingTime: ${readingTime}`,
    "---",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(targetDir, slugifyFilename(entry)), yaml + normalizeBody(body).trimStart(), "utf8");
}
