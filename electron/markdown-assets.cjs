const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { Marked, Renderer } = require("marked");
const { fromMarkdown } = require("mdast-util-from-markdown");
const { gfmFromMarkdown } = require("mdast-util-gfm");
const { gfm } = require("micromark-extension-gfm");
const { findLegacyUnderline, mapLegacyUnderline, legacyUnderlineOpaqueRanges } = require("../shared/legacy-underline.mjs");

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

function markdownImageBoundary(documentPath, rootPath) {
  const normalizedDocumentPath = path.normalize(documentPath);
  const documentDirectory = path.dirname(normalizedDocumentPath);
  let allowedDirectory = documentDirectory;
  if (rootPath !== undefined && rootPath !== null && rootPath !== "") {
    if (typeof rootPath !== "string" || !path.isAbsolute(rootPath)) {
      throw new Error("Markdown 图片资料库路径无效。");
    }
    const configuredRoot = path.normalize(rootPath);
    if (isInsideDirectory(configuredRoot, normalizedDocumentPath)) {
      allowedDirectory = configuredRoot;
    }
  }
  return { normalizedDocumentPath, documentDirectory, allowedDirectory };
}

function verifiedMarkdownImageBoundary(documentPath, rootPath) {
  const boundary = markdownImageBoundary(documentPath, rootPath);
  const allowedDirectoryRealPath = fs.realpathSync(boundary.allowedDirectory);
  const documentRealPath = fs.realpathSync(boundary.normalizedDocumentPath);
  if (!isInsideDirectory(allowedDirectoryRealPath, documentRealPath)) {
    throw new Error("Markdown 文档实际位置不在允许的资料库范围内。");
  }
  return { ...boundary, allowedDirectoryRealPath, documentRealPath };
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

  const { normalizedDocumentPath, documentDirectory, allowedDirectory } = markdownImageBoundary(
    documentPath,
    options.rootPath
  );
  if (!isInsideDirectory(allowedDirectory, candidate)) {
    throw new Error(
      allowedDirectory === documentDirectory
        ? "为保护本地文件，只加载 Markdown 所在文件夹内的图片。"
        : "为保护本地文件，只加载当前资料库内的图片。"
    );
  }
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) {
    throw new Error("仅支持 PNG、JPEG、GIF 和 WebP 图片。");
  }

  if (options.mustExist !== false) {
    const { allowedDirectoryRealPath } = verifiedMarkdownImageBoundary(
      normalizedDocumentPath,
      options.rootPath
    );
    const candidateRealPath = fs.realpathSync(candidate);
    if (!isInsideDirectory(allowedDirectoryRealPath, candidateRealPath)) {
      throw new Error("图片实际位置不在允许的资料库范围内。");
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
  const boundary = verifiedMarkdownImageBoundary(documentPath, request?.rootPath);

  const buffer = Buffer.from(request?.data || []);
  if (!buffer.length) throw new Error("剪贴板图片为空。");
  if (buffer.length > MAX_PASTED_IMAGE_BYTES) {
    throw new Error("单张图片不能超过 20 MB。");
  }

  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    throw new Error("仅支持 PNG、JPEG、GIF 和 WebP 图片；SVG 与 TIFF 暂不写入文档。");
  }

  const assetDirectory = markdownAssetDirectory(boundary.normalizedDocumentPath);
  await fs.promises.mkdir(assetDirectory, { recursive: true });
  const assetDirectoryRealPath = await fs.promises.realpath(assetDirectory);
  if (!isInsideDirectory(boundary.allowedDirectoryRealPath, assetDirectoryRealPath)) {
    throw new Error("图片附件目录实际位置不在允许的资料库范围内。");
  }
  const name = makeAssetFileName(buffer, mimeType);
  const targetPath = path.join(assetDirectory, name);

  try {
    await fs.promises.writeFile(targetPath, buffer, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existingStat = await fs.promises.lstat(targetPath);
    if (!existingStat.isFile() || existingStat.isSymbolicLink()) {
      throw new Error("图片附件发生不安全的文件名冲突，请检查 assets 目录。");
    }
    const existingRealPath = await fs.promises.realpath(targetPath);
    if (!isInsideDirectory(boundary.allowedDirectoryRealPath, existingRealPath)) {
      throw new Error("图片附件实际位置不在允许的资料库范围内。");
    }
    const existing = await fs.promises.readFile(targetPath);
    if (!existing.equals(buffer)) {
      throw new Error("图片附件发生文件名冲突，请重新粘贴。");
    }
  }
  const targetRealPath = await fs.promises.realpath(targetPath);
  if (!isInsideDirectory(boundary.allowedDirectoryRealPath, targetRealPath)) {
    await fs.promises.rm(targetPath, { force: true }).catch(() => undefined);
    throw new Error("图片附件实际位置不在允许的资料库范围内。");
  }

  return {
    path: targetPath,
    name,
    relativePath: path.relative(boundary.documentDirectory, targetPath).split(path.sep).join("/"),
    mimeType,
    size: buffer.length
  };
}

function localImageDataUrl(documentPath, source, clipboardBudget, rootPath) {
  const imagePath = resolveMarkdownImagePath(documentPath, source, { rootPath });
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

function applyMarkdownEdits(source, edits) {
  const pieces = [];
  let cursor = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.start < cursor || edit.end < edit.start) throw new Error("Markdown 格式转换范围发生重叠。");
    pieces.push(source.slice(cursor, edit.start), edit.value);
    cursor = edit.end;
  }
  pieces.push(source.slice(cursor));
  return pieces.join("");
}

function portableMarkdownEdits(markdown, { plainText = false } = {}) {
  const source = String(markdown || "");
  const body = splitFrontmatter(source);
  const bodyOffset = source.length - body.length;
  const root = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const protectedRanges = [];
  const inlineContainers = [];
  const openUnderlineTags = [];
  const edits = [];
  const emphasisHeadingRanges = [];
  const protect = (start, end) => protectedRanges.push({ start: start + bodyOffset, end: end + bodyOffset });
  if (bodyOffset) protectedRanges.push({ start: 0, end: bodyOffset });
  const visit = (node) => {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return;
    if (["link", "linkReference", "strong", "emphasis", "delete"].includes(node.type)) {
      inlineContainers.push({ start: start + bodyOffset, end: end + bodyOffset });
    }
    if (["code", "inlineCode", "definition", "image", "imageReference", "footnoteReference"].includes(node.type)) {
      protect(start, end);
      return;
    }
    if (node.type === "footnoteDefinition") {
      protect(start, node.children?.[0]?.position?.start?.offset ?? end);
    }
    if (["link", "linkReference"].includes(node.type)) {
      if ((node.type === "linkReference" && node.referenceType !== "full") || !body.slice(start, end).startsWith("[")) {
        // Autolinks are URLs; shortcut/collapsed labels also identify their
        // reference target. Editing either would change the link itself.
        protect(start, end);
        return;
      }
      const children = node.children || [];
      // Preserve destination/title/reference bytes, including literal ++.
      protect(start, children[0]?.position?.start?.offset ?? end);
      protect(children.at(-1)?.position?.end?.offset ?? start, end);
    }
    if (node.type === "html") {
      const raw = body.slice(start, end);
      protect(start, end);
      if (/^<u(?:\s+[^<>]*)?>$/i.test(raw)) openUnderlineTags.push(start + bodyOffset);
      else if (/^<\/u\s*>$/i.test(raw) && openUnderlineTags.length) {
        inlineContainers.push({ start: openUnderlineTags.pop(), end: end + bodyOffset });
      }
      if (plainText && /^<\/?u(?:\s+[^<>]*)?>$/i.test(raw)) {
        edits.push({ start: start + bodyOffset, end: end + bodyOffset, value: "", kind: "html" });
      } else if (plainText && /^<br\s*\/?\s*>$/i.test(raw)) {
        edits.push({ start: start + bodyOffset, end: end + bodyOffset, value: "\n", kind: "html" });
      } else {
        const block = raw.match(/^(<u(?:\s+[^<>]*)?>)([\s\S]*?)(<\/u\s*>)(\r?\n)?$/i);
        if (block) {
          // Parse only the allowed underline body; arbitrary HTML remains literal.
          const inner = block[2];
          const innerOffset = start + bodyOffset + block[1].length;
          const innerEdits = portableMarkdownEdits(inner, { plainText });
          edits.push(...innerEdits.map(edit => ({ ...edit, start: edit.start + innerOffset, end: edit.end + innerOffset })));
          if (plainText) {
            edits.push({ start: start + bodyOffset, end: innerOffset, value: "", kind: "html" });
            edits.push({ start: innerOffset + inner.length, end: innerOffset + inner.length + block[3].length, value: "", kind: "html" });
          }
        }
      }
      return;
    }
    if (plainText && node.type === "heading" && node.depth <= 3) {
      const raw = body.slice(start, end);
      const heading = raw.match(/^(\s{0,3})#{1,3}\s+([^\r\n]*?)\s*#*\s*$/);
      const emphasis = heading ? underlineEmphasisContent(heading[2]) : null;
      if (heading && emphasis?.matched) {
        const range = { start: start + bodyOffset, end: end + bodyOffset };
        emphasisHeadingRanges.push(range);
        edits.push({ ...range, value: markdownClipboardPlainText(emphasis.content) });
        protect(start, end);
        return;
      }
    }
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  for (const start of openUnderlineTags) inlineContainers.push({ start, end: source.length });
  // Keep UTF-16 offsets stable while hiding code, HTML and link destinations
  // from the shared delimiter scanner. Only delimiters are edited, never bodies.
  const maskedCharacters = source.split("");
  for (const range of protectedRanges) {
    for (let index = range.start; index < range.end; index += 1) {
      if (maskedCharacters[index] !== "\r" && maskedCharacters[index] !== "\n") maskedCharacters[index] = "\ufffc";
    }
  }
  const masked = maskedCharacters.join("");
  mapLegacyUnderline(masked, (match) => {
    // A mark may contain a whole link/strong node, or live wholly inside it.
    // Crossing just one edge would produce misnested HTML and change styling.
    const crossesContainer = inlineContainers.some(container =>
      (match.start >= container.start && match.start < container.end)
        !== (match.contentEnd >= container.start && match.contentEnd < container.end));
    if (crossesContainer) return masked.slice(match.start, match.end);
    edits.push({ start: match.start, end: match.contentStart, value: plainText ? "" : "<u>" });
    edits.push({ start: match.contentEnd, end: match.end, value: plainText ? "" : "</u>" });
    return masked.slice(match.start, match.end);
  });
  const opaque = legacyUnderlineOpaqueRanges(masked);
  const overlapsOpaque = (edit) => {
    let left = 0, right = opaque.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (opaque[middle].end <= edit.start) left = middle + 1;
      else right = middle;
    }
    return opaque[left]?.start < edit.end;
  };
  return edits.filter(edit => !(edit.kind === "html" && overlapsOpaque(edit))
    && !emphasisHeadingRanges.some(range => edit.start > range.start && edit.end <= range.end));
}

// Pure, source-preserving conversion. It never reads or writes user documents.
function normalizeLegacyUnderlineMarkdown(markdown) {
  const source = String(markdown || "");
  return applyMarkdownEdits(source, portableMarkdownEdits(source));
}

function unwrapStrongMarkdown(value) {
  let source = String(value || "").trim();
  while (/^\*\*[\s\S]*\*\*$/.test(source)) {
    source = source.slice(2, -2).trim();
  }
  return source;
}

function underlineEmphasisContent(value) {
  const source = unwrapStrongMarkdown(value);
  const domiUnderline = findLegacyUnderline(source);
  if (domiUnderline?.start === 0 && domiUnderline.end === source.length) {
    return { matched: true, content: unwrapStrongMarkdown(domiUnderline.content) };
  }
  const htmlUnderline = source.match(/^<u(?:\s+[^<>]*)?>\s*([\s\S]*?)\s*<\/u\s*>$/i);
  if (htmlUnderline) {
    return { matched: true, content: unwrapStrongMarkdown(htmlUnderline[1]) };
  }
  return { matched: false, content: source };
}

function markdownClipboardPlainText(markdown) {
  const source = String(markdown || "");
  return applyMarkdownEdits(source, portableMarkdownEdits(source, { plainText: true }));
}

const CLIPBOARD_UNDERLINE_STYLE = "text-decoration:underline;text-underline-offset:2px;";

function renderSafeMarkdownHtml(text, parseInline) {
  const source = String(text || "");
  if (/^<br\s*\/?\s*>$/i.test(source)) return "<br>";
  if (/^<u(?:\s+[^<>]*)?>$/i.test(source)) {
    return `<u style="${CLIPBOARD_UNDERLINE_STYLE}">`;
  }
  if (/^<\/u\s*>$/i.test(source)) return "</u>";

  const underlineBlock = source.match(/^<u(?:\s+[^<>]*)?>\s*([\s\S]*?)\s*<\/u\s*>$/i);
  if (underlineBlock) {
    const content = parseInline(underlineBlock[1]);
    return `<u style="${CLIPBOARD_UNDERLINE_STYLE}">${content}</u>`;
  }
  return `<pre>${escapeHtml(source)}</pre>`;
}

function isUnderlineEmphasisHeading(token) {
  if (Number(token?.depth) > 3) return false;
  const tokens = Array.isArray(token?.tokens) ? token.tokens : [];
  if (tokens.length === 1) {
    let child = tokens[0];
    while (child?.type === "strong" && Array.isArray(child.tokens) && child.tokens.length === 1) {
      [child] = child.tokens;
    }
    if (child?.type === "underline") return true;
  }
  return underlineEmphasisContent(token?.text).matched;
}

function markdownClipboardParser(renderer) {
  const parser = new Marked();
  parser.setOptions({ async: false, breaks: false, gfm: true, renderer });
  return parser;
}

function safeClipboardLink(href) {
  const source = String(href || "").trim();
  if (!source) return "";
  try {
    const resolved = new URL(source, "https://domi.invalid/");
    return ["http:", "https:", "mailto:", "tel:"].includes(resolved.protocol) ? source : "";
  } catch { return ""; }
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
  const parser = markdownClipboardParser(renderer);
  renderer.html = ({ text }) => renderSafeMarkdownHtml(text, (value) => parser.parseInline(value));
  renderer.link = function renderClipboardLink(token) {
    const label = this.parser.parseInline(token.tokens || []);
    const href = safeClipboardLink(token.href);
    if (!href) return label;
    const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
    return `<a href="${escapeHtml(href)}"${title}>${label}</a>`;
  };
  renderer.heading = function renderClipboardHeading(token) {
    const inline = this.parser.parseInline(token.tokens || []);
    if (isUnderlineEmphasisHeading(token)) {
      return `<p><strong>${inline}</strong></p>\n`;
    }
    return `<h${token.depth}>${inline}</h${token.depth}>\n`;
  };
  renderer.image = ({ href, title, text }) => {
    const source = String(href || "");
    const alt = escapeHtml(text || "图片");
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    if (/^https?:\/\//i.test(source)) {
      return `<img src="${escapeHtml(source)}" alt="${alt}"${titleAttribute}>`;
    }
    try {
      const dataUrl = localImageDataUrl(documentPath, source, budget, request?.rootPath);
      return `<img src="${dataUrl}" alt="${alt}"${titleAttribute}>`;
    } catch {
      missingImageCount += 1;
      return `<span>[图片：${alt}（未找到）]</span>`;
    }
  };

  const body = splitFrontmatter(normalizeLegacyUnderlineMarkdown(markdown));
  const rendered = parser.parse(body)
    .replace(/<table>/g, '<table style="border-collapse:collapse">')
    .replace(/<(th|td)(\s[^>]*)?>/g, '<$1$2 style="border:1px solid #ddd;padding:6px 9px;vertical-align:top">');
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
    text: markdownClipboardPlainText(markdown),
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
  normalizeLegacyUnderlineMarkdown,
  markdownAssetDirectory,
  resolveMarkdownImagePath,
  savePastedMarkdownImage
};
