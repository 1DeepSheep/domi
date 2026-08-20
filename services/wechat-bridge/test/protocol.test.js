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
  responseWaitsForUser,
  shouldContinueActiveTask,
  splitText,
} from "../src/protocol.js";

test("task references route to the requested independent task", () => {
  const tasks = { W001: { id: "W001" }, W002: { id: "W002" } };
  assert.equal(findTaskReference("回到1号任务，参会人是张三", tasks), "W001");
  assert.equal(findTaskReference("补充 #W002", tasks), "W002");
  assert.equal(canonicalTaskId(8), "W008");
});

test("only follow-up-like text implicitly continues the active task", () => {
  const active = { id: "W002", status: "completed" };
  assert.equal(shouldContinueActiveTask("补充一下收入数据", active), true);
  assert.equal(shouldContinueActiveTask("研究一家新的公司", active), false);
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
