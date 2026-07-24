const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { marked, Renderer } = require("marked");

const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_CLIPBOARD_IMAGES = 60;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function detectImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return "";
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a"
    || buffer.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

function extensionForMime(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/webp") return ".webp";
  return "";
}

function stripMarkdownDestination(value) {
  let source = String(value || "").trim();
  if (source.startsWith("<") && source.endsWith(">")) {
    source = source.slice(1, -1);
  }
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
}

function isInsideDirectory(directoryPath, candidatePath) {
  const relative = path.relative(directoryPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveMarkdownImagePath(documentPath, source, options = {}) {
  if (typeof documentPath !== "string" || !path.isAbsolute(documentPath)) {
    throw new Error("Markdown 文档路径无效。");
  }
  if (!/\.(?:md|markdown)$/i.test(documentPath)) {
    throw new Error("图片必须关联到 Markdown 文档。");
  }

  const normalizedSource = stripMarkdownDestination(source);
  if (!normalizedSource || /^(?:https?:|data:|blob:|domi-asset:)/i.test(normalizedSource)) {
    throw new Error("这不是本地 Markdown 图片。");
  }

  let candidate;
  if (/^file:\/\//i.test(normalizedSource)) {
    candidate = fileURLToPath(normalizedSource);
  } else {
    const pathOnly = normalizedSource.replace(/[?#].*$/, "");
    candidate = path.isAbsolute(pathOnly)
      ? path.normalize(pathOnly)
      : path.resolve(path.dirname(documentPath), pathOnly);
  }

  const documentDirectory = path.dirname(path.normalize(documentPath));
  if (!isInsideDirectory(documentDirectory, candidate)) {
    throw new Error("为保护本地文件，只加载 Markdown 所在文件夹内的图片。");
  }
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) {
    throw new Error("仅支持 PNG、JPEG、GIF 和 WebP 图片。");
  }

  if (options.mustExist !== false) {
    const documentRealPath = fs.realpathSync(documentPath);
    const documentDirectoryRealPath = path.dirname(documentRealPath);
    const candidateRealPath = fs.realpathSync(candidate);
    if (!isInsideDirectory(documentDirectoryRealPath, candidateRealPath)) {
      throw new Error("图片实际位置不在 Markdown 所在文件夹内。");
    }
    const stat = fs.statSync(candidateRealPath);
    if (!stat.isFile()) throw new Error("图片地址不是文件。");
    return candidateRealPath;
  }

  return candidate;
}

function markdownAssetDirectory(documentPath) {
  return path.join(path.dirname(path.normalize(documentPath)), "assets");
}

function makeAssetFileName(buffer, mimeType, now = new Date()) {
  const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  return `image-${timestamp}-${digest}${extensionForMime(mimeType)}`;
}

async function savePastedMarkdownImage(request) {
  const documentPath = String(request?.documentPath || "");
  if (!path.isAbsolute(documentPath) || !/\.(?:md|markdown)$/i.test(documentPath)) {
    throw new Error("请先打开一个有效的本地 Markdown 文档。");
  }
  const documentStat = await fs.promises.stat(documentPath);
  if (!documentStat.isFile()) throw new Error("Markdown 文档不存在。");

  const buffer = Buffer.from(request?.data || []);
  if (!buffer.length) throw new Error("剪贴板图片为空。");
  if (buffer.length > MAX_PASTED_IMAGE_BYTES) {
    throw new Error("单张图片不能超过 20 MB。");
  }

  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    throw new Error("仅支持 PNG、JPEG、GIF 和 WebP 图片；SVG 与 TIFF 暂不写入文档。");
  }

  const assetDirectory = markdownAssetDirectory(documentPath);
  await fs.promises.mkdir(assetDirectory, { recursive: true });
  const name = makeAssetFileName(buffer, mimeType);
  const targetPath = path.join(assetDirectory, name);

  try {
    await fs.promises.writeFile(targetPath, buffer, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fs.promises.readFile(targetPath);
    if (!existing.equals(buffer)) {
      throw new Error("图片附件发生文件名冲突，请重新粘贴。");
    }
  }

  return {
    path: targetPath,
    name,
    relativePath: path.relative(path.dirname(documentPath), targetPath).split(path.sep).join("/"),
    mimeType,
    size: buffer.length
  };
}

function localImageDataUrl(documentPath, source, clipboardBudget) {
  const imagePath = resolveMarkdownImagePath(documentPath, source);
  if (clipboardBudget.count >= MAX_CLIPBOARD_IMAGES) {
    throw new Error(`单次最多复制 ${MAX_CLIPBOARD_IMAGES} 张图片。`);
  }
  const stat = fs.statSync(imagePath);
  if (clipboardBudget.bytes + stat.size > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error("图片总大小超过 40 MB。");
  }
  const buffer = fs.readFileSync(imagePath);
  const mimeType = detectImageMime(buffer);
  if (!mimeType) throw new Error("图片文件内容与支持格式不符。");
  clipboardBudget.count += 1;
  clipboardBudget.bytes += buffer.length;
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function splitFrontmatter(markdown) {
  const match = String(markdown || "").match(/^(\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?)/);
  return match ? String(markdown).slice(match[1].length) : String(markdown || "");
}

function buildMarkdownClipboardPayload(request) {
  const documentPath = String(request?.documentPath || "");
  const markdown = typeof request?.markdown === "string" ? request.markdown : "";
  if (!path.isAbsolute(documentPath) || !/\.(?:md|markdown)$/i.test(documentPath)) {
    throw new Error("Markdown 文档路径无效。");
  }
  if (Buffer.byteLength(markdown, "utf8") > 8 * 1024 * 1024) {
    throw new Error("Markdown 内容超过 8 MB，无法复制全文。");
  }

  const budget = { count: 0, bytes: 0 };
  let missingImageCount = 0;
  const renderer = new Renderer();
  renderer.html = ({ text }) => `<pre>${escapeHtml(text)}</pre>`;
  renderer.image = ({ href, title, text }) => {
    const source = String(href || "");
    const alt = escapeHtml(text || "图片");
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    if (/^https?:\/\//i.test(source)) {
      return `<img src="${escapeHtml(source)}" alt="${alt}"${titleAttribute}>`;
    }
    try {
      const dataUrl = localImageDataUrl(documentPath, source, budget);
      return `<img src="${dataUrl}" alt="${alt}"${titleAttribute}>`;
    } catch {
      missingImageCount += 1;
      return `<span>[图片：${alt}（未找到）]</span>`;
    }
  };

  const body = splitFrontmatter(markdown);
  const rendered = marked.parse(body, {
    async: false,
    breaks: false,
    gfm: true,
    renderer
  });
  const html = [
    "<div style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
    "font-size:15px;line-height:1.7;color:#292926;\">",
    "<style>img{display:block;max-width:100%;height:auto;margin:16px 0}",
    "table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 9px}",
    "blockquote{border-left:3px solid #d98669;margin:16px 0;padding:6px 12px;color:#555}</style>",
    rendered,
    "</div>"
  ].join("");

  return {
    text: markdown,
    html,
    imageCount: budget.count,
    missingImageCount
  };
}

module.exports = {
  MAX_CLIPBOARD_IMAGE_BYTES,
  MAX_CLIPBOARD_IMAGES,
  MAX_PASTED_IMAGE_BYTES,
  buildMarkdownClipboardPayload,
  detectImageMime,
  makeAssetFileName,
  markdownAssetDirectory,
  resolveMarkdownImagePath,
  savePastedMarkdownImage
};
