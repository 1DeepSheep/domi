// Synthetic receipt bindings for unit tests only; not an artifact QA generator.
const fs = require("node:fs");
const crypto = require("node:crypto");
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
module.exports = function addPdfProofFixture(receipt) {
  const sheet = `${receipt.pdf.path}.test-sheet.png`;
  const proof = `${receipt.pdf.path}.test-proof.json`;
  fs.writeFileSync(sheet, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from("independent synthetic PDF render")]));
  const pages = Array.from({ length: receipt.pages }, (_, index) => index + 1);
  fs.writeFileSync(proof, JSON.stringify({ contractVersion: "DOMI_SLIDES_PDF_PROOF_V1", status: "passed", failures: [],
    pdfSha256: receipt.pdf.sha256, htmlSha256: receipt.html.sha256,
    pages: pages.map(page => ({ page, rendered: true, dimensions: [792,612] })),
    fonts: pages.map(page => ({ page, fonts: [{ name: "Calibri", embedded: true }] })),
    contactSheet: { path: sheet, sha256: sha(sheet) } }));
  receipt.pdfProof = { path: proof, sha256: sha(proof) };
  receipt.pdfVisualReview = { status: "passed", reviewer: "Synthetic test", notes: "Synthetic unit fixture, not real visual review", reviewedPages: pages, pdfSha256: receipt.pdf.sha256, contactSheetSha256: sha(sheet) };
};
