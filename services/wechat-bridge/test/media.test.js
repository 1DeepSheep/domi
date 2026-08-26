import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  codexInputFor,
  domiInvestmentSlidesPolicyFor,
  domiSlidesCorrectionInputFor,
  domiSlidesDeliveryPolicyFor,
  encodeOutboundAesKey,
  validateDomiSlidesDeliverables,
} from "../src/media.js";

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

test("plain PPT requests use the domi investment-banking HTML and PDF workflow", () => {
  const request = "把三家 H 股 AI 制药公司做成 PPT";
  const policy = domiInvestmentSlidesPolicyFor({ text: request });
  const input = codexInputFor({ text: request, attachments: [] });

  assert.equal(domiSlidesDeliveryPolicyFor({ text: request }), "html_pdf");
  assert.match(policy, /\$domi:investment-analysis/);
  assert.match(policy, /investment-banking-slides\.md/);
  assert.match(policy, /Morgan Stanley/);
  assert.match(policy, /HTML 源文件.*PDF/);
  assert.match(policy, /不得创建或交付 \.pptx/);
  assert.match(input, /DOMI_INVESTMENT_SLIDES_POLICY_V1/);
  assert.match(input, /用户原始请求：\n把三家 H 股 AI 制药公司做成 PPT/);
});

test("only explicit editable PowerPoint requests permit PPTX while keeping domi QA", () => {
  const request = "请给我一份可编辑 PowerPoint 源文件";
  const policy = domiInvestmentSlidesPolicyFor({ text: request });

  assert.equal(domiSlidesDeliveryPolicyFor({ text: request }), "explicit_pptx");
  assert.match(policy, /允许交付 \.pptx/);
  assert.match(policy, /Morgan Stanley/);
  assert.match(policy, /contact sheet/);
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
    /DOMI_INVESTMENT_SLIDES_POLICY_V1/,
  );
});

test("editing an attached PPTX keeps the domi investment-banking style guard", () => {
  const attachments = [{
    filePath: "/tmp/research.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "file",
  }];
  const input = codexInputFor({ text: "请重新排版", attachments });

  assert.match(input, /允许交付 \.pptx/);
  assert.match(input, /用户通过微信提供了以下本地附件/);
});

test("an attached PPTX may preserve an explicitly requested existing template", () => {
  const attachments = [{ filePath: "/tmp/research.pptx", kind: "file" }];
  assert.equal(
    domiInvestmentSlidesPolicyFor({ text: "请修改文字并保持原模板", attachments }),
    "",
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
  const stylePath = path.join(root, "style-packs", "morgan-stanley", "style.css");
  fs.mkdirSync(path.dirname(stylePath), { recursive: true });
  fs.writeFileSync(stylePath, ':root { --style-pack: "morgan-stanley"; }\n');
  const htmlPath = path.join(root, "deck.html");
  fs.writeFileSync(
    htmlPath,
    '<link rel="stylesheet" href="./style-packs/morgan-stanley/style.css"><section class="slide"></section>',
  );
  fs.writeFileSync(path.join(root, "deck.pdf"), "%PDF fixture");
  assert.equal(validateDomiSlidesDeliverables("html_pdf", [
    { filePath: htmlPath },
    { filePath: path.join(root, "deck.pdf") },
  ]).ok, true);
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(
    validateDomiSlidesDeliverables("explicit_pptx", [
      { filePath: "/tmp/deck.pptx" },
    ]).ok,
    true,
  );
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
  fs.writeFileSync(pdfPath, "%PDF fixture");

  const result = validateDomiSlidesDeliverables("html_pdf", [
    { filePath: htmlPath },
    { filePath: pdfPath },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /没有加载 domi 的 Morgan Stanley style pack/);
});
