const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { newestRuntime, visibleModels } = require("../electron/codex-discovery.cjs");

test("only a verified, strictly newer executable can replace the managed runtime", async () => {
  const managed = { path: "/managed", version: "codex-cli 0.153.4" };
  const versions = { old: "0.140.0", equal: "0.153.4", preview: "0.169.0-alpha.11.1", stable: "0.169.0" };
  const verify = async ({ binary }) => {
    if (!versions[binary]) throw Error("Signature verification failed");
    return versions[binary];
  };
  const entries = (...names) => names.map(binary => ({ binary, identity: binary }));
  assert.equal(await newestRuntime(managed, entries("old", "equal", "untrusted"), verify), managed);
  assert.equal((await newestRuntime(managed, entries("untrusted", "preview"), verify)).path, "preview");
  assert.equal((await newestRuntime(managed, entries("stable", "preview"), verify)).path, "stable");
});

test("model discovery reads all pages, deduplicates IDs, and rejects stalled pagination", async () => {
  const models = [{ id: "first" }, { id: "new", isDefault: true }];
  const request = async (method, { cursor, includeHidden }) => {
    assert.equal(method, "model/list");
    assert.equal(includeHidden, false);
    return cursor ? { data: models } : { data: [models[0]], nextCursor: "second" };
  };
  assert.deepEqual((await visibleModels({ request }, 5000)).data, models);
  await assert.rejects(visibleModels({ request: async () => ({ data: [], nextCursor: "same" }) }, 5000));
});

test("upgrading in place defers through a running turn, switches once, and respects a custom path", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const settings = { codexPath: "/managed" };
  let identity = "v1", custom = "", resets = 0, preparations = 0;
  const activeRuns = new Map(), startingCodexRunIds = new Set();
  const context = vm.createContext({
    activeRuns, startingCodexRunIds, pendingRunPostProcessing: new Map(),
    codexThreadReclaimer: { pending: new Set() }, applicationQuitFlushStarted: false,
    updateRestartPreparing: false, domiPluginActivationGate: null, codexClient: { pending: new Map() },
    activeCodexRuntime: null, codexRuntimeReadinessPromise: null, runtimeSourcesKey: "",
    app: { isPackaged: true }, resolveCodexBinary: p => p, stamp: p => p, appendRuntimeLog() {},
    resetCodexClient: () => { resets++; }, getAppSettings: () => ({
      load: () => ({ settings }), save: patch => Object.assign(settings, patch)
    }),
    codexSources: () => ({ key: identity + custom, candidates: [{ identity }], custom,
      manager: { readState: () => ({}) } }),
    getCodexBootstrap: () => ({
      install: async () => { preparations++; return { ok: true, path: "/managed" }; },
      status: async p => ({ ok: true, path: p })
    }),
    newestRuntime: async (_managed, [candidate]) => ({ ok: true, path: "/desktop", identity: candidate.identity })
  });
  vm.runInContext(source.slice(source.indexOf("function canSwitchCodexRuntime("), source.indexOf("// Passive checks")), context);
  const ready = context.ensureCodexRuntimeReady;
  await Promise.all([ready(), ready()]);
  assert.equal(preparations, 1);
  assert.equal(settings.codexPath, "/desktop");
  const initial = resets;
  identity = "v2";
  activeRuns.set("old", {});
  assert.equal((await ready()).identity, "v1");
  activeRuns.clear();
  startingCodexRunIds.add("next");
  assert.equal((await ready()).identity, "v1");
  assert.equal((await ready("next")).identity, "v2");
  startingCodexRunIds.clear();
  await ready();
  assert.equal(resets, initial + 1);
  custom = "/custom";
  assert.equal((await ready()).path, custom);
});
