const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const test = require("node:test");
const { PlaudContextService, runPlaudContextCommand, extractRecall, distributedRecallSource, readBoundTranscript } = require("../electron/plaud-context.cjs");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const source = "# 录音标题：机器人融资\n[00:01] Speaker 1: 医院排班系统先从护理科室落地，试点覆盖三家医院，每周自动整理排班冲突。\n[10:20] Speaker 2: 客户要求私有化部署，病人数据保存在医院内部，排班系统通过接口读取人员班次。\n[30:00] Speaker 1: 明年的重点是收费模式，计划按科室数量订阅，先完成接口验收再签合同。\n";

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function memoryStore() {
  const values = new Map();
  return { values, loadCache: key => values.has(key) ? { value: JSON.parse(values.get(key)) } : null,
    saveCache: (key, value) => values.set(key, JSON.stringify(value)) };
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-context-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const transcriptPath = path.join(directory, "transcript.md");
  fs.writeFileSync(transcriptPath, source);
  const f = { directory, transcriptPath, fileId: "synthetic-recording", scope: hash("synthetic-scope"),
    store: memoryStore(), calls: [], stage: "transcript_ready", disposition: "needs_input", owned: true,
    context: { contextStatus: "pending", participants: [], projectName: "", conversationType: "", userContext: "", extraContext: "" } };
  f.snapshot = () => ({ ok: true, fileId: f.fileId, accountScope: f.scope, stage: f.stage,
    disposition: f.disposition, recordRevision: hash(f.stage),
    transcript: { path: transcriptPath, sha256: hash(fs.readFileSync(transcriptPath)), bytes: fs.statSync(transcriptPath).size },
    recallSummary: "旧标题推断的无依据说明", recallSummaryVerified: false, context: f.context });
  f.command = async (command, fileId, payload) => {
    f.calls.push({ command, fileId, payload });
    assert.equal(fileId, f.fileId);
    if (f.hold) await f.hold;
    if (f.commandResult) return f.commandResult;
    if (command === "context-prepare") return f.snapshot();
    assert.equal(command, "context-submit");
    return { ...f.snapshot(), context: payload, contextPath: path.join(directory, "context.json") };
  };
  f.service = () => new PlaudContextService({ stateStore: f.store, currentScope: () => f.scope,
    metadataForRecording: (_scope, fileId) => f.owned && fileId === f.fileId
      ? { fileId, fileName: "Synthetic meeting", duration: 1800000, createdAt: 1 } : null,
    runCommand: (...args) => f.command(...args) });
  f.client = f.service();
  f.binding = () => ({ fileId: f.fileId, accountScope: f.scope, transcriptSha256: hash(fs.readFileSync(transcriptPath)) });
  f.submission = () => ({ ...f.binding(), expectedTranscriptSha256: f.binding().transcriptSha256,
    expectedRecordRevision: hash(f.stage), submissionId: "synthetic-submission", sourceTurnId: "synthetic-thread",
    contextStatus: "provided", participants: "讲者甲\n讲者乙", userContext: "医院排班系统产品交流", rawAnswer: "  讲者甲与讲者乙\n讨论医院排班。  " });
  return f;
}

test("deterministic recall quotes substantive text without inventing content from the title or attendees", () => {
  const recall = extractRecall(source);
  assert.equal(recall.source, "extract");
  assert(recall.excerpts.some(value => value.includes("医院")));
  assert(recall.excerpts.some(value => value.includes("收费模式")));
  assert(recall.keywords.some(value => /排班|医院/.test(value)));
  assert.doesNotMatch(JSON.stringify(recall), /机器人融资|旧标题/);
  assert.equal(recall.participants, undefined);
  assert.equal(recall.conversationType, undefined);
});

test("narrow model source covers the beginning, middle and end within 12k characters", () => {
  const long = Array.from({ length: 240 }, (_, index) => `第${index}段详细讨论医院排班软件的部署方式，以及科室预算和接口开发；${"这里还有具体的技术方案和商业讨论内容。".repeat(8)}`).join("\n");
  const recall = distributedRecallSource(long);
  assert(recall.sourceText.length <= 12000);
  assert.equal(recall.sourceTruncated, true);
  assert.match(recall.sourceText, /第0段/);
  assert.match(recall.sourceText, /第239段/);
  assert.match(recall.sourceText, /原文片段 3\/6/);
});

test("duplicate prepares share one local command and return context fields as strings", async t => {
  const f = fixture(t), gate = deferred(); f.hold = gate.promise;
  f.context.participants = ["讲者甲", "讲者乙"];
  const first = f.client.prepare({ fileId: f.fileId }), second = f.client.prepare({ fileId: f.fileId });
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(f.calls.length, 1); assert.deepEqual(a, b); assert.equal(a.ok, true);
  assert.equal(a.accountScope, f.scope); assert.equal(a.context.participants, "讲者甲\n讲者乙");
  assert.equal(a.recall.source, "extract"); assert.doesNotMatch(a.recall.summary, /旧标题/);
  assert.equal(a.duration, 1800000);
});

test("a missing or changed transcript is never synthesized from recording metadata", async t => {
  const f = fixture(t); const prepared = f.snapshot();
  fs.writeFileSync(f.transcriptPath, "已改变的文本。");
  await assert.rejects(readBoundTranscript(prepared.transcript), { code: "PLAUD_CONTEXT_TRANSCRIPT_CHANGED" });
  f.commandResult = { ok: false, fileId: f.fileId, errorCode: "PLAUD_CONTEXT_TRANSCRIPT_REQUIRED", error: "请先同步文字稿。" };
  const result = await f.client.prepare({ fileId: f.fileId });
  assert.equal(result.errorCode, "PLAUD_CONTEXT_TRANSCRIPT_REQUIRED");
  assert.equal(result.recall, undefined);
  fs.rmSync(f.transcriptPath);
  await assert.rejects(readBoundTranscript(prepared.transcript), { code: "PLAUD_CONTEXT_TRANSCRIPT_REQUIRED" });
});

test("saved model recall retains grounded detail without changing the plugin record revision", async t => {
  const f = fixture(t), initial = await f.client.prepare({ fileId: f.fileId });
  const recall = { summary: "讨论医院排班系统的落地方式、私有化部署要求和按科室订阅的收费计划。", source: "model",
    keywords: ["排班系统", "私有化部署"], excerpts: ["客户要求私有化部署"], conversationType: "创业公司交流" };
  const saved = await f.client.saveRecall({ ...f.binding(), recallSummary: recall.summary, recall });
  assert.equal(saved.ok, true); assert.equal(saved.recall.source, "model");
  const next = await f.client.prepare({ fileId: f.fileId });
  assert.equal(next.recall.source, "cache"); assert.equal(next.recall.summary, recall.summary);
  assert.deepEqual(next.recall.keywords, recall.keywords); assert.deepEqual(next.recall.excerpts, recall.excerpts);
  assert.equal(next.recall.conversationType, recall.conversationType);
  assert.equal(next.recordRevision, initial.recordRevision);
  assert(f.calls.every(call => call.command === "context-prepare"));
  const modelInput = await f.client.prepareRecall(f.binding());
  assert.equal(modelInput.cachedRecall.source, "cache");
  assert.equal(modelInput.recall.source, "cache");
  assert.equal(modelInput.cachedRecallSummary, recall.summary);
});

test("ungrounded recall and a stale source hash cannot overwrite a valid cache", async t => {
  const f = fixture(t);
  const valid = await f.client.saveRecall({ ...f.binding(), recallSummary: "医院排班的部署与合同讨论。" });
  assert.equal(valid.ok, true);
  const invalid = await f.client.saveRecall({ ...f.binding(), recallSummary: "不存在的事实", recall: { keywords: ["不存在的机器人"], excerpts: [] } });
  assert.equal(invalid.errorCode, "PLAUD_CONTEXT_RECALL_INVALID");
  const binding = f.binding(); fs.writeFileSync(f.transcriptPath, source + "新补充的讨论：预算需等到明年。\n");
  assert.equal((await f.client.saveRecall({ ...binding, recallSummary: "旧稿摘要" })).errorCode, "PLAUD_CONTEXT_TRANSCRIPT_CHANGED");
  assert.equal((await f.client.prepare({ fileId: f.fileId })).recall.source, "extract");
});

test("account changes during preparation revoke old results and never fall back to an unscoped record", async t => {
  const f = fixture(t), gate = deferred();
  f.hold = gate.promise;
  const pending = f.client.prepare({ fileId: f.fileId });
  await new Promise(resolve => setImmediate(resolve));
  f.scope = hash("another-account"); f.owned = false; gate.resolve();
  assert.equal((await pending).errorCode, "PLAUD_CONTEXT_SCOPE_CHANGED");
  const count = f.calls.length;
  assert.equal((await f.client.prepare({ fileId: f.fileId })).errorCode, "PLAUD_CONTEXT_RECORD_UNVERIFIED");
  assert.equal(f.calls.length, count);
  assert.equal(f.store.values.size, 0);
});

test("draft survives failed submission and is isolated by transcript hash and account", async t => {
  const f = fixture(t), binding = f.binding(), draft = { participants: "讲者甲", userContext: "需要补充的信息" };
  assert.equal((await f.client.saveDraft({ ...binding, draft })).ok, true);
  f.commandResult = { ok: false, fileId: f.fileId, errorCode: "PLAUD_CONTEXT_REVISION_CONFLICT", error: "版本已变化。" };
  assert.equal((await f.client.save(f.submission())).errorCode, "PLAUD_CONTEXT_REVISION_CONFLICT");
  f.commandResult = null;
  assert.equal((await f.client.prepare({ fileId: f.fileId })).draft.userContext, draft.userContext);
  fs.writeFileSync(f.transcriptPath, source + "新稿包含额外讨论内容。\n");
  assert.equal((await f.client.prepare({ fileId: f.fileId })).draft, undefined);
  f.scope = hash("another-account");
  assert.equal((await f.client.prepare({ fileId: f.fileId })).draft, undefined);
});

test("duplicate submissions share execution, retain the exact raw answer and clear draft only on success", async t => {
  const f = fixture(t), gate = deferred(), request = f.submission();
  await f.client.saveDraft({ ...f.binding(), draft: request });
  f.hold = gate.promise;
  const first = f.client.save(request), second = f.client.save(request);
  assert.equal(f.client.activeWrites, 2);
  gate.resolve(); const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true); assert.deepEqual(a, b);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.rawAnswer, request.rawAnswer);
  assert.deepEqual(f.calls[0].payload.participants, ["讲者甲", "讲者乙"]);
  assert.equal(a.context.participants, "讲者甲\n讲者乙"); assert.equal(f.client.activeWrites, 0);
  assert.equal((await f.client.prepare({ fileId: f.fileId })).draft, undefined);
});

test("oversized submitted input is rejected rather than silently truncating original information", async t => {
  const f = fixture(t);
  const result = await f.client.save({ ...f.submission(), userContext: "文".repeat(32769) });
  assert.equal(result.errorCode, "PLAUD_CONTEXT_INPUT_INVALID"); assert.equal(f.calls.length, 0);
  assert.equal(f.client.activeWrites, 0);
});

test("independent process restores only matching scoped recall and draft caches", async t => {
  const f = fixture(t); await f.client.prepare({ fileId: f.fileId });
  await f.client.saveDraft({ ...f.binding(), draft: { userContext: "已填写的会议背景" } });
  await f.client.saveRecall({ ...f.binding(), recallSummary: "已校验的医院排班讨论提示。" });
  const dataPath = path.join(f.directory, "fixture.json");
  fs.writeFileSync(dataPath, JSON.stringify({ values: [...f.store.values], snapshot: f.snapshot(), scope: f.scope }));
  const childScript = path.join(f.directory, "restore.cjs");
  fs.writeFileSync(childScript, `const fs=require('node:fs');
const {PlaudContextService}=require(${JSON.stringify(path.resolve(__dirname, "../electron/plaud-context.cjs"))});
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),values=new Map(data.values);
const service=new PlaudContextService({stateStore:{loadCache:k=>values.has(k)?{value:JSON.parse(values.get(k))}:null,saveCache:(k,v)=>values.set(k,JSON.stringify(v))},currentScope:()=>data.scope,metadataForRecording:()=>null,runCommand:async()=>data.snapshot});
service.prepare({fileId:data.snapshot.fileId}).then(r=>console.log(JSON.stringify({ok:r.ok,source:r.recall?.source,draft:r.draft?.userContext})));`);
  const { stdout } = await promisify(execFile)(process.execPath, [childScript, dataPath], { timeout: 5000 });
  assert.deepEqual(JSON.parse(stdout), { ok: true, source: "cache", draft: "已填写的会议背景" });
});

test("local command sends context over stdin and preserves structured plugin errors", async t => {
  const f = fixture(t), script = path.join(f.directory, "local-command.cjs");
  fs.writeFileSync(script, `let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const p=JSON.parse(input);console.log(JSON.stringify({ok:false,fileId:process.argv[3],errorCode:'PLAUD_CONTEXT_REVISION_CONFLICT',error:'版本已变化。',stdinReceived:p.rawAnswer==='synthetic answer',argvPrivate:process.argv.some(x=>x.includes('synthetic answer'))}));process.exitCode=1;});`);
  const result = await runPlaudContextCommand({ execFile, executable: process.execPath, script,
    command: "context-submit", fileId: f.fileId, payload: { rawAnswer: "synthetic answer" }, env: { ...process.env } });
  assert.equal(result.errorCode, "PLAUD_CONTEXT_REVISION_CONFLICT");
  assert.equal(result.stdinReceived, true); assert.equal(result.argvPrivate, false);
});

test("local command never exposes child stderr or raw exceptions when output is invalid", async t => {
  const f = fixture(t), script = path.join(f.directory, "invalid-command.cjs");
  fs.writeFileSync(script, "process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('PRIVATE_FIXTURE_BODY');process.exitCode=1;});");
  const result = await runPlaudContextCommand({ execFile, executable: process.execPath, script,
    command: "context-prepare", fileId: f.fileId, payload: {}, env: { ...process.env } });
  assert.equal(result.errorCode, "PLAUD_CONTEXT_COMMAND_FAILED");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_FIXTURE_BODY/);
});

test("integration verifies current-account list ownership before any command and exposes pending writes", async t => {
  const f = fixture(t);
  const { DomiIntegration } = require("../electron/domi-integration.cjs");
  const integration = new DomiIntegration({ stateStore: f.store, plaudStateDir: f.directory,
    plaudOutputDir: f.directory, configProvider: () => ({ plaudConnectionMode: "enabled", plaudBrowser: "chrome" }),
    domiConfigPath: path.join(f.directory, "config.json"), mediaRuntime: {}, playwrightNodeModules: f.directory });
  const context = integration.getPlaudContextService();
  let commands = 0; context.runCommand = async () => { commands++; return { ...f.snapshot(), accountScope: integration.plaudContextAccountScope() }; };
  fs.writeFileSync(integration.plaudStateFile, JSON.stringify({ records: { [f.fileId]: { fileId: f.fileId, stage: "transcript_ready", transcriptPath: f.transcriptPath } } }));
  assert.equal((await integration.preparePlaudContext({ fileId: f.fileId })).errorCode, "PLAUD_CONTEXT_RECORD_UNVERIFIED");
  assert.equal(commands, 0);
  f.store.saveCache(integration.plaudListCacheKey(integration.plaudSnapshotScope()), { syncedAt: 1, items: [{ fileId: f.fileId, fileName: "Synthetic meeting" }] });
  const prepared = await integration.preparePlaudContext({ fileId: f.fileId }); assert.equal(prepared.ok, true);
  const gate = deferred(); context.runCommand = async () => { await gate.promise; return { ok: true, fileId: f.fileId }; };
  const save = integration.savePlaudContext({ ...f.submission(), accountScope: prepared.accountScope });
  assert.equal(integration.criticalOperationSnapshot().databaseWrites, 1);
  gate.resolve(); assert.equal((await save).ok, true);
  assert.equal(integration.criticalOperationSnapshot().databaseWrites, 0);
  integration.invalidatePlaudAccountSnapshot("chrome");
  assert.notEqual(integration.plaudContextAccountScope(), prepared.accountScope);
  assert.equal((await integration.preparePlaudContext({ fileId: f.fileId })).errorCode, "PLAUD_CONTEXT_RECORD_UNVERIFIED");
  assert.equal((await integration.savePlaudContext({ ...f.submission(), accountScope: prepared.accountScope })).errorCode, "PLAUD_CONTEXT_SCOPE_CHANGED");
});

test("a successful later list page proves native-context ownership without trusting workflow-only rows", async t => {
  const f = fixture(t);
  const { DomiIntegration } = require("../electron/domi-integration.cjs");
  const integration = new DomiIntegration({ stateStore: f.store, plaudStateDir: f.directory,
    plaudOutputDir: f.directory, configProvider: () => ({ plaudConnectionMode: "enabled", plaudBrowser: "chrome" }),
    domiConfigPath: path.join(f.directory, "config.json"), mediaRuntime: {}, playwrightNodeModules: f.directory });
  integration.plaudPaths = () => ({ plugin: { root: f.directory }, script: path.join(f.directory, "fixture.cjs") });
  integration.runPlaudWorker = async () => ({ ok: true, items: [{ fileId: f.fileId, fileName: "Synthetic page two" }], hasMore: false });
  const context = integration.getPlaudContextService();
  context.runCommand = async () => ({ ...f.snapshot(), accountScope: integration.plaudContextAccountScope() });
  await integration.plaudQueue({ offset: 50, limit: 50 });
  assert.equal(integration.loadPlaudSuccessfulSnapshot(), null, "later page must not overwrite the first-page cache");
  const prepared = await integration.preparePlaudContext({ fileId: f.fileId });
  assert.equal(prepared.ok, true); assert.equal(prepared.fileName, "Synthetic page two");
  assert.equal((await integration.preparePlaudContext({ fileId: "unknown-recording" })).errorCode, "PLAUD_CONTEXT_RECORD_UNVERIFIED");
});

test("an account change during submission cannot return success or clear an old account's draft", async t => {
  const f = fixture(t), binding = f.binding(), gate = deferred();
  await f.client.saveDraft({ ...binding, draft: { userContext: "应保留的旧账号草稿" } });
  f.hold = gate.promise;
  const save = f.client.save(f.submission());
  await new Promise(resolve => setImmediate(resolve));
  f.scope = hash("another-account"); gate.resolve();
  assert.equal((await save).errorCode, "PLAUD_CONTEXT_SCOPE_CHANGED");
  assert.equal(f.client.activeWrites, 0);
  const old = f.client.load("draft", binding.accountScope, binding.fileId, binding.transcriptSha256);
  assert.equal(old.draft.userContext, "应保留的旧账号草稿");
});

test("scope recovery offers only bindings after current-list and unchanged-transcript proof", async t => {
  const f = fixture(t), old = f.scope, prior = f.snapshot();
  prior.context.rawAnswer = "PRIVATE_OLD_ANSWER";
  f.scope = hash("relogged-scope");
  f.commandResult = prior;
  const request = { fileId: f.fileId, accountScope: old, expectedTranscriptSha256: prior.transcript.sha256 };
  const offered = await f.client.prepare(request);
  assert.equal(offered.errorCode, "PLAUD_CONTEXT_SCOPE_RECOVERY_REQUIRED");
  assert.equal(offered.scopeRecovery.accountScope, f.scope);
  assert.doesNotMatch(JSON.stringify(offered), /PRIVATE_OLD_ANSWER|医院|transcript.md/);
  assert.equal(offered.context, undefined); assert.equal(offered.recall, undefined);
  assert(f.calls.every(call => call.command === "context-prepare"));
  f.owned = false;
  f.client.store("owner", f.scope, f.fileId, "", { fileId: f.fileId });
  assert.equal((await f.client.prepare(request)).errorCode, "PLAUD_CONTEXT_RECORD_UNVERIFIED", "owner cache cannot authorize an account migration");
  f.owned = true;
  assert.equal((await f.client.prepare({ ...request, expectedTranscriptSha256: hash("changed") })).errorCode, "PLAUD_CONTEXT_TRANSCRIPT_CHANGED");
  assert.equal((await f.client.prepare({ fileId: f.fileId, accountScope: old })).errorCode, "PLAUD_CONTEXT_SCOPE_CHANGED");
  f.commandResult = { ...prior, stage: "managed", disposition: "advanced" };
  assert.equal((await f.client.prepare(request)).errorCode, "PLAUD_CONTEXT_STAGE_CONFLICT");
});

test("confirmed scope recovery deduplicates writes, retains original answers and never runs a workflow", async t => {
  const f = fixture(t), old = f.scope, prior = f.snapshot();
  f.scope = hash("relogged-scope");
  f.commandResult = { ...prior, accountScope: f.scope, stage: "reviewed", disposition: "advanced",
    context: { ...prior.context, rawAnswer: " original answer\nfull text ", sourceTurnId: "original-turn" } };
  const request = { action: "recover_scope", confirmed: true, fileId: f.fileId, accountScope: f.scope,
    previousAccountScope: old, expectedTranscriptSha256: prior.transcript.sha256, expectedRecordRevision: prior.recordRevision };
  const gate = deferred(); f.hold = gate.promise;
  const a = f.client.save(request), b = f.client.save(request);
  gate.resolve(); const results = await Promise.all([a, b]);
  assert.equal(results[0].ok, true); assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].context.rawAnswer, " original answer\nfull text ");
  assert.equal(results[0].context.sourceTurnId, "original-turn");
  assert.equal(results[0].stage, "reviewed");
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command, "context-rebind");
  assert.equal(f.client.activeWrites, 0);
  assert.equal((await f.client.save({ ...request, confirmed: false })).errorCode, "PLAUD_CONTEXT_REQUEST_INVALID");
  f.owned = false;
  assert.equal((await f.client.save(request)).errorCode, "PLAUD_CONTEXT_RECORD_UNVERIFIED");
});

test("a lost scope-recovery response can be explicitly replayed after reload without disclosing old context", async t => {
  const f = fixture(t), old = f.scope, prior = f.snapshot();
  f.scope = hash("relogged-scope");
  f.command = async (_command, fileId, payload) => payload.accountScope === old
    ? { ok: false, fileId, errorCode: "PLAUD_CONTEXT_SCOPE_MISMATCH" }
    : { ...prior, accountScope: f.scope, recordRevision: hash("new-revision"), context: { rawAnswer: "PRIVATE" },
      scopeRecoveryBinding: { previousAccountScope: old, previousRecordRevision: prior.recordRevision, transcriptSha256: prior.transcript.sha256 } };
  const result = await f.client.prepare({ fileId: f.fileId, accountScope: old, expectedTranscriptSha256: prior.transcript.sha256 });
  assert.equal(result.errorCode, "PLAUD_CONTEXT_SCOPE_RECOVERY_REQUIRED");
  assert.equal(result.scopeRecovery.recordRevision, prior.recordRevision);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
