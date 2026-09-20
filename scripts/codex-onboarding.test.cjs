const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { workflowCapabilities, verifyWorkspace, verifyCodexWorkflow } = require("../electron/codex-onboarding.cjs");
const requirements = require("../shared/model-requirements.json");
const models = Object.values(requirements).map(item => ({ id: item.model, supportedReasoningEfforts: [{ id: item.effort }] }));

test("onboarding checks the same model and reasoning requirements as real work without downgrade", () => {
  assert.equal(workflowCapabilities(models).ok, true);
  assert.equal(workflowCapabilities(models.slice(1)).ok, false);
  assert.equal(workflowCapabilities(models.map(model => ({ ...model, supportedReasoningEfforts: [{ id: "low" }] }))).ok, false);
  assert.equal(workflowCapabilities([]).ok, false);
});

test("workspace validation creates and reads a private temporary probe without changing user files", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-workspace-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "keep.md"), "unchanged");
  verifyWorkspace(root);
  assert.deepEqual(fs.readdirSync(root), ["keep.md"]);
  assert.equal(fs.readFileSync(path.join(root, "keep.md"), "utf8"), "unchanged");
  assert.throws(() => verifyWorkspace(path.join(root, "keep.md")));
  assert.throws(() => verifyWorkspace("relative"));
});

function fixture(t, { events = "success", deferThread = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-onboard-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [], stages = [];
  let options, closed = 0, resolveThread;
  const runtime = { codexPath: "/synthetic/codex", env: { HTTPS_PROXY: "http://127.0.0.1:8899", DOMI_CONFIG_PATH: "/synthetic/config" } };
  const request = { runtime, models, workspacePath: root, version: "9.9.0", timeoutMs: 2000,
    setStage: stage => stages.push(stage),
    createClient: value => {
      options = value;
      return { close: () => { closed++; }, request: async (method, params) => {
        calls.push({ method, params });
        if (method === "thread/start") {
          if (deferThread) return new Promise(resolve => { resolveThread = resolve; });
          return { thread: { id: "test-thread" }, model: events === "wrong-model" ? "other" : requirements.premium.model, reasoningEffort: events === "wrong-effort" ? "low" : requirements.premium.effort };
        }
        const marker = params.input[0].text.match(/DOMI_CHECK_[a-f0-9]+/)[0];
        const notify = (method, extra) => options.onNotification(method, { threadId: "test-thread", turnId: "test-turn", ...extra });
        if (events === "silent") return { turn: { id: "test-turn" } };
        if (events !== "missing-tool") notify("item/completed", { item: { type: "commandExecution", exitCode: 0, aggregatedOutput: marker } });
        notify("item/completed", { item: { type: "agentMessage", text: marker } });
        notify("turn/completed", { turn: { id: "test-turn", status: events === "failed" ? "failed" : "completed" } });
        return { turn: { id: events === "wrong-turn" ? "other" : "test-turn" } };
      } };
    } };
  return { request, calls, stages, runtime, root, options: () => options, closed: () => closed,
    finishThread: () => resolveThread({ thread: { id: "test-thread" } }) };
}

test("verification uses app-server, exact prepared runtime, premium policy and ephemeral tool evidence", async t => {
  const f = fixture(t);
  const result = await verifyCodexWorkflow(f.request);
  assert.equal(result.ok, true);
  assert.equal(result.workspaceOk, true);
  assert.equal(f.options().runtimeProvider(), f.runtime);
  assert.equal(f.calls[0].params.ephemeral, true);
  assert.equal(f.calls[0].params.sandbox, "read-only");
  assert.equal(f.calls[1].params.model, requirements.premium.model);
  assert.equal(f.calls[1].params.effort, requirements.premium.effort);
  assert.deepEqual(f.stages, ["workspace", "model-tool"]);
  assert.equal(f.closed(), 1);
  assert.equal(fs.existsSync(f.options().cwd), false);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

for (const events of ["missing-tool", "failed", "wrong-turn", "wrong-model", "wrong-effort"]) test(`verification rejects ${events} even when model echoes the marker`, async t => {
  const f = fixture(t, { events });
  await assert.rejects(verifyCodexWorkflow(f.request));
  assert.equal(f.closed(), 1);
  assert.equal(fs.existsSync(f.options().cwd), false);
});

test("unsupported capabilities never start an AI task", async t => {
  const f = fixture(t);
  const result = await verifyCodexWorkflow({ ...f.request, models: [] });
  assert.equal(result.ok, false);
  assert.equal(result.diagnosticCode, "DOMI_WORKFLOW_MODELS_UNAVAILABLE");
  assert.equal(f.calls.length, 0);
});

test("canceling pending thread creation closes only the disposable test and prevents a late turn", async t => {
  const f = fixture(t, { deferThread: true });
  const controller = new AbortController();
  const pending = verifyCodexWorkflow({ ...f.request, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, /cancelled/);
  f.finishThread();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.map(item => item.method), ["thread/start"]);
  assert.equal(fs.existsSync(f.options().cwd), false);
});

test("an unresponsive model is bounded and the temporary process is closed", async t => {
  const f = fixture(t, { events: "silent" });
  await assert.rejects(verifyCodexWorkflow({ ...f.request, timeoutMs: 20 }), /超时/);
  assert.ok(f.closed() >= 1);
  assert.equal(fs.existsSync(f.options().cwd), false);
});
