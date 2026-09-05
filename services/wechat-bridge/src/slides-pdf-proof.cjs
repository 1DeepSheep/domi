const fs = require("node:fs");
const crypto = require("node:crypto");

function bound(binding) {
  try {
    if (!binding?.path || !binding?.sha256) return false;
    const stat = fs.statSync(binding.path);
    return stat.isFile() && stat.size > 0 && stat.size < 64 * 1024 * 1024
      && crypto.createHash("sha256").update(fs.readFileSync(binding.path)).digest("hex") === binding.sha256;
  } catch { return false; }
}

function validatePdfProof(receipt) {
  try {
    if (!bound(receipt.pdfProof)) return "缺少最终 PDF 的字体与全页渲染检查，或检查文件已变化。";
    const proof = JSON.parse(fs.readFileSync(receipt.pdfProof.path, "utf8"));
    const allPages = (pages) => Array.isArray(pages) && pages.length === receipt.pages && pages.every((page, index) => page === index + 1);
    if (proof.contractVersion !== "DOMI_SLIDES_PDF_PROOF_V1" || proof.status !== "passed"
      || proof.pdfSha256 !== receipt.pdf?.sha256 || proof.htmlSha256 !== receipt.html?.sha256
      || !Array.isArray(proof.failures) || proof.failures.length || !bound(proof.contactSheet)
      || !fs.readFileSync(proof.contactSheet.path).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      || proof.contactSheet.sha256 === receipt.contactSheet?.sha256
      || !allPages(proof.pages?.map((page) => page.page)) || proof.pages.some((page) => page.rendered !== true)
      || !allPages(proof.fonts?.map((page) => page.page))
      || proof.fonts.some((page) => !Array.isArray(page.fonts) || !page.fonts.length || page.fonts.some((font) => font.embedded !== true))) {
      return "最终 PDF 的字体、页数或独立渲染证据未通过检查。";
    }
    const review = receipt.pdfVisualReview;
    if (review?.status !== "passed" || review.pdfSha256 !== receipt.pdf.sha256
      || review.contactSheetSha256 !== proof.contactSheet.sha256 || !allPages(review.reviewedPages)
      || typeof review.reviewer !== "string" || review.reviewer.trim().length < 2
      || typeof review.notes !== "string" || review.notes.trim().length < 12) {
      return "最终 PDF 尚未完成独立逐页视觉复核。";
    }
    return "";
  } catch { return "最终 PDF 检查记录无法读取。"; }
}
module.exports = { validatePdfProof };
