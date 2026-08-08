const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { lexer: markedLexer } = require("marked");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const SUPPORTED_XML_TAGS = new Set([
  "a", "b", "blockquote", "br", "checkbox", "code", "col", "colgroup", "del", "em",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9", "hr", "img",
  "li", "ol", "p", "pre", "span", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"
]);
const MARKER_PREFIX = "domi飞书图片";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isPathInside(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function extractFrontmatter(markdown) {
  const normalized = String(markdown || "").replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { body: normalized, frontmatter: "" };
  }
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match
    ? { body: normalized.slice(match[0].length), frontmatter: match[1] }
    : { body: normalized, frontmatter: "" };
}

function markdownFeatureCounts(markdown) {
  const source = String(markdown || "");
  const withoutStrongMarkdown = source.replace(/(?:\*\*|__)(?=\S)[\s\S]*?(?:\*\*|__)/g, "");
  const lines = source.split(/\r?\n/);
  const counts = {
    headings: 0,
    paragraphs: 0,
    bold: (source.match(/(?:\*\*|__)(?=\S)[\s\S]*?(?:\*\*|__)/g) || []).length
      + (source.match(/<b\b[^>]*>/gi) || []).length,
    italic: (withoutStrongMarkdown.match(/(?:^|[^*_])(?:\*|_)(?=\S)[^\n]*?(?:\*|_)(?![*_])/g) || []).length
      + (source.match(/<em\b[^>]*>/gi) || []).length,
    strikethrough: (source.match(/~~(?=\S)[\s\S]*?~~/g) || []).length
      + (source.match(/<del\b[^>]*>/gi) || []).length,
    unorderedLists: 0,
    orderedLists: 0,
    taskLists: 0,
    checkedTasks: (source.match(/^\s*[-+*]\s+\[[xX]\]\s+/gm) || []).length
      + (source.match(/^\s*[-+*]\s+☑\s+/gm) || []).length
      + (source.match(/<checkbox\b[^>]*\bdone="true"/gi) || []).length,
    uncheckedTasks: (source.match(/^\s*[-+*]\s+\[ \]\s+/gm) || []).length
      + (source.match(/^\s*[-+*]\s+☐\s+/gm) || []).length
      + (source.match(/<checkbox\b[^>]*\bdone="false"/gi) || []).length,
    quotes: 0,
    codeBlocks: 0,
    tables: 0,
    tableCells: (source.match(/<(?:td|th)\b[^>]*>/gi) || []).length,
    links: (source.match(/(?<!!)\[[^\]]+\]\([^)]+\)/g) || []).length
      + (source.match(/<a\b[^>]*\bhref=/gi) || []).length,
    horizontalRules: 0,
    images: (source.match(/!\[[^\]]*\](?:\([^)]+\)|\[[^\]]*\])/g) || []).length
      + (source.match(/<img\b[^>]*>/gi) || []).length
  };
  let inFence = false;
  let paragraphOpen = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) {
      if (!inFence) counts.codeBlocks += 1;
      inFence = !inFence;
      paragraphOpen = false;
      continue;
    }
    if (inFence) continue;
    if (/^\s{0,3}#{1,6}\s+/.test(line) || /^\s*<h[1-6]\b/i.test(line)) counts.headings += 1;
    if (/^\s*[-+*]\s+(?:\[[ xX]\]|[☑☐])\s+/.test(line) || /^\s*<checkbox\b/i.test(line)) counts.taskLists += 1;
    else if (/^\s*[-+*]\s+/.test(line) || /^\s*<ul\b/i.test(line)) counts.unorderedLists += 1;
    else if (/^\s*\d+[.)]\s+/.test(line) || /^\s*<ol\b/i.test(line)) counts.orderedLists += 1;
    if (/^\s*>\s?/.test(line) || /^\s*<blockquote\b/i.test(line)) counts.quotes += 1;
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) || /^\s*<hr\s*\/?\s*>/i.test(line)) {
      counts.horizontalRules += 1;
    }
    if (
      /^\s*<table\b/i.test(line)
      || (
        /^\s*\|.*\|\s*$/.test(line)
        && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[index + 1] || "")
      )
    ) counts.tables += 1;
    if (
      /^\s*\|.*\|\s*$/.test(line)
      && !/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line)
    ) {
      counts.tableCells += line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length;
    }
    const isBlock = !line.trim()
      || /^\s*(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+|>|```|~~~|<\/?(?:table|blockquote|pre|checkbox|hr)\b)/i.test(line)
      || /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    if (!isBlock && !paragraphOpen) {
      counts.paragraphs += 1;
      paragraphOpen = true;
    } else if (isBlock) {
      paragraphOpen = false;
    }
  }
  return counts;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdownToXml(value) {
  const placeholders = [];
  const placeholder = (content) => {
    const token = `DOMIINLINE${placeholders.length}TOKEN`;
    placeholders.push(content);
    return token;
  };
  let output = String(value || "");
  output = output.replace(/`([^`\n]+)`/g, (_match, code) => placeholder(`<code>${escapeXml(code)}</code>`));
  output = escapeXml(output);
  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (_match, label, href) =>
    `<a href="${escapeXml(href)}">${label}</a>`
  );
  output = output
    .replace(/(?:\*\*|__)(?=\S)(.+?)(?:\*\*|__)/g, "<b>$1</b>")
    .replace(/~~(?=\S)(.+?)~~/g, "<del>$1</del>")
    .replace(/\*(?=\S)(.+?)\*/g, "<em>$1</em>")
    .replace(/_(?=\S)(.+?)_/g, "<em>$1</em>");
  placeholders.forEach((content, index) => {
    output = output.replace(`DOMIINLINE${index}TOKEN`, content);
  });
  return output;
}

function transformTaskLists(markdown, degradations) {
  const lines = String(markdown || "").split("\n");
  let inFence = false;
  let nestedCount = 0;
  const transformed = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const match = line.match(/^(\s*)[-+*]\s+\[([ xX])\]\s+(.*)$/);
    if (!match) return line;
    if (match[1].length) {
      nestedCount += 1;
      const status = match[2].toLowerCase() === "x" ? "☑" : "☐";
      return `${match[1]}- ${status} ${match[3]}`;
    }
    return `<checkbox done="${match[2].toLowerCase() === "x" ? "true" : "false"}">${inlineMarkdownToXml(match[3])}</checkbox>`;
  }).join("\n");
  if (nestedCount) {
    degradations.push({
      code: "nested-task-list-visual-fallback",
      severity: "error",
      count: nestedCount,
      message: `${nestedCount} 个嵌套任务项无法在飞书中同时保持层级和可交互勾选状态。`,
      strategy: "阻止远端写入；请把嵌套任务拆成顶层任务，或改成普通嵌套列表后重试。"
    });
  }
  return transformed;
}

function preserveUnsupportedHtml(markdown, degradations) {
  const lines = String(markdown || "").split("\n");
  let inFence = false;
  let count = 0;
  const transformed = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(/<\/?([A-Za-z][\w:-]*)(?:\s[^>]*)?>/g, (tag, name) => {
      if (SUPPORTED_XML_TAGS.has(String(name).toLowerCase())) return tag;
      count += 1;
      return `\\${tag}`;
    });
  }).join("\n");
  if (count) {
    degradations.push({
      code: "unsupported-html-visible-text",
      severity: "error",
      count,
      message: `${count} 个飞书不支持的 HTML 标签无法证明可无损导入。`,
      strategy: "阻止远端写入；请改成 CommonMark/GFM 结构后重试。"
    });
  }
  return transformed;
}

function resolveMarkdownAsset(sourcePath, rawTarget, libraryRoot) {
  const target = String(rawTarget || "").trim().replace(/^<|>$/g, "");
  if (!target || /^(?:https?:|data:|mailto:|#)/i.test(target)) return null;
  let decoded = target;
  try {
    decoded = /^file:\/\//i.test(target)
      ? fileURLToPath(target)
      : decodeURIComponent(target);
  } catch {
    // Keep malformed but otherwise usable local paths as literal paths.
  }
  const withoutAnchor = decoded.split("#")[0].split("?")[0];
  let realRoot;
  let realSource;
  try {
    realRoot = fs.realpathSync.native(path.resolve(libraryRoot));
    realSource = fs.realpathSync.native(path.resolve(sourcePath));
  } catch {
    return { missing: true, path: "", reason: "资料库或源文档路径无法解析" };
  }
  const absolutePath = path.resolve(path.dirname(realSource), withoutAnchor);
  if (!isPathInside(realRoot, absolutePath)) {
    return { missing: true, path: absolutePath, reason: "图片位于资料库之外" };
  }
  const relativeParts = path.relative(realRoot, absolutePath).split(path.sep).filter(Boolean);
  let currentPath = realRoot;
  for (const part of relativeParts) {
    currentPath = path.join(currentPath, part);
    try {
      if (fs.lstatSync(currentPath).isSymbolicLink()) {
        return { missing: true, path: absolutePath, reason: "图片路径包含符号链接" };
      }
    } catch {
      return { missing: true, path: absolutePath, reason: "图片文件不存在" };
    }
  }
  try {
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { missing: true, path: absolutePath, reason: "图片不是普通文件" };
    }
  } catch {
    return { missing: true, path: absolutePath, reason: "图片文件不存在" };
  }
  let realAsset;
  try {
    realAsset = fs.realpathSync.native(absolutePath);
  } catch {
    return { missing: true, path: absolutePath, reason: "图片文件无法解析" };
  }
  if (!isPathInside(realRoot, realAsset)) {
    return { missing: true, path: absolutePath, reason: "图片真实路径位于资料库之外" };
  }
  return { missing: false, path: realAsset };
}

function localImageExtension(target) {
  return path.extname(String(target || "").replace(/^<|>$/g, "").split(/[?#]/)[0]).toLowerCase();
}

function stripFencedCodeBlocks(markdown) {
  const output = [];
  let fence = "";
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fence && match) {
      fence = match[1][0];
      continue;
    }
    if (fence && new RegExp(`^\\s*${fence === "`" ? "`{3,}" : "~{3,}"}\\s*$`).test(line)) {
      fence = "";
      continue;
    }
    if (!fence) output.push(line);
  }
  return output.join("\n");
}

function prepareMarkdownForFeishu({ markdown, sourcePath, libraryRoot, title = "文档" }) {
  const original = String(markdown || "").replace(/\r\n?/g, "\n");
  const extracted = extractFrontmatter(original);
  const degradations = [];
  const assets = [];
  let assetIndex = 0;
  if (extracted.frontmatter) {
    degradations.push({
      code: "frontmatter-not-rendered",
      severity: "info",
      count: 1,
      message: "本地 YAML frontmatter 属于 domi 内部元数据，不写入飞书正文。",
      strategy: "元数据仍保留在本地 Markdown；飞书副本只呈现正文。"
    });
  }
  if (extracted.body.includes(MARKER_PREFIX)) {
    degradations.push({
      code: "reserved-image-marker-collision",
      severity: "error",
      count: 1,
      message: `正文包含 domi 内部保留标记“${MARKER_PREFIX}”，无法区分用户文字与图片占位符。`,
      strategy: "阻止远端写入；请改写这段保留标记文字后重试。"
    });
  }
  try {
    const sourceEntities = collectOrderedEntities(strictMarkdownSignature(extracted.body));
    const titledImages = sourceEntities.images.filter((image) => image.caption);
    const htmlImageTitles = [...extracted.body.matchAll(/<img\b[^>]*\btitle=(['"])(.*?)\1[^>]*>/gi)];
    if (titledImages.length || htmlImageTitles.length) {
      degradations.push({
        code: "image-title-not-verifiable",
        severity: "error",
        count: titledImages.length + htmlImageTitles.length,
        message: "图片同时包含 alt 与 title/caption；当前飞书图片接口无法证明两者都能原样回读。",
        strategy: "阻止远端写入；请把要显示的说明统一放进图片 alt，或移到图片下方的普通段落。"
      });
    }
  } catch (error) {
    degradations.push({
      code: "markdown-structure-not-parseable",
      severity: "error",
      count: 1,
      message: `Markdown 结构无法建立严格校验签名：${error instanceof Error ? error.message : String(error)}`,
      strategy: "阻止远端写入；请先修复 Markdown 语法。"
    });
  }
  const references = new Map();
  for (const match of extracted.body.matchAll(/^\s*\[([^\]]+)\]:\s*(<[^>]+>|\S+)(?:\s+["'(][^\n]*["')])?\s*$/gm)) {
    references.set(match[1].trim().toLocaleLowerCase("zh-CN"), match[2]);
  }
  const makeImageMarker = (altText, rawTarget, originalSyntax) => {
    const target = String(rawTarget || "").trim();
    const normalizedTarget = target.replace(/^<|>$/g, "");
    if (/^https?:/i.test(normalizedTarget)) {
      degradations.push({
        code: "remote-image-not-verifiable",
        severity: "error",
        count: 1,
        message: `远程图片“${String(altText || "图片").trim() || "图片"}”无法在写入前证明下载内容、标题与飞书回读结果完全一致。`,
        strategy: "阻止远端写入；请先把图片下载到本地资料库，再按本地相对路径引用。"
      });
      return originalSyntax;
    }
    if (/^data:/i.test(normalizedTarget)) {
      degradations.push({
        code: "data-image-not-verifiable",
        severity: "error",
        count: 1,
        message: `内嵌 data URI 图片“${String(altText || "图片").trim() || "图片"}”无法保证被飞书无损接收和回读。`,
        strategy: "阻止远端写入；请把图片保存为资料库内的 PNG/JPEG/GIF/WebP/BMP 文件后重试。"
      });
      return originalSyntax;
    }
    if (!IMAGE_EXTENSIONS.has(localImageExtension(target))) {
      const caption = String(altText || path.basename(target.replace(/^<|>$/g, ""))).trim() || "图片";
      degradations.push({
        code: "local-image-format-unsupported",
        severity: "error",
        count: 1,
        message: `本地图片“${caption}”的格式不受飞书图片上传能力支持。`,
        strategy: "阻止远端写入；本地 Markdown 与原图片保持不变，可转为 PNG/JPEG/GIF/WebP/BMP 后重试。"
      });
      return `> 图片未导入：${caption}（格式不受支持）`;
    }
    const resolved = resolveMarkdownAsset(sourcePath, target, libraryRoot);
    const caption = String(altText || path.basename(target.replace(/^<|>$/g, ""))).trim() || "图片";
    if (!resolved || resolved.missing) {
      degradations.push({
        code: "local-image-unavailable",
        severity: "error",
        count: 1,
        message: `本地图片“${caption}”未能上传：${resolved?.reason || "无法解析"}。`,
        strategy: "在飞书正文保留清晰的缺图提示；本地 Markdown 和原图片不改动。"
      });
      return `> 图片未导入：${caption}（${resolved?.reason || "无法解析"}）`;
    }
    assetIndex += 1;
    const marker = `${MARKER_PREFIX}${assetIndex}-${crypto.createHash("sha1").update(`${resolved.path}:${assetIndex}`).digest("hex").slice(0, 10)}`;
    assets.push({ path: resolved.path, caption, marker, type: "image", sourceSyntax: originalSyntax });
    return `${marker} · ${caption}`;
  };
  let content = preserveUnsupportedHtml(extracted.body, degradations);
  content = content.replace(/!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g,
    (fullMatch, altText, target) => makeImageMarker(altText, target, fullMatch));
  content = content.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (fullMatch, altText, reference) => {
    const key = String(reference || altText).trim().toLocaleLowerCase("zh-CN");
    const target = references.get(key);
    return target ? makeImageMarker(altText, target, fullMatch) : fullMatch;
  });
  content = content.replace(/<img\b([^>]*?)\bsrc=(['"])(.*?)\2([^>]*)>/gi, (fullMatch, before, _quote, target, after) => {
    const alt = `${before} ${after}`.match(/\balt=(['"])(.*?)\1/i)?.[2] || "";
    return makeImageMarker(alt, target, fullMatch);
  });
  content = transformTaskLists(content, degradations);
  const mermaidCount = (content.match(/^\s*```mermaid\s*$/gim) || []).length;
  if (mermaidCount) {
    degradations.push({
      code: "mermaid-kept-as-code",
      severity: "info",
      count: mermaidCount,
      message: `${mermaidCount} 个 Mermaid 图在飞书副本中保留为代码块。`,
      strategy: "不擅自改变图意；需要时可由用户另行命令转换为飞书画板。"
    });
  }
  const footnoteCount = (stripFencedCodeBlocks(content).match(/\[\^[^\]]+\]/g) || []).length;
  if (footnoteCount) {
    degradations.push({
      code: "footnotes-kept-as-text",
      severity: "error",
      count: footnoteCount,
      message: `${footnoteCount} 个 Markdown 脚注无法保证在飞书中保持脚注关系和跳转。`,
      strategy: "阻止远端写入；请把脚注展开为普通正文与普通链接后重试。"
    });
  }
  const relativeLinks = new Set();
  try {
    const contentEntities = collectOrderedEntities(strictMarkdownSignature(content, assets));
    for (const link of contentEntities.links) {
      if (!/^(?:https?:|mailto:|#)/i.test(link.href)) relativeLinks.add(link.href);
    }
  } catch {
    // The parse failure above already blocks writing. Keep direct-link fallback for diagnostics.
  }
  for (const match of content.matchAll(/(?<!!)\[[^\]]+\]\((?!https?:|mailto:|#)(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    relativeLinks.add(match[1]);
  }
  if (relativeLinks.size) {
    degradations.push({
      code: "relative-links-require-target-map",
      severity: "error",
      count: relativeLinks.size,
      message: `${relativeLinks.size} 个本地相对链接离开本机目录后无法保证仍指向同一内容。`,
      strategy: "阻止远端写入；请先改成可验证的 https/mailto/文内锚点链接，或由批量发布流程建立目标映射。"
    });
  }
  if (!content.trim()) content = `# ${title}\n`;
  if (!content.endsWith("\n")) content += "\n";
  const sourceHash = crypto.createHash("sha256").update(original);
  for (const asset of assets) sourceHash.update(fs.readFileSync(asset.path));
  const featureCounts = markdownFeatureCounts(extracted.body);
  return {
    content,
    assets,
    sourceSha256: sourceHash.digest("hex"),
    contentSha256: sha256(content),
    fidelity: {
      version: 1,
      status: degradations.some((item) => item.severity === "error")
        ? "blocked"
        : degradations.some((item) => item.severity === "warning")
          ? "ready-with-warnings"
          : "ready",
      featureCounts,
      assetCount: assets.length,
      degradations
    }
  };
}

function semanticTokens(markdown) {
  const visible = String(markdown || "")
    .replace(new RegExp(`${MARKER_PREFIX}\\d+-[a-f0-9]+`, "gi"), "")
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/^\s*~~~[^\n]*$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~#>|\[\]()-]/g, " ");
  return visible.match(/\p{Script=Han}|[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu) || [];
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlInlineToMarkdown(value) {
  let output = String(value || "");
  output = output.replace(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href, label) => `[${xmlInlineToMarkdown(label)}](${decodeXmlEntities(href)})`);
  output = output
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<del>([\s\S]*?)<\/del>/gi, "~~$1~~")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");
  return decodeXmlEntities(output);
}

function escapeMarkdownImageAlt(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownForStrictLexing(markdown, assets = []) {
  let source = String(markdown || "").replace(/\r\n?/g, "\n");
  for (const [index, asset] of assets.entries()) {
    const markerWithCaption = new RegExp(
      `${regexEscape(asset.marker)}\\s*·\\s*${regexEscape(asset.caption)}`,
      "g"
    );
    source = source.replace(
      markerWithCaption,
      `![${escapeMarkdownImageAlt(asset.caption)}](domi-local-image://${index + 1})`
    );
  }
  source = source.replace(
    /^(\s*)<checkbox\s+done="(true|false)">([^\n]*?)<\/checkbox>\s*$/gim,
    (_match, indentation, done, body) => `${indentation}- [${done.toLowerCase() === "true" ? "x" : " "}] ${xmlInlineToMarkdown(body)}`
  );
  source = source.replace(/^(\s*)[-+*]\s+☑\s+/gm, "$1- [x] ");
  source = source.replace(/^(\s*)[-+*]\s+☐\s+/gm, "$1- [ ] ");
  return source;
}

function normalizedText(value) {
  return decodeXmlEntities(String(value || "")).replace(/\s+/g, " ").trim();
}

function inlineSignature(tokens = []) {
  const result = [];
  for (const token of tokens || []) {
    if (!token || token.type === "checkbox") continue;
    if (token.type === "text" || token.type === "escape") {
      if (Array.isArray(token.tokens) && token.tokens.length) {
        result.push(...inlineSignature(token.tokens));
      } else {
        const text = normalizedText(token.text ?? token.raw);
        if (text) result.push({ type: "text", text });
      }
      continue;
    }
    if (["strong", "em", "del"].includes(token.type)) {
      result.push({ type: token.type, children: inlineSignature(token.tokens || []) });
      continue;
    }
    if (token.type === "codespan") {
      result.push({ type: "codespan", text: String(token.text || "") });
      continue;
    }
    if (token.type === "br") {
      result.push({ type: "br" });
      continue;
    }
    if (token.type === "link") {
      result.push({
        type: "link",
        href: decodeXmlEntities(String(token.href || "")).replace(/^<|>$/g, ""),
        title: token.title == null ? "" : String(token.title),
        children: inlineSignature(token.tokens || [])
      });
      continue;
    }
    if (token.type === "image") {
      result.push({
        type: "image",
        alt: normalizedText(token.text || ""),
        caption: token.title == null ? "" : normalizedText(token.title)
      });
      continue;
    }
    if (token.type === "html") {
      result.push({ type: "html", raw: normalizedText(token.raw || token.text || "") });
      continue;
    }
    result.push({
      type: String(token.type || "unknown"),
      raw: normalizedText(token.raw || token.text || "")
    });
  }
  return result;
}

function tableCellSignature(cell) {
  return inlineSignature(cell?.tokens || []);
}

function blockSignature(tokens = []) {
  const result = [];
  for (const token of tokens || []) {
    if (!token || token.type === "space" || token.type === "def") continue;
    if (token.type === "heading") {
      result.push({ type: "heading", depth: Number(token.depth), inline: inlineSignature(token.tokens || []) });
      continue;
    }
    if (token.type === "paragraph" || token.type === "text") {
      result.push({ type: "paragraph", inline: inlineSignature(token.tokens || []) });
      continue;
    }
    if (token.type === "list") {
      result.push({
        type: "list",
        ordered: Boolean(token.ordered),
        start: token.ordered ? Number(token.start || 1) : null,
        items: (token.items || []).map((item) => ({
          task: Boolean(item.task),
          checked: item.task ? Boolean(item.checked) : null,
          children: blockSignature((item.tokens || []).filter((child) => child?.type !== "checkbox"))
        }))
      });
      continue;
    }
    if (token.type === "blockquote") {
      result.push({ type: "blockquote", children: blockSignature(token.tokens || []) });
      continue;
    }
    if (token.type === "table") {
      result.push({
        type: "table",
        align: (token.align || []).map((value) => value || ""),
        header: (token.header || []).map(tableCellSignature),
        rows: (token.rows || []).map((row) => row.map(tableCellSignature))
      });
      continue;
    }
    if (token.type === "code") {
      result.push({
        type: "code",
        language: String(token.lang || "").trim(),
        text: String(token.text || "").replace(/\r\n?/g, "\n")
      });
      continue;
    }
    if (token.type === "hr") {
      result.push({ type: "hr" });
      continue;
    }
    if (token.type === "html") {
      result.push({ type: "html", raw: normalizedText(token.raw || token.text || "") });
      continue;
    }
    result.push({
      type: String(token.type || "unknown"),
      raw: normalizedText(token.raw || token.text || "")
    });
  }
  return result;
}

function strictMarkdownSignature(markdown, assets = []) {
  const normalized = markdownForStrictLexing(markdown, assets);
  return blockSignature(markedLexer(normalized, { gfm: true, breaks: false }));
}

function collectOrderedEntities(signature, result = { links: [], images: [] }) {
  const visitInline = (nodes) => {
    for (const node of nodes || []) {
      if (node.type === "link") {
        result.links.push({
          label: normalizedText(flattenInlineText(node.children)),
          href: node.href,
          title: node.title
        });
      }
      if (node.type === "image") result.images.push({ alt: node.alt, caption: node.caption });
      if (node.children) visitInline(node.children);
    }
  };
  const visitBlocks = (nodes) => {
    for (const node of nodes || []) {
      if (node.inline) visitInline(node.inline);
      if (node.type === "table") {
        node.header.forEach(visitInline);
        node.rows.forEach((row) => row.forEach(visitInline));
      }
      if (node.type === "list") node.items.forEach((item) => visitBlocks(item.children));
      else if (node.children && !node.inline) visitBlocks(node.children);
    }
  };
  visitBlocks(signature);
  return result;
}

function flattenInlineText(nodes = []) {
  return nodes.map((node) => {
    if (node.type === "text" || node.type === "codespan") return node.text || "";
    if (node.type === "image") return node.alt || "";
    if (node.children) return flattenInlineText(node.children);
    return "";
  }).join("");
}

function arraysEqual(expected, actual) {
  return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
}

function jsonEqual(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function firstArrayMismatch(expected, actual) {
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if (!jsonEqual(expected[index], actual[index])) {
      return { index, expected: expected[index] ?? null, actual: actual[index] ?? null };
    }
  }
  return null;
}

function exactTokenCoverage(expected, actual) {
  if (!expected.length) return actual.length ? 0 : 1;
  let matchingPositions = 0;
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] === actual[index]) matchingPositions += 1;
  }
  return matchingPositions / expected.length;
}

function verifyFeishuMarkdownImport({ prepared, fetchedMarkdown }) {
  if (typeof fetchedMarkdown !== "string") {
    return {
      status: "unverified",
      textCoverage: null,
      missingTextSamples: [],
      sourceFeatures: prepared?.fidelity?.featureCounts || {},
      targetFeatures: {},
      message: "飞书已返回文档，但没有返回可比较的 Markdown 正文。"
    };
  }
  const blockingDegradations = (prepared?.fidelity?.degradations || [])
    .filter((item) => item?.severity === "error");
  const preparationSafe = prepared?.fidelity?.status !== "blocked" && blockingDegradations.length === 0;
  const expectedTokens = semanticTokens(prepared.content);
  const actualTokens = semanticTokens(fetchedMarkdown);
  const tokensExact = arraysEqual(expectedTokens, actualTokens);
  const coverage = exactTokenCoverage(expectedTokens, actualTokens);
  const missing = expectedTokens.filter((token, index) => token !== actualTokens[index]).slice(0, 12);
  const sourceFeatures = prepared?.fidelity?.featureCounts || {};
  const targetFeatures = markdownFeatureCounts(fetchedMarkdown);
  const structuralFields = [
    "headings", "paragraphs", "bold", "italic", "strikethrough", "unorderedLists", "orderedLists",
    "taskLists", "checkedTasks", "uncheckedTasks", "quotes", "codeBlocks", "tables", "tableCells",
    "links", "horizontalRules", "images"
  ];
  const missingFeatureCounts = Object.fromEntries(structuralFields
    .map((field) => [field, Math.max(0, Number(sourceFeatures[field] || 0) - Number(targetFeatures[field] || 0))])
    .filter(([, count]) => count > 0));
  const featureCountDifferences = Object.fromEntries(structuralFields
    .map((field) => [field, {
      expected: Number(sourceFeatures[field] || 0),
      actual: Number(targetFeatures[field] || 0)
    }])
    .filter(([, values]) => values.expected !== values.actual));
  let sourceStructure = [];
  let targetStructure = [];
  let parseError = "";
  try {
    sourceStructure = strictMarkdownSignature(prepared.content, prepared.assets || []);
    targetStructure = strictMarkdownSignature(fetchedMarkdown);
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  const structureComplete = !parseError && jsonEqual(sourceStructure, targetStructure);
  const sourceEntities = collectOrderedEntities(sourceStructure);
  const targetEntities = collectOrderedEntities(targetStructure);
  const linksComplete = jsonEqual(sourceEntities.links, targetEntities.links);
  const imagesComplete = jsonEqual(sourceEntities.images, targetEntities.images);
  const sourceMarkers = (prepared.assets || []).map((asset) => asset.marker);
  const missingPreparedMarkers = sourceMarkers.filter((marker) => !String(prepared.content || "").includes(marker));
  const residualMarkers = fetchedMarkdown.match(new RegExp(`${MARKER_PREFIX}[^\\s\\n]*`, "gi")) || [];
  const markersComplete = missingPreparedMarkers.length === 0 && residualMarkers.length === 0;
  const status = preparationSafe
    && tokensExact
    && structureComplete
    && linksComplete
    && imagesComplete
    && markersComplete
    && Object.keys(featureCountDifferences).length === 0
    ? "passed"
    : "failed";
  return {
    status,
    textCoverage: Number(coverage.toFixed(4)),
    tokenOrderCoverage: Number(coverage.toFixed(4)),
    tokensExact,
    missingTextSamples: missing,
    sourceFeatures,
    targetFeatures,
    missingFeatureCounts,
    featureCountDifferences,
    structureComplete,
    structureMismatch: structureComplete ? null : firstArrayMismatch(sourceStructure, targetStructure),
    parseError,
    missingLinkSignatures: linksComplete ? [] : [firstArrayMismatch(sourceEntities.links, targetEntities.links)],
    imageSignatureMismatch: imagesComplete ? null : firstArrayMismatch(sourceEntities.images, targetEntities.images),
    residualMarkers,
    missingPreparedMarkers,
    blockingDegradations: blockingDegradations.map((item) => item.code),
    message: status === "passed"
      ? "正文 token、块级结构、列表/任务、表格、代码、链接与图片均按顺序完整回读。"
      : "飞书回读与源 Markdown 并非 100% 等价，不能把本次同步标记为完成。"
  };
}

module.exports = {
  MARKER_PREFIX,
  extractFrontmatter,
  markdownFeatureCounts,
  prepareMarkdownForFeishu,
  semanticTokens,
  verifyFeishuMarkdownImport
};
