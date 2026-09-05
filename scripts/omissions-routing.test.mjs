import assert from "node:assert/strict";
import { resolveSlidesDeliveryPolicy as policy } from "../services/wechat-bridge/src/slides-request-policy.js";
import { domiModelPolicyClass } from "../src/model-policy.ts";
import { remarkMessageFormatting } from "../src/message-formatting.ts";
import { workflowPrompt } from "../src/workflows.ts";
import produced from "../services/wechat-bridge/src/slides-produced.cjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
for (const text of ["在展示产品内容和玩法的时候，要强调内容都是AI生成的，是基于公司自己的模型", "补充一下公司的竞争优势"]) {
  assert.equal(policy({ text, previousDeliveryPolicy: "html_pdf" }), "html_pdf");
  assert.equal(policy({ text }), "");
}
assert.equal(policy({ text: "请根据这份BP做slides", hasPowerPointAttachment: true }), "html_pdf");
assert.equal(policy({ text: "根据 BP.pptx 制作 slides" }), "html_pdf");
assert.equal(policy({ text: "请生成一份 presentation" }), "html_pdf");
assert.equal(policy({ text: "请修改第二页", hasPowerPointAttachment: true }), "explicit_pptx");
for (const text of ["研究另一家公司", "新增一个待办事项", "打开之前的PPT", "不要生成slides"]) {
  assert.equal(policy({ text, previousDeliveryPolicy: "html_pdf" }), "");
}
assert.equal(domiModelPolicyClass(undefined, undefined, { useDomiPlugin: true, requestText: "修改slides的字体", domiSlidesDeliveryPolicy: "html_pdf" }), "premium");
const userPrompt = workflowPrompt({ id: "user-skill:deck", title: "My Deck", skill: "$my-deck", source: "user", producesSlides: true, skillPath: "/synthetic/skills/deck" }, "研究合成案例", "", true);
assert.match(userPrompt, /DOMI_SLIDES_POLICY_V2/);
assert.match(userPrompt, /\$domi:slides/);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "domi-produced-slides-"));
try {
  const file = path.join(temporary, "deck.html");
  fs.writeFileSync(file, '<section class="slide" data-template="cover">Example</section>');
  assert.equal(produced.producedSlides([file], Date.now() - 1000), true);
  assert.equal(produced.producedSlides([file], Date.now() + 1000), false);
  fs.writeFileSync(file, '<main>Ordinary web page</main>');
  assert.equal(produced.producedSlides([file], Date.now() - 1000), false);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
const root = { type: "root", children: [{ type: "paragraph", children: [
  { type: "html", value: "<u>" }, { type: "text", value: "重点" }, { type: "html", value: "</u>" },
  { type: "html", value: "<br>" }, { type: "inlineCode", value: "<br>" }, { type: "html", value: "<script>alert(1)</script>" }
] }] };
remarkMessageFormatting()(root);
assert.equal(root.children[0].children[0].data.hName, "u");
assert.equal(root.children[0].children[1].type, "break");
assert.equal(root.children[0].children[2].type, "inlineCode");
assert.equal(root.children[0].children[3].type, "text");
console.log("Omission regressions: Slides continuation, source format, reasoning and safe Markdown passed");
