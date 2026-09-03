import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractLocalAttachments } from "../src/protocol.js";

import {
  codexInputFor,
  domiInvestmentSlidesPolicyFor,
  domiSlidesCorrectionInputFor,
  domiSlidesDeliveryPolicyFor,
  encodeOutboundAesKey,
  validateDomiSlidesDeliverables,
} from "../src/media.js";

test("Slides clarification answers keep host policy and injected instructions aligned", () => {
  const request = { text: "面向投委会，10 页，沿用原模板", previousDeliveryPolicy: "explicit_pptx_preserve_template", awaitingSlidesInput: true };
  assert.equal(domiSlidesDeliveryPolicyFor(request), "explicit_pptx_preserve_template");
  assert.match(codexInputFor(request), /DOMI_SLIDES_POLICY_V2/);
  assert.match(codexInputFor(request), /额外交付|可编辑/);
  assert.equal(domiSlidesDeliveryPolicyFor({ ...request, awaitingSlidesInput: false }), "");
});

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function inlineMorganStanleyHtml(body = '<section class="slide" data-template="ms-cover-with-findings"></section>') {
  const css = [
    "/* DOMI_SLIDES_STYLE_LOCK_V1 */",
    "@page { size: 11in 8.5in; margin: 0; }",
    ':root { --style-pack: "morgan-stanley"; }',
    ".slide { width: 11in; height: 8.5in; }",
  ].join("\n");
  const cssSha256 = crypto.createHash("sha256").update(css, "utf8").digest("hex");
  return [
    `<style id="domi-slides-style-lock" data-domi-style-lock="DOMI_SLIDES_STYLE_LOCK_V1" data-domi-style-pack="morgan-stanley" data-domi-style-sha256="${cssSha256}">`,
    css,
    "</style>",
    body,
  ].join("\n");
}

function writePassedReceipt(root, artifacts) {
  const htmlSha256 = sha256(artifacts.html);
  const contentAuditPath = path.join(root, "deck.content-audit.json");
  fs.writeFileSync(contentAuditPath, JSON.stringify({
    contractVersion: "DOMI_SLIDES_CONTENT_AUDIT_V1",
    status: "passed",
    failures: [],
    warnings: [],
    artifacts: { html: { path: artifacts.html, sha256: htmlSha256 } },
  }));
  const contactSheetPath = path.join(root, "deck.contact-sheet.png");
  fs.writeFileSync(contactSheetPath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("rendered contact sheet fixture"),
  ]));
  const contactSheetSha256 = sha256(contactSheetPath);
  const contactManifestPath = `${contactSheetPath}.manifest.json`;
  fs.writeFileSync(contactManifestPath, JSON.stringify({
    contractVersion: "DOMI_SLIDES_CONTACT_SHEET_V1",
    htmlSha256,
    pages: 1,
    contactSheetSha256,
  }));
  const receiptPath = path.join(root, "deck.qa-receipt.json");
  const receipt = {
    contract: "DOMI_SLIDES_QA_RECEIPT_V1",
    qaVersion: 3,
    fontSummary: { expectedLatinFont: "Calibri", actualRenderedFontsChecked: 2, renderedMismatches: [] },
    strict: true,
    status: "passed",
    pages: 1,
    failures: 0,
    structuralFailures: [],
    unresolvedPlaceholders: [],
    whitespaceWarnings: 0,
    layoutWarnings: 0,
    fontFailures: 0,
    details: [{
      page: 1,
      template: "ms-cover-with-findings",
      hasLayoutDeclaration: true,
      overflowX: false,
      overflowY: false,
      outOfBounds: [],
    }],
    contentAudit: {
      path: contentAuditPath,
      sha256: sha256(contentAuditPath),
      contractVersion: "DOMI_SLIDES_CONTENT_AUDIT_V1",
      status: "passed",
      htmlSha256,
    },
    contactSheet: {
      path: contactSheetPath,
      sha256: contactSheetSha256,
      manifestPath: contactManifestPath,
      manifestSha256: sha256(contactManifestPath),
      contractVersion: "DOMI_SLIDES_CONTACT_SHEET_V1",
      htmlSha256,
      pages: 1,
    },
    visualReview: {
      status: "passed",
      reviewer: "Codex QA",
      notes: "逐页检查页面布局、字体、表格和来源，结果通过。",
      reviewedPages: [1],
      htmlSha256,
      contactSheetSha256,
    },
  };
  for (const [kind, filePath] of Object.entries(artifacts)) {
    receipt[kind] = { path: filePath, sha256: sha256(filePath) };
  }
  if (artifacts.pptx) {
    const pptxContactSheetPath = path.join(root, "deck-pptx.contact-sheet.png");
    fs.writeFileSync(pptxContactSheetPath, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("rendered PPTX pages fixture"),
    ]));
    const pptxContactSheetSha256 = sha256(pptxContactSheetPath);
    const pptxManifestPath = `${pptxContactSheetPath}.pptx-manifest.json`;
    fs.writeFileSync(pptxManifestPath, JSON.stringify({
      contractVersion: "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1",
      pptxSha256: receipt.pptx.sha256,
      contactSheetSha256: pptxContactSheetSha256,
      pages: 1,
    }));
    receipt.pptxContactSheet = {
      path: pptxContactSheetPath,
      sha256: pptxContactSheetSha256,
      manifestPath: pptxManifestPath,
      manifestSha256: sha256(pptxManifestPath),
      contractVersion: "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1",
      pptxSha256: receipt.pptx.sha256,
      pages: 1,
    };
    receipt.pptxVisualReview = {
      status: "passed",
      reviewer: "Codex QA",
      notes: "逐页检查最终 PPTX 渲染结果、字体和内容，结果通过。",
      reviewedPages: [1],
      pptxSha256: receipt.pptx.sha256,
      contactSheetSha256: pptxContactSheetSha256,
    };
  }
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  return receiptPath;
}

test("outbound Weixin media keys encode the 32-character hex key expected by clients", () => {
  const rawKey = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const encoded = encodeOutboundAesKey(rawKey);

  assert.equal(
    Buffer.from(encoded, "base64").toString("utf8"),
    "00112233445566778899aabbccddeeff",
  );
});

test("outbound Weixin media keys reject invalid AES-128 key lengths", () => {
  assert.throws(() => encodeOutboundAesKey(Buffer.alloc(15)), /有效的加密密钥/);
  assert.throws(() => encodeOutboundAesKey("001122"), /有效的加密密钥/);
});

test("plain PPT requests use the standalone domi Slides HTML and PDF workflow", () => {
  const request = "把三家 H 股 AI 制药公司做成 PPT";
  const policy = domiInvestmentSlidesPolicyFor({ text: request });
  const input = codexInputFor({ text: request, attachments: [] });

  assert.equal(domiSlidesDeliveryPolicyFor({ text: request }), "html_pdf");
  assert.match(policy, /\$domi:slides/);
  assert.match(policy, /investment-banking-slides\.md/);
  assert.match(policy, /Morgan Stanley/);
  assert.match(policy, /HTML 源文件.*PDF/);
  assert.match(policy, /DOMI_SLIDES_STYLE_LOCK_V1/);
  assert.match(policy, /单文件自包含/);
  assert.match(policy, /不得创建或交付 \.pptx/);
  assert.match(input, /DOMI_SLIDES_POLICY_V2/);
  assert.match(input, /用户原始请求：\n把三家 H 股 AI 制药公司做成 PPT/);
});

test("common presentation wording consistently routes through the standalone Slides skill", () => {
  for (const request of ["用 Keynote 做一份公司介绍", "制作路演材料", "做个汇报"]) {
    assert.equal(domiSlidesDeliveryPolicyFor({ text: request }), "html_pdf", request);
    assert.match(codexInputFor({ text: request }), /\$domi:slides/, request);
  }
});

test("only explicit editable PowerPoint requests permit PPTX while keeping domi QA", () => {
  const request = "请给我一份可编辑 PowerPoint 源文件";
  const policy = domiInvestmentSlidesPolicyFor({ text: request });

  assert.equal(domiSlidesDeliveryPolicyFor({ text: request }), "explicit_pptx");
  assert.match(policy, /额外交付 \.pptx/);
  assert.match(policy, /Morgan Stanley/);
  assert.match(policy, /contact sheet/);
  assert.match(policy, /DOMI_SLIDES_PPTX_CONTACT_SHEET_V1/);
  assert.match(policy, /不能复用 HTML contact sheet/);
  assert.doesNotMatch(policy, /不得创建或交付 \.pptx/);
});

test("non-slide domi work is routed while ordinary chat stays unchanged", () => {
  assert.match(
    codexInputFor({ text: "研究一下这家公司", attachments: [] }),
    /DOMI_WECHAT_ROUTING_POLICY_V1[\s\S]*\$domi:desk-research/,
  );
  assert.equal(
    codexInputFor({ text: "你好，随便聊聊今天的安排", attachments: [] }),
    "你好，随便聊聊今天的安排",
  );
  assert.equal(
    domiInvestmentSlidesPolicyFor({ text: "为什么这个 PPT 打不开？" }),
    "",
  );
  assert.match(
    domiInvestmentSlidesPolicyFor({ text: "为什么这个 PPT 这么丑，请修复改进" }),
    /DOMI_SLIDES_POLICY_V2/,
  );
  assert.equal(
    domiInvestmentSlidesPolicyFor({ text: "为什么之前生成的 PPT 这么丑？" }),
    "",
  );
});

test("editing an attached PPTX keeps the domi investment-banking style guard", () => {
  const attachments = [{
    filePath: "/tmp/research.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "file",
  }];
  const input = codexInputFor({ text: "请重新排版", attachments });

  assert.match(input, /额外交付 \.pptx/);
  assert.match(input, /用户通过微信提供了以下本地附件/);
});

test("an attached PPTX may preserve an explicitly requested existing template", () => {
  const attachments = [{ filePath: "/tmp/research.pptx", kind: "file" }];
  const policy = domiInvestmentSlidesPolicyFor({ text: "请修改文字并保持原模板", attachments });
  assert.equal(
    domiSlidesDeliveryPolicyFor({ text: "请修改文字并保持原模板", attachments }),
    "explicit_pptx_preserve_template",
  );
  assert.match(policy, /DOMI_SLIDES_POLICY_V2/);
  assert.match(policy, /不得覆盖原主题/);
  assert.match(policy, /仍必须使用 \$domi:slides/);
});

test("preserving an attached template keeps the hard QA gate without forcing Morgan Stanley theme", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-preserved-deck-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const htmlPath = path.join(root, "deck.html");
  const pdfPath = path.join(root, "deck.pdf");
  const pptxPath = path.join(root, "deck.pptx");
  fs.writeFileSync(
    htmlPath,
    '<style>.slide{color:#111}</style><section class="slide" data-template="original-company-master">content<img alt="logo" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></section>',
  );
  fs.writeFileSync(pdfPath, "%PDF-1.7\npreserved fixture");
  fs.writeFileSync(pptxPath, Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("PPTX preserved fixture"),
  ]));
  const receiptPath = writePassedReceipt(root, {
    html: htmlPath,
    pdf: pdfPath,
    pptx: pptxPath,
  });

  const preservedResult = validateDomiSlidesDeliverables("explicit_pptx_preserve_template", [
    { filePath: htmlPath },
    { filePath: pdfPath },
    { filePath: pptxPath },
    { filePath: receiptPath },
  ]);
  assert.equal(preservedResult.ok, true, preservedResult.error);
  assert.match(
    domiSlidesCorrectionInputFor("explicit_pptx_preserve_template", "模板校验失败"),
    /保留用户现有模板[\s\S]*不得套用 Morgan Stanley 主题[\s\S]*必须把其样式和必要资源内联/,
  );
});

test("the slides delivery gate blocks wrong formats and accepts the required artifacts", () => {
  assert.deepEqual(
    validateDomiSlidesDeliverables("html_pdf", [
      { filePath: "/tmp/deck.pptx" },
    ]),
    { ok: false, error: "普通 PPT 请求不得交付 PPTX。" },
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-ms-deck-"));
  const htmlPath = path.join(root, "deck.html");
  fs.writeFileSync(htmlPath, inlineMorganStanleyHtml());
  const pdfPath = path.join(root, "deck.pdf");
  fs.writeFileSync(pdfPath, "%PDF-1.7\nfixture");
  const receiptPath = writePassedReceipt(root, { html: htmlPath, pdf: pdfPath });
  const htmlPdfResult = validateDomiSlidesDeliverables("html_pdf", [
    { filePath: htmlPath },
    { filePath: pdfPath },
    { filePath: receiptPath },
  ]);
  assert.equal(htmlPdfResult.ok, true, htmlPdfResult.error);
  const passedReceipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  passedReceipt.visualReview.status = "pending";
  fs.writeFileSync(receiptPath, JSON.stringify(passedReceipt));
  assert.match(validateDomiSlidesDeliverables("html_pdf", [
    { filePath: htmlPath },
    { filePath: pdfPath },
    { filePath: receiptPath },
  ]).error, /显式 contact sheet 视觉复核/);
  const pptxPath = path.join(root, "deck.pptx");
  fs.writeFileSync(pptxPath, Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("PPTX fixture"),
  ]));
  const explicitReceiptPath = writePassedReceipt(root, {
    html: htmlPath,
    pdf: pdfPath,
    pptx: pptxPath,
  });
  assert.equal(
    validateDomiSlidesDeliverables("explicit_pptx", [
      { filePath: htmlPath },
      { filePath: pdfPath },
      { filePath: pptxPath },
      { filePath: explicitReceiptPath },
    ]).ok,
    true,
  );
  const htmlOnlyProof = JSON.parse(fs.readFileSync(explicitReceiptPath, "utf8"));
  delete htmlOnlyProof.pptxContactSheet;
  delete htmlOnlyProof.pptxVisualReview;
  fs.writeFileSync(explicitReceiptPath, JSON.stringify(htmlOnlyProof));
  assert.match(
    validateDomiSlidesDeliverables("explicit_pptx", [
      { filePath: htmlPath },
      { filePath: pdfPath },
      { filePath: pptxPath },
      { filePath: explicitReceiptPath },
    ]).error,
    /PPTX contact sheet/,
  );
  const invalidPageReceiptPath = writePassedReceipt(root, {
    html: htmlPath,
    pdf: pdfPath,
    pptx: pptxPath,
  });
  const invalidPageReceipt = JSON.parse(fs.readFileSync(invalidPageReceiptPath, "utf8"));
  invalidPageReceipt.pages = 0;
  fs.writeFileSync(invalidPageReceiptPath, JSON.stringify(invalidPageReceipt));
  assert.match(
    validateDomiSlidesDeliverables("explicit_pptx", [
      { filePath: htmlPath },
      { filePath: pdfPath },
      { filePath: pptxPath },
      { filePath: invalidPageReceiptPath },
    ]).error,
    /未通过严格质量门/,
  );
  assert.match(
    validateDomiSlidesDeliverables("explicit_pptx", [
      { filePath: pptxPath },
      { filePath: explicitReceiptPath },
    ]).error,
    /不能只交 PPTX/,
  );
  fs.rmSync(root, { recursive: true, force: true });
  assert.match(
    domiSlidesCorrectionInputFor("html_pdf", "缺少 PDF"),
    /不得创建或交付 \.pptx/,
  );
});

test("the slides delivery gate rejects generic HTML even when a PDF exists", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-generic-deck-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const htmlPath = path.join(root, "deck.html");
  const pdfPath = path.join(root, "deck.pdf");
  fs.writeFileSync(htmlPath, '<section class="slide">generic</section>');
  fs.writeFileSync(pdfPath, "%PDF-1.7\nfixture");

  const result = validateDomiSlidesDeliverables("html_pdf", [
    { filePath: htmlPath },
    { filePath: pdfPath },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /缺少可校验的内联 Morgan Stanley style lock/);
});

test("the slides delivery gate rejects fake PDF and PPTX files even when receipt hashes match", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-fake-slides-files-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const htmlPath = path.join(root, "deck.html");
  const pdfPath = path.join(root, "deck.pdf");
  const pptxPath = path.join(root, "deck.pptx");
  fs.writeFileSync(htmlPath, inlineMorganStanleyHtml());
  fs.writeFileSync(pdfPath, "not really a PDF");
  let receiptPath = writePassedReceipt(root, { html: htmlPath, pdf: pdfPath });
  assert.match(validateDomiSlidesDeliverables("html_pdf", [
    { filePath: htmlPath },
    { filePath: pdfPath },
    { filePath: receiptPath },
  ]).error, /PDF 文件签名无效/);

  fs.writeFileSync(pdfPath, "%PDF-1.7\nfixture");
  fs.writeFileSync(pptxPath, "not really a PPTX ZIP");
  receiptPath = writePassedReceipt(root, { html: htmlPath, pdf: pdfPath, pptx: pptxPath });
  assert.match(validateDomiSlidesDeliverables("explicit_pptx", [
    { filePath: htmlPath },
    { filePath: pdfPath },
    { filePath: pptxPath },
    { filePath: receiptPath },
  ]).error, /PPTX 文件签名无效/);
});

test("the slides delivery gate verifies the inline style-lock hash", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-style-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const htmlPath = path.join(root, "deck.html");
  const pdfPath = path.join(root, "deck.pdf");
  fs.writeFileSync(htmlPath, inlineMorganStanleyHtml().replace("width: 11in", "width: 10in"));
  fs.writeFileSync(pdfPath, "%PDF-1.7\nfixture");

  const result = validateDomiSlidesDeliverables("html_pdf", [
    { filePath: htmlPath },
    { filePath: pdfPath },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /style lock 哈希不匹配/);
});

test("the slides delivery gate rejects local sidecar resources for default and preserved templates", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-slides-sidecar-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pdfPath = path.join(root, "deck.pdf");
  const pptxPath = path.join(root, "deck.pptx");
  fs.writeFileSync(pdfPath, "%PDF-1.7\nfixture");
  fs.writeFileSync(pptxPath, Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("PPTX fixture"),
  ]));

  const defaultHtmlPath = path.join(root, "default.html");
  fs.writeFileSync(
    defaultHtmlPath,
    `${inlineMorganStanleyHtml()}\n<link rel="stylesheet" href="./style.css">`,
  );
  assert.match(validateDomiSlidesDeliverables("html_pdf", [
    { filePath: defaultHtmlPath },
    { filePath: pdfPath },
  ]).error, /仍依赖外部或本地资源/);

  const preservedHtmlPath = path.join(root, "preserved.html");
  fs.writeFileSync(
    preservedHtmlPath,
    '<style>.slide { color: black; }</style><section class="slide"><img src="./logo.png"></section>',
  );
  assert.match(validateDomiSlidesDeliverables("explicit_pptx_preserve_template", [
    { filePath: preservedHtmlPath },
    { filePath: pdfPath },
    { filePath: pptxPath },
  ]).error, /\.\/logo\.png/);
});

test("the slides delivery gate rejects network, protocol-relative and blob resources", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-slides-external-resource-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pdfPath = path.join(root, "deck.pdf");
  const pptxPath = path.join(root, "deck.pptx");
  fs.writeFileSync(pdfPath, "%PDF-1.7\nfixture");
  fs.writeFileSync(pptxPath, Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("PPTX fixture"),
  ]));

  const cases = [
    ["https", '<section class="slide"><img src="https://cdn.example.com/chart.png"></section>'],
    ["protocol-relative", '<section class="slide"><script src="//cdn.example.com/chart.js"></script></section>'],
    ["blob", '<style>.slide{background-image:url("blob:deck-chart")}</style><section class="slide"></section>'],
    ["unquoted", '<section class=slide><img src=https://example.test/chart.png></section>'],
    ["unquoted-css", '<section class=slide><link rel=stylesheet href=./style.css></section>'],
    ["srcset", '<section class=slide><img src="data:image/png;base64,AAA" srcset="https://example.test/chart.png 2x"></section>'],
    ["xlink", '<section class=slide><svg><use xlink:href="https://example.test/icons.svg#chart"></use></svg></section>'],
    ["poster", '<section class=slide><video src="data:video/mp4;base64,AAA" poster="https://example.test/poster.png"></video></section>'],
  ];
  for (const [name, html] of cases) {
    const htmlPath = path.join(root, `${name}.html`);
    fs.writeFileSync(htmlPath, html);
    const result = validateDomiSlidesDeliverables("explicit_pptx_preserve_template", [
      { filePath: htmlPath },
      { filePath: pdfPath },
      { filePath: pptxPath },
    ]);
    assert.equal(result.ok, false, name);
    assert.match(result.error, /仍依赖外部或本地资源/, name);
  }
});

test("WeChat edits inherit Slides only for contextual revision and honor format negation", () => {
  for (const text of ["这页删掉", "这两页可以去掉", "这页也可以删掉", "把第2页改一下", "标题改短一些", "请修改", "请更新", "按上面的要求改一下"]) {
    assert.equal(domiSlidesDeliveryPolicyFor({ text, previousDeliveryPolicy: "html_pdf" }), "html_pdf");
    assert.match(codexInputFor({ text, previousDeliveryPolicy: "html_pdf" }), /DOMI_SLIDES_POLICY_V2/);
    assert.equal(domiSlidesDeliveryPolicyFor({ text }), "");
  }
  for (const text of [
    "PPT 是什么？", "怎么制作 PPT？", "为什么修改 PPT 后文字溢出了？",
    "帮我打开之前做的 slides", "把上次生成的 slides 发给我",
    "请检查 slides 的排版", "不要生成 slides，只分析报告",
    "修复 PPT 生成失败的问题", "创建一个做 slides 的 Skill", "研究另一家公司", "请修改我的Skill", "请修改代码",
  ]) {
    assert.equal(domiSlidesDeliveryPolicyFor({ text, previousDeliveryPolicy: "html_pdf" }), "", text);
    assert.doesNotMatch(codexInputFor({ text, previousDeliveryPolicy: "html_pdf" }), /DOMI_SLIDES_POLICY_V2/, text);
  }
  assert.equal(domiSlidesDeliveryPolicyFor({ text: "请做 slides，不要 PPTX" }), "html_pdf");
  assert.equal(domiSlidesDeliveryPolicyFor({ text: "请做 slides，别用 PPTX" }), "html_pdf");
  assert.equal(domiSlidesDeliveryPolicyFor({ text: "不要 PPTX，只要 PDF", previousDeliveryPolicy: "explicit_pptx" }), "html_pdf");
  assert.equal(domiSlidesDeliveryPolicyFor({ text: "请修改 slides，保留原模板" }), "html_pdf_preserve_template");
  assert.equal(domiSlidesDeliveryPolicyFor({ text: "请修改第二页，保留原有模板", attachments: [{ filePath: "/tmp/deck.pptx" }] }), "explicit_pptx_preserve_template");
});

test("live WeChat extraction includes the fourth PPTX QA artifact instead of truncating it", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-slides-four-artifacts-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifacts = { html: path.join(root, "deck.html"), pdf: path.join(root, "deck.pdf"), pptx: path.join(root, "deck.pptx") };
  fs.writeFileSync(artifacts.html, inlineMorganStanleyHtml());
  fs.writeFileSync(artifacts.pdf, "%PDF-1.7\nfixture\n%%EOF\n");
  fs.writeFileSync(artifacts.pptx, Buffer.from("PK\u0003\u0004PPTX fixture"));
  const receipt = writePassedReceipt(root, artifacts);
  const links = Object.entries(artifacts).map(([kind, file]) => `[${kind}](<${file}>)`).join("\n");
  for (const receiptLink of [`[QA](<${receipt}>)`, `\`${receipt}\``, `:codex-file-citation{path="${receipt}"}`]) {
    const extracted = extractLocalAttachments(`${links}\n${receiptLink}`, 16, { includeJson: true });
    assert.equal(extracted.length, 4);
    assert.equal(validateDomiSlidesDeliverables("explicit_pptx", extracted).ok, true);
  }
  const source = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(source, /extractLocalAttachments\(response, job\.slidesDeliveryPolicy \? 16 : 3/);
  assert.match(source, /includeJson: Boolean\(job\.slidesDeliveryPolicy\)/);
  assert.match(source, /wantsFiles: Boolean\(slidesDeliveryPolicy\) \|\| wantsFileDelivery\(inputText\)/);
  assert.match(source, /status: "correcting"/);
  assert.match(source, /status: "quality_failed"/);
  assert.match(source, /task\.delivery\.slidesQaPassed = true;[\s\S]*sendLocalAttachment\(/);
});

test("a preserved HTML template passes without PPTX and unvalidated duplicate deliverables are rejected", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-preserved-html-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const htmlPath = path.join(root, "deck.html");
  const pdfPath = path.join(root, "deck.pdf");
  fs.writeFileSync(htmlPath, '<div class=slide data-layout=company-template><img srcset="data:image/png;base64,AAA 1x, data:image/png;base64,BBB 2x"></div>');
  fs.writeFileSync(pdfPath, "%PDF-1.7\nfixture\n%%EOF\n");
  const receiptPath = writePassedReceipt(root, { html: htmlPath, pdf: pdfPath });
  const attachments = [{ filePath: htmlPath }, { filePath: pdfPath }, { filePath: receiptPath }];
  assert.equal(validateDomiSlidesDeliverables("html_pdf_preserve_template", attachments).ok, true);
  assert.match(validateDomiSlidesDeliverables("html_pdf", attachments).error, /Morgan Stanley/);
  assert.match(validateDomiSlidesDeliverables("html_pdf_preserve_template", [...attachments, { filePath: path.join(root, "unreviewed.pdf") }]).error, /多个同格式/);
});
