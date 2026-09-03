import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const REQUIRED_SLIDES_FILES = [
  ["skills", "slides", "SKILL.md"],
  ["skills", "slides", "agents", "openai.yaml"],
  ["skills", "slides", "references", "investment-banking-slides.md"],
  ["skills", "slides", "references", "morgan-stanley-ibd-template-notes.md"],
  ["skills", "slides", "assets", "slides", "base-deck.html"],
  ["skills", "slides", "assets", "slides", "ms-research.css"],
  ["skills", "slides", "assets", "slides", "page-templates.html"],
  ["skills", "slides", "assets", "slides", "style-packs", "morgan-stanley", "style-lock.yml"],
  ["skills", "slides", "assets", "slides", "style-packs", "morgan-stanley", "style.css"],
  ["skills", "slides", "assets", "slides", "style-packs", "morgan-stanley", "templates.html"],
  ["skills", "slides", "assets", "slides", "style-packs", "morgan-stanley", "layout-index.json"],
  ["skills", "slides", "assets", "slides", "style-packs", "morgan-stanley", "layout-recipes.md"],
  ["skills", "slides", "assets", "slides", "style-packs", "morgan-stanley", "chart-recipes.md"],
  ["skills", "slides", "scripts", "audit_research_deck.js"],
  ["skills", "slides", "scripts", "init_deck.js"],
  ["skills", "slides", "scripts", "qa_deck.js"],
  ["skills", "slides", "scripts", "export_pdf.js"],
];

function completeSlidesRoot(root) {
  return Boolean(root) && REQUIRED_SLIDES_FILES.every((segments) => (
    fs.existsSync(path.join(root, ...segments))
  ));
}

function managedDomiEnabled(homeDir) {
  const configPath = path.join(homeDir, ".codex", "config.toml");
  if (!fs.existsSync(configPath)) return false;
  const config = fs.readFileSync(configPath, "utf8");
  const section = config.match(/\[plugins\."domi@domi-managed"\]([\s\S]*?)(?=\n\[|$)/)?.[1] || "";
  return /^\s*enabled\s*=\s*true\s*$/m.test(section);
}

function cachedPluginRoots(homeDir) {
  const cacheRoot = path.join(homeDir, ".codex", "plugins", "cache", "domi-managed", "domi");
  if (!fs.existsSync(cacheRoot)) return [];
  return fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(cacheRoot, entry.name))
    .sort((left, right) => {
      const leftTime = fs.statSync(left).mtimeMs;
      const rightTime = fs.statSync(right).mtimeMs;
      return rightTime - leftTime;
    });
}

export function verifyDomiInvestmentSlidesContract({
  homeDir = os.homedir(),
  environment = process.env,
} = {}) {
  if (!managedDomiEnabled(homeDir)) {
    return {
      ok: false,
      root: "",
      error: "domi@domi-managed 插件未启用，请先在 domi 中完成插件安装或更新。",
    };
  }

  const explicitRoot = String(environment.DOMI_WECHAT_DOMI_PLUGIN_ROOT || "").trim();
  const candidates = [
    explicitRoot && path.resolve(explicitRoot),
    path.join(
      homeDir,
      "Library",
      "Application Support",
      "domi",
      "runtime",
      "domi-marketplace",
      "plugins",
      "domi",
    ),
    ...cachedPluginRoots(homeDir),
  ].filter(Boolean);
  const root = candidates.find(completeSlidesRoot) || "";
  if (!root) {
    return {
      ok: false,
      root: "",
      error: "当前 domi 插件缺少独立 slides Skill、Morgan Stanley 样式或严格 QA 脚本，请先更新插件。",
    };
  }

  const reference = fs.readFileSync(
    path.join(root, "skills", "slides", "references", "investment-banking-slides.md"),
    "utf8",
  );
  if (
    !/Morgan Stanley/i.test(reference)
    || !/HTML\s*\+\s*PDF/i.test(reference)
    || !/--strict/.test(reference)
  ) {
    return {
      ok: false,
      root: "",
      error: "当前 domi 插件的投研 Slides 契约不是受支持版本，请先更新插件。",
    };
  }
  return { ok: true, root, error: "" };
}

export { REQUIRED_SLIDES_FILES };
