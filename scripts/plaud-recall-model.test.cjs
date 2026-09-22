const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { generatePlaudRecall, validateRecallOutput, PlaudRecallService } = require("../electron/plaud-recall-model.cjs");

const source = "这次主要讨论仓库拣选机器人的客户试点。硬件采购与自研成本还在比较，下一轮融资计划用于扩大客户部署。";
const response = JSON.stringify({ summary: "仓储机器人项目交流，讨论客户试点、硬件采购与自研成本，以及下一轮融资安排。",
  conversationType: "创业公司交流", keywords: ["仓库拣选", "客户试点", "杜撰名称"], evidence: ["这次主要讨论仓库拣选机器人的客户试点。"] });

function fixture({ mode = "success" } = {}) {
  let options, finishThread;
  const calls = [];
  const closed = [];
  return { calls, closed, options: () => options, finishThread: () => finishThread?.({ thread: { id: "recall-thread" } }),
    input: { sourceText: source, version: "test", runtimeProvider: () => ({ codexPath: "/synthetic/codex" }), timeoutMs: 1000,
      createClient: value => {
        options = value;
        return { close: () => closed.push(true), request: async (method, params) => {
          calls.push({ method, params });
          if (method === "thread/start") {
            if (mode === "deferred") return new Promise(resolve => { finishThread = resolve; });
            return { thread: { id: "recall-thread" } };
          }
          const notify = (method, extra) => options.onNotification(method, { threadId: "recall-thread", turnId: "recall-turn", ...extra });
          options.onNotification("turn/completed", { threadId: "other-thread", turn: { status: "failed" } });
          if (mode === "silent") return { turn: { id: "recall-turn" } };
          if (mode === "tool") notify("item/started", { item: { type: "mcpToolCall" } });
          else if (mode === "input") options.onUserInputRequest({ id: "unexpected" });
          else {
            notify("item/completed", { item: { type: "agentMessage", text: mode === "invalid" ? "not JSON" : response } });
            notify("turn/completed", { turn: { id: "recall-turn", status: "completed" } });
          }
          return { turn: { id: mode === "wrong-turn" ? "wrong" : "recall-turn" } };
        } };
      }
    }
  };
}

test("recall keeps verbatim evidence, drops invented keywords and rejects missing source support", () => {
  const result = validateRecallOutput(response, source);
  assert.deepEqual(result.keywords, ["仓库拣选", "客户试点"]);
  assert.equal(result.source, "model");
  assert.throws(() => validateRecallOutput(response.replace("这次主要讨论仓库拣选机器人的客户试点。", "原文不存在这个融资金额和公司名称"), source), { code: "PLAUD_RECALL_UNGROUNDED" });
  assert.throws(() => validateRecallOutput("{}", source), { code: "PLAUD_RECALL_INVALID" });
});

test("a recall uses a disposable thread with tools disabled and never invokes workflow APIs", async () => {
  const f = fixture();
  const result = await generatePlaudRecall(f.input);
  assert.equal(result.summary, JSON.parse(response).summary);
  assert.deepEqual(f.calls.map(x => x.method), ["thread/start", "turn/start"]);
  assert.equal(f.calls[0].params.ephemeral, true);
  assert.deepEqual(f.calls[0].params.environments, []);
  assert.equal(f.calls[0].params.sandbox, "read-only");
  assert.equal(f.calls[0].params.config["features.plugins"], false);
  assert.equal(f.calls[0].params.config["features.shell_tool"], false);
  assert.equal(f.calls[1].params.effort, "low");
  assert.equal(f.calls[1].params.outputSchema.required.includes("evidence"), true);
  assert.equal(fs.existsSync(f.options().cwd), false);
  assert.ok(f.closed.length > 0);
});

for (const mode of ["tool", "input", "invalid", "wrong-turn", "silent"]) {
  test(`recall safely falls back for ${mode} without leaving a live process`, async () => {
    const f = fixture({ mode });
    await assert.rejects(generatePlaudRecall({ ...f.input, timeoutMs: 20 }));
    assert.ok(f.closed.length > 0);
    assert.equal(fs.existsSync(f.options().cwd), false);
  });
}

test("timeout includes thread startup and a late response cannot start a model turn", async () => {
  const f = fixture({ mode: "deferred" });
  await assert.rejects(generatePlaudRecall({ ...f.input, timeoutMs: 20 }), { code: "PLAUD_RECALL_TIMEOUT" });
  f.finishThread();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.map(x => x.method), ["thread/start"]);
});

test("submitting context can cancel only its optional recall, including during startup", async () => {
  const f = fixture({ mode: "deferred" });
  const controller = new AbortController();
  const pending = generatePlaudRecall({ ...f.input, signal: controller.signal });
  controller.abort(new Error("context already submitted"));
  await assert.rejects(pending, /already submitted/);
  f.finishThread();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
});

test("duplicate hints share one bounded request; account and transcript bindings remain independent", async () => {
  let calls = 0, resolve;
  const service = new PlaudRecallService({ generate: () => { calls++; return new Promise(done => { resolve = done; }); }, maxConcurrent: 1 });
  const first = service.run("account-a:file:hash-a", {});
  const duplicate = service.run("account-a:file:hash-a", {});
  assert.equal(first, duplicate);
  await assert.rejects(service.run("account-b:file:hash-a", {}), { code: "PLAUD_RECALL_BUSY" });
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 1);
  resolve({ summary: "same result" });
  await first;
  assert.equal(service.pending.size, 0);
});

test("failed summaries do not burn tokens on every render or block other recordings", async () => {
  let now = 1_000, calls = 0;
  const service = new PlaudRecallService({ now: () => now, generate: async () => { calls++; throw new Error("offline"); } });
  await assert.rejects(service.run("a:file:hash", {}));
  await assert.rejects(service.run("a:file:hash", {}), { code: "PLAUD_RECALL_COOLDOWN" });
  assert.equal(calls, 1);
  await assert.rejects(service.run("a:another:hash", {}));
  assert.equal(calls, 2);
  now += 60_001;
  await assert.rejects(service.run("a:file:hash", {}));
  assert.equal(calls, 3);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const nextTick = () => new Promise(resolve => setImmediate(resolve));

// Exercise the real IPC boundary: a model-only service test cannot catch
// cancellation before preparation returns or deduplication during persistence.
function ipcFixture({ integration = {}, withStableClient = operation => operation() } = {}) {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const start = main.indexOf("function plaudContextFailure(");
  const end = main.indexOf('ipcMain.handle("domi:plaud-list"', start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Map();
  const calls = { prepare: 0, generate: 0, save: 0 };
  const recall = validateRecallOutput(response, source);
  const service = new PlaudRecallService({ generate: async () => { calls.generate++; return recall; } });
  const context = {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getDomiPluginActivationGate: () => ({ withStableClient }),
    getDomiIntegration: () => ({
      preparePlaudRecall: async () => { calls.prepare++; return { ok: true, sourceText: source }; },
      savePlaudRecall: async () => { calls.save++; return { ok: true }; },
      savePlaudContext: async () => ({ ok: true }), ...integration
    }),
    plaudRecallService: service, updateRestartPreparing: false, applicationQuitFlushStarted: false,
    serviceCoordinator: { invalidate() {} }, getPreparedCodexRuntime: () => ({}),
    app: { getVersion: () => "fixture" }, appendRuntimeLog() {}, Error
  };
  vm.runInNewContext(main.slice(start, end), context);
  const request = { fileId: "synthetic-recording", accountScope: "synthetic-scope", expectedTranscriptSha256: "a".repeat(64) };
  return { context, calls, service, recall, request,
    run: (override = {}) => handlers.get("domi:plaud-context-recall")(undefined, { ...request, ...override }),
    submit: () => handlers.get("domi:plaud-context-submit")(undefined, request) };
}

test("actual recall IPC deduplicates preparation and the full cache persistence window", async () => {
  const prepared = deferred(), persisted = deferred();
  let prepareCalls = 0, saveCalls = 0;
  const f = ipcFixture({ integration: {
    preparePlaudRecall: async () => { prepareCalls++; return prepared.promise; },
    savePlaudRecall: async () => { saveCalls++; return persisted.promise; }
  } });
  const first = f.run(), duplicateBeforePrepare = f.run();
  await nextTick();
  assert.equal(prepareCalls, 1);
  prepared.resolve({ ok: true, sourceText: source });
  await nextTick();
  assert.equal(f.calls.generate, 1);
  assert.equal(saveCalls, 1);
  const duplicateDuringSave = f.run();
  await nextTick();
  assert.equal(f.calls.generate, 1);
  assert.equal(prepareCalls, 1);
  persisted.resolve({ ok: true });
  const results = await Promise.all([first, duplicateBeforePrepare, duplicateDuringSave]);
  assert.ok(results.every(result => result.ok && result.recall === f.recall));
  assert.equal(f.service.pending.size, 0);
});

test("successful context submission cancels recall while local preparation is pending", async () => {
  const prepared = deferred();
  const f = ipcFixture({ integration: { preparePlaudRecall: () => prepared.promise } });
  const pending = f.run();
  await nextTick();
  assert.equal((await f.submit()).ok, true);
  prepared.resolve({ ok: true, sourceText: source });
  const result = await pending;
  assert.equal(result.errorCode, "PLAUD_RECALL_CANCELLED");
  assert.equal(f.calls.generate, 0);
  assert.equal(f.calls.save, 0);
});

test("closing recalls prevents late preparation from starting a model and quit rejects new work", async () => {
  const prepared = deferred();
  const f = ipcFixture({ integration: { preparePlaudRecall: () => prepared.promise } });
  const pending = f.run();
  await nextTick();
  f.context.applicationQuitFlushStarted = true;
  f.service.close();
  prepared.resolve({ ok: true, sourceText: source });
  assert.equal((await pending).errorCode, "PLAUD_RECALL_CANCELLED");
  assert.equal((await f.run({ fileId: "another-recording" })).ok, false);
  assert.equal(f.calls.generate, 0);
  assert.equal(f.calls.save, 0);
});

test("cancellation while waiting for plugin activation cannot start cache persistence", async () => {
  const activated = deferred();
  let leases = 0;
  const f = ipcFixture({ withStableClient: operation => ++leases === 2 ? activated.promise.then(operation) : operation() });
  const pending = f.run();
  await nextTick();
  assert.equal(f.calls.generate, 1);
  assert.equal(leases, 2);
  assert.equal((await f.submit()).ok, true);
  activated.resolve();
  assert.equal((await pending).errorCode, "PLAUD_RECALL_CANCELLED");
  assert.equal(f.calls.save, 0);
});

test("a failed context submission does not cancel a still useful recall", async () => {
  const prepared = deferred();
  const f = ipcFixture({ integration: {
    preparePlaudRecall: () => prepared.promise, savePlaudContext: async () => ({ ok: false })
  } });
  const pending = f.run();
  await nextTick();
  assert.equal((await f.submit()).ok, false);
  prepared.resolve({ ok: true, sourceText: source });
  assert.equal((await pending).ok, true);
  assert.equal(f.calls.generate, 1);
  assert.equal(f.calls.save, 1);
});

test("a verified rich recall cache avoids model calls and cache writes at the IPC boundary", async () => {
  const cachedRecall = { ...validateRecallOutput(response, source), source: "cache" };
  const f = ipcFixture({ integration: { preparePlaudRecall: async () => ({ ok: true, cachedRecall }) } });
  assert.equal((await f.run()).recall, cachedRecall);
  assert.equal(f.calls.generate, 0);
  assert.equal(f.calls.save, 0);
});
