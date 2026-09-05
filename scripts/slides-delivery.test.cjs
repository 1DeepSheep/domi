const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  extractLocalFileLinks,
  slidesDeliveryCorrectionPrompt,
  validateSlidesDeliveryOutput
} = require("../electron/slides-delivery.cjs");
const { isSlidesInputRequest } = require("../services/wechat-bridge/src/slides-response-policy.cjs");

test("Slides input clarification is not a successful artifact delivery or a broken-file bypass", () => {
  for (const output of [
    "尚未收到项目材料，请先上传报告或底稿，收到后我再整理 slides。",
    "请先确认汇报的受众与目标；确认后我再制作。",
    "缺少原始文件，请先上传 research.pdf，收到后继续。",
    "Please provide the source material before I can prepare the deck.",
  ]) {
    assert.equal(isSlidesInputRequest(output), true, output);
    assert.equal(validateSlidesDeliveryOutput({ output, deliveryPolicy: "html_pdf" }).ok, false);
  }
  for (const output of [
    "Slides 已完成，请先确认受众。",
    "已生成报告；缺少材料，请先补充。",
    "缺少源文件，请先确认：[PDF](/missing.pdf)",
    "请先补充材料。这是文件 /tmp/draft.html。",
    "请先补充材料：:codex-file-citation{path=\"/tmp/deck.pdf\"}",
    "我的研究结论是市场还有增长空间。",
  ]) assert.equal(isSlidesInputRequest(output), false, output);
});

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function linked(filePath, label = path.basename(filePath)) {
  return `[${label}](<${filePath}>)`;
}

function createDeliveryFixture({ preserveTemplate = false, pptx = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-slides-delivery-"));
  const htmlPath = path.join(root, "Investment Review.html");
  const pdfPath = path.join(root, "Investment Review.pdf");
  const pptxPath = path.join(root, "Investment Review.pptx");
  const auditPath = path.join(root, "content-audit.json");
  const contactSheetPath = path.join(root, "contact-sheet.png");
  const manifestPath = `${contactSheetPath}.manifest.json`;
  const pptxContactSheetPath = path.join(root, "pptx-contact-sheet.png");
  const pptxManifestPath = `${pptxContactSheetPath}.pptx-manifest.json`;
  const receiptPath = path.join(root, "Investment Review.qa-receipt.json");

  const css = [
    ':root { --style-pack: "morgan-stanley"; --ink: #102a43; }',
    "@page { size: 11in 8.5in; margin: 0; }",
    ".slide { width: 11in; height: 8.5in; }"
  ].join("\n");
  const style = preserveTemplate
    ? "<style>:root { --client-template: preserved; }</style>"
    : `<style id="domi-slides-style-lock" data-domi-style-lock="DOMI_SLIDES_STYLE_LOCK_V1" data-domi-style-pack="morgan-stanley" data-domi-style-sha256="${crypto.createHash("sha256").update(css, "utf8").digest("hex")}">\n${css}\n</style>`;
  fs.writeFileSync(htmlPath, [
    "<!doctype html><html><head>",
    style,
    "</head><body>",
    '<section class="slide cover" data-template="ms-cover-with-findings"><div class="content">Cover</div></section>',
    '<section class="slide" data-layout="ms-left-data-right-analysis"><div class="content">Analysis</div></section>',
    "</body></html>"
  ].join("\n"));
  fs.writeFileSync(pdfPath, "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "latin1");
  if (pptx) {
    fs.writeFileSync(pptxPath, Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("ppt/presentation.xml\0[Content_Types].xml")
    ]));
    fs.writeFileSync(
      pptxContactSheetPath,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    );
  }
  fs.writeFileSync(
    contactSheetPath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  );

  const htmlSha256 = sha256File(htmlPath);
  writeJson(auditPath, {
    contractVersion: "DOMI_SLIDES_CONTENT_AUDIT_V1",
    status: "passed",
    failures: [],
    warnings: [],
    artifacts: {
      html: { path: htmlPath, sha256: htmlSha256 }
    }
  });
  writeJson(manifestPath, {
    contractVersion: "DOMI_SLIDES_CONTACT_SHEET_V1",
    htmlSha256,
    pages: 2,
    contactSheetSha256: sha256File(contactSheetPath)
  });
  if (pptx) {
    writeJson(pptxManifestPath, {
      contractVersion: "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1",
      pptxSha256: sha256File(pptxPath),
      pages: 2,
      contactSheetSha256: sha256File(pptxContactSheetPath)
    });
  }

  const receipt = {
    contract: "DOMI_SLIDES_QA_RECEIPT_V1",
    qaVersion: 4,
    fontSummary: { expectedCjkFont: "Kaiti SC", trueCjkBoldChecked: true, expectedLatinFont: "Calibri", actualRenderedFontsChecked: 2, renderedMismatches: [] },
    strict: true,
    status: "passed",
    html: { path: htmlPath, sha256: htmlSha256 },
    pdf: { path: pdfPath, sha256: sha256File(pdfPath) },
    ...(pptx ? { pptx: { path: pptxPath, sha256: sha256File(pptxPath) } } : {}),
    contentAudit: {
      path: auditPath,
      sha256: sha256File(auditPath),
      contractVersion: "DOMI_SLIDES_CONTENT_AUDIT_V1",
      status: "passed",
      htmlSha256
    },
    contactSheet: {
      path: contactSheetPath,
      sha256: sha256File(contactSheetPath),
      manifestPath,
      manifestSha256: sha256File(manifestPath),
      contractVersion: "DOMI_SLIDES_CONTACT_SHEET_V1",
      htmlSha256,
      pages: 2
    },
    visualReview: {
      status: "passed",
      reviewer: "Codex QA",
      notes: "逐页检查了标题、密度、字体、边界和整体阅读顺序。",
      reviewedPages: [1, 2],
      htmlSha256,
      contactSheetSha256: sha256File(contactSheetPath),
      failures: []
    },
    ...(pptx ? {
      pptxContactSheet: {
        path: pptxContactSheetPath,
        sha256: sha256File(pptxContactSheetPath),
        manifestPath: pptxManifestPath,
        manifestSha256: sha256File(pptxManifestPath),
        contractVersion: "DOMI_SLIDES_PPTX_CONTACT_SHEET_V1",
        pptxSha256: sha256File(pptxPath),
        pages: 2
      },
      pptxVisualReview: {
        status: "passed",
        reviewer: "Codex QA",
        notes: "逐页检查最终 PPTX 渲染的字体、换行、边界和元素位置。",
        reviewedPages: [1, 2],
        pptxSha256: sha256File(pptxPath),
        contactSheetSha256: sha256File(pptxContactSheetPath)
      }
    } : {}),
    pages: 2,
    failures: 0,
    structuralFailures: [],
    unresolvedPlaceholders: [],
    whitespaceWarnings: 0,
    layoutWarnings: 0,
    fontFailures: 0,
    details: [
      {
        page: 1,
        template: "ms-cover-with-findings",
        hasLayoutDeclaration: true,
        overflowX: false,
        overflowY: false,
        outOfBounds: []
      },
      {
        page: 2,
        template: "ms-left-data-right-analysis",
        hasLayoutDeclaration: true,
        overflowX: false,
        overflowY: false,
        outOfBounds: []
      }
    ]
  };
  require("./slides-proof-fixture.cjs")(receipt);
  writeJson(receiptPath, receipt);

  const output = [
    linked(htmlPath, "HTML"),
    linked(pdfPath, "PDF"),
    ...(pptx ? [linked(pptxPath, "PPTX")] : []),
    linked(receiptPath, "QA receipt")
  ].join("\n");
  return {
    root,
    htmlPath,
    pdfPath,
    pptxPath,
    receiptPath,
    output,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}

test("accepts a hash-bound HTML/PDF delivery with strict QA and Morgan Stanley style lock", () => {
  const fixture = createDeliveryFixture();
  try {
    assert.deepEqual(validateSlidesDeliveryOutput({
      output: fixture.output,
      deliveryPolicy: "html_pdf"
    }), {
      ok: true,
      error: "",
      files: {
        html: fixture.htmlPath,
        pdf: fixture.pdfPath,
        receipt: fixture.receiptPath
      }
    });
  } finally {
    fixture.cleanup();
  }
});

test("requires and verifies PPTX only for an explicit editable PowerPoint delivery", () => {
  const fixture = createDeliveryFixture({ pptx: true });
  try {
    assert.equal(validateSlidesDeliveryOutput({
      output: fixture.output,
      deliveryPolicy: "explicit_pptx"
    }).ok, true);
    assert.match(validateSlidesDeliveryOutput({
      output: fixture.output,
      deliveryPolicy: "html_pdf"
    }).error, /不得把 PPTX/);

    const withoutPptxLink = fixture.output
      .split("\n")
      .filter((line) => !line.includes("PPTX"))
      .join("\n");
    assert.match(validateSlidesDeliveryOutput({
      output: withoutPptxLink,
      deliveryPolicy: "explicit_pptx"
    }).error, /缺少.*PPTX/);

    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    delete receipt.pptxContactSheet;
    delete receipt.pptxVisualReview;
    writeJson(fixture.receiptPath, receipt);
    assert.match(validateSlidesDeliveryOutput({
      output: fixture.output,
      deliveryPolicy: "explicit_pptx"
    }).error, /PPTX contact sheet/);
  } finally {
    fixture.cleanup();
  }
});

test("PPTX delivery requires independent rendered evidence bound to the exact file", () => {
  const staleRender = createDeliveryFixture({ pptx: true });
  try {
    const receipt = JSON.parse(fs.readFileSync(staleRender.receiptPath, "utf8"));
    fs.appendFileSync(receipt.pptxContactSheet.path, "changed after review");
    assert.match(validateSlidesDeliveryOutput({
      output: staleRender.output,
      deliveryPolicy: "explicit_pptx"
    }).error, /PPTX contact sheet.*哈希不匹配/);
  } finally {
    staleRender.cleanup();
  }

  const reusedHtmlRender = createDeliveryFixture({ pptx: true });
  try {
    const receipt = JSON.parse(fs.readFileSync(reusedHtmlRender.receiptPath, "utf8"));
    receipt.pptxContactSheet.path = receipt.contactSheet.path;
    receipt.pptxContactSheet.sha256 = receipt.contactSheet.sha256;
    writeJson(reusedHtmlRender.receiptPath, receipt);
    assert.match(validateSlidesDeliveryOutput({
      output: reusedHtmlRender.output,
      deliveryPolicy: "explicit_pptx"
    }).error, /独立.*PPTX 全页渲染/);
  } finally {
    reusedHtmlRender.cleanup();
  }

  const mismatchedReview = createDeliveryFixture({ pptx: true });
  try {
    const receipt = JSON.parse(fs.readFileSync(mismatchedReview.receiptPath, "utf8"));
    receipt.pptxVisualReview.pptxSha256 = "0".repeat(64);
    writeJson(mismatchedReview.receiptPath, receipt);
    assert.match(validateSlidesDeliveryOutput({
      output: mismatchedReview.output,
      deliveryPolicy: "explicit_pptx"
    }).error, /独立视觉复核/);
  } finally {
    mismatchedReview.cleanup();
  }
});

test("preserve-template is the only policy allowed to skip the Morgan Stanley style lock", () => {
  const fixture = createDeliveryFixture({ preserveTemplate: true, pptx: true });
  try {
    assert.equal(validateSlidesDeliveryOutput({
      output: fixture.output,
      deliveryPolicy: "explicit_pptx_preserve_template"
    }).ok, true);
    assert.match(validateSlidesDeliveryOutput({
      output: fixture.output,
      deliveryPolicy: "explicit_pptx"
    }).error, /Morgan Stanley/);
  } finally {
    fixture.cleanup();
  }
});

test("fails closed when a delivered artifact changed after QA", () => {
  const fixture = createDeliveryFixture();
  try {
    fs.appendFileSync(fixture.pdfPath, "changed after QA");
    assert.match(validateSlidesDeliveryOutput({
      output: fixture.output,
      deliveryPolicy: "html_pdf"
    }).error, /PDF 文件哈希不匹配/);
  } finally {
    fixture.cleanup();
  }
});

test("legacy declaration-only receipts and missing actual-font checks fail closed", () => {
  for (const update of [
    (receipt) => { receipt.qaVersion = 2; },
    (receipt) => { delete receipt.fontSummary; },
    (receipt) => { delete receipt.fontSummary.expectedCjkFont; },
    (receipt) => { delete receipt.fontSummary.trueCjkBoldChecked; },
    (receipt) => { delete receipt.pdfProof; },
    (receipt) => { delete receipt.pdfVisualReview; },
    (receipt) => { receipt.pdfVisualReview.reviewedPages = [1]; },
    (receipt) => { receipt.pdfVisualReview.pdfSha256 = "stale"; },
    (receipt) => { fs.appendFileSync(receipt.pdfProof.path, "tampered"); },
    (receipt) => { receipt.fontSummary.actualRenderedFontsChecked = 0; },
    (receipt) => { receipt.fontSummary.renderedMismatches = [{ actualFonts: ["Kaiti SC"], expected: "Calibri" }]; },
  ]) {
    const fixture = createDeliveryFixture();
    try {
      const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
      update(receipt);
      writeJson(fixture.receiptPath, receipt);
      assert.equal(validateSlidesDeliveryOutput({ output: fixture.output, deliveryPolicy: "html_pdf" }).ok, false);
    } finally { fixture.cleanup(); }
  }
});

test("fails closed for invalid file signatures, warnings, placeholders, and ambiguous links", () => {
  const invalidPdf = createDeliveryFixture();
  try {
    fs.writeFileSync(invalidPdf.pdfPath, "not actually a PDF");
    assert.match(validateSlidesDeliveryOutput({
      output: invalidPdf.output,
      deliveryPolicy: "html_pdf"
    }).error, /PDF 文件头无效/);
  } finally {
    invalidPdf.cleanup();
  }

  const warned = createDeliveryFixture();
  try {
    const receipt = JSON.parse(fs.readFileSync(warned.receiptPath, "utf8"));
    receipt.whitespaceWarnings = 1;
    writeJson(warned.receiptPath, receipt);
    assert.match(validateSlidesDeliveryOutput({
      output: warned.output,
      deliveryPolicy: "html_pdf"
    }).error, /布局问题/);
  } finally {
    warned.cleanup();
  }

  const placeholder = createDeliveryFixture();
  try {
    fs.appendFileSync(placeholder.htmlPath, "{{UNRESOLVED}}");
    const receipt = JSON.parse(fs.readFileSync(placeholder.receiptPath, "utf8"));
    receipt.html.sha256 = sha256File(placeholder.htmlPath);
    writeJson(placeholder.receiptPath, receipt);
    assert.match(validateSlidesDeliveryOutput({
      output: placeholder.output,
      deliveryPolicy: "html_pdf"
    }).error, /占位符/);
  } finally {
    placeholder.cleanup();
  }

  const ambiguous = createDeliveryFixture();
  try {
    const duplicatePdf = path.join(ambiguous.root, "duplicate.pdf");
    fs.copyFileSync(ambiguous.pdfPath, duplicatePdf);
    assert.match(validateSlidesDeliveryOutput({
      output: `${ambiguous.output}\n${linked(duplicatePdf)}`,
      deliveryPolicy: "html_pdf"
    }).error, /2 个 PDF/);
  } finally {
    ambiguous.cleanup();
  }
});

test("rejects local and remote HTML resources and permits preserve-template only when self-contained", () => {
  const localImage = createDeliveryFixture({ preserveTemplate: true, pptx: true });
  try {
    fs.appendFileSync(localImage.htmlPath, '<img src="./screenshots/page-1.png">');
    const receipt = JSON.parse(fs.readFileSync(localImage.receiptPath, "utf8"));
    receipt.html.sha256 = sha256File(localImage.htmlPath);
    writeJson(localImage.receiptPath, receipt);
    assert.match(validateSlidesDeliveryOutput({
      output: localImage.output,
      deliveryPolicy: "explicit_pptx_preserve_template"
    }).error, /本地旁车资源/);
  } finally {
    localImage.cleanup();
  }

  const importedCss = createDeliveryFixture();
  try {
    fs.appendFileSync(importedCss.htmlPath, '<style>@import "./theme.css";</style>');
    const receipt = JSON.parse(fs.readFileSync(importedCss.receiptPath, "utf8"));
    receipt.html.sha256 = sha256File(importedCss.htmlPath);
    writeJson(importedCss.receiptPath, receipt);
    assert.match(validateSlidesDeliveryOutput({
      output: importedCss.output,
      deliveryPolicy: "html_pdf"
    }).error, /CSS @import/);
  } finally {
    importedCss.cleanup();
  }

  for (const source of [
    "https://cdn.example.com/hero.png",
    "blob:https://example.com/deck-asset"
  ]) {
    const remoteAsset = createDeliveryFixture({ preserveTemplate: true, pptx: true });
    try {
      fs.appendFileSync(remoteAsset.htmlPath, `<img src="${source}">`);
      const receipt = JSON.parse(fs.readFileSync(remoteAsset.receiptPath, "utf8"));
      receipt.html.sha256 = sha256File(remoteAsset.htmlPath);
      writeJson(remoteAsset.receiptPath, receipt);
      assert.match(validateSlidesDeliveryOutput({
        output: remoteAsset.output,
        deliveryPolicy: "explicit_pptx_preserve_template"
      }).error, /外部资源/);
    } finally {
      remoteAsset.cleanup();
    }
  }
});

test("desktop self-contained gate rejects unquoted, srcset and secondary resources", () => {
  for (const html of [
    "<img src=https://example.test/chart.png>",
    "<link rel=stylesheet href=./style.css>",
    '<img src="data:image/png;base64,AAA" srcset="https://example.test/chart.png 2x">',
    '<svg><use xlink:href="https://example.test/icons.svg#chart"></use></svg>',
    '<video src="data:video/mp4;base64,AAA" poster="https://example.test/poster.png"></video>',
  ]) {
    const fixture = createDeliveryFixture({ preserveTemplate: true });
    try {
      fs.appendFileSync(fixture.htmlPath, html);
      const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
      receipt.html.sha256 = sha256File(fixture.htmlPath);
      writeJson(fixture.receiptPath, receipt);
      assert.match(validateSlidesDeliveryOutput({ output: fixture.output, deliveryPolicy: "html_pdf_preserve_template" }).error, /外部资源/, html);
    } finally {
      fixture.cleanup();
    }
  }
});

test("preserving HTML-only slides keeps the QA gate without forcing PPTX", () => {
  const fixture = createDeliveryFixture({ preserveTemplate: true });
  try {
    assert.equal(validateSlidesDeliveryOutput({ output: fixture.output, deliveryPolicy: "html_pdf_preserve_template" }).ok, true);
    assert.match(validateSlidesDeliveryOutput({ output: fixture.output, deliveryPolicy: "html_pdf" }).error, /Morgan Stanley/);
  } finally {
    fixture.cleanup();
  }
});

test("extracts only absolute local links and emits one bounded correction contract", () => {
  const paths = extractLocalFileLinks([
    "[absolute](</tmp/My Deck.pdf>)",
    "[web](https://example.com/deck.pdf)",
    "[relative](deck.pdf)",
    ':codex-file-citation{path="/tmp/deck.html" purpose="source"}',
    "[duplicate](</tmp/My Deck.pdf>)"
  ].join("\n"));
  assert.deepEqual(paths, ["/tmp/My Deck.pdf", "/tmp/deck.html"]);

  const correction = slidesDeliveryCorrectionPrompt("explicit_pptx", "missing receipt");
  assert.match(correction, /DOMI_SLIDES_DESKTOP_CORRECTION_V1/);
  assert.match(correction, /唯一一次自动修正/);
  assert.match(correction, /HTML、PDF、经过独立全页渲染与逐页复核的可编辑 PPTX/);
  assert.match(correction, /missing receipt/);
});

test("desktop lifecycle wires the policy through submission, restart recovery, and completion gate", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.cjs"), "utf8");

  assert.match(app, /slidesDeliveryPolicy:\s*latestAssistant\.slidesDeliveryPolicy/);
  assert.match(app, /slidesDeliveryPolicy\s*}\s*:\s*{}\)/);
  assert.match(main, /completeRunThroughSlidesDeliveryGate\(run\)/);
  assert.match(main, /slidesDeliveryCorrectionAttempts[^\n]*>=\s*1/);
  assert.match(main, /run\.output\s*=\s*"";[\s\S]{0,500}finishRun\(run,\s*"failed"/);
  assert.match(main, /recoverCodexThread\(threadId, request = \{\}\)/);
  assert.match(main, /status === "completed" && slidesDeliveryPolicy/);
  assert.match(preload, /codex:recover-thread", threadId, request/);
  assert.match(main, /isSlidesInputRequest\(run\.output\)[\s\S]{0,100}finishRun\(run, "waiting-input"\)/);
  assert.match(main, /isSlidesInputRequest\(output\)[\s\S]{0,100}status = "waiting-input"/);
  assert.match(app, /awaitingSlidesInput: payload\.type === "waiting-input"/);
  assert.match(app, /awaitingSlidesInput = previousAssistant\?\.awaitingSlidesInput === true/);
  assert.match(app, /queuedSubmission: undefined/);
});

test("actual desktop gate ends missing-input turns without consuming repair or bypassing artifact QA", async () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const gate = main.slice(main.indexOf("async function completeRunThroughSlidesDeliveryGate(run)"),
    main.indexOf("\nfunction prepareCodexConnectionMaintenance", main.indexOf("async function completeRunThroughSlidesDeliveryGate(run)")));
  const results = [];
  let validations = 0;
  const context = vm.createContext({
    normalizedSlidesDeliveryPolicy: (value) => value || "",
    isSlidesInputRequest,
    validateSlidesDeliveryOutput: () => { validations += 1; return { ok: false, error: "invalid receipt" }; },
    finishRun: (run, type, details) => results.push({ type, details, output: run.output }),
    appendRuntimeLog: () => {},
    boundedRuntimeText: (value) => value
  });
  vm.runInContext(gate, context);
  const question = { slidesDeliveryPolicy: "html_pdf", output: "尚未收到报告，请先上传材料，收到后继续制作。" };
  await context.completeRunThroughSlidesDeliveryGate(question);
  assert.equal(results.at(-1).type, "waiting-input");
  assert.equal(validations, 0);
  assert.equal(question.slidesDeliveryCorrectionAttempts, undefined);
  await context.completeRunThroughSlidesDeliveryGate({
    slidesDeliveryPolicy: "html_pdf", slidesDeliveryCorrectionAttempts: 1,
    output: "请先提供材料，已完成：[PDF](/missing.pdf)"
  });
  assert.equal(results.at(-1).type, "failed");
  assert.equal(results.at(-1).output, "");
  assert.equal(validations, 1);
  await context.completeRunThroughSlidesDeliveryGate({ output: "普通任务答复" });
  assert.equal(results.at(-1).type, "completed");
});
