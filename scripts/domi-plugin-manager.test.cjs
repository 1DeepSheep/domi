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
    codexCheckFailureDetails, pluginCheckFailure,
    ensureDemoWorkspace() {}, ensureCodexRuntimeReady: async () => {},
    throwIfCodexCheckAborted() {}, codexCheckTimeout: (_deadline, maximum) => maximum,
    getAppSettings: () => ({ load: () => ({ settings: { codexPath: "codex" } }) }),
    getCodexRuntime: () => ({ authMode: "chatgpt", codexPath: "codex", env: {} }),
    resolveCodexBinary: () => "codex", codexEnvironment: () => ({}),
    getDomiPluginActivationGate: () => gate,
    getDomiPluginManager: () => ({ checkInstalled: async () => {
      assert.equal(gate.readers, 1, "busy check reads actual registry under a reader lease");
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
  assert.match(notReady.error, /尚未安装/);
  current = { manifest: { version: "0.3.20" } };
  const readyWithExisting = await context.runCodexCheck({});
  assert.equal(readyWithExisting.ok, true);
  assert.equal(readyWithExisting.pluginSetup.deferred, true);
  registered = false;
  const filesWithoutRegistration = await context.runCodexCheck({});
  assert.equal(filesWithoutRegistration.ok, false, "source files alone do not prove plugin activation");
  assert.equal(filesWithoutRegistration.connectionOk, true);
  assert.equal(filesWithoutRegistration.pluginSetup.status, "missing");
  assert.equal(ensureCalls, 1, "busy connection checks do not install/remove plugins");
  assert.equal(resetCalls, 1);
  const realRun = main.slice(main.indexOf("async function runCodex(sender, payload)"), main.indexOf("async function stopCodex("));
  assert.match(realRun, /await getDomiPluginActivationGate\(\)\.waitForActivation\(\);\s*const client = getCodexClient\(\)/);
  assert.match(main, /isBusy: \(\) => updateRestartPreparing\s*\|\| !codexClientIdleForSkillReload\(activeRuns, startingCodexRunIds\)/);
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
    ensureDemoWorkspace: () => calls.push("workspace"),
    ensureCodexRuntimeReady: async () => calls.push("runtime-install"),
    throwIfCodexCheckAborted() {}, codexCheckTimeout: (_deadline, max) => max,
    getAppSettings: () => ({ load: () => ({ settings: { codexPath: runtime.codexPath } }) }),
    getCodexRuntime: () => ({ ...runtime }),
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

Promise.all([verifyBoundedRemoteStartup(), verifyActivationGate(), verifyRecoveryReaderLease(),
  verifyReadOnlyInstalledCheck(), verifyReadinessDiagnostics()])
  .then(() => console.log("domi plugin manager tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
