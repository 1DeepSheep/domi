import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { marked } from "marked";
import PDFDocument from "pdfkit";

import { STATE_DIR, ensurePrivateDir } from "./state.js";

const OUTBOUND_PDF_DIR = path.join(STATE_DIR, "outbound-pdf");
const BODY_COLOR = "#292724";
const MUTED_COLOR = "#77736d";
const ACCENT_COLOR = "#9a7663";
const BORDER_COLOR = "#ded8d1";
const PANEL_COLOR = "#f6f3ef";
const PDF_RENDERER_VERSION = "2";

const FONT_CANDIDATES = [
  {
    filePath: "/System/Library/Fonts/Hiragino Sans GB.ttc",
    regularFamily: "HiraginoSansGB-W3",
    boldFamily: "HiraginoSansGB-W6",
  },
  {
    filePath: "/System/Library/Fonts/STHeiti Light.ttc",
    regularFamily: "STHeitiSC-Light",
    boldFamily: "STHeitiSC-Light",
  },
];

function registerFonts(document) {
  const candidate = FONT_CANDIDATES.find((entry) => fs.existsSync(entry.filePath));
  if (!candidate) return { regular: "Helvetica", bold: "Helvetica-Bold" };
  document.registerFont("DomiBody", candidate.filePath, candidate.regularFamily);
  document.registerFont("DomiBold", candidate.filePath, candidate.boldFamily);
  return { regular: "DomiBody", bold: "DomiBold" };
}

function stripFrontmatter(markdown) {
  return String(markdown || "").replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
}

function textFromInlineTokens(tokens) {
  return (tokens || []).map((token) => {
    if (token.type === "br") return "\n";
    if (token.type === "codespan") return token.text || "";
    if (token.type === "image") return token.text ? `［图片：${token.text}］` : "［图片］";
    if (token.type === "link") {
      const label = textFromInlineTokens(token.tokens) || token.text || token.href || "";
      return token.href && /^https?:\/\//i.test(token.href) && label !== token.href
        ? `${label}（${token.href}）`
        : label;
    }
    if (token.tokens?.length) return textFromInlineTokens(token.tokens);
    return String(token.text || token.raw || "").replace(/<[^>]+>/g, "");
  }).join("");
}

function plainInline(text, tokens) {
  return textFromInlineTokens(tokens?.length ? tokens : marked.Lexer.lexInline(String(text || "")));
}

function ensureSpace(document, minimumHeight = 36) {
  const bottom = document.page.height - document.page.margins.bottom;
  if (document.y + minimumHeight > bottom) document.addPage();
}

function writeParagraph(document, fonts, value, { indent = 0, size = 10.5, color = BODY_COLOR } = {}) {
  const text = String(value || "").trim();
  if (!text) return;
  ensureSpace(document, 30);
  const x = document.page.margins.left + indent;
  const width = document.page.width - document.page.margins.left - document.page.margins.right - indent;
  document.font(fonts.regular).fontSize(size).fillColor(color).text(text, x, document.y, {
    width,
    lineGap: 3.2,
  });
  document.moveDown(0.58);
}

function writeHeading(document, fonts, text, depth) {
  const sizes = { 1: 23, 2: 18, 3: 14.5, 4: 12.5, 5: 11.5, 6: 10.5 };
  const size = sizes[Math.min(6, Math.max(1, depth || 2))];
  ensureSpace(document, size * 2.4);
  if (document.y > document.page.margins.top + 8) document.moveDown(depth <= 2 ? 0.85 : 0.55);
  if (depth === 2) {
    document.save().strokeColor(ACCENT_COLOR).lineWidth(2.2)
      .moveTo(document.page.margins.left, document.y + 2)
      .lineTo(document.page.margins.left + 22, document.y + 2).stroke().restore();
    document.y += 9;
  }
  document.font(fonts.bold).fontSize(size).fillColor(BODY_COLOR).text(String(text || ""), {
    width: document.page.width - document.page.margins.left - document.page.margins.right,
    lineGap: 2,
  });
  document.moveDown(depth <= 2 ? 0.48 : 0.32);
}

function writeList(document, fonts, token, indent = 0) {
  const ordered = Boolean(token.ordered);
  const start = Number(token.start) || 1;
  token.items.forEach((item, index) => {
    const itemTokens = item.tokens || [];
    const primary = itemTokens.find((entry) => ["text", "paragraph"].includes(entry.type));
    const text = plainInline(primary?.text || item.text, primary?.tokens);
    ensureSpace(document, 30);
    const x = document.page.margins.left + indent;
    const marker = item.task ? (item.checked ? "☑" : "☐") : ordered ? `${start + index}.` : "•";
    document.font(fonts.regular).fontSize(10.5).fillColor(ACCENT_COLOR).text(marker, x, document.y, {
      width: 22,
      lineGap: 3,
    });
    document.font(fonts.regular).fontSize(10.5).fillColor(BODY_COLOR).text(
      text,
      x + 22,
      document.y - document.currentLineHeight(),
      {
        width: document.page.width - document.page.margins.right - x - 22,
        lineGap: 3.2,
      },
    );
    document.moveDown(0.32);
    for (const child of itemTokens) {
      if (child.type === "list") writeList(document, fonts, child, indent + 22);
    }
  });
  document.moveDown(0.3);
}

function writeTable(document, fonts, token) {
  const headers = token.header.map((cell) => plainInline(cell.text, cell.tokens));
  if (headers.length > 4) {
    token.rows.forEach((row, rowIndex) => {
      ensureSpace(document, 52);
      writeParagraph(
        document,
        fonts,
        row.map((cell, index) => `${headers[index] || `字段${index + 1}`}：${plainInline(cell.text, cell.tokens)}`).join("\n"),
        { indent: 10, size: 9.3 },
      );
      if (rowIndex < token.rows.length - 1) document.moveDown(0.2);
    });
    return;
  }

  const x = document.page.margins.left;
  const totalWidth = document.page.width - document.page.margins.left - document.page.margins.right;
  const columnWidth = totalWidth / Math.max(1, headers.length);
  const rows = [headers, ...token.rows.map((row) => row.map((cell) => plainInline(cell.text, cell.tokens)))];
  rows.forEach((row, rowIndex) => {
    document.font(rowIndex === 0 ? fonts.bold : fonts.regular).fontSize(rowIndex === 0 ? 8.8 : 8.5);
    const height = Math.max(28, ...row.map((cell) => document.heightOfString(cell, {
      width: columnWidth - 12,
      lineGap: 2,
    }) + 12));
    ensureSpace(document, height);
    const y = document.y;
    row.forEach((cell, columnIndex) => {
      const cellX = x + columnIndex * columnWidth;
      document.save().fillColor(rowIndex === 0 ? "#eee8e2" : "#ffffff")
        .strokeColor(BORDER_COLOR).lineWidth(0.6)
        .rect(cellX, y, columnWidth, height).fillAndStroke().restore();
      document.font(rowIndex === 0 ? fonts.bold : fonts.regular)
        .fontSize(rowIndex === 0 ? 8.8 : 8.5).fillColor(BODY_COLOR)
        .text(cell, cellX + 6, y + 6, { width: columnWidth - 12, lineGap: 2 });
    });
    document.y = y + height;
  });
  document.moveDown(0.75);
}

function writeCode(document, fonts, text) {
  ensureSpace(document, 44);
  const x = document.page.margins.left;
  const width = document.page.width - document.page.margins.left - document.page.margins.right;
  document.font(fonts.regular).fontSize(8.5);
  const height = Math.min(500, document.heightOfString(String(text || ""), { width: width - 20, lineGap: 2 }) + 18);
  document.save().fillColor(PANEL_COLOR).roundedRect(x, document.y, width, height, 5).fill().restore();
  document.fillColor(BODY_COLOR).text(String(text || ""), x + 10, document.y + 9, {
    width: width - 20,
    lineGap: 2,
  });
  document.y += 9;
  document.moveDown(0.7);
}

function writeBlockquote(document, fonts, token) {
  const text = (token.tokens || []).map((entry) => plainInline(entry.text, entry.tokens)).filter(Boolean).join("\n");
  ensureSpace(document, 40);
  const y = document.y;
  document.save().strokeColor(ACCENT_COLOR).lineWidth(2).moveTo(document.page.margins.left, y)
    .lineTo(document.page.margins.left, y + 28).stroke().restore();
  writeParagraph(document, fonts, text, { indent: 13, size: 9.8, color: MUTED_COLOR });
}

function renderTokens(document, fonts, tokens) {
  for (const token of tokens) {
    if (token.type === "space") continue;
    if (token.type === "heading") {
      writeHeading(document, fonts, plainInline(token.text, token.tokens), token.depth);
    } else if (["paragraph", "text"].includes(token.type)) {
      writeParagraph(document, fonts, plainInline(token.text, token.tokens));
    } else if (token.type === "list") {
      writeList(document, fonts, token);
    } else if (token.type === "table") {
      writeTable(document, fonts, token);
    } else if (token.type === "code") {
      writeCode(document, fonts, token.text);
    } else if (token.type === "blockquote") {
      writeBlockquote(document, fonts, token);
    } else if (token.type === "hr") {
      ensureSpace(document, 24);
      document.save().strokeColor(BORDER_COLOR).lineWidth(0.8)
        .moveTo(document.page.margins.left, document.y)
        .lineTo(document.page.width - document.page.margins.right, document.y).stroke().restore();
      document.moveDown(0.8);
    }
  }
}

function addPageFurniture(document, fonts, title) {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    document.save();
    const originalBottomMargin = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    document.font(fonts.regular).fontSize(7.5).fillColor(MUTED_COLOR);
    document.text(title, document.page.margins.left, 24, {
      width: document.page.width - document.page.margins.left - document.page.margins.right - 70,
      ellipsis: true,
      lineBreak: false,
    });
    document.text(`${index - range.start + 1} / ${range.count}`, document.page.width - document.page.margins.right - 62, 24, {
      width: 62,
      align: "right",
      lineBreak: false,
    });
    document.strokeColor(BORDER_COLOR).lineWidth(0.5)
      .moveTo(document.page.margins.left, document.page.height - 33)
      .lineTo(document.page.width - document.page.margins.right, document.page.height - 33).stroke();
    document.text("由 domi 转为便于移动端阅读的 PDF", document.page.margins.left, document.page.height - 26, {
      width: document.page.width - document.page.margins.left - document.page.margins.right,
      align: "center",
      lineBreak: false,
    });
    document.page.margins.bottom = originalBottomMargin;
    document.restore();
  }
}

export async function markdownToPdf({ inputPath, outputPath }) {
  const markdown = stripFrontmatter(fs.readFileSync(inputPath, "utf8"));
  const tokens = marked.lexer(markdown, { gfm: true });
  const firstHeading = tokens.find((token) => token.type === "heading");
  const title = firstHeading ? plainInline(firstHeading.text, firstHeading.tokens) : path.basename(inputPath, path.extname(inputPath));
  ensurePrivateDir(path.dirname(outputPath));
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(temporaryPath, { mode: 0o600 });
    const document = new PDFDocument({
      size: "A4",
      margins: { top: 52, right: 54, bottom: 58, left: 54 },
      bufferPages: true,
      info: { Title: title, Author: "domi", Creator: "domi" },
    });
    const fonts = registerFonts(document);
    output.once("finish", resolve);
    output.once("error", reject);
    document.once("error", reject);
    document.pipe(output);
    renderTokens(document, fonts, tokens);
    addPageFurniture(document, fonts, title);
    document.end();
  }).catch((error) => {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  });
  fs.renameSync(temporaryPath, outputPath);
  fs.chmodSync(outputPath, 0o600);
  return outputPath;
}

export async function prepareAttachmentForWeixin(filePath) {
  const resolved = path.resolve(filePath);
  if (![".md", ".markdown"].includes(path.extname(resolved).toLowerCase())) return resolved;
  const stat = fs.statSync(resolved);
  const cacheKey = crypto.createHash("sha256")
    .update(`${PDF_RENDERER_VERSION}\0${resolved}\0${stat.size}\0${stat.mtimeMs}`)
    .digest("hex").slice(0, 16);
  const outputDirectory = path.join(OUTBOUND_PDF_DIR, cacheKey);
  const outputPath = path.join(outputDirectory, `${path.basename(resolved, path.extname(resolved))}.pdf`);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return outputPath;
  return markdownToPdf({ inputPath: resolved, outputPath });
}
