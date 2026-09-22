const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const {
  DomiPluginManager,
  DomiPluginActivationGate,
  checkRemoteWithinBudget,
  codexCheckFailureDetails,
  pluginCheckFailure,
  compareVersions,
  selectPreferredCandidate
} = require("../electron/domi-plugin-manager.cjs");

assert(compareVersions("0.1.7+codex.20260716121308", "0.1.7+codex.20260716093024") > 0);
assert(compareVersions("0.2.0", "0.1.99") > 0);
assert.equal(compareVersions("0.1.7", "0.1.7"), 0);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-manager-unit-"));
try {
  const bundledRoot = path.join(temporaryRoot, "bundled");
  const lockPath = path.join(temporaryRoot, "domi-plugin-lock.json");
  fs.mkdirSync(path.join(bundledRoot, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(bundledRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "domi",
    version: "0.1.7+codex.20260716121308"
  }));
  fs.writeFileSync(path.join(bundledRoot, "fixture.txt"), "bundled plugin\n");
  fs.writeFileSync(lockPath, JSON.stringify({
    pluginVersion: "0.1.7+codex.20260716121308",
    gitCommit: "fixture-commit",
    sha256: "fixture-sha"
  }));

  const manager = new DomiPluginManager({
    userDataPath: path.join(temporaryRoot, "user-data"),
    bundledPluginRoot: bundledRoot,
    bundledLockPath: lockPath
  });
  const info = manager.bundledInfo();
  assert.equal(info.manifest.name, "domi");
  assert.equal(manager.writeManagedMarketplace(info), true);
  assert.equal(manager.writeManagedMarketplace(info), false);

  const copiedManifest = path.join(
    temporaryRoot,
    "user-data",
    "runtime",
    "domi-marketplace",
    "plugins",
    "domi",
    ".codex-plugin",
    "plugin.json"
  );
  assert.equal(JSON.parse(fs.readFileSync(copiedManifest, "utf8")).name, "domi");

  const remoteRoot = path.join(temporaryRoot, "remote");
  fs.mkdirSync(path.join(remoteRoot, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(remoteRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "domi",
    version: "0.2.0+codex.20260727090000"
  }));
  fs.writeFileSync(path.join(remoteRoot, "fixture.txt"), "remote plugin\n");
  const remoteInfo = {
    source: "remote-release",
    root: remoteRoot,
    manifest: {
      name: "domi",
      version: "0.2.0+codex.20260727090000"
    },
    lock: {
      pluginVersion: "0.2.0+codex.20260727090000",
      gitCommit: "remote-commit",
      sha256: "remote-sha",
      publishedAt: "2026-07-27T09:00:00.000Z"
    }
  };
  assert.equal(selectPreferredCandidate([info, remoteInfo]), remoteInfo);

  const transaction = manager.prepareManagedMarketplace(remoteInfo);
  assert.equal(transaction.changed, true);
  const copiedFixture = path.join(path.dirname(copiedManifest), "..", "fixture.txt");
  assert.equal(fs.readFileSync(copiedFixture, "utf8"), "remote plugin\n");
  transaction.rollback();
  assert.equal(fs.readFileSync(copiedFixture, "utf8"), "bundled plugin\n");
  assert.equal(manager.installedInfo().manifest.version, info.manifest.version);

  manager.prepareManagedMarketplace(remoteInfo);
  const recoveredManager = new DomiPluginManager({
    userDataPath: path.join(temporaryRoot, "user-data"),
    bundledPluginRoot: bundledRoot,
    bundledLockPath: lockPath
  });
  assert.equal(fs.readFileSync(copiedFixture, "utf8"), "bundled plugin\n");
  assert.equal(recoveredManager.installedInfo().manifest.version, info.manifest.version);

  const committedTransaction = recoveredManager.prepareManagedMarketplace(remoteInfo);
  committedTransaction.finalize();
  assert.equal(recoveredManager.installedInfo().manifest.version, remoteInfo.manifest.version);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

async function verifyBoundedRemoteStartup() {
  let resolveCheck;
  const cachedCandidate = { source: "remote-release", manifest: { version: "cached" } };
  const updater = {
    cachedCandidate: () => cachedCandidate,
    check: () => new Promise((resolve) => {
      resolveCheck = resolve;
    })
  };
  const startedAt = Date.now();
  const result = await checkRemoteWithinBudget(updater, 30);
  assert.ok(Date.now() - startedAt < 250);
  assert.equal(result.reason, "background-refresh");
  assert.equal(result.candidate, cachedCandidate);
  resolveCheck({ ok: true, checked: true, candidate: null });

  const immediate = await checkRemoteWithinBudget({
    check: async () => ({ ok: true, checked: true, candidate: null })
  }, 1_000);
  assert.equal(immediate.checked, true);
}

async function verifyActivationGate() {
  let busy = true;
  let current = { manifest: { version: "0.3.20" } };
  let registered = true;
  let ensureCalls = 0;
  let resetCalls = 0;
  let finishEnsure;
  let finishReset;
  const gate = new DomiPluginActivationGate({
    isBusy: () => busy,
    installedInfo: () => current,
    ensure: () => {
      ensureCalls += 1;
      return new Promise((resolve) => { finishEnsure = resolve; });
    },
    onActivated: () => {
      resetCalls += 1;
      return new Promise((resolve) => { finishReset = resolve; });
    }
  });
  const deferred = await gate.ensureWhenIdle({ enabled: true });
  assert.equal(deferred.ok, true);
  assert.equal(deferred.deferred, true);
  assert.equal(deferred.version, "0.3.20");
  assert.equal(ensureCalls, 0);
  assert.equal(resetCalls, 0);
  current = null;
  const firstInstallWhileBusy = await gate.ensureWhenIdle({ enabled: true });
  assert.equal(firstInstallWhileBusy.ok, false);
  assert.match(firstInstallWhileBusy.error, /尚未安装/);
  assert.equal(ensureCalls, 0);
  assert.equal((await gate.ensureWhenIdle({ enabled: false })).ok, true);
  assert.equal(gate.pending, null);

  busy = false;
  const activation = gate.ensureWhenIdle({ enabled: true });
  assert.ok(gate.pending, "activation slot is claimed before the first async yield");
  busy = true; // A new task arrives while plugin installation is starting.
  assert.equal(gate.ensureWhenIdle({ enabled: true }), activation);
  let taskEnteredClient = false;
  const waitingTask = gate.waitForActivation().then(() => { taskEnteredClient = true; });
  await Promise.resolve();
  assert.equal(ensureCalls, 1);
  assert.equal(taskEnteredClient, false);
  finishEnsure({ ok: true, updated: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resetCalls, 1);
  assert.equal(taskEnteredClient, false, "new task must wait through client reset too");
  finishReset();
  await Promise.all([activation, waitingTask]);
  assert.equal(taskEnteredClient, true);
  assert.equal(gate.pending, null);

  let attempts = 0;
  const failingGate = new DomiPluginActivationGate({
    isBusy: () => false,
    installedInfo: () => current,
    ensure: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("installation failed; rollback complete");
      return { ok: true, updated: false };
    },
    onActivated: () => assert.fail("failed install must not reset the client")
  });
  const failedActivation = failingGate.ensureWhenIdle({ enabled: true });
  await Promise.all([
    assert.rejects(failedActivation, /rollback complete/),
    assert.rejects(failingGate.waitForActivation(), /rollback complete/)
  ]);
  assert.equal(failingGate.pending, null, "failure releases the slot for retry");
  assert.equal((await failingGate.ensureWhenIdle({ enabled: true })).ok, true);
  const missingBundleGate = new DomiPluginActivationGate({
    isBusy: () => false,
    installedInfo: () => null,
    ensure: async () => ({ ok: false, error: "安装包未包含 domi 插件。" }),
    onActivated: () => assert.fail("an incomplete installation must not reset the client")
  });
  const missingBundle = missingBundleGate.ensureWhenIdle({ enabled: true });
  await assert.rejects(missingBundleGate.waitForActivation(), /未包含/);
  assert.equal((await missingBundle).ok, false);
  assert.equal(missingBundleGate.pending, null);

  const failedInstall = missingBundleGate.ensureWhenIdle({ enabled: true });
  let checkedAfterFailure = false;
  const diagnosticRead = missingBundleGate.withStableClient(async () => {
    checkedAfterFailure = true;
    assert.equal(missingBundleGate.readers, 1);
    assert.equal(missingBundleGate.pending, null, "diagnostic waits for activation to drain");
    return { ok: true };
  }, { allowFailedActivation: true });
  assert.equal((await failedInstall).ok, false);
  assert.equal((await diagnosticRead).ok, true);
  assert.equal(checkedAfterFailure, true);
  assert.equal(missingBundleGate.readers, 0);

  // Execute the production health-check function, not a reimplementation:
  // a busy first installation must not produce a false healthy result.
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const implementation = main.match(/async function runCodexCheck\([\s\S]*?\n\}\n/)[0];
  const context = {
    process: { env: {} }, app: { isPackaged: true },
    codexCheckRuntimeKey: () => "test-runtime", codexCheckGeneration: 0,
    codexClient: null, codexNetworkDiagnostic: { ok: true, status: "direct" },
    codexCheckFailureDetails, pluginCheckFailure,
    ensureDemoWorkspace() {}, ensureCodexRuntimeReady: async () => {},
    throwIfCodexCheckAborted() {}, codexCheckTimeout: (_deadline, maximum) => maximum,
    getAppSettings: () => ({ load: () => ({ settings: { codexPath: "codex" } }) }),
    getCodexRuntime: () => ({ authMode: "chatgpt", codexPath: "codex", env: {} }),
    getPreparedCodexRuntime: async () => ({ authMode: "chatgpt", codexPath: "codex", env: {} }),
    resolveCodexBinary: () => "codex", codexEnvironment: () => ({}),
    getDomiPluginActivationGate: () => gate,
    getDomiPluginManager: () => ({ checkInstalled: async () => {
      assert(gate.readers >= 1, "busy check reads actual registry under the full health-probe lease");
      return { ok: Boolean(current) && registered, status: registered ? "ready" : "missing" };
    } }),
    execFileAsync: async () => ({ stdout: "codex test" }),
    CODEX_VERSION_CHECK_TIMEOUT_MS: 100, CODEX_HEALTH_REQUEST_TIMEOUT_MS: 100,
    demoWorkspace: "/isolated-test-workspace", appendRuntimeLog() {},
    isSelectedCodexConnectionReady: () => true,
    resetCodexClient: () => assert.fail("runCodexCheck cannot reset after releasing the activation slot"),
    getCodexClient: () => ({ request: async (method) => method === "account/read"
      ? { account: { type: "chatgpt" }, requiresOpenaiAuth: false }
      : method === "model/list" ? { data: [] } : { config: {} } })
  };
  vm.createContext(context);
  vm.runInContext(implementation, context);
  const notReady = await context.runCodexCheck({});
  assert.equal(notReady.ok, false);
  assert.equal(notReady.pluginSetup.ok, false);
  assert.match(notReady.error, /自动更新/);
  assert.equal(notReady.pluginSetup.reason, "activation-pending");
  current = { manifest: { version: "0.3.20" } };
  const readyWithExisting = await context.runCodexCheck({});
  assert.equal(readyWithExisting.ok, true);
  assert.equal(readyWithExisting.pluginSetup.deferred, true);
  registered = false;
  const filesWithoutRegistration = await context.runCodexCheck({});
  assert.equal(filesWithoutRegistration.ok, false, "source files alone do not prove plugin activation");
  assert.equal(filesWithoutRegistration.connectionOk, true);
  assert.equal(filesWithoutRegistration.pluginSetup.status, "deferred");
  assert.equal(filesWithoutRegistration.pluginSetup.reason, "activation-pending");
  assert.equal(ensureCalls, 1, "busy connection checks do not install/remove plugins");
  assert.equal(resetCalls, 1);
  const realRun = main.slice(main.indexOf("async function runCodex(sender, payload)"), main.indexOf("async function stopCodex("));
  assert(realRun.indexOf("await getDomiPluginActivationGate().waitForActivation();") < realRun.indexOf("const client = getCodexClient();"));
  assert.match(main, /isBusy: \(\) => updateRestartPreparing\s*\|\| applicationQuitFlushStarted\s*\|\| !codexClientIdleForSkillReload\(activeRuns, startingCodexRunIds\)/);
  gate.dispose();
}

async function verifyRecoveryReaderLease() {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const implementation = main.match(/async function recoverCodexThread\([\s\S]*?\n\}\n/)[0];
  const events = [];
  let finishActivation;
  let finishRead;
  let rejectRead;
  const gate = new DomiPluginActivationGate({
    isBusy: () => false,
    installedInfo: () => ({ manifest: { version: "installed" } }),
    ensure: () => {
      events.push("install");
      return new Promise((resolve) => { finishActivation = resolve; });
    },
    onActivated: () => { events.push("reset"); }
  });
  const context = {
    activeRuns: new Map(),
    resolveCodexActiveRun: () => ({ run: null, ambiguousCandidates: [] }),
    getDomiPluginActivationGate: () => gate,
    getCodexClient: () => ({ request: (method, params) => {
      assert.equal(method, "thread/read", "recovery must never write, send, or start a task");
      assert.equal(params.threadId, "recovered-thread");
      assert.equal(params.includeTurns, true);
      events.push("read");
      return new Promise((resolve, reject) => { finishRead = resolve; rejectRead = reject; });
    } }),
    classifyCodexTurnStatus: require("../electron/codex-turn-status.cjs").classifyCodexTurnStatus,
    normalizedSlidesDeliveryPolicy: () => null
  };
  const completedResponse = { thread: { turns: [{
    id: "last-turn", status: "completed", items: [{
      type: "agentMessage", phase: "final_answer", text: "Original completed result"
    }]
  }] } };
  vm.createContext(context);
  vm.runInContext(implementation, context);

  const readingFirst = context.recoverCodexThread("recovered-thread");
  assert.equal(gate.readers, 1);
  const deferred = await gate.ensureWhenIdle({ enabled: true });
  assert.equal(deferred.deferred, true);
  assert.deepEqual(events, ["read"], "activation cannot remove plugins or reset during recovery");
  finishRead(completedResponse);
  const firstResult = await readingFirst;
  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.status, "completed");
  assert.equal(firstResult.output, "Original completed result");
  assert.equal(gate.readers, 0);

  const activationFirst = gate.ensureWhenIdle({ enabled: true });
  const readingAfter = context.recoverCodexThread("recovered-thread");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["read", "install"]);
  assert.equal(gate.readers, 1);
  finishActivation({ ok: true, updated: true });
  await activationFirst;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["read", "install", "reset", "read"]);
  finishRead(completedResponse);
  const secondResult = await readingAfter;
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.status, "completed");
  assert.equal(secondResult.output, firstResult.output);
  assert.equal(gate.readers, 0);

  const failedRead = context.recoverCodexThread("recovered-thread");
  await new Promise((resolve) => setImmediate(resolve));
  rejectRead(new Error("temporary read failure"));
  const failure = await failedRead;
  assert.equal(failure.ok, false);
  assert.equal(failure.status, "unknown", "a diagnostic error must not report the task failed");
  assert.equal(gate.readers, 0, "read exceptions release the lease");
  const retryActivation = gate.ensureWhenIdle({ enabled: true });
  await new Promise((resolve) => setImmediate(resolve));
  finishActivation({ ok: true, updated: false });
  assert.equal((await retryActivation).ok, true);
  assert.equal(gate.pending, null);
}

async function verifyReadOnlyInstalledCheck() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-read-check-"));
  try {
    const manager = new DomiPluginManager({
      userDataPath: root, bundledPluginRoot: path.join(root, "bundle"),
      bundledLockPath: path.join(root, "bundle-lock.json"), recoverTransactions: false
    });
    manager.bundledInfo = () => ({ manifest: { version: "7.0.3" } });
    manager.installedInfo = () => ({ manifest: { version: "7.0.3" } });
    for (const method of ["recoverInterruptedTransaction", "ensure", "prepareManagedMarketplace", "writeMarketplaceDefinition"]) {
      manager[method] = () => assert.fail(`read-only check called ${method}`);
    }
    manager.remoteUpdater.check = () => assert.fail("read-only check cannot update from network");
    let listed = [];
    let calls = 0;
    manager.runCodex = async (_binary, args) => {
      assert.deepEqual(args, ["plugin", "list", "--json"]);
      calls += 1;
      return { installed: listed };
    };
    const check = () => manager.checkInstalled({ binary: "fixture", env: {} });
    const managed = { name: "domi", enabled: true, pluginId: "domi@domi-managed", version: "7.0.3" };
    for (const invalid of [[], [{ ...managed, enabled: false }], [{ ...managed, name: "other" }],
      [{ ...managed, pluginId: "other@domi-managed" }], [{ ...managed, version: "invalid" }]]) {
      listed = invalid;
      assert.equal((await check()).reason, "plugin-missing");
    }
    listed = [{ ...managed, version: "7.0.2" }];
    assert.equal((await check()).reason, "plugin-outdated");
    listed = [{ ...managed, pluginId: "domi@other" }];
    assert.equal((await check()).reason, "plugin-unmanaged");
    listed = [{ ...managed, pluginId: "domi@other", version: "7.0.4" }];
    assert.equal((await check()).ok, true, "preserve existing newer user plugin policy");
    listed = [{ ...managed, pluginId: "domi@other" }, managed];
    assert.equal((await check()).pluginId, managed.pluginId, "prefer managed identity at equal version");
    listed = [managed];
    assert.equal((await check()).status, "ready");
    manager.installedInfo = () => ({ manifest: { version: "7.0.4" } });
    assert.equal((await check()).reason, "plugin-outdated", "registered cache must match newer managed source too");
    manager.runCodex = async () => { throw Object.assign(new Error("Command failed: /private/fixture/codex plugin list --json"), {
      signal: "SIGTERM", killed: true, code: null, domiCheckStage: "plugin/list"
    }); };
    const failure = await check();
    assert.equal(failure.reason, "plugin-check-timeout");
    assert.equal(failure.diagnostic.stage, "plugin/list");
    assert.equal(failure.diagnostic.killed, true);
    assert.doesNotMatch(failure.error, /Command failed|\/private/);
    assert.doesNotMatch(failure.diagnostic.message, /\/private/);
    assert.equal(calls, 11);

    // A fresh diagnostic manager must not recover or remove an interrupted
    // transaction simply because its status was requested.
    fs.mkdirSync(path.dirname(manager.transactionStatePath), { recursive: true });
    const receipt = JSON.stringify({ hadPreviousPlugin: false });
    fs.writeFileSync(manager.transactionStatePath, receipt);
    const freshReadOnly = new DomiPluginManager({
      userDataPath: root, bundledPluginRoot: path.join(root, "bundle"),
      bundledLockPath: path.join(root, "bundle-lock.json"), recoverTransactions: false
    });
    freshReadOnly.runCodex = () => assert.fail("incomplete activation cannot be declared verified");
    assert.equal((await freshReadOnly.checkInstalled({ enabled: true })).reason, "activation-incomplete");
    assert.equal(fs.readFileSync(manager.transactionStatePath, "utf8"), receipt);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function verifyReadinessDiagnostics() {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const implementation = main.match(/async function runCodexCheck\([\s\S]*?\n\}\n/)[0];
  const cacheImplementation = main.match(/function runCodexCheckCached\([\s\S]*?\n\}\n/)[0];
  const runtimeKeyImplementation = main.match(/function codexCheckRuntimeKey\([\s\S]*?\n\}\n/)[0];
  const runtime = { authMode: "chatgpt", codexPath: "fixture", env: {}, apiBaseUrl: "", args: [] };
  const errors = {};
  const logs = [];
  const calls = [];
  let pluginResult = { ok: true, status: "ready" };
  let onHealth;
  let accountResult = { account: { type: "chatgpt" }, requiresOpenaiAuth: false };
  const client = {
    initialized: true, child: { killed: false }, intentionalClose: false,
    request: async (method) => {
      calls.push(method);
      if (onHealth) await onHealth(method);
      if (errors[method]) throw errors[method];
      return method === "account/read" ? accountResult
        : method === "model/list" ? { data: [{ id: "fixture-model" }] } : { config: { model: "fixture-model" } };
    }
  };
  const gate = new DomiPluginActivationGate({
    isBusy: () => false, installedInfo: () => ({ manifest: { version: "7.0.3" } }),
    ensure: async () => {
      calls.push("ensure");
      if (errors.plugin) throw errors.plugin;
      return pluginResult;
    },
    onActivated: () => assert.fail("diagnostic tests must not activate plugins")
  });
  const context = {
    process: { env: {} }, app: { isPackaged: true },
    crypto: require("node:crypto"), codexCheckGeneration: 0, codexClient: client,
    codexNetworkDiagnostic: { ok: true, status: "direct" },
    ensureDemoWorkspace: () => calls.push("workspace"),
    ensureCodexRuntimeReady: async () => calls.push("runtime-install"),
    throwIfCodexCheckAborted() {}, codexCheckTimeout: (_deadline, max) => max,
    getAppSettings: () => ({ load: () => ({ settings: { codexPath: runtime.codexPath } }) }),
    getCodexRuntime: () => ({ ...runtime }),
    getPreparedCodexRuntime: async () => { calls.push("network"); return { ...runtime }; },
    resolveCodexBinary: () => "fixture", codexEnvironment: () => ({}),
    getDomiPluginActivationGate: () => gate,
    getDomiPluginManager: (options) => {
      assert.equal(options.readOnly, true, "diagnostic manager cannot recover transactions");
      return { checkInstalled: async () => {
        calls.push("plugin-list-read");
        assert.equal(gate.readers, 1, "plugin read is protected from activation");
        return errors.plugin ? pluginCheckFailure(errors.plugin) : pluginResult;
      } };
    },
    execFileAsync: async (_binary, args) => {
      assert.equal(args.join(" "), "--version");
      calls.push("version");
      if (errors.version) throw errors.version;
      return { stdout: "codex test" };
    },
    CODEX_VERSION_CHECK_TIMEOUT_MS: 100, CODEX_HEALTH_REQUEST_TIMEOUT_MS: 100, CODEX_CHECK_CACHE_TTL_MS: 60_000,
    demoWorkspace: "/isolated-test-workspace", appendRuntimeLog: (name, details) => logs.push({ name, ...details }),
    isSelectedCodexConnectionReady: require("../electron/codex-protocol.cjs").isSelectedCodexConnectionReady,
    codexCheckFailureDetails, pluginCheckFailure,
    resetCodexClient: () => assert.fail("status checking must not reset app-server"),
    getCodexClient: () => { calls.push("get-client"); return client; },
    serviceCoordinator: new (require("../electron/service-coordinator.cjs").ServiceCoordinator)()
  };
  vm.createContext(context);
  vm.runInContext(`${runtimeKeyImplementation}\n${implementation}\n${cacheImplementation}`, context);
  errors.plugin = Object.assign(new Error("Command failed: /private/fixture/codex plugin list --json"), {
    domiCheckStage: "plugin/list", killed: true, signal: "SIGTERM", code: null
  });
  const pluginFailure = await context.runCodexCheck();
  assert.equal(pluginFailure.ok, false);
  assert.equal(pluginFailure.connectionOk, true, "plugin subprocess failure does not mean server disconnected");
  assert.equal(pluginFailure.pluginSetup.status, "check-failed");
  assert.equal(pluginFailure.account.type, "chatgpt");
  assert.equal(pluginFailure.models.length, 1);
  assert.doesNotMatch(pluginFailure.error, /Command failed|\/private/);
  assert(logs.some((item) => item.stage === "plugin/list" && item.timeout));

  delete errors.plugin;
  errors.version = Object.assign(new Error("Command failed: /private/fixture/codex --version"), { killed: true, signal: "SIGTERM" });
  const versionFailure = await context.runCodexCheck();
  assert.equal(versionFailure.ok, true);
  assert.equal(versionFailure.connectionOk, true);
  assert.equal(versionFailure.version, "");
  assert.equal(versionFailure.diagnosticWarnings.length, 1);
  assert(logs.some((item) => item.stage === "runtime/version" && item.timeout));
  errors["model/list"] = Object.assign(new Error("temporary RPC failure"), { code: "DOMI_CODEX_REQUEST_TIMEOUT" });
  const rpcFailure = await context.runCodexCheck();
  assert.equal(rpcFailure.connectionOk, false);
  assert.equal(rpcFailure.requiresOpenaiAuth, false, "unknown RPC failure must not invent logout");
  assert(logs.some((item) => item.stage === "model/list" && item.message === "temporary RPC failure"));
  delete errors["model/list"];
  delete errors.version;
  accountResult = { account: null, requiresOpenaiAuth: true };
  const loggedOut = await context.runCodexCheck();
  assert.equal(loggedOut.connectionOk, false);
  assert.equal(loggedOut.requiresOpenaiAuth, true, "explicit account reply still reports real logout");
  errors.plugin = Object.assign(new Error("temporary plugin failure"), { domiCheckStage: "plugin/list" });
  const loggedOutWithPluginFailure = await context.runCodexCheck();
  assert.equal(loggedOutWithPluginFailure.connectionOk, false);
  assert.match(loggedOutWithPluginFailure.error, /请先登录 ChatGPT/);
  assert.equal(loggedOutWithPluginFailure.pluginSetup.status, "check-failed");
  delete errors.plugin;
  accountResult = { account: { type: "chatgpt" }, requiresOpenaiAuth: false };

  calls.length = 0;
  const readOnly = await context.runCodexCheck({ readOnly: true });
  assert.equal(readOnly.ok, true);
  assert.deepEqual(calls.slice().sort(), ["account/read", "config/read", "model/list", "plugin-list-read", "version"].sort());
  assert.equal(gate.readers, 0);
  pluginResult = { ok: false, status: "missing", reason: "plugin-missing", error: "domi 插件缺失" };
  const missing = await context.runCodexCheck({ readOnly: true });
  assert.equal(missing.connectionOk, true);
  assert.equal(missing.ok, false);
  pluginResult = { ok: true, status: "ready" };
  client.initialized = false;
  calls.length = 0;
  const noLiveServer = await context.runCodexCheck({ readOnly: true });
  assert.equal(noLiveServer.connectionOk, false);
  assert(!calls.includes("get-client"), "read-only check cannot create/restart a server");
  assert(!calls.includes("account/read"));
  client.initialized = true;

  let bumped = false;
  onHealth = async () => {
    if (!bumped) { bumped = true; context.codexCheckGeneration += 1; }
  };
  const superseded = await context.runCodexCheck({ readOnly: true });
  assert.equal(superseded.connectionOk, false);
  assert.equal(superseded.account, null);
  assert.match(superseded.error, /配置已变更/);
  onHealth = null;

  let releaseRead;
  onHealth = () => new Promise((resolve) => { releaseRead ||= []; releaseRead.push(resolve); });
  const first = context.runCodexCheckCached({ readOnly: true, force: true });
  const joined = context.runCodexCheckCached({ readOnly: true, force: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releaseRead.length, 3, "forced checks still share a single flight");
  context.codexCheckGeneration += 1;
  onHealth = null;
  const newGeneration = await context.runCodexCheckCached({ readOnly: true });
  assert.equal(newGeneration.connectionOk, true, "a reset must not join the old request");
  releaseRead.forEach((resolve) => resolve());
  assert.equal((await first).connectionOk, false);
  assert.equal((await joined).connectionOk, false);
  assert.equal((await context.runCodexCheckCached({ readOnly: true })).connectionOk, true,
    "late old result cannot overwrite current-generation cache");
  await context.runCodexCheckCached({ readOnly: false });
  errors["model/list"] = new Error("server no longer available");
  const forcedManual = await context.runCodexCheckCached({ readOnly: false, force: true });
  assert.equal(forcedManual.connectionOk, false, "manual check must bypass a formerly ready cached result");
  delete errors["model/list"];
  releaseRead = null;
  onHealth = () => new Promise((resolve) => { releaseRead ||= []; releaseRead.push(resolve); });
  const manualFirst = context.runCodexCheckCached({ readOnly: false, force: true });
  const manualJoined = context.runCodexCheckCached({ readOnly: false, force: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releaseRead.length, 3, "manual force must not create parallel health checks");
  onHealth = null;
  releaseRead.forEach((resolve) => resolve());
  assert.equal((await manualFirst).ok, true);
  assert.equal((await manualJoined).ok, true);
  const keyBefore = context.codexCheckRuntimeKey();
  runtime.defaultModel = "new-relay-model";
  assert.notEqual(context.codexCheckRuntimeKey(), keyBefore);

  const maintenanceImplementation = main.match(/function prepareCodexConnectionMaintenance\([\s\S]*?\n\}\n/)[0];
  const maintenanceContext = {
    activeRuns: new Map(), startingCodexRunIds: new Set(["preparing"]),
    partitionCodexRuns: () => ({ background: [{}], foreground: [] }),
    finishRun: () => assert.fail("maintenance cannot stop background or reset while a task is preparing")
  };
  vm.createContext(maintenanceContext);
  vm.runInContext(maintenanceImplementation, maintenanceContext);
  assert.equal(maintenanceContext.prepareCodexConnectionMaintenance("busy").ok, false);
}

async function verifyPlaudPluginActivationLease() {
  const { DomiIntegration } = require("../electron/domi-integration.cjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-plaud-lease-"));
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const helper = main.match(/async function withPlaudPluginActivation\([\s\S]*?\n\}\n/)[0];
  const events = [], availability = [];
  let integration, manager;
  const context = { crypto: require("node:crypto"), getDomiIntegration: () => integration };
  vm.createContext(context);
  vm.runInContext(helper, context);
  const source = path.join(directory, "bundle");
  const lockPath = path.join(directory, "lock.json");
  const writeBundle = version => {
    fs.mkdirSync(path.join(source, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(path.join(source, ".codex-plugin/plugin.json"), JSON.stringify({ name: "domi", version }));
    fs.writeFileSync(lockPath, JSON.stringify({ pluginVersion: version, gitCommit: `fixture-${version}`, sha256: `fixture-${version}` }));
  };
  const cache = new Map();
  let pluginRoot = path.join(directory, "cache-v1");
  fs.mkdirSync(pluginRoot);
  const oldPluginRoot = pluginRoot;
  let readResponse = null, readEntered = null, addResponse = null, addEntered = null, failAdd = false;
  integration = new DomiIntegration({
    stateStore: { loadCache: key => cache.get(key), saveCache: (key, value) => cache.set(key, { value }) },
    configProvider: () => ({ plaudConnectionMode: "enabled", plaudBrowser: "chrome" }),
    plaudStateDir: directory,
    onPlaudReaderAvailability: state => { availability.push(state.available); events.push(state.available ? "available" : "paused"); },
    plaudBroker: {
      request: async (_command, _args, selectedPlugin) => {
        assert.equal(fs.existsSync(selectedPlugin), true, "A running reader must retain its selected plugin directory");
        readEntered?.resolve();
        if (readResponse) await readResponse.promise;
        assert.equal(fs.existsSync(selectedPlugin), true, "The old directory cannot disappear before the read completes");
        events.push("read-complete");
        return { ok: true, items: [{ fileId: "synthetic", fileName: "Synthetic" }] };
      },
      stop: async () => { events.push("worker-closed"); }
    }
  });
  integration.findPlugin = () => ({ root: pluginRoot });
  integration.loadPlaudWorkflowRecords = () => [];
  let leaseCalls = 0, registryVersion = "1.0.0";
  const mutationEntered = deferred();
  writeBundle("1.0.0");
  manager = new DomiPluginManager({ userDataPath: directory, bundledPluginRoot: source, bundledLockPath: lockPath,
    remoteUpdateEnabled: false, recoverTransactions: false,
    withActivationLease: operation => { leaseCalls++; mutationEntered.resolve(); return context.withPlaudPluginActivation(operation); }
  });
  manager.writeManagedMarketplace(manager.bundledInfo());
  manager.runCodex = async (_binary, args) => {
    if (args[1] === "marketplace") return { marketplaces: [{ name: "domi-managed", root: manager.marketplaceRoot }] };
    if (args[1] === "list") return { installed: [{ name: "domi", enabled: true, pluginId: "domi@domi-managed", version: registryVersion }] };
    assert.equal(integration.plaudReaderPaused(), true, "Cache mutation owns the PLAUD lease");
    if (args[1] === "remove") {
      assert(events.includes("worker-closed"), "Close the worker before removing its plugin");
      events.push("remove");
      fs.rmSync(pluginRoot, { recursive: true, force: true });
      return {};
    }
    assert.equal(args[1], "add", "The installer must never execute a PLAUD generation command");
    events.push("add"); addEntered?.resolve();
    if (addResponse) await addResponse.promise;
    if (failAdd && manager.installedInfo().manifest.version === "3.0.0") throw new Error("Synthetic installation failure");
    registryVersion = manager.installedInfo().manifest.version;
    pluginRoot = path.join(directory, `cache-${registryVersion}`);
    fs.mkdirSync(pluginRoot, { recursive: true });
    return {};
  };
  try {
    writeBundle("2.0.0");
    readEntered = deferred(); readResponse = deferred();
    const reading = integration.plaudQueue({ fresh: true });
    await readEntered.promise;
    const activation = manager.ensure({ binary: "synthetic", env: {} });
    await mutationEntered.promise;
    assert.equal(integration.plaudReaderPaused(), true);
    assert.equal(fs.existsSync(oldPluginRoot), true);
    assert.equal(manager.installedInfo().manifest.version, "1.0.0", "Do not replace marketplace files before readers drain");
    assert.equal(events.includes("remove"), false);
    addEntered = deferred(); addResponse = deferred();
    readResponse.resolve(); await reading;
    await addEntered.promise;
    const paused = await integration.plaudQueue({ fresh: true });
    assert.equal(paused.paused, true);
    assert.equal(paused.items[0].fileId, "synthetic", "Keep the last verified list during installation");
    assert.equal((await integration.syncPlaud()).paused, true, "New syncs cannot submit during activation");
    assert.equal(events.filter(event => event === "read-complete").length, 1);
    addResponse.resolve();
    assert.equal((await activation).updated, true);
    assert.deepEqual(events.filter(event => ["read-complete", "worker-closed", "remove", "add", "available"].includes(event)),
      ["read-complete", "worker-closed", "remove", "add", "available"]);
    assert.equal(availability.at(-1), true, "Existing availability subscription will trigger a fresh list");
    readResponse = null; addResponse = null;
    assert.equal((await integration.plaudQueue({ fresh: true })).stale, false);
    const priorLeases = leaseCalls;
    assert.equal((await manager.ensure({ binary: "synthetic", env: {} })).updated, false);
    assert.equal(leaseCalls, priorLeases, "An ordinary installed-version check must not pause PLAUD");

    // Failed install and rollback remain inside the lease, then always release.
    writeBundle("3.0.0"); failAdd = true;
    const failed = await manager.ensure({ binary: "synthetic", env: {} });
    assert.equal(failed.ok, false);
    assert.equal(manager.installedInfo().manifest.version, "2.0.0");
    assert.equal(registryVersion, "2.0.0", "Rollback restored the previous registered plugin");
    assert.equal(integration.plaudReaderPaused(), false);
    assert.equal(availability.at(-1), true);

    // Crash recovery mutates directories too and must wait for an existing owner.
    manager.prepareManagedMarketplace(manager.bundledInfo());
    assert.equal(manager.installedInfo().manifest.version, "3.0.0");
    await integration.reservePlaudForWorkflow("existing-recording-task");
    const beforeRecovery = leaseCalls;
    const recovery = manager.ensure({ binary: "synthetic", env: {} });
    await Promise.resolve();
    assert.equal(leaseCalls, beforeRecovery + 1);
    assert.equal(manager.installedInfo().manifest.version, "3.0.0", "Do not recover over an existing workflow owner");
    integration.releasePlaudWorkflow("existing-recording-task");
    assert.equal((await recovery).ok, false, "The synthetic new-version install still fails after recovery");
    assert.equal(manager.installedInfo().manifest.version, "2.0.0");
    assert.equal(integration.plaudReaderPaused(), false);

    // Exercise the real run preparation statements with an activation that
    // needs the same PLAUD lease. Reserving first would deadlock both promises.
    const realRun = main.slice(main.indexOf("async function runCodex(sender, payload)"), main.indexOf("async function stopCodex("));
    const start = realRun.indexOf("await getDomiPluginActivationGate().waitForActivation();");
    const end = realRun.indexOf("const client = getCodexClient();", start);
    assert(start >= 0 && end > start);
    assert(start < realRun.indexOf("await getDomiIntegration().reservePlaudForWorkflow(runId)"));
    const beginReplacement = deferred(), enteredEnsure = deferred();
    const starting = new Set();
    const gate = new DomiPluginActivationGate({ isBusy: () => starting.size > 0,
      installedInfo: () => manager.installedInfo(),
      ensure: async () => { enteredEnsure.resolve(); await beginReplacement.promise;
        return context.withPlaudPluginActivation(async () => ({ ok: true, updated: true })); },
      onActivated: () => events.push("reset") });
    context.getDomiPluginActivationGate = () => gate;
    context.assertCodexRunNotCancelled = () => {};
    integration.plaudWorkflowPlan = () => ({ requiresBrowser: true });
    vm.runInContext(`async function prepareRun(runId, payload) { let plaudWorkflowReserved = false; ${realRun.slice(start, end)} return plaudWorkflowReserved; }`, context);
    const replacing = gate.ensureWhenIdle({ enabled: true });
    await enteredEnsure.promise;
    starting.add("next-task");
    const preparing = context.prepareRun("next-task", {});
    assert.equal(integration.plaudWorkflowOwners.has("next-task"), false, "Wait for activation before reserving its queue");
    beginReplacement.resolve();
    let timer;
    try {
      const [, reserved] = await Promise.race([Promise.all([replacing, preparing]),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Plugin/PLAUD deadlock")), 1000); })]);
      assert.equal(reserved, true);
      assert.equal(integration.plaudActiveWorkflowOwner, "next-task");
      assert.equal((await gate.ensureWhenIdle({ enabled: true })).deferred, true);
    } finally { clearTimeout(timer); integration.releasePlaudWorkflow("next-task"); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function verifyLocalPlaudCompletionLease() {
  const { DomiIntegration } = require("../electron/domi-integration.cjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-plaud-verifier-lease-"));
  const startedPath = path.join(directory, "verifier-started");
  const releasePath = path.join(directory, "release-verifier");
  let pluginRoot = path.join(directory, "plugin-v1");
  const installFixture = root => {
    const scripts = path.join(root, "skills", "plaud", "scripts");
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, "quality.cjs"), `module.exports = ${JSON.stringify({
      ok: true, fileId: "synthetic", stage: "notes_non_project", checks: { notesAudit: "passed" }
    })};`);
    // Run a real child, keeping a dependency unread until the test releases it.
    // Removing its plugin directory during verification would fail the receipt.
    fs.writeFileSync(path.join(scripts, "plaud.js"), `
      const fs = require("node:fs");
      fs.writeFileSync(${JSON.stringify(startedPath)}, "started");
      const timeout = setTimeout(() => process.exit(1), 5000);
      function finish() {
        if (!fs.existsSync(${JSON.stringify(releasePath)})) return setTimeout(finish, 5);
        clearTimeout(timeout);
        console.log(JSON.stringify(require("./quality.cjs")));
      }
      finish();
    `);
  };
  const waitForStarted = async () => {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(startedPath)) {
      assert(Date.now() < deadline, "The synthetic local verifier must start");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  let handler;
  try {
    installFixture(pluginRoot);
    const transcriptPath = path.join(directory, "transcript.txt");
    const notesPath = path.join(directory, "notes.md");
    fs.writeFileSync(transcriptPath, "Synthetic transcript");
    fs.writeFileSync(notesPath, "Synthetic notes");
    fs.writeFileSync(path.join(directory, "plaud-workflow.json"), JSON.stringify({ records: {
      synthetic: { fileId: "synthetic", stage: "notes_non_project", transcriptPath, notesPath }
    } }));
    const integration = new DomiIntegration({
      stateStore: { loadCache() {}, saveCache() {} },
      configProvider: () => ({ plaudConnectionMode: "enabled", plaudBrowser: "chrome" }),
      plaudStateDir: directory, podcastCacheDir: path.join(directory, "podcasts"),
      plaudBroker: { stop: async () => {} }
    });
    integration.findPlugin = () => ({ root: pluginRoot });
    const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
    const activationHelper = main.match(/async function withPlaudPluginActivation\([\s\S]*?\n\}\n/)[0];
    const completionHandler = main.match(/ipcMain\.handle\("domi:plaud-workflow-completion", async \([\s\S]*?\n\}\);/)[0];
    let mutationEntered, releaseMutation;
    const mutationStarted = new Promise(resolve => { mutationEntered = resolve; });
    const mutationMayFinish = new Promise(resolve => { releaseMutation = resolve; });
    const context = { crypto: require("node:crypto"), getDomiIntegration: () => integration,
      ipcMain: { handle: (_name, callback) => { handler = callback; } } };
    vm.createContext(context);
    vm.runInContext(activationHelper, context);
    const gate = new DomiPluginActivationGate({ isBusy: () => false,
      installedInfo: () => ({ manifest: { version: "1.0.0" } }), onActivated: () => {},
      ensure: () => context.withPlaudPluginActivation(async () => {
        mutationEntered();
        await mutationMayFinish;
        fs.rmSync(pluginRoot, { recursive: true, force: true });
        pluginRoot = path.join(directory, "plugin-v2");
        installFixture(pluginRoot);
        return { ok: true, updated: true };
      }) });
    context.getDomiPluginActivationGate = () => gate;
    vm.runInContext(completionHandler, context);

    // A local verifier remains independent of the browser Profile owner.
    await integration.reservePlaudForWorkflow("synthetic-recording-owner");
    const verifying = handler(null, { fileId: "synthetic" });
    await waitForStarted();
    assert.equal(gate.readers, 1);
    assert.equal(integration.plaudCommandQueue.snapshot().activeCount, 0);
    assert.equal((await gate.ensureWhenIdle({ enabled: true })).deferred, true,
      "An active local verifier must defer plugin cache replacement");
    assert.equal(fs.existsSync(pluginRoot), true);
    fs.writeFileSync(releasePath, "release");
    assert.equal((await verifying).outcome, "completed");
    assert.equal(integration.plaudActiveWorkflowOwner, "synthetic-recording-owner");
    integration.releasePlaudWorkflow("synthetic-recording-owner");
    assert.equal(gate.readers, 0);

    // A verifier arriving after activation waits before resolving its script.
    fs.rmSync(startedPath);
    const activation = gate.ensureWhenIdle({ enabled: true });
    await mutationStarted;
    const following = handler(null, { fileId: "synthetic" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fs.existsSync(startedPath), false);
    releaseMutation();
    assert.equal((await activation).updated, true);
    assert.equal((await following).outcome, "completed");
    assert.equal(gate.readers, 0);
  } finally {
    fs.writeFileSync(releasePath, "release");
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function verifyLongPluginOperationLeases() {
  const { DomiIntegration } = require("../electron/domi-integration.cjs");
  const { ServiceCoordinator, TaskQueue } = require("../electron/service-coordinator.cjs");
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const gateDefinition = main.match(/function getDomiPluginActivationGate\([\s\S]*?\n\}\n/)[0];
  const leaseDefinition = main.match(/async function withPlaudPluginActivation\([\s\S]*?\n\}\n/)[0];
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
  const nextTick = () => new Promise(resolve => setImmediate(resolve));
  const within = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Plugin lease deadlock")), 5000);
    })]); } finally { clearTimeout(timer); }
  };
  for (const operationName of ["domi:plaud-sync", "domi:plaud-resume", "domi:podcast-process", "domi:sync"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-long-plugin-operation-"));
    const legacy = operationName === "domi:sync";
    let selectedPlugin = path.join(root, "plugin-v1");
    const install = () => {
      const scripts = path.join(selectedPlugin, "skills/investment-mgmt/scripts");
      fs.mkdirSync(scripts, { recursive: true });
      fs.writeFileSync(path.join(scripts, "ensure-intake-time-fields.js"), 'console.log(JSON.stringify(require("./fixture.cjs")));');
      fs.writeFileSync(path.join(scripts, "fixture.cjs"), 'module.exports = {ok:true};');
    };
    install();
    let started = deferred(), finishOperation = deferred(), startCount = 0, mutationStarted = deferred(), finishMutation = deferred();
    const integration = new DomiIntegration({
      stateStore: { loadCache() {}, saveCache() {} },
      configProvider: () => ({ plaudConnectionMode: "enabled", plaudBrowser: "chrome" }),
      plaudStateDir: root, podcastCacheDir: path.join(root, "podcasts"),
      plaudBroker: { stop: async () => {} }
    });
    integration.findPlugin = () => ({ root: selectedPlugin, version: path.basename(selectedPlugin) });
    integration.performPlaudSync = integration.processPodcastEpisodeOnce = async () => {
      startCount++; started.resolve(); await finishOperation.promise; return { ok: true };
    };
    // This case executes the real legacy sync, migration and child process. Its
    // migration deliberately waits in the real lark queue before loading code.
    if (legacy) {
      integration.readProjectConfig = () => ({ backend: "feishu" });
      integration.status = async () => ({ lark: { ok: true } });
      integration.resolvePeopleBase = () => ({});
      integration.fetchRecords = async () => ({ total: 0, records: [] });
      integration.normalizeProjects = integration.normalizePeople = () => [];
      integration.larkCommandQueue = new TaskQueue(1);
      const originalQueueRun = integration.larkCommandQueue.run.bind(integration.larkCommandQueue);
      integration.larkCommandQueue.run = operation => { startCount++; started.resolve(); return originalQueueRun(operation); };
    }
    let handler, mutationCount = 0;
    const context = {
      crypto: require("node:crypto"), DomiPluginActivationGate, domiPluginActivationGate: null,
      domiIntegration: integration, getDomiIntegration: () => integration,
      updateRestartPreparing: false, applicationQuitFlushStarted: false,
      activeRuns: new Map(), startingCodexRunIds: new Set(),
      codexClientIdleForSkillReload: () => true, resetCodexClient() {},
      codexCheckRuntimeKey: () => undefined, getCodexClient: () => ({ start: async () => {} }),
      appendRuntimeLog() {}, BrowserWindow: { getAllWindows: () => [] },
      serviceCoordinator: new ServiceCoordinator(),
      ipcMain: { handle: (_name, callback) => { handler = callback; } },
      getDomiPluginManager: () => ({ installedInfo: () => ({ manifest: { version: "1.0.0" } }),
        ensure: () => context.withPlaudPluginActivation(async () => {
          mutationCount++; mutationStarted.resolve(); await finishMutation.promise;
          fs.rmSync(selectedPlugin, { recursive: true, force: true });
          selectedPlugin = path.join(root, "plugin-v2"); install();
          return { ok: true, updated: true };
        }) })
    };
    vm.createContext(context);
    vm.runInContext(leaseDefinition + gateDefinition, context);
    const registration = main.match(new RegExp(`ipcMain\\.handle\\("${operationName}", async \\([\\s\\S]*?\\n\\}\\);`))[0];
    vm.runInContext(registration, context);
    const gate = context.getDomiPluginActivationGate();
    const request = operationName === "domi:podcast-process" ? { jobId: "synthetic" } : {};
    let queuedBlock;
    try {
      if (legacy) queuedBlock = integration.larkCommandQueue.run(() => finishOperation.promise);
      // Ignore the queue blocker when observing the actual migration.
      if (legacy) { started = deferred(); startCount = 0; }
      const existing = handler(null, request);
      await within(started.promise);
      assert.equal(gate.readers, 1, operationName);
      if (legacy) assert.equal(integration.larkCommandQueue.snapshot().pendingCount, 1);
      assert.equal((await gate.ensureWhenIdle({ enabled: true })).deferred, true, operationName);
      assert.equal(gate.pending, null, "An old long operation must not occupy activation's global pending slot");
      await within(gate.waitForActivation());
      assert.equal(mutationCount, 0, "Ordinary Codex preparation can proceed without waiting for old background work");
      // Cancel this diagnostic request so each ordering below has an independent
      // fixture. Automatic replay after release has its own upgrade regression.
      gate.cancelDeferred();
      finishOperation.resolve();
      assert.equal((await within(existing)).ok, true);
      if (queuedBlock) await queuedBlock;
      assert.equal(gate.readers, 0);

      // Also cover internal pre-existing promises without an IPC read lease.
      if (!legacy) {
        started = deferred(); finishOperation = deferred();
        const internal = operationName === "domi:podcast-process"
          ? integration.processPodcastEpisode(request) : integration.resumePlaudTranscripts();
        await within(started.promise);
        assert.equal(gate.readers, 0);
        assert.equal((await gate.ensureWhenIdle({ enabled: true })).deferred, true,
          "isBusy protects internal long operations before an IPC lease exists");
        assert.equal(gate.pending, null);
        gate.cancelDeferred();
        finishOperation.resolve(); await within(internal);
      }

      // If activation wins, the new operation must not publish a long promise
      // that activation's profile drain would then wait for in the opposite order.
      started = deferred(); finishOperation = deferred(); startCount = 0;
      const activating = gate.ensureWhenIdle({ enabled: true });
      await within(mutationStarted.promise);
      const following = handler(null, request);
      await nextTick();
      assert.equal(startCount, 0, "Do not enter the integration or lark queue before activation completes");
      assert.equal(integration.plaudSyncPromise, null);
      assert.equal(integration.podcastProcessPromises.size, 0);
      finishMutation.resolve();
      assert.equal((await within(activating)).updated, true);
      if (!legacy) { await within(started.promise); finishOperation.resolve(); }
      assert.equal((await within(following)).ok, true);
      assert.equal(gate.readers, 0);
      assert.equal(mutationCount, 1);
      assert.equal(integration.plaudReaderPaused(), false);
    } finally {
      finishOperation.resolve(); finishMutation.resolve();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

async function verifyDeferredUpgradeAndReadback() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-deferred-plugin-upgrade-"));
  const bundle = path.join(root, "bundle"), lock = path.join(root, "lock.json");
  const registryPath = path.join(root, "registry.json"), behaviorPath = path.join(root, "behavior.json");
  const commandLog = path.join(root, "commands.jsonl"), binary = path.join(root, "codex-fixture");
  const writeBundle = version => {
    fs.mkdirSync(path.join(bundle, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(path.join(bundle, ".codex-plugin/plugin.json"), JSON.stringify({ name: "domi", version }));
    fs.writeFileSync(lock, JSON.stringify({ pluginVersion: version, gitCommit: version, sha256: version }));
  };
  const manager = new DomiPluginManager({ userDataPath: root, bundledPluginRoot: bundle,
    bundledLockPath: lock, remoteUpdateEnabled: false });
  const managed = version => ({ name: "domi", pluginId: "domi@domi-managed", enabled: true, version });
  fs.writeFileSync(behaviorPath, "{}");
  fs.writeFileSync(registryPath, JSON.stringify({ installed: [managed("7.0.13")],
    marketplaces: [{ name: "domi-managed", root: manager.marketplaceRoot }] }));
  fs.writeFileSync(binary, `#!${process.execPath}
    const fs = require("node:fs"), path = require("node:path");
    const registryPath = ${JSON.stringify(registryPath)}, behaviorPath = ${JSON.stringify(behaviorPath)};
    const args = process.argv.slice(2), registry = JSON.parse(fs.readFileSync(registryPath));
    const behavior = JSON.parse(fs.readFileSync(behaviorPath));
    fs.appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify(args) + "\\n");
    let result = {};
    if (args[1] === "marketplace") result = { marketplaces: registry.marketplaces };
    else if (args[1] === "list") result = { installed: registry.installed };
    else if (args[1] === "remove") registry.installed = registry.installed.filter(p => p.pluginId !== args[2]);
    else if (args[1] === "add") {
      const manifest = JSON.parse(fs.readFileSync(path.join(registry.marketplaces[0].root, "plugins/domi/.codex-plugin/plugin.json")));
      if (manifest.version !== behavior.ignoreVersion) registry.installed = [{name:"domi",pluginId:"domi@domi-managed",enabled:true,version:manifest.version}];
    } else process.exit(2);
    fs.writeFileSync(registryPath, JSON.stringify(registry));
    console.log(JSON.stringify(result));
  `, { mode: 0o700 });
  let finishReader, finishReset, settled;
  const readerMayFinish = new Promise(resolve => { finishReader = resolve; });
  const resetMayFinish = new Promise(resolve => { finishReset = resolve; });
  const backgroundSettled = new Promise(resolve => { settled = resolve; });
  const events = [];
  const gate = new DomiPluginActivationGate({ isBusy: () => false,
    installedInfo: () => manager.installedInfo(), ensure: request => manager.ensure(request),
    onActivated: async () => { events.push("reset"); await resetMayFinish; },
    onSettled: result => { events.push("settled"); settled(result); } });
  const within = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Deferred plugin upgrade did not finish")), 5000);
    })]); } finally { clearTimeout(timer); }
  };
  try {
    writeBundle("7.0.13");
    manager.writeManagedMarketplace(manager.bundledInfo());
    writeBundle("7.0.14");
    const reader = gate.withStableClient(async () => { await readerMayFinish; events.push("reader-finished"); });
    const request = { binary, env: process.env, enabled: true };
    assert.equal((await gate.ensureWhenIdle(request)).deferred, true);
    assert.equal((await manager.checkInstalled(request)).reason, "plugin-outdated");
    assert.equal(manager.installedInfo().manifest.version, "7.0.13");
    finishReader(); await reader;
    assert.ok(gate.pending, "Last reader release automatically claims activation without another user check");
    const nextReader = gate.withStableClient(() => events.push("next-reader"));
    // New reads queue behind the upgrade and its App Server reset.
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(events.includes("next-reader"), false);
    finishReset();
    const result = await within(backgroundSettled);
    assert.equal(result.ok, true);
    assert.equal(result.version, "7.0.14");
    await within(nextReader);
    assert.equal((await manager.checkInstalled(request)).status, "ready");
    assert.equal(manager.installedInfo().manifest.version, "7.0.14");
    assert(events.indexOf("reader-finished") < events.indexOf("reset"));
    assert(events.indexOf("reset") < events.indexOf("next-reader"));
    assert.equal(gate.deferredRequest, null);
    assert.equal(gate.retryTimer, null);
    const commands = fs.readFileSync(commandLog, "utf8").trim().split("\n").map(JSON.parse);
    const addIndex = commands.findIndex(args => args[1] === "add");
    assert.equal(commands[addIndex + 1][1], "list", "Successful CLI exit requires a real registry readback");

    // A CLI that exits successfully without enabling the target version must
    // never turn readiness green or commit the new source version.
    writeBundle("7.0.15");
    fs.writeFileSync(behaviorPath, JSON.stringify({ ignoreVersion: "7.0.15" }));
    const failed = await manager.ensure(request);
    assert.equal(failed.ok, false);
    assert.equal(failed.diagnostic.code, "DOMI_PLUGIN_ACTIVATION_VERIFY_FAILED");
    assert.equal(failed.diagnostic.stage, "plugin/verify");
    assert.equal(manager.installedInfo().manifest.version, "7.0.14", "Failed activation rolls back source files");
    assert.equal(JSON.parse(fs.readFileSync(registryPath)).installed[0].version, "7.0.14", "Rollback re-registers the previous version");
    assert.equal(fs.existsSync(manager.transactionStatePath), false);
  } finally {
    gate.dispose(); finishReader(); finishReset();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function verifyDeferredIdleAndCancellation() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let busy = true, currentRuntime = "first", calls = 0, settled = 0;
  const gate = new DomiPluginActivationGate({ isBusy: () => busy,
    installedInfo: () => ({ manifest: { version: "7.0.13" } }), retryDelayMs: 25,
    isRequestCurrent: request => request.runtimeKey === currentRuntime,
    ensure: async () => { calls++; return { ok: false, reason: "synthetic-permanent-failure" }; },
    onActivated: () => assert.fail("Failed install must not reset"), onSettled: () => { settled++; } });
  try {
    await gate.ensureWhenIdle({ enabled: true, runtimeKey: "first" });
    await sleep(60);
    assert.equal(calls, 0, "Active model work must never be interrupted by automatic activation");
    assert.equal(await gate.withStableClient(async () => "completion"), "completion",
      "Reads needed to complete the active task must not deadlock behind its own upgrade");
    busy = false;
    await sleep(80);
    assert.equal(calls, 1, "External busy state becoming idle automatically resumes installation");
    assert.equal(settled, 1);
    await sleep(60);
    assert.equal(calls, 1, "A permanent failure is surfaced once and never creates a retry loop");

    busy = true;
    await gate.ensureWhenIdle({ enabled: true, runtimeKey: "first" });
    currentRuntime = "changed"; busy = false;
    await sleep(60);
    assert.equal(calls, 1, "A queued request cannot replay stale account/runtime configuration");
    assert.equal(gate.deferredRequest, null);

    busy = true;
    await gate.ensureWhenIdle({ enabled: true, runtimeKey: "changed" });
    gate.cancelDeferred(); busy = false;
    await sleep(60);
    assert.equal(calls, 1);
    busy = true;
    await gate.ensureWhenIdle({ enabled: true, runtimeKey: "changed" });
    gate.dispose(); busy = false;
    await sleep(60);
    assert.equal(calls, 1, "Shutdown cannot start a background installation");
    assert.equal(gate.retryTimer, null);
  } finally { gate.dispose(); }
}

async function verifyHealthProbeDuringDeferredUpgrade() {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const implementation = main.match(/async function runCodexCheck\([\s\S]*?\n\}\n/)[0];
  let busy = true, upgraded = false, healthStarted, finishHealth, activationSettled;
  const healthEntered = new Promise(resolve => { healthStarted = resolve; });
  const healthMayFinish = new Promise(resolve => { finishHealth = resolve; });
  const backgroundFinished = new Promise(resolve => { activationSettled = resolve; });
  const events = [];
  const gate = new DomiPluginActivationGate({ isBusy: () => busy,
    installedInfo: () => ({ manifest: { version: upgraded ? "7.0.14" : "7.0.13" } }),
    ensure: async () => { events.push("install"); upgraded = true; return { ok: true, updated: true }; },
    onActivated: () => events.push("reset"), onSettled: activationSettled });
  const client = { initialized: true, child: { killed: false }, intentionalClose: false,
    request: async method => {
      healthStarted(); await healthMayFinish; events.push(`health:${method}`);
      return method === "account/read" ? { account: { type: "chatgpt" }, requiresOpenaiAuth: false }
        : method === "model/list" ? { data: [] } : { config: {} };
    } };
  const context = {
    process: { env: {} }, app: { isPackaged: true },
    codexCheckRuntimeKey: () => "test-runtime", codexCheckGeneration: 0,
    // Match networkFingerprint so this test isolates plugin activation.
    codexClient: client, codexNetworkDiagnostic: { ok: true, status: "direct" },
    codexCheckFailureDetails, pluginCheckFailure,
    ensureDemoWorkspace() {}, ensureCodexRuntimeReady: async () => {},
    throwIfCodexCheckAborted() {}, codexCheckTimeout: (_deadline, maximum) => maximum,
    getAppSettings: () => ({ load: () => ({ settings: { codexPath: "codex" } }) }),
    getCodexRuntime: () => ({ authMode: "chatgpt", codexPath: "codex", env: {} }),
    getPreparedCodexRuntime: async () => ({ authMode: "chatgpt", codexPath: "codex", env: {} }),
    resolveCodexBinary: () => "codex", codexEnvironment: () => ({}),
    getDomiPluginActivationGate: () => gate,
    getDomiPluginManager: () => ({ checkInstalled: async () => ({
      ok: upgraded, status: upgraded ? "ready" : "missing",
      reason: upgraded ? "installed-verified" : "plugin-outdated", version: upgraded ? "7.0.14" : "7.0.13"
    }) }),
    execFileAsync: async () => ({ stdout: "codex test" }),
    CODEX_VERSION_CHECK_TIMEOUT_MS: 100, CODEX_HEALTH_REQUEST_TIMEOUT_MS: 100,
    demoWorkspace: "/isolated-test-workspace", appendRuntimeLog() {},
    isSelectedCodexConnectionReady: () => true,
    resetCodexClient: () => assert.fail("Connection check cannot reset outside activation"),
    getCodexClient: () => client
  };
  vm.createContext(context); vm.runInContext(implementation, context);
  try {
    const checking = context.runCodexCheck({});
    await healthEntered;
    busy = false; gate.resumeDeferred();
    assert.equal(upgraded, false, "Transport health requests retain the read lease after registry verification");
    assert.equal(events.includes("reset"), false);
    finishHealth();
    const first = await checking;
    assert.equal(first.connectionOk, true);
    assert.equal(first.pluginSetup.reason, "activation-pending");
    assert.equal((await backgroundFinished).ok, true);
    const lastHealth = Math.max(...events.map((event, index) => event.startsWith("health:") ? index : -1));
    assert(lastHealth < events.indexOf("install"), "All health requests finish before automatic mutation/reset");
    assert.equal((await context.runCodexCheck({ readOnly: true })).ok, true,
      "The automatic activation result can be confirmed by a read-only UI refresh");
  } finally { finishHealth(); gate.dispose(); }
}

async function verifyMainAutomaticActivationWiring() {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const functions = ["getDomiPluginActivationGate", "resetCodexClient", "runCodexCheck"].map(name =>
    main.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}\\n`))[0]).join("\n");
  const events = [], invalidated = [], notifications = [], logs = [];
  let registryVersion = "7.0.13", runtimeKey = "original-runtime", allowStart, startFailures = 1;
  const startMayComplete = new Promise(resolve => { allowStart = resolve; });
  const response = method => method === "account/read" ? { account: { type: "chatgpt" }, requiresOpenaiAuth: false }
    : method === "model/list" ? { data: [] } : { config: {} };
  const oldClient = { initialized: true, child: { killed: false }, intentionalClose: false,
    request: async method => response(method), close: () => { events.push("old-close"); } };
  const activeRuns = new Map([["existing-task", {}]]);
  const context = {
    process: { env: {} }, app: { isPackaged: true }, DomiPluginActivationGate,
    domiPluginActivationGate: null, domiIntegration: null, updateRestartPreparing: false,
    applicationQuitFlushStarted: false, activeRuns, startingCodexRunIds: new Set(),
    codexClientIdleForSkillReload: runs => runs.size === 0,
    codexNetworkReloadPending: false, codexCheckGeneration: 0,
    liveCodexThreads: new Map(), codexThreadTurnIds: new Map(), resolvedCodexUserInputs: new Map(),
    codexCheckRuntimeKey: () => runtimeKey, codexClient: oldClient,
    codexNetworkDiagnostic: { ok: true, status: "direct" }, codexCheckFailureDetails, pluginCheckFailure,
    serviceCoordinator: { invalidate: key => invalidated.push(key) },
    BrowserWindow: { getAllWindows: () => [
      { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => notifications.push(args) } },
      { isDestroyed: () => true, webContents: { isDestroyed: () => true, send: () => assert.fail("Destroyed window") } }
    ] },
    appendRuntimeLog: (...args) => logs.push(args),
    getDomiPluginManager: () => ({
      installedInfo: () => ({ manifest: { version: registryVersion } }),
      ensure: async request => {
        assert.equal(request.runtimeKey, runtimeKey); events.push("install"); registryVersion = "7.0.14";
        return { ok: true, updated: true, version: registryVersion, env: { secret: "must-not-be-published" } };
      },
      checkInstalled: async () => ({ ok: registryVersion === "7.0.14", updated: false,
        status: registryVersion === "7.0.14" ? "ready" : "missing",
        reason: registryVersion === "7.0.14" ? "installed-verified" : "plugin-outdated", version: registryVersion })
    }),
    getCodexClient: () => {
      if (!context.codexClient) context.codexClient = {
        initialized: false, child: null, intentionalClose: false,
        start: async () => {
          events.push("new-start");
          if (startFailures-- > 0) throw new Error("Synthetic local handshake failure");
          await startMayComplete;
          context.codexClient.initialized = true; context.codexClient.child = { killed: false };
          events.push("new-initialized");
        },
        request: async method => { assert.equal(context.codexClient.initialized, true); return response(method); },
        close: () => events.push("new-close")
      };
      return context.codexClient;
    },
    ensureDemoWorkspace() {}, ensureCodexRuntimeReady: async () => {}, throwIfCodexCheckAborted() {},
    codexCheckTimeout: (_deadline, maximum) => maximum,
    getAppSettings: () => ({ load: () => ({ settings: { codexPath: "codex" } }) }),
    getCodexRuntime: () => ({ authMode: "chatgpt", codexPath: "codex", env: {} }),
    getPreparedCodexRuntime: async () => ({ authMode: "chatgpt", codexPath: "codex", env: {} }),
    resolveCodexBinary: () => "codex", codexEnvironment: () => ({}),
    execFileAsync: async () => ({ stdout: "codex test" }),
    CODEX_VERSION_CHECK_TIMEOUT_MS: 100, CODEX_HEALTH_REQUEST_TIMEOUT_MS: 100,
    demoWorkspace: "/isolated-test-workspace", isSelectedCodexConnectionReady: () => true
  };
  vm.createContext(context); vm.runInContext(functions, context);
  const gate = context.getDomiPluginActivationGate();
  try {
    const first = await context.runCodexCheck({});
    assert.equal(first.connectionOk, true);
    assert.equal(first.ok, false);
    assert.equal(first.pluginSetup.reason, "activation-pending");
    assert.equal(events.length, 0, "No activation/reset while the model is busy");
    activeRuns.clear(); gate.resumeDeferred();
    const background = gate.pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ["install", "old-close", "new-start", "new-start"],
      "A failed local handshake is retried once before announcing readiness");
    assert.equal(notifications.length, 0, "Do not announce ready before the replacement transport starts");
    assert.equal(context.codexCheckGeneration, 1);
    let readFinished = false;
    const recheck = context.runCodexCheck({ readOnly: true }).then(result => { readFinished = true; return result; });
    await Promise.resolve();
    assert.equal(readFinished, false, "A read-only observer waits for activation and new transport initialization");
    allowStart(); await background;
    const refreshed = await recheck;
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.pluginSetup.version, "7.0.14");
    assert.equal(context.codexClient.initialized, true);
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0][0], "codex:plugin-state");
    assert.deepEqual(JSON.parse(JSON.stringify(notifications[0][1])), {
      ok: true, updated: true, status: "ready", reason: "", version: "7.0.14"
    });
    assert(invalidated.includes("codex:check"));
    assert(invalidated.includes("domi:status"));
    assert.equal(logs.filter(([event]) => event === "domi-plugin-activation").length, 1);
    assert.equal(logs.filter(([event]) => event === "domi-plugin-transport-retry").length, 1);
    assert.doesNotMatch(JSON.stringify([notifications, logs]), /must-not-be-published/);

    // The actual main factory discards a queued request from a replaced
    // connection before it can install, reset or notify the new account.
    activeRuns.set("next-task", {});
    await gate.ensureWhenIdle({ enabled: true, runtimeKey });
    const queuedBeforeReset = gate.deferredRequest;
    context.resetCodexClient();
    assert.equal(gate.deferredRequest, queuedBeforeReset,
      "A same-runtime skill/network reset cannot discard the queued upgrade");
    runtimeKey = "replacement-runtime"; activeRuns.clear(); gate.resumeDeferred();
    assert.equal(gate.deferredRequest, null);
    assert.equal(events.filter(event => event === "install").length, 1);
    assert.equal(notifications.length, 1);

    // Exercise the actual main hook during accepted quit/update. It may close
    // the old client but must not start a new process or notify an exiting UI.
    const startCount = events.filter(event => event === "new-start").length;
    context.applicationQuitFlushStarted = true;
    assert.equal((await gate.ensureWhenIdle({ enabled: true, runtimeKey })).deferred, true);
    await gate.onActivated();
    gate.onSettled({ ok: true, updated: true, version: "7.0.14" }, { runtimeKey });
    assert.equal(events.filter(event => event === "new-start").length, startCount);
    assert.equal(notifications.length, 1);
    gate.cancelDeferred();
    context.applicationQuitFlushStarted = false; context.updateRestartPreparing = true;
    assert.equal((await gate.ensureWhenIdle({ enabled: true, runtimeKey })).deferred, true);
    await gate.onActivated();
    gate.onSettled({ ok: true, updated: true, version: "7.0.14" }, { runtimeKey });
    assert.equal(events.filter(event => event === "new-start").length, startCount);
    assert.equal(notifications.length, 1);
  } finally { allowStart(); gate.dispose(); }
}

async function verifyMainShutdownActivationDrain() {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const registration = main.match(/app\.on\("before-quit", \(event\) => \{[\s\S]*?\n\}\);/)[0];
  for (const rejectActivation of [false, true]) {
    const events = [], logs = [];
    let quitHandler, finishActivation, failActivation, didQuit;
    const pending = new Promise((resolve, reject) => { finishActivation = resolve; failActivation = reject; });
    const quitFinished = new Promise(resolve => { didQuit = resolve; });
    const context = {
      app: { on: (_event, handler) => { quitHandler = handler; }, quit: () => { events.push("quit"); didQuit(); } },
      appendRuntimeLog: (...args) => logs.push(args), codexCheckFailureDetails,
      applicationQuitFlushComplete: false, applicationQuitFlushStarted: false, activeRuns: new Map(),
      BrowserWindow: { getAllWindows: () => [] },
      dialog: { showMessageBox: () => assert.fail("No live tasks or unsaved renderer") },
      requestRendererFlush: () => assert.fail("No renderer"), drainRunPostProcessing: async () => 0,
      domiPluginActivationGate: { pending, dispose: () => events.push("dispose") },
      plaudRecallService: { close: () => events.push("recall-close") },
      domiIntegration: { shutdownAllPlaudOperations: async () => events.push("plaud-close") },
      documentSearchService: { close: async () => events.push("documents-close") },
      updateService: { stop: () => events.push("updates-stop") },
      codexClient: { close: () => events.push("codex-close") },
      stateStore: { close: () => events.push("state-close") }
    };
    vm.createContext(context); vm.runInContext(registration, context);
    quitHandler({ preventDefault: () => events.push("prevent") });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.applicationQuitFlushStarted, true);
    assert.deepEqual(events, ["prevent", "dispose"]);
    events.push("activation-drained");
    if (rejectActivation) failActivation(new Error("Synthetic completed rollback")); else finishActivation({ ok: true });
    await quitFinished;
    assert.deepEqual(events, ["prevent", "dispose", "activation-drained", "recall-close", "plaud-close",
      "documents-close", "updates-stop", "codex-close", "state-close", "quit"]);
    assert.equal(context.applicationQuitFlushComplete, true);
    assert.equal(logs.filter(([event]) => event === "domi-plugin-shutdown-drain").length, Number(rejectActivation));
  }

  // A canceled quit must retain the live gate and its valid deferred request.
  for (const reason of ["user-cancel", "flush-failed"]) {
    let quitHandler, dialogs = 0;
    const context = {
      app: { on: (_event, handler) => { quitHandler = handler; }, quit: () => assert.fail("Quit was canceled") },
      appendRuntimeLog() {}, applicationQuitFlushComplete: false, applicationQuitFlushStarted: false,
      activeRuns: reason === "user-cancel" ? new Map([["running", {}]]) : new Map(),
      BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false }] },
      dialog: { showMessageBox: async () => { dialogs++; return { response: 0 }; } },
      requestRendererFlush: async () => ({ ok: false, error: "Synthetic unsaved work" }),
      drainRunPostProcessing: () => assert.fail("Quit not accepted"),
      domiPluginActivationGate: { dispose: () => assert.fail("Canceling quit must not dispose the live gate") }
    };
    vm.createContext(context); vm.runInContext(registration, context);
    quitHandler({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialogs, 1);
    assert.equal(context.applicationQuitFlushStarted, false);
  }

  // The update-specific will-quit path bypasses ordinary before-quit flushing.
  const updateClose = main.match(/const closeUpdateResources = \(\) => \{[\s\S]*?\n      \};/)[0];
  const closed = [];
  const updateContext = {
    updateInstallFailureHandler: () => {}, installQuitWatchdog: null, clearTimeout,
    updateService: { stop: () => closed.push("updates") },
    domiPluginActivationGate: { dispose: () => closed.push("gate") },
    codexClient: { close: () => closed.push("codex") }, stateStore: { close: () => closed.push("state") },
    appendRuntimeLog() {}, boundedRuntimeText: text => text
  };
  vm.createContext(updateContext); vm.runInContext(`${updateClose}\ncloseUpdateResources();`, updateContext);
  assert(closed.includes("gate"));
  assert(closed.indexOf("gate") < closed.indexOf("codex"));
  assert(closed.indexOf("gate") < closed.indexOf("state"));
}

Promise.all([verifyMainShutdownActivationDrain(), verifyMainAutomaticActivationWiring(), verifyHealthProbeDuringDeferredUpgrade(), verifyDeferredUpgradeAndReadback(), verifyDeferredIdleAndCancellation(), verifyLongPluginOperationLeases(), verifyLocalPlaudCompletionLease(), verifyPlaudPluginActivationLease(), verifyBoundedRemoteStartup(), verifyActivationGate(), verifyRecoveryReaderLease(),
  verifyReadOnlyInstalledCheck(), verifyReadinessDiagnostics()])
  .then(() => console.log("domi plugin manager tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
