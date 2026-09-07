const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { localTaskReceipt, sha256, stableJson } = require("../electron/task-receipt.cjs");

test("todo completion requires exact document bytes, actual task IDs and a verified execution receipt", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-task-receipt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const document = path.join(root, "todo.md"), content = "# 待办\n- [ ] 跟进\n", ledger = { tasks: [{ id: "a" }, { id: "b" }] };
  const receipt = { schema: "domi.todo-result.v1", runId: "run-1", verified: true, documentSha256: sha256(content), ledgerSha256: sha256(stableJson(ledger)), taskIds: ["b", "a"] };
  const receiptPath = path.join(root, ".domi-todo-last-run.json");
  assert.equal(localTaskReceipt(document, content, ledger).syncReceipt, undefined);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.equal(localTaskReceipt(document, content, ledger).syncReceipt.runId, "run-1");
  assert.equal(localTaskReceipt(document, content + "user edit", ledger).syncReceipt, undefined);
  assert.equal(localTaskReceipt(document, content, { tasks: [{ id: "a" }] }).syncReceipt, undefined);
  fs.writeFileSync(receiptPath, JSON.stringify({ ...receipt, verified: false }));
  assert.equal(localTaskReceipt(document, content, ledger).syncReceipt, undefined);
  fs.unlinkSync(receiptPath); fs.mkdirSync(receiptPath);
  assert.equal(localTaskReceipt(document, content, ledger).syncReceipt, undefined);
});
