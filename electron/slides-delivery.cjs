const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validatePdfProof } = require("../services/wechat-bridge/src/slides-pdf-proof.cjs");
const { externalLocalResourceIn, slideElementsIn } = require("../services/wechat-bridge/src/slides-html-contract.cjs");

const SLIDES_DELIVERY_POLICIES = new Set([
  "html_pdf",
  "html_pdf_preserve_template",
  "explicit_pptx",
  "explicit_pptx_preserve_template"
]);
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const MAX_AUDIT_BYTES = 4 * 1024 * 1024;

function normalizedSlidesDeliveryPolicy(value) {
  const policy = String(value || "").trim();
  return SLIDES_DELIVERY_POLICIES.has(policy) ? policy : "";
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function canonicalFile(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function sameFile(left, right) {
  return Boolean(left && right && canonicalFile(left) === canonicalFile(right));
}

function regularNonemptyFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function fileHeader(filePath, length) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(descriptor, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fileTail(filePath, length) {
  const stat = fs.statSync(filePath);
  const descriptor = fs.openSync(filePath, "r");
  try {
    const size = Math.min(length, stat.size);
    const buffer = Buffer.alloc(size);
    const bytesRead = fs.readSync(descriptor, buffer, 0, size, Math.max(0, stat.size - size));
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateDeliverableSignature(filePath, kind) {
  try {
    if (kind === "pdf") {
      if (fileHeader(filePath, 5).toString("ascii") !== "%PDF-") {
        return "PDF 文件头无效。";
      }
      if (!fileTail(filePath, 1_024).toString("latin1").includes("%%EOF")) {
        return "PDF 文件没有完整结束标记。";
      }
    }
    if (kind === "pptx") {
      const header = fileHeader(filePath, 4);
      if (header.length !== 4 || !header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        return "PPTX 不是有效的 OOXML ZIP 文件。";
      }
    }
  } catch {
    return `${kind.toUpperCase()} 文件无法读取。`;
  }
  return "";
}

function readJson(filePath, maximumBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function cleanLocalLinkTarget(rawTarget) {
  let target = String(rawTarget || "").trim().replace(/\\([() ])/g, "$1");
  if (!target || /^https?:/i.test(target)) return "";
  if (/^file:/i.test(target)) {
    try {
      target = decodeURIComponent(new URL(target).pathname);
    } catch {
      return "";
    }
  }
  target = target.replace(/#L\d+(?:C\d+)?$/i, "");
  if (!path.isAbsolute(target)) return "";
  return path.resolve(target);
}

function extractLocalFileLinks(markdown) {
  const source = String(markdown || "");
  const paths = [];
  const seen = new Set();
  const add = (value) => {
    const filePath = cleanLocalLinkTarget(value);
    if (!filePath || seen.has(filePath)) return;
    seen.add(filePath);
    paths.push(filePath);
  };

  const markdownLink = /\[[^\]\r\n]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))(?:\s+["'][^"'\r\n]*["'])?\s*\)/g;
  for (const match of source.matchAll(markdownLink)) add(match[1] || match[2]);

  const codexCitation = /:codex-file-citation\{[^}\r\n]*\bpath=(?:"([^"]+)"|'([^']+)')[^}\r\n]*\}/g;
  for (const match of source.matchAll(codexCitation)) add(match[1] || match[2]);
  return paths;
}

function uniqueLinkedFileByExtension(paths, extensions, label) {
  const matches = paths.filter((filePath) => extensions.has(path.extname(filePath).toLowerCase()));
  if (matches.length !== 1) {
    return {
      ok: false,
      error: matches.length
        ? `最终回复包含 ${matches.length} 个 ${label} 链接，无法确定正式交付文件。`
        : `最终回复缺少可提取的本地 ${label} 文件链接。`
    };
  }
  if (!regularNonemptyFile(matches[0])) {
    return { ok: false, error: `${label} 文件不存在或为空：${matches[0]}` };
  }
  return { ok: true, filePath: matches[0] };
}

function validateBoundFile(binding, expectedPath, label) {
  if (!binding?.path || !binding?.sha256) {
    return `${label} 没有写入 QA receipt 的路径与 SHA-256。`;
  }
  if (!sameFile(binding.path, expectedPath)) {
    return `QA receipt 指向的 ${label} 不是最终回复中的正式文件。`;
  }
  if (!regularNonemptyFile(expectedPath) || sha256File(expectedPath) !== binding.sha256) {
    return `QA receipt 与最终 ${label} 文件哈希不匹配。`;
  }
  return "";
}

function validateReceiptBoundFile(binding, label) {
  if (!binding?.path || !binding?.sha256) {
    return `${label} 没有写入 QA receipt 的路径与 SHA-256。`;
  }
  if (!regularNonemptyFile(binding.path) || sha256File(binding.path) !== binding.sha256) {
    return `${label} 不存在、为空或与 QA receipt 哈希不匹配。`;
  }
  return "";
}

function isRenderedContactSheet(filePath) {
  try {
    const signature = fileHeader(filePath, 8);
    const png = signature.equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    const jpeg = signature[0] === 0xff
      && signature[1] === 0xd8
      && signature[2] === 0xff;
    const pdf = signature.subarray(0, 5).toString("ascii") === "%PDF-"
      && fileTail(filePath, 1_024).toString("latin1").includes("%%EOF");
    return png || jpeg || pdf;
  } catch {
    return false;
  }
}


function validateHtmlStructure(htmlPath, receipt, preserveTemplate) {
  let html;
  try {
    html = fs.readFileSync(htmlPath, "utf8");
  } catch {
    return "HTML Slides 无法读取。";
  }
  const externalResource = externalLocalResourceIn(html);
  if (externalResource) {
    return `HTML 仍依赖本地旁车资源或外部资源（${externalResource}），不是可独立交付的单文件。`;
  }
  const tags = slideElementsIn(html);
  if (!tags.length) return "HTML 没有使用 domi Slides 的 .slide 页面结构。";
  if (tags.some((tag) => !tag.attributes.some((attribute) => /^(?:data-template|data-layout)$/.test(attribute.name) && attribute.value.trim() && attribute.value.trim().toLowerCase() !== "unspecified"))) {
    return "HTML 中有页面缺少 data-template 或 data-layout 声明。";
  }
  if (/\{\{[^{}\r\n]{1,200}\}\}/.test(html)) {
    return "HTML 中仍有未替换的占位符。";
  }
  if (Number(receipt?.pages) !== tags.length) {
    return "QA receipt 页数与最终 HTML 不一致。";
  }
  if (preserveTemplate) return "";

  const inlineStyle = html.match(
    /(<style\b[^>]*\bid=["']domi-slides-style-lock["'][^>]*>)([\s\S]*?)<\/style>/i
  );
  if (inlineStyle) {
    const openingTag = inlineStyle[1];
    const css = inlineStyle[2].trim();
    const declaredHash = openingTag.match(/\bdata-domi-style-sha256=["']([a-f0-9]{64})["']/i)?.[1] || "";
    if (
      !/\bdata-domi-style-lock=["']DOMI_SLIDES_STYLE_LOCK_V1["']/i.test(openingTag)
      || !/\bdata-domi-style-pack=["']morgan-stanley["']/i.test(openingTag)
      || !declaredHash
      || crypto.createHash("sha256").update(css, "utf8").digest("hex") !== declaredHash.toLowerCase()
      || !/--style-pack\s*:\s*["']morgan-stanley["']/i.test(css)
      || !/@page\s*\{[\s\S]*?size\s*:\s*11in\s+8\.5in/i.test(css)
      || !/\.slide\s*\{/i.test(css)
    ) {
      return "HTML 中的 Morgan Stanley 内联 style lock 无效或已被修改。";
    }
    return "";
  }
  return "HTML 缺少可校验的内联 Morgan Stanley style lock。";
}

function validatePptxVisualEvidence(receipt) {
  const pptxSha256 = receipt?.pptx?.sha256 || "";
  const contactSheet = receipt?.pptxContactSheet;
  if (sameFile(contactSheet?.path, receipt?.contactSheet?.path)) {
    return "Slides PPTX contact sheet 必须是独立于 HTML contact sheet 的 PPTX 全页渲染证据。";
  }
  let error = validateReceiptBoundFile(contactSheet, "Slides PPTX contact sheet");
  if (error) return error;
  error = validateReceiptBoundFile({
    path: contactSheet.manifestPath,
    sha256: contactSheet.manifestSha256
  }, "Slides PPTX contact sheet manifest");
  if (error) return error;

  if (!isRenderedContactSheet(contactSheet.path)) {
    return "Slides PPTX contact sheet 不是可核验的 PNG、JPEG 或 PDF 渲染产物。";
  }

  const manifest = readJson(contactSheet.manifestPath, MAX_RECEIPT_BYTES);
  if (
    contactSheet.contractVersion !== "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1"
    || contactSheet.pptxSha256 !== pptxSha256
    || contactSheet.pages !== receipt.pages
    || manifest?.contractVersion !== "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1"
    || manifest?.pptxSha256 !== pptxSha256
    || manifest?.pages !== receipt.pages
    || manifest?.contactSheetSha256 !== contactSheet.sha256
  ) {
    return "Slides PPTX contact sheet 未绑定最终 PPTX 或页数不匹配。";
  }

  const review = receipt?.pptxVisualReview;
  if (
    review?.status !== "passed"
    || review?.pptxSha256 !== pptxSha256
    || review?.contactSheetSha256 !== contactSheet.sha256
    || !Array.isArray(review?.reviewedPages)
    || review.reviewedPages.length !== receipt.pages
    || review.reviewedPages.some((page, index) => page !== index + 1)
    || String(review?.reviewer || "").trim().length < 2
    || String(review?.notes || "").trim().length < 12
  ) {
    return "Slides 缺少覆盖全部页面且绑定最终 PPTX 的独立视觉复核。";
  }
  return "";
}

function validateStrictReceipt(receiptPath, files, preserveTemplate) {
  const receipt = readJson(receiptPath, MAX_RECEIPT_BYTES);
  if (!receipt) return { ok: false, error: "Slides QA receipt 不存在、过大或无法解析。" };
  if (
    receipt.contract !== "DOMI_SLIDES_QA_RECEIPT_V1"
    || receipt.qaVersion !== 4
    || !receipt.fontSummary?.expectedCjkFont
    || receipt.fontSummary?.trueCjkBoldChecked !== true
    || !receipt.fontSummary?.expectedLatinFont
    || !(receipt.fontSummary?.actualRenderedFontsChecked > 0)
    || !Array.isArray(receipt.fontSummary?.renderedMismatches)
    || receipt.fontSummary.renderedMismatches.length !== 0
    || receipt.strict !== true
    || receipt.status !== "passed"
  ) {
    return { ok: false, error: "Slides QA receipt 未通过当前严格质量门。" };
  }
  if (!Number.isInteger(receipt.pages) || receipt.pages <= 0) {
    return { ok: false, error: "Slides QA receipt 没有有效页数。" };
  }
  if (!files.pptx && receipt.pptx) {
    return { ok: false, error: "普通 Slides 请求的 QA receipt 不得残留 PPTX 正式交付绑定。" };
  }
  for (const [kind, label] of [["html", "HTML"], ["pdf", "PDF"], ["pptx", "PPTX"]]) {
    if (!files[kind]) continue;
    const error = validateBoundFile(receipt[kind], files[kind], label);
    if (error) return { ok: false, error };
  }

  const htmlSha256 = receipt.html.sha256;
  const structuralError = validateHtmlStructure(files.html, receipt, preserveTemplate);
  if (structuralError) return { ok: false, error: structuralError };

  if (files.pptx) {
    const pptxEvidenceError = validatePptxVisualEvidence(receipt);
    if (pptxEvidenceError) return { ok: false, error: pptxEvidenceError };
  }

  if (
    receipt.failures !== 0
    || !Array.isArray(receipt.structuralFailures)
    || receipt.structuralFailures.length > 0
    || !Array.isArray(receipt.unresolvedPlaceholders)
    || receipt.unresolvedPlaceholders.length > 0
    || receipt.whitespaceWarnings !== 0
    || receipt.layoutWarnings !== 0
    || receipt.fontFailures !== 0
    || !Array.isArray(receipt.details)
    || receipt.details.length !== receipt.pages
    || receipt.details.some((page, index) => (
      page?.page !== index + 1
      || page?.hasLayoutDeclaration !== true
      || page?.template === "unspecified"
      || page?.overflowX === true
      || page?.overflowY === true
      || !Array.isArray(page?.outOfBounds)
      || page.outOfBounds.length > 0
    ))
  ) {
    return { ok: false, error: "Slides QA receipt 仍含结构、溢出、字体、留白或布局问题。" };
  }

  const contentAudit = receipt.contentAudit;
  if (
    !contentAudit?.path
    || !contentAudit?.sha256
    || !regularNonemptyFile(contentAudit.path)
    || sha256File(contentAudit.path) !== contentAudit.sha256
    || contentAudit.contractVersion !== "DOMI_SLIDES_CONTENT_AUDIT_V1"
    || contentAudit.status !== "passed"
    || contentAudit.htmlSha256 !== htmlSha256
  ) {
    return { ok: false, error: "Slides 内容审计未通过或没有绑定最终 HTML。" };
  }
  const audit = readJson(contentAudit.path, MAX_AUDIT_BYTES);
  if (
    audit?.contractVersion !== "DOMI_SLIDES_CONTENT_AUDIT_V1"
    || audit?.status !== "passed"
    || !Array.isArray(audit?.failures)
    || audit.failures.length > 0
    || !Array.isArray(audit?.warnings)
    || audit.warnings.length > 0
    || !sameFile(audit?.artifacts?.html?.path, files.html)
    || audit?.artifacts?.html?.sha256 !== htmlSha256
  ) {
    return { ok: false, error: "Slides 内容审计文件无效、仍有问题或已过期。" };
  }

  const contactSheet = receipt.contactSheet;
  if (
    !contactSheet?.path
    || !contactSheet?.sha256
    || !regularNonemptyFile(contactSheet.path)
    || sha256File(contactSheet.path) !== contactSheet.sha256
    || contactSheet.contractVersion !== "DOMI_SLIDES_CONTACT_SHEET_V1"
    || contactSheet.htmlSha256 !== htmlSha256
    || contactSheet.pages !== receipt.pages
  ) {
    return { ok: false, error: "Slides contact sheet 不存在、已过期或与最终 HTML 不匹配。" };
  }
  if (!isRenderedContactSheet(contactSheet.path)) {
    return { ok: false, error: "Slides contact sheet 不是可核验的 PNG、JPEG 或 PDF 渲染产物。" };
  }
  const manifest = readJson(contactSheet.manifestPath, MAX_RECEIPT_BYTES);
  if (
    !contactSheet.manifestSha256
    || !manifest
    || sha256File(contactSheet.manifestPath) !== contactSheet.manifestSha256
    || manifest.contractVersion !== "DOMI_SLIDES_CONTACT_SHEET_V1"
    || manifest.htmlSha256 !== htmlSha256
    || manifest.pages !== receipt.pages
    || manifest.contactSheetSha256 !== contactSheet.sha256
  ) {
    return { ok: false, error: "Slides contact sheet manifest 无效或与最终文件不匹配。" };
  }

  const review = receipt.visualReview;
  if (
    review?.status !== "passed"
    || review?.htmlSha256 !== htmlSha256
    || review?.contactSheetSha256 !== contactSheet.sha256
    || !Array.isArray(review?.reviewedPages)
    || review.reviewedPages.length !== receipt.pages
    || review.reviewedPages.some((page, index) => page !== index + 1)
    || String(review?.reviewer || "").trim().length < 2
    || String(review?.notes || "").trim().length < 12
  ) {
    return { ok: false, error: "Slides 缺少与最终 contact sheet 绑定的逐页视觉复核。" };
  }
  const pdfProofError = validatePdfProof(receipt);
  if (pdfProofError) return { ok: false, error: pdfProofError };
  return { ok: true, error: "", receipt, receiptPath };
}

function validateSlidesDeliveryOutput({ output, deliveryPolicy }) {
  const policy = normalizedSlidesDeliveryPolicy(deliveryPolicy);
  if (!policy) return { ok: true, error: "", files: {} };
  const links = extractLocalFileLinks(output);
  const html = uniqueLinkedFileByExtension(links, new Set([".html", ".htm"]), "HTML");
  if (!html.ok) return html;
  const pdf = uniqueLinkedFileByExtension(links, new Set([".pdf"]), "PDF");
  if (!pdf.ok) return pdf;
  const pdfSignatureError = validateDeliverableSignature(pdf.filePath, "pdf");
  if (pdfSignatureError) return { ok: false, error: pdfSignatureError };
  const pptxLinks = links.filter((filePath) => path.extname(filePath).toLowerCase() === ".pptx");
  let pptx = null;
  if (policy.startsWith("explicit_pptx")) {
    const result = uniqueLinkedFileByExtension(links, new Set([".pptx"]), "PPTX");
    if (!result.ok) return result;
    pptx = result.filePath;
    const pptxSignatureError = validateDeliverableSignature(pptx, "pptx");
    if (pptxSignatureError) return { ok: false, error: pptxSignatureError };
  } else if (pptxLinks.length > 0) {
    return { ok: false, error: "普通 Slides 请求不得把 PPTX 列为正式交付文件。" };
  }

  const receiptCandidates = links
    .filter((filePath) => path.extname(filePath).toLowerCase() === ".json")
    .filter((filePath) => readJson(filePath, MAX_RECEIPT_BYTES)?.contract === "DOMI_SLIDES_QA_RECEIPT_V1");
  if (receiptCandidates.length !== 1) {
    return {
      ok: false,
      error: receiptCandidates.length
        ? "最终回复包含多个 Slides QA receipt，无法确定正式验收记录。"
        : "最终回复缺少可提取且可解析的 DOMI_SLIDES_QA_RECEIPT_V1 本地文件链接。"
    };
  }
  const files = { html: html.filePath, pdf: pdf.filePath, ...(pptx ? { pptx } : {}) };
  const receiptValidation = validateStrictReceipt(
    receiptCandidates[0],
    files,
    policy.endsWith("_preserve_template")
  );
  return receiptValidation.ok
    ? { ok: true, error: "", files: { ...files, receipt: receiptCandidates[0] } }
    : receiptValidation;
}

function slidesDeliveryCorrectionPrompt(deliveryPolicy, error) {
  const policy = normalizedSlidesDeliveryPolicy(deliveryPolicy);
  const format = policy === "explicit_pptx_preserve_template"
    ? "保留原模板／母版／主题，并交付同源 HTML、PDF、经过独立全页渲染与逐页复核的可编辑 PPTX 和严格 QA receipt。"
    : policy === "html_pdf_preserve_template"
      ? "保留原模板／母版／主题，并交付同源 HTML、PDF 和严格 QA receipt；不要交付 PPTX。"
    : policy === "explicit_pptx"
      ? "交付 Morgan Stanley 风格的同源 HTML、PDF、经过独立全页渲染与逐页复核的可编辑 PPTX 和严格 QA receipt。"
      : "交付 Morgan Stanley 风格 HTML、由其导出的 PDF 和严格 QA receipt；不要交付 PPTX。";
  return [
    "DOMI_SLIDES_DESKTOP_CORRECTION_V1",
    `上轮结果未通过 domi 桌面端发送前质量门：${error}`,
    "这是唯一一次自动修正机会。不要重新开展研究；复用本任务已有研究与上下文，实际修复最终交付物并重新执行 $domi:slides 的内容审计、严格 QA、contact sheet 与逐页视觉复核。",
    format,
    "最终回复只列出修正后的正式文件，并为每个正式交付物及 DOMI_SLIDES_QA_RECEIPT_V1 提供可提取的绝对本地 Markdown 文件链接。不得只声称完成。"
  ].join("\n");
}

module.exports = {
  extractLocalFileLinks,
  normalizedSlidesDeliveryPolicy,
  slidesDeliveryCorrectionPrompt,
  validateSlidesDeliveryOutput
};
