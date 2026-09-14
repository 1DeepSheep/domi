import test from "node:test";
import assert from "node:assert/strict";
import { attachmentDisplayName, attachmentPathLabel, attachmentLinkLabel, attachmentPrompt } from "../shared/attachment-names.mjs";

const root = "/library";
const raw = "/library/项目/原始材料/1770000000000-0-【BP】示例公司.pdf";
const context = { managedRoots: [root] };

test("managed legacy labels hide one storage prefix without changing the path", () => {
  assert.equal(attachmentDisplayName(raw, context), "【BP】示例公司.pdf");
  assert.equal(attachmentDisplayName(raw), "1770000000000-0-【BP】示例公司.pdf");
  assert.equal(attachmentDisplayName("/library/attachments/1770000000000-12-1770000000001-0-report.pdf", context), "1770000000001-0-report.pdf");
});

test("only managed attachment directories qualify; date/version names survive", () => {
  for (const file of ["/Downloads/attachments/1770000000000-0-BP.pdf", "/library-other/attachments/1770000000000-0-BP.pdf", "/library/会议纪要/1770000000000-0-BP.pdf", "/library/../outside/attachments/1770000000000-0-BP.pdf", "/library/attachments/20260914-0-BP.pdf", "/library/attachments/7.0.5-BP.pdf"]) {
    assert.equal(attachmentDisplayName(file, context), file.split("/").pop());
  }
});

test("stored original names take precedence even when they resemble storage names", () => {
  const original = "1770000000000-0-用户原名.pdf";
  assert.equal(attachmentDisplayName(raw, { ...context, attachments: [{ path: raw, name: original }] }), original);
});

test("link labels preserve semantic text, external URLs, Unicode and literal percent paths", () => {
  assert.equal(attachmentLinkLabel(raw, raw.split("/").pop(), context), "【BP】示例公司.pdf");
  assert.equal(attachmentLinkLabel(raw, "原始商业计划书", context), "原始商业计划书");
  assert.equal(attachmentLinkLabel("file://" + encodeURI(raw), undefined, context), "【BP】示例公司.pdf");
  assert.equal(attachmentLinkLabel("https://example.com/" + raw.split("/").pop(), undefined, context), raw.split("/").pop());
  const literal = "/library/attachments/1770000000000-0-report%20.pdf";
  assert.equal(attachmentDisplayName(literal, context), "report%20.pdf");
  assert.equal(attachmentPathLabel(literal, undefined, context), "report%20.pdf");
  assert.equal(attachmentPathLabel("/library/attachments/1770000000000-0-report%2Fcase.pdf", undefined, context), "report%2Fcase.pdf");
  assert.equal(attachmentLinkLabel(literal, undefined, { ...context, attachments: [{ path: literal, name: "report%20.pdf" }] }), "report%20.pdf");
  assert.equal(attachmentLinkLabel("../attachments/1770000000000-0-BP.pdf", undefined, { ...context, basePath: "/library/tasks" }), "BP.pdf");
});

test("attachment prompt separates original names from immutable paths as JSON", () => {
  const files = [{ name: "【BP】示例公司.pdf", path: raw }, { name: 'quoted"\nname.pdf', path: '/library/attachments/a"\n.pdf' }];
  const prompt = attachmentPrompt(files);
  assert.deepEqual(prompt.split("\n").slice(1).map((line) => JSON.parse(line)), files);
  assert.equal(attachmentPrompt([]), "");
});
