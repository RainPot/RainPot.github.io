import fs from "node:fs";
import path from "node:path";

const source = "/Users/zhangyu2333/Documents/note/工作/基于 OpenClaw 项目的 AI Agent 技术分享.md";
const sourceImageDir = "/Users/zhangyu2333/Documents/note/Blog/images";
const target = "/Users/zhangyu2333/Documents/project/RainPot2026Blog/src/content/blog/openclaw-ai-agent.md";
const srcImageDir = "/Users/zhangyu2333/Documents/project/RainPot2026Blog/src/images/openclaw";
const publicImageDir = "/Users/zhangyu2333/Documents/project/RainPot2026Blog/public/images/openclaw";

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function normalizeObsidianLinks(markdown) {
  return markdown
    .replace(/!\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g, (_, filename) => {
      const clean = String(filename).trim();
      return `![${path.parse(clean).name}](../../images/openclaw/${encodeURI(clean)})`;
    })
    .replace(/\[\[#([^|\]]+)\|([^\]]+)\]\]/g, (_, _anchor, label) => label)
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_, _target, label) => label)
    .replace(/\[\[([^\]]+)\]\]/g, (_, label) => label);
}

function stripNoteHeader(markdown) {
  return markdown.trimStart()
    .replace(/^>\s*基于 OpenClaw 项目的 AI Agent 技术分享\s*\n>\s*\n>\s*日期：2026-02-26\s*\n\n---\n\n?/, "")
    .trimStart();
}

fs.mkdirSync(srcImageDir, { recursive: true });
fs.mkdirSync(publicImageDir, { recursive: true });

let body = fs.readFileSync(source, "utf8");
const imageNames = [...body.matchAll(/!\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g)].map((match) => match[1].trim());

for (const imageName of new Set(imageNames)) {
  const sourcePath = path.join(sourceImageDir, imageName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing image: ${sourcePath}`);
  }
  fs.copyFileSync(sourcePath, path.join(srcImageDir, imageName));
  fs.copyFileSync(sourcePath, path.join(publicImageDir, imageName));
}

body = normalizeObsidianLinks(stripNoteHeader(body));

const frontmatter = [
  "---",
  `title: ${quoteYaml("基于 OpenClaw 项目的 AI Agent 技术分享")}`,
  `description: ${quoteYaml("从 OpenClaw 的 Gateway、工具体系、Skills、MCP 与 Agent 执行流程，看个人 AI 助手系统的工程架构。")}`,
  `date: ${quoteYaml("2026-04-25")}`,
  `tags: [${["OpenClaw", "AI Agent", "Gateway", "Skills", "MCP"].map(quoteYaml).join(", ")}]`,
  "draft: false",
  "featured: true",
  "readingTime: 28",
  "---",
  ""
].join("\n");

fs.writeFileSync(target, `${frontmatter}${body}`, "utf8");
