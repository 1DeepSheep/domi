const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { PlaudContextService, runPlaudContextCommand } = require("../electron/plaud-context.cjs");

// Mandatory, like plugin-contracts.test.cjs: exercise the checkout being
// shipped, never silently substitute an installed plugin or skip the suite.
assert.ok(process.env.DOMI_PLUGIN_CONTRACT_ROOT, "Set DOMI_PLUGIN_CONTRACT_ROOT to the plugin checkout.");
const script = path.resolve(process.env.DOMI_PLUGIN_CONTRACT_ROOT, "skills/plaud/scripts/plaud.js");
assert.ok(fs.statSync(script).isFile(), "Missing PLAUD plugin CLI contract implementation");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-context-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = Array.from({ length: 180 }, (_, index) => `第${index}段：合成仓储机器人客户试点，讨论量产成本与接口验收。`).join("\n")
    + "\n末尾关键信息：计划在明年完成三家电商仓的扩容。\n";
  const transcript = path.join(root, "synthetic-transcript.md"), stateFile = path.join(root, "plaud-workflow.json");
  const config = path.join(root, "config.json"), guard = path.join(root, "offline.cjs");
  fs.writeFileSync(transcript, source);
  fs.writeFileSync(config, JSON.stringify({ plaudConnectionMode: "enabled" }));
  fs.writeFileSync(stateFile, JSON.stringify({ version: 1, records: {
    synthetic: { fileId: "synthetic", stage: "transcript_ready", transcriptPath: transcript }
  } }));
  fs.writeFileSync(guard, `const deny=()=>{throw new Error('Network/browser access is forbidden in this local contract');};
globalThis.fetch=deny;
for(const name of ['node:http','node:https']){const m=require(name);m.request=deny;m.get=deny;}
const net=require('node:net');net.connect=deny;net.createConnection=deny;net.Socket.prototype.connect=deny;
require('node:tls').connect=deny;
const cp=require('node:child_process');for(const key of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])cp[key]=deny;
`);
  const f = { scope: sha256("original-session"), owned: true, root, transcript, source, stateFile, calls: [] };
  f.client = () => new PlaudContextService({
    currentScope: () => f.scope,
    metadataForRecording: (scope, fileId) => f.owned && scope === f.scope && fileId === "synthetic"
      ? { fileId, fileName: "Synthetic recording", duration: 600000, createdAt: 1 } : null,
    runCommand: (command, fileId, payload) => {
      assert.ok(["context-prepare", "context-submit", "context-rebind"].includes(command));
      f.calls.push(command);
      return runPlaudContextCommand({ executable: process.execPath, script, command, fileId, payload,
        execFile: (executable, args, options, callback) => execFile(executable, ["--require", guard, ...args], options, callback),
        env: { PATH: process.env.PATH, NODE_PATH: path.resolve(__dirname, "../node_modules"),
          DOMI_CONFIG_PATH: config, DOMI_PLAUD_STATE_DIR: root } });
    }
  });
  f.service = f.client();
  f.submission = prepared => ({ fileId: "synthetic", accountScope: f.scope, submissionId: "context-submit-1",
    sourceTurnId: "synthetic-source-turn", expectedTranscriptSha256: prepared.transcript.sha256,
    expectedRecordRevision: prepared.recordRevision, contextStatus: "provided", conversationType: "创业公司交流",
    participants: "示例参会者甲\n示例参会者乙", userContext: "保留这一段完整背景。",
    rawAnswer: "  原始选择与回答\n参会者甲和乙，讨论客户试点及量产。\n末尾补充：保留空格。  " });
  return f;
}

test("real local CLI preserves full-source binding, original answers and idempotent submissions", async t => {
  const f = fixture(t), before = fs.readFileSync(f.stateFile);
  const prepared = await f.service.prepare({ fileId: "synthetic" });
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.transcript.sha256, sha256(Buffer.from(f.source)));
  assert.equal(prepared.transcript.bytes, Buffer.byteLength(f.source));
  assert.equal(prepared.disposition, "needs_input");
  assert.ok(before.equals(fs.readFileSync(f.stateFile)), "prepare cannot advance the queue");
  const request = f.submission(prepared), saved = await f.service.save(request);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.stage, "context_ready");
  assert.equal(saved.context.rawAnswer, request.rawAnswer);
  assert.equal(saved.context.sourceTurnId, request.sourceTurnId);
  assert.equal(saved.context.participants, request.participants);
  const artifact = JSON.parse(fs.readFileSync(saved.contextPath));
  assert.equal(artifact.rawAnswer, request.rawAnswer);
  assert.equal(artifact.transcript.sha256, prepared.transcript.sha256);
  const committed = fs.readFileSync(f.stateFile);
  const duplicate = await f.service.save(request);
  assert.equal(duplicate.ok, true, duplicate.error);
  assert.equal(duplicate.reused, true);
  assert.equal(duplicate.contextPath, saved.contextPath);
  assert.ok(committed.equals(fs.readFileSync(f.stateFile)), "retry cannot write a second receipt");
  const restored = await f.client().prepare({ fileId: "synthetic", accountScope: f.scope });
  assert.equal(restored.disposition, "ready");
  assert.equal(restored.context.rawAnswer, request.rawAnswer);
  assert.equal(restored.context.sourceTurnId, request.sourceTurnId);
});

test("real scope recovery requires explicit confirmation and keeps old artifacts, answers and stages", async t => {
  const f = fixture(t), prepared = await f.service.prepare({ fileId: "synthetic" });
  const request = f.submission(prepared), saved = await f.service.save(request);
  assert.equal(saved.ok, true, saved.error);
  const originalBytes = fs.readFileSync(saved.contextPath), previousAccountScope = f.scope;
  // Model-owned subsequent stages must remain untouched by scope recovery.
  const queue = JSON.parse(fs.readFileSync(f.stateFile)); queue.records.synthetic.stage = "reviewed";
  fs.writeFileSync(f.stateFile, JSON.stringify(queue));
  f.scope = sha256("explicit-relogin");
  const prepareRequest = { fileId: "synthetic", accountScope: previousAccountScope, expectedTranscriptSha256: prepared.transcript.sha256 };
  f.owned = false;
  assert.equal((await f.service.prepare(prepareRequest)).errorCode, "PLAUD_CONTEXT_RECORD_UNVERIFIED");
  f.owned = true;
  const offered = await f.service.prepare(prepareRequest);
  assert.equal(offered.errorCode, "PLAUD_CONTEXT_SCOPE_RECOVERY_REQUIRED");
  assert.equal(offered.context, undefined); assert.equal(offered.recall, undefined);
  assert.doesNotMatch(JSON.stringify(offered), /原始选择|参会者甲|客户试点/);
  const proof = offered.scopeRecovery;
  const recover = { action: "recover_scope", confirmed: true, fileId: "synthetic", accountScope: proof.accountScope,
    previousAccountScope: proof.previousAccountScope, expectedTranscriptSha256: proof.transcriptSha256, expectedRecordRevision: proof.recordRevision };
  assert.equal((await f.service.save({ ...recover, confirmed: false })).errorCode, "PLAUD_CONTEXT_REQUEST_INVALID");
  const result = await f.service.save(recover);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.stage, "reviewed");
  assert.equal(result.context.rawAnswer, request.rawAnswer);
  assert.equal(result.context.sourceTurnId, request.sourceTurnId);
  assert.notEqual(result.contextPath, saved.contextPath);
  assert.ok(originalBytes.equals(fs.readFileSync(saved.contextPath)));
  const next = f.client(), restored = await next.prepare({ fileId: "synthetic", accountScope: f.scope });
  assert.equal(restored.ok, true, restored.error); assert.equal(restored.stage, "reviewed");
  assert.equal(restored.context.rawAnswer, request.rawAnswer);
  // Simulate restart after the commit but before the UI received its response.
  const lostReply = await next.prepare(prepareRequest);
  assert.equal(lostReply.errorCode, "PLAUD_CONTEXT_SCOPE_RECOVERY_REQUIRED");
  assert.equal(lostReply.scopeRecovery.recordRevision, proof.recordRevision);
  assert.equal((await next.save(recover)).reused, true);
});

test("changing only the transcript tail invalidates submission and recovery without changing the queue", async t => {
  const f = fixture(t), prepared = await f.service.prepare({ fileId: "synthetic" });
  const before = fs.readFileSync(f.stateFile);
  fs.appendFileSync(f.transcript, "仅全文末尾新增的重要融资条件。\n");
  assert.equal((await f.service.save(f.submission(prepared))).errorCode, "PLAUD_CONTEXT_TRANSCRIPT_CHANGED");
  const oldScope = f.scope; f.scope = sha256("another-login");
  assert.equal((await f.service.prepare({ fileId: "synthetic", accountScope: oldScope,
    expectedTranscriptSha256: prepared.transcript.sha256 })).errorCode, "PLAUD_CONTEXT_TRANSCRIPT_CHANGED");
  assert.ok(before.equals(fs.readFileSync(f.stateFile)), "rejected source binding cannot mutate context or stage");
});
