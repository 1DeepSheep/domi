import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalTaskId,
  extractLocalAttachments,
  findTaskReference,
  likelyWaitingReply,
  requestsExistingResult,
  responseWaitsForUser,
  shouldContinueActiveTask,
  splitText,
} from "../src/protocol.js";

test("task references route to the requested independent task", () => {
  const tasks = { W01: { id: "W01" }, W02: { id: "W02" } };
  assert.equal(findTaskReference("回到1号任务，参会人是张三", tasks), "W01");
  assert.equal(findTaskReference("补充 #W02", tasks), "W02");
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
