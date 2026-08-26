import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalTaskId,
  extractLocalAttachments,
  findTaskReference,
  isResultOnlyRequest,
  likelyWaitingReply,
  looksLikeNewTask,
  requestsExistingResult,
  redactInternalFileCitations,
  responseWaitsForUser,
  shouldContinueActiveTask,
  shouldFlushPendingDeliveriesForMessage,
  shouldRedeliverExistingResult,
  splitText,
  targetsExistingResult,
  taskReferenceToken,
  wantsFileDelivery,
} from "../src/protocol.js";

test("task references route to the requested independent task", () => {
  const tasks = { W01: { id: "W01" }, W02: { id: "W02" } };
  assert.equal(findTaskReference("回到1号任务，参会人是张三", tasks), "W01");
  assert.equal(findTaskReference("补充 #W02", tasks), "W02");
  assert.equal(taskReferenceToken("W99 只发送已有结果"), "W99");
  assert.equal(canonicalTaskId(8), "W08");
  assert.equal(canonicalTaskId(21), "");
});

test("follow-ups and recent result requests continue the active task", () => {
  const active = { id: "W02", status: "completed", updatedAt: new Date().toISOString() };
  assert.equal(shouldContinueActiveTask("补充一下收入数据", active), true);
  assert.equal(shouldContinueActiveTask("研究一家新的公司", active), false);
  assert.equal(shouldContinueActiveTask("研究纪要我看下", active), true);
  assert.equal(shouldContinueActiveTask("为什么会这样", active), true);
  assert.equal(shouldContinueActiveTask("今天的录音有哪些", active), false);
  assert.equal(requestsExistingResult("W09 只发送已有结果，不要重新研究和入库"), true);
  assert.equal(shouldContinueActiveTask("任何回答", { ...active, status: "waiting_user" }), true);
  assert.equal(likelyWaitingReply("研究一家新的公司"), false);
  assert.equal(likelyWaitingReply("收入是3亿元"), true);
});

test("new entities and new actions cannot replay the active task result", () => {
  const active = { id: "W15", status: "completed", updatedAt: new Date().toISOString() };
  const ratingRequest = "请对 ojo 进行评级，并把研究报告pdf发我看看";
  const otherCompanyRequest = "赵动科技的纪要发我看看";

  for (const request of [ratingRequest, otherCompanyRequest]) {
    assert.equal(requestsExistingResult(request), true);
    assert.equal(looksLikeNewTask(request), true);
    assert.equal(isResultOnlyRequest(request), false);
    assert.equal(likelyWaitingReply(request), false);
    assert.equal(shouldContinueActiveTask(request, active), false);
    assert.equal(shouldRedeliverExistingResult({
      text: request,
      routingReason: "new_task",
      hasFinalResponse: true,
    }), false);
  }
});

test("routing distinguishes contextual follow-ups from cross-entity requests", () => {
  const active = { id: "W15", status: "completed", updatedAt: new Date().toISOString() };
  const newRequests = [
    "请把赵动科技纪要发我",
    "请把赵动科技的会议纪要发我",
    "请发送赵动科技的纪要给我",
    "请给我赵动科技的报告",
    "对赵动科技怎么看",
    "另外分析一下赵动科技",
    "还有，对星海科技做个评级",
    "麻烦分析赵动科技",
    "给赵动科技评级",
    "帮我查查赵动科技",
    "帮我看一下赵动科技",
    "帮我看一看赵动科技",
    "查下赵动科技",
    "搜搜赵动科技",
    "请看一下赵动科技",
    "调研一下赵动科技",
    "给赵动科技打个分",
    "看看赵动科技",
    "分析当前科技有限公司",
    "对其利工业集团进行评级",
    "赵动科技怎么样",
    "OJO值得投吗",
    "请基于赵动科技纪要给个评级",
    "新任务：研究赵动科技",
    "换个问题，赵动科技怎么样",
    "然后分析一下赵动科技",
    "继续研究另一家公司赵动科技",
    "想分析一下赵动科技",
    "换个公司，分析赵动科技",
    "再分析一家新公司赵动科技",
    "赵动科技做个评级",
    "把报告发我，再对赵动科技评级",
    "把纪要发我，然后研究赵动科技",
    "把报告发我，另一个任务：研究赵动科技",
    "纪要发我接着研究星海科技",
    "报告发我另一个任务研究赵动科技",
    "报告发我另外研究赵动科技",
    "报告发我顺便研究赵动科技",
    "把报告发我并研究赵动科技",
    "报告发我同时研究赵动科技",
    "报告发我之后研究赵动科技",
    "报告发我再帮我研究赵动科技",
    "报告发我然后查一查赵动科技",
    "报告发我接着搜一下赵动科技",
    "报告发我再看看赵动科技",
  ];
  const followUps = [
    "对这个项目怎么看",
    "请对估值进行分析",
    "请对这个项目进行评级",
    "请对风险再分析一下",
    "请对刚才的估值进行分析",
    "分析一下这个项目风险",
    "对这家公司做个评级",
    "这个项目怎么样",
    "该公司值得投吗",
    "请基于这个项目纪要给个评级",
    "用这份报告做个评级",
    "根据刚才的报告再分析一下",
    "帮我看看它的风险",
    "继续分析",
    "继续研究",
    "再分析一下",
    "接着研究一下",
    "分析一下其",
    "对其进行评级",
    "给其做个评级",
    "为其做个分析",
    "再分析一下其",
    "查一下它的创始人背景",
    "对它进行评级",
    "为这个项目做个评级",
    "进一步分析它的风险",
    "深入分析它的技术",
    "顺便分析一下它的团队",
    "这家公司值得投吗",
    "当前项目怎么样",
    "上述项目怎么看",
    "本项目值得推进吗",
    "其商业模式怎么样",
    "把报告修改一下再发我",
    "报告里补充团队信息再发我",
    "把报告翻译成英文发我",
  ];
  const resultOnlyRequests = [
    "把之前的报告发我",
    "把该项目的报告发我",
    "请把这个项目的报告发我",
    "上面的完整报告发我",
    "请把刚才的完整纪要发我",
    "请发送这个项目的报告给我",
    "把刚才那份报告发我",
    "完整的报告发我",
    "最新的报告发我",
    "再发我一次报告",
    "再把报告发我",
    "重新发送报告给我",
    "刚才生成的报告发我",
    "上面提到的报告发我",
    "本次报告发我",
    "当前项目最终版报告发我",
    "给我再发一下报告",
    "给我发下报告",
    "再给我发下报告",
    "发我看看报告",
    "发我看看纪要",
    "给我看看报告",
    "给我看下报告",
    "给我看一下报告",
  ];

  for (const request of newRequests) {
    assert.equal(looksLikeNewTask(request), true, request);
    assert.equal(isResultOnlyRequest(request), false, request);
    assert.equal(shouldContinueActiveTask(request, active), false, request);
    assert.equal(shouldFlushPendingDeliveriesForMessage(request), false, request);
  }
  for (const request of followUps) {
    assert.equal(looksLikeNewTask(request), false, request);
    assert.equal(shouldContinueActiveTask(request, active), true, request);
  }
  for (const request of resultOnlyRequests) {
    assert.equal(isResultOnlyRequest(request), true, request);
    assert.equal(looksLikeNewTask(request), false, request);
    assert.equal(shouldContinueActiveTask(request, active), true, request);
  }
});

test("only explicit or recent result-only requests may redeliver an existing result", () => {
  const active = { id: "W15", status: "completed", updatedAt: new Date().toISOString() };
  const stale = { ...active, updatedAt: new Date(Date.now() - 11 * 60_000).toISOString() };

  assert.equal(isResultOnlyRequest("研究纪要我看下"), true);
  assert.equal(shouldContinueActiveTask("研究纪要我看下", active), true);
  assert.equal(shouldContinueActiveTask("研究纪要我看下", stale), false);
  assert.equal(shouldRedeliverExistingResult({
    text: "W15 只发送已有结果，不要重新研究和入库",
    routingReason: "explicit_reference",
    hasFinalResponse: true,
  }), true);
  assert.equal(shouldRedeliverExistingResult({
    text: "把报告发我",
    routingReason: "quoted_reference",
    hasFinalResponse: true,
  }), true);
  assert.equal(shouldRedeliverExistingResult({
    text: "把报告发我",
    routingReason: "active_existing_result",
    hasFinalResponse: true,
    deliveryStatus: "pending",
  }), false);
  assert.equal(targetsExistingResult({
    text: "把报告发我",
    routingReason: "active_existing_result",
    hasFinalResponse: true,
  }), true);
  assert.equal(shouldRedeliverExistingResult({
    text: "W15 重新评级并把报告发我",
    routingReason: "explicit_reference",
    hasFinalResponse: true,
  }), false);

  for (const request of [
    "W15 只发报告，不用重新分析",
    "W15 把报告发我，不需要修改",
    "W15 只发已有报告，不要评级",
    "W15 给我看看报告，不要做任何分析",
  ]) {
    assert.equal(isResultOnlyRequest(request), true, request);
    assert.equal(looksLikeNewTask(request), false, request);
    assert.equal(shouldRedeliverExistingResult({
      text: request,
      routingReason: "explicit_reference",
      hasFinalResponse: true,
    }), true, request);
  }
});

test("waiting responses and long text are represented without truncation", () => {
  assert.equal(responseWaitsForUser("请补充参会人？"), true);
  const chunks = splitText("段落。\n".repeat(1800), 1000);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1000));
  assert.equal(chunks.join("").replace(/\s/g, ""), "段落。\n".repeat(1800).replace(/\s/g, ""));
});

test("existing local Markdown links become deliverable attachments", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "完整纪要.md");
  fs.writeFileSync(filePath, "# 纪要\n", "utf8");
  const attachments = extractLocalAttachments(`[查看完整纪要](<${filePath}>)`);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filePath, filePath);
});

test("Codex file citations become deliverable attachments without exposing local paths", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-citation-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'UniPat（李宽） Pre A&A轮“二次”见面&Pre IC.pdf');
  fs.writeFileSync(filePath, "pdf", "utf8");
  const marker = `:codex-file-citation{path=${JSON.stringify(filePath)} purpose="source"}`;

  const attachments = extractLocalAttachments(`完整原件：${marker}`);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filePath, filePath);
  assert.equal(attachments[0].label, path.basename(filePath));
  const visible = redactInternalFileCitations(`完整原件：${marker}`);
  assert.equal(visible, `完整原件：文件：${path.basename(filePath)}`);
  assert.doesNotMatch(visible, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("invalid or malformed Codex file citations never leak a local path", () => {
  const unavailablePath = path.join(path.sep, "private-home", "private", "missing.pdf");
  const unavailable = `:codex-file-citation{path=${JSON.stringify(unavailablePath)} purpose="source"}`;
  const malformed = `:codex-file-citation{path=${JSON.stringify(unavailablePath)}`;

  assert.deepEqual(extractLocalAttachments(unavailable), []);
  assert.equal(redactInternalFileCitations(unavailable), "文件：missing.pdf");
  assert.equal(redactInternalFileCitations(malformed), "文件引用不可用");
});

test("slide deliverables request file delivery even when the user only says PPT or slides", () => {
  for (const request of [
    "把三家公司做成 PPT",
    "please create investment slides",
    "输出一份 slide deck",
    "生成演示文稿",
  ]) {
    assert.equal(wantsFileDelivery(request), true, request);
  }
});

test("HTML slide sources and Codex file citations become deliverable attachments", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-slides-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const htmlPath = path.join(directory, "投研Slides.html");
  fs.writeFileSync(htmlPath, "<!doctype html><title>Slides</title>", "utf8");

  const markdown = extractLocalAttachments(`[HTML源文件](<${htmlPath}>)`);
  const directive = extractLocalAttachments(
    `:codex-file-citation{path="${htmlPath}" purpose="source"}`,
  );

  assert.equal(markdown[0]?.filePath, htmlPath);
  assert.equal(directive[0]?.filePath, htmlPath);
});
