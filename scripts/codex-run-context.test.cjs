const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { TodoRunWatchdog, isTodoSyncRun } = require("../electron/todo-run-watchdog.cjs");
const {
  bindCodexRunToTurn,
  codexClientIdleForSkillReload,
  codexRunExecutionMode,
  codexTurnContext,
  normalizeCodexRoutingParams,
  partitionCodexRuns,
  prepareCodexRunForNextTurn,
  requestCodexTurn,
  resolveCodexActiveRun,
  runtimeAdditionalContext,
  threadPersistenceOptions
} = require("../electron/codex-run-context.cjs");

test("Skill reload waits for both preflight and active tasks", () => {
  const active = new Map();
  const starting = new Set(["task-a"]);
  assert.equal(codexClientIdleForSkillReload(active, starting), false);
  active.set("task-a", { runId: "task-a" });
  starting.delete("task-a");
  assert.equal(codexClientIdleForSkillReload(active, starting), false);
  starting.add("task-b");
  active.delete("task-a");
  assert.equal(codexClientIdleForSkillReload(active, starting), false);
  starting.delete("task-b");
  assert.equal(codexClientIdleForSkillReload(active, starting), true);
});

test("Skill reload coordination guards the real task preflight and its cleanup", () => {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  assert.match(main, /startingCodexRunIds\.add\(runId\);[\s\S]*?try\s*\{[\s\S]*?await ensureCodexRuntimeReady/);
  assert.match(main, /finally\s*\{[\s\S]*?startingCodexRunIds\.delete\(runId\);\s*schedulePendingSkillHubCodexReload\(\)/);
  assert.match(main, /if \(activeRuns\.has\(runId\) \|\| startingCodexRunIds\.has\(runId\)\)/);
  assert.match(main, /function activateImportedSkillsWhenSafe\(\)[\s\S]*?codexClientIdleForSkillReload\(activeRuns, startingCodexRunIds\)/);
  assert.match(main, /startsWith\("user-skill:"\) && skillHubCodexReloadPending/);
  assert.match(main, /用户 Skill 更新正在等待当前任务结束后生效/);
  assert.match(main, /\["skill-creator", "[^"\n]*Codex 用户 Skill 目录/);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mainRunHarness(overrides = {}) {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const calls = [];
  const events = [];
  const plaudOwners = new Set();
  const plaudIntegration = {
    plaudWorkflowPlan: payload => ({ requiresBrowser: payload.plaudAccess?.kind === "remote"
      || payload.workflowId === "domi-router" || payload.workflowId === "plaud-connection-assist",
      runtimeContext: payload.plaudAccess?.kind === "local_transcript" ? "verified local transcript execution context" : "" }),
    reservePlaudForWorkflow: async runId => { plaudOwners.add(runId); },
    releasePlaudWorkflow: runId => { plaudOwners.delete(runId); }
  };
  const context = {
    path, process, setTimeout, clearTimeout,
    activeRuns: new Map(), startingCodexRunIds: new Set(), cancelledCodexRunIds: new Set(),
    startingCodexThreadIds: new Set(), liveCodexThreads: new Map(), codexThreadTurnIds: new Map(), codexThreadSandboxPolicies: new Map(),
    updateRestartPreparing: false, skillHubCodexReloadPending: false, demoWorkspace: "/synthetic/workspace",
    ensureDemoWorkspace() {}, getAppSettings: () => ({ load: () => ({ settings: { storageBackend: "local" } }) }),
    resolveCanonicalEntityWorkspace: async () => ({ ok: true, workspacePath: "/synthetic/entity" }),
    validCodexWorkspace: () => "/synthetic/workspace", isEntityWorkspace: () => false,
    ensureCodexRuntimeReady: async () => {}, needsLarkAccess: () => false,
    confirmExternalDomiRun: async () => ({ allowed: true, sandbox: "workspace-write" }),
    getDomiPluginActivationGate: () => ({ waitForActivation: async () => {}, withStableClient: callback => callback() }),
    getDomiIntegration: () => plaudIntegration, plaudOwners, codexClient: null,
    projectResearchCacheScope: () => ({ allowed: false, workspacePath: "" }),
    prepareProjectResearchCache: async () => ({}), preparedProjectResearchCacheContext: () => ({}),
    markProjectMaterialIndexInjected() {},
    getStateStore: () => ({}), researchCacheNamespace: () => "synthetic",
    repositoryRuntimeContext: () => "", larkRuntimeContext: async () => "", feishuDocumentWriteContext: async () => "",
    createRunUsageTracker: () => ({}), directoryIdentity: () => ({}), normalizedSlidesDeliveryPolicy: () => null,
    armRunIdleTimeout() {}, appendRuntimeLog() {}, boundedRuntimeText: String,
    schedulePendingSkillHubCodexReload() {}, resetCodexClient() {},
    codexClientIdleForSkillReload, codexRunExecutionMode, threadPersistenceOptions, bindCodexRunToTurn,
    isTodoSyncRun,
    normalizeCodexRoutingParams, requestCodexTurn, resolveCodexActiveRun,
    classifyCodexTurnStatus: require("../electron/codex-turn-status.cjs").classifyCodexTurnStatus,
    publishCodexEvent: (_sender, _runId, event) => events.push(event),
    queueRunPostProcessing() {},
    completeRunThroughSlidesDeliveryGate(run) {
      calls.push({ method: "quality-gate" });
      context.finishRun(run, "completed");
    },
    ...overrides
  };
  context.todoRunWatchdog ||= new TodoRunWatchdog({
    isRunning: id => context.activeRuns.has(id) || context.startingCodexRunIds.has(id),
    stop: id => context.stopCodex(id)
  });
  context.findActiveRun = params => resolveCodexActiveRun(context.activeRuns.values(), params).run;
  context.getCodexClient ||= () => ({
    start: async () => {}, capabilities: () => ({ experimentalApi: true }),
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: "new-thread" } };
      if (method === "thread/resume") return { thread: { id: params.threadId, turns: [] } };
      if (method === "thread/turns/list") return { data: [], nextCursor: null };
      if (method === "turn/start") return { turn: { id: "new-turn" } };
      throw new Error(`Unexpected fake call: ${method}`);
    }
  });
  vm.createContext(context);
  for (const name of ["finishRun", "domiOutputRuntimeContext", "codexThreadRuntimeKey", "rememberCodexThreadSandbox", "codexTurnSandboxPolicy", "readCodexThreadTurnHeaders", "verifyCodexThreadIdle", "resolveThread", "assertCodexRunNotCancelled", "markRunMaterialIndexInjected", "reconcileCodexTurnStart", "runCodex", "stopCodex", "handleCodexNotification", "recoverCodexThread"]) {
    const implementation = main.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}\\n`));
    assert.ok(implementation, `missing real function ${name}`);
    vm.runInContext(implementation[0], context);
  }
  return { context, calls, events };
}

test("todo main watchdog spans preflight and model execution and clears only on terminal completion", async () => {
  const prepared = deferred();
  const { context } = mainRunHarness({ ensureCodexRuntimeReady: () => prepared.promise });
  const id = "todo-sync-main-lifecycle";
  const completion = context.runCodex({}, { runId: id, prompt: "synthetic todo", workflowId: "task", background: true, ephemeral: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.startingCodexRunIds.has(id), true);
  assert.equal(context.todoRunWatchdog.entries.has(id), true);
  prepared.resolve();
  await new Promise(resolve => setImmediate(resolve));
  const run = context.activeRuns.get(id);
  assert.equal(context.startingCodexRunIds.has(id), false);
  assert.equal(context.todoRunWatchdog.entries.has(id), true);
  assert.equal(run.todoSyncWatchdogProtected, true);
  context.finishRun(run, "completed");
  assert.equal((await completion).ok, true);
  assert.equal(context.todoRunWatchdog.entries.has(id), false);
});

test("failed todo preflight clears its main watchdog without affecting another task", async () => {
  const { context } = mainRunHarness({ ensureCodexRuntimeReady: async () => { throw new Error("synthetic preflight failure"); } });
  const id = "todo-sync-preflight-failure";
  const result = await context.runCodex({}, { runId: id, prompt: "synthetic todo", workflowId: "task", background: true, ephemeral: true });
  assert.equal(result.ok, false);
  assert.equal(context.todoRunWatchdog.entries.has(id), false);
  assert.equal(context.startingCodexRunIds.has(id), false);
});

test("every real run supplies the domi output contract without changing user input or starting extra turns", async () => {
  for (const lifecycle of ["new", "resumed", "live"]) {
    for (const experimentalApi of [true, false]) {
      const { context, calls } = mainRunHarness({
        repositoryRuntimeContext: () => "synthetic repository context",
        larkRuntimeContext: async () => "synthetic lark context"
      });
      const client = context.getCodexClient();
      context.getCodexClient = () => ({
        ...client,
        capabilities: () => ({ experimentalApi }),
        async request(method, params) {
          const result = await client.request(method, params);
          if (method === "turn/start") {
            setImmediate(() => context.handleCodexNotification("turn/completed", {
              threadId: params.threadId,
              turnId: result.turn.id,
              turn: { id: result.turn.id, status: "completed" }
            }));
          }
          return result;
        }
      });
      if (lifecycle === "live") {
        context.liveCodexThreads.set("original", context.codexThreadRuntimeKey("/synthetic/workspace", "workspace-write"));
        context.codexThreadTurnIds.set("original", new Set());
      }
      const prompt = "用户明确要求解释指令语法，保留代码示例。";
      const result = await context.runCodex({}, {
        runId: `output-${lifecycle}-${experimentalApi}`, prompt,
        ...(lifecycle === "new" ? {} : { threadId: "original" })
      });
      assert.equal(result.ok, true, `${lifecycle} run must complete`);
      const turns = calls.filter(call => call.method === "turn/start");
      assert.equal(turns.length, 1, "the output contract must not add a model round trip");
      const params = turns[0].params;
      const outputContext = experimentalApi
        ? params.additionalContext["domi-runtime"].value
        : params.input[0].text;
      if (experimentalApi) assert.equal(params.input[0].text, prompt);
      else assert.ok(params.input[0].text.startsWith(`${prompt}\n\n`));
      assert.match(outputContext, /domi 客户端输出能力/);
      assert.ok(outputContext.includes('- :codex-followup[简短操作名]{prompt="完整后续请求"}'));
      assert.match(outputContext, /只将请求填入草稿，用户发送后才执行/);
      assert.match(outputContext, /正式纪要、研究报告及其他保存或导出的文档不写入 UI 指令/);
      assert.match(outputContext, /用户明确要求解释语法、展示代码示例或指定原文/);
      assert.match(outputContext, /synthetic repository context/);
      assert.match(outputContext, /synthetic lark context/);
      assert.equal(calls.filter(call => call.method === "thread/start").length, lifecycle === "new" ? 1 : 0);
      assert.equal(calls.filter(call => call.method === "thread/resume").length, lifecycle === "resumed" ? 1 : 0);
    }
  }
});

test("resume failures preserve the original thread without creating a blank replacement", async () => {
  for (const failure of ["timeout", "not found", "permission denied"]) {
    const { context, calls } = mainRunHarness();
    const client = { request: async (method) => {
      calls.push({ method });
      throw new Error(failure);
    } };
    await assert.rejects(context.resolveThread(client, { threadId: "original", model: "chosen" }, "/synthetic/workspace", "read-only"), /原对话已保留/);
    assert.deepEqual(calls.map(call => call.method), ["thread/resume"]);
  }
});

test("archiving a live thread changes cwd and permissions without resuming or losing retired turns", async () => {
  for (const sandbox of ["workspace-write", "read-only", "danger-full-access"]) {
    const { context, calls } = mainRunHarness({
      confirmExternalDomiRun: async () => ({ allowed: true, sandbox })
    });
    context.liveCodexThreads.set("original", context.codexThreadRuntimeKey("/synthetic/intake", "danger-full-access"));
    context.codexThreadTurnIds.set("original", new Set(["previous-turn"]));
    const running = context.runCodex({}, { runId: "followup", threadId: "original", prompt: "synthetic",
      externalType: "project", externalRecordId: "synthetic-project" });
    await new Promise(resolve => setImmediate(resolve));
    const turnCalls = calls.filter(call => call.method === "turn/start");
    assert.equal(turnCalls.length, 1);
    assert.equal(calls.some(call => call.method === "thread/resume" || call.method === "thread/start"), false);
    const params = turnCalls[0].params;
    assert.equal(params.cwd, "/synthetic/entity");
    assert.deepEqual(Array.from(params.runtimeWorkspaceRoots), ["/synthetic/entity"]);
    assert.equal(params.sandboxPolicy.type, sandbox === "read-only" ? "readOnly"
      : sandbox === "danger-full-access" ? "dangerFullAccess" : "workspaceWrite");
    if (sandbox !== "danger-full-access") assert.equal(params.sandboxPolicy.networkAccess, false);
    if (sandbox === "workspace-write") assert.deepEqual(Array.from(params.sandboxPolicy.writableRoots), ["/synthetic/entity"]);
    const run = context.activeRuns.get("followup");
    assert.ok(run.retiredTurnIds.has("previous-turn"));
    assert.deepEqual(run.turnParameters.sandboxPolicy, params.sandboxPolicy, "automatic correction keeps the same permissions");
    assert.deepEqual(run.turnParameters.runtimeWorkspaceRoots, params.runtimeWorkspaceRoots);
    context.handleCodexNotification("turn/completed", { threadId: "original", turnId: "previous-turn",
      turn: { id: "previous-turn", status: "completed" } });
    assert.equal(run.finished, false, "delayed old completions cannot finish a follow-up");
    context.finishRun(run, "completed");
    assert.equal((await running).ok, true);
  }
});

test("live workspace moves preserve configured network and extra roots without carrying the old cwd", async () => {
  const { context, calls } = mainRunHarness();
  const initial = { thread: { id: "original" }, cwd: "/synthetic/intake", sandbox: {
    type: "workspaceWrite", writableRoots: ["/synthetic/intake", "/synthetic/shared"],
    networkAccess: true, excludeSlashTmp: true, excludeTmpdirEnvVar: true
  } };
  const client = { request: async () => initial };
  assert.equal(await context.resolveThread(client, {}, "/synthetic/intake", "workspace-write"), "original");
  const running = context.runCodex({}, { runId: "custom-policy", threadId: "original", prompt: "synthetic",
    externalType: "project", externalRecordId: "synthetic-project" });
  await new Promise(resolve => setImmediate(resolve));
  const params = calls.find(call => call.method === "turn/start").params;
  assert.equal(params.sandboxPolicy.networkAccess, true);
  assert.deepEqual(Array.from(params.sandboxPolicy.writableRoots), ["/synthetic/entity", "/synthetic/shared"]);
  assert.equal(params.sandboxPolicy.excludeSlashTmp, true);
  assert.equal(params.sandboxPolicy.excludeTmpdirEnvVar, true);
  assert.deepEqual(initial.sandbox.writableRoots, ["/synthetic/intake", "/synthetic/shared"]);
  context.finishRun(context.activeRuns.get("custom-policy"), "completed");
  await running;
});

test("resumed policies are preserved only for a matching mode and guidance always stays offline", async () => {
  const { context } = mainRunHarness();
  const client = { request: async method => method === "thread/resume" ? {
    thread: { id: "original" }, cwd: "/synthetic/intake",
    sandbox: { type: "readOnly", networkAccess: true }
  } : { data: [], nextCursor: null } };
  await context.resolveThread(client, { threadId: "original" }, "/synthetic/entity", "read-only");
  assert.equal(context.codexTurnSandboxPolicy("read-only", "/synthetic/entity", "original").networkAccess, true);
  assert.equal(context.codexTurnSandboxPolicy("read-only", "/synthetic/entity", "original", true).networkAccess, false);
  context.rememberCodexThreadSandbox("original", { sandbox: { type: "dangerFullAccess" } }, "/synthetic/intake");
  const downgrade = context.codexTurnSandboxPolicy("workspace-write", "/synthetic/entity", "original");
  assert.equal(downgrade.networkAccess, false);
  assert.deepEqual(Array.from(downgrade.writableRoots), ["/synthetic/entity"]);
});

test("a rejected elevated turn cannot widen the cached effective policy", async () => {
  const { context } = mainRunHarness({ confirmExternalDomiRun: async () => ({ allowed: true, sandbox: "danger-full-access" }) });
  context.liveCodexThreads.set("original", context.codexThreadRuntimeKey("/synthetic/intake", "workspace-write"));
  context.codexThreadTurnIds.set("original", new Set());
  context.rememberCodexThreadSandbox("original", { sandbox: { type: "workspaceWrite", networkAccess: false,
    writableRoots: ["/synthetic/shared"] } }, "/synthetic/intake");
  const before = context.codexThreadSandboxPolicies.get("original");
  const client = context.getCodexClient();
  context.getCodexClient = () => ({ ...client, request: async method => {
    assert.equal(method, "turn/start");
    throw Object.assign(new Error("rejected"), { responseReceived: true });
  } });
  const result = await context.runCodex({}, { runId: "rejected-policy", threadId: "original", prompt: "synthetic" });
  assert.equal(result.ok, false);
  assert.equal(context.codexThreadSandboxPolicies.get("original"), before);
  const next = context.codexTurnSandboxPolicy("workspace-write", "/synthetic/entity", "original");
  assert.equal(next.type, "workspaceWrite");
  assert.equal(next.networkAccess, false);
  assert.deepEqual(Array.from(next.writableRoots), ["/synthetic/entity", "/synthetic/shared"]);
});

test("cold resume pages every turn header without hydrating items", async () => {
  const { context } = mainRunHarness();
  const calls = [];
  const client = { request: async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/resume") return { thread: { id: "original", turns: [] } };
    assert.equal(method, "thread/turns/list");
    assert.equal(params.itemsView, "notLoaded");
    return params.cursor === null
      ? { data: [{ id: "recent", status: "completed" }], nextCursor: "older-page" }
      : { data: [{ id: "old", status: "interrupted" }], nextCursor: null };
  } };
  assert.equal(await context.resolveThread(client, { threadId: "original" }, "/synthetic/workspace", "read-only"), "original");
  assert.equal(calls[0].params.excludeTurns, true);
  assert.deepEqual([...context.codexThreadTurnIds.get("original")], ["recent", "old"]);
  assert.equal(calls.length, 3);
});

test("a lost resume response recovers only the same proven idle thread without resending", async () => {
  const { context } = mainRunHarness();
  const calls = [];
  const client = { request: async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/resume") throw Object.assign(new Error("timeout"), {
      code: "DOMI_CODEX_REQUEST_TIMEOUT", requestSent: true
    });
    if (method === "thread/read") {
      assert.equal(params.includeTurns, false);
      return { thread: { id: "original", status: { type: "idle" } } };
    }
    assert.equal(method, "thread/turns/list");
    return { data: [{ id: "previous-turn", status: "completed" }], nextCursor: null };
  } };
  assert.equal(await context.resolveThread(client, { threadId: "original" }, "/synthetic/new", "workspace-write"), "original");
  assert.deepEqual(calls.map(call => call.method), ["thread/resume", "thread/read", "thread/turns/list", "thread/read"]);
  assert.deepEqual([...context.codexThreadTurnIds.get("original")], ["previous-turn"]);
  assert.equal(await context.resolveThread(client, { threadId: "original" }, "/synthetic/next", "read-only"), "original");
  assert.equal(calls.length, 4, "the next follow-up reuses the recovered thread");
});

for (const failure of ["wrong-id", "not-loaded", "active", "became-active", "active-turn", "unknown-turn", "unreadable"]) {
  test(`resume timeout reconciliation preserves history and fails closed for ${failure}`, async () => {
    const { context } = mainRunHarness();
    const calls = [];
    let reads = 0;
    const client = { request: async method => {
      calls.push(method);
      if (method === "thread/resume") throw Object.assign(new Error("timeout"), {
        code: "DOMI_CODEX_REQUEST_TIMEOUT", requestSent: true
      });
      if (method === "thread/read") {
        reads++;
        return { thread: { id: failure === "wrong-id" ? "different" : "original",
          status: { type: failure === "not-loaded" ? "notLoaded"
            : failure === "active" || (failure === "became-active" && reads > 1) ? "active" : "idle" } } };
      }
      assert.equal(method, "thread/turns/list");
      return failure === "unreadable" ? { data: [] } : { data: [{ id: "previous-turn",
        status: failure === "active-turn" ? "inProgress" : failure === "unknown-turn" ? "futureStatus" : "completed" }], nextCursor: null };
    } };
    await assert.rejects(context.resolveThread(client, { threadId: "original" }, "/synthetic/workspace", "read-only"), /原对话已保留/);
    assert.equal(calls.filter(method => method === "thread/resume").length, 1);
    assert.equal(calls.includes("thread/start"), false);
    assert.equal(context.liveCodexThreads.has("original"), false);
    assert.equal(context.codexThreadTurnIds.has("original"), false);
  });
}

test("turn baseline rejects repeated cursors and duplicate turn ids", async () => {
  for (const duplicate of ["cursor", "turn-id"]) {
    const { context } = mainRunHarness();
    let page = 0;
    const client = { request: async () => ({ data: [{ id: duplicate === "turn-id" ? "same" : `turn-${page++}`, status: "completed" }],
      nextCursor: duplicate === "cursor" ? "same" : `page-${page++}` }) };
    await assert.rejects(context.readCodexThreadTurnHeaders(client, "original"), /无效/);
  }
});

test("empty intermediate turn pages fail closed instead of silently accepting an incomplete baseline", async () => {
  const { context } = mainRunHarness();
  let calls = 0;
  await assert.rejects(context.readCodexThreadTurnHeaders({ request: async () => {
    calls++;
    return { data: [], nextCursor: "another-page" };
  } }, "original"), /分页状态无效/);
  assert.equal(calls, 1);
});

test("ephemeral completion removes its effective policy while persistent threads retain it", async () => {
  for (const ephemeral of [true, false]) {
    const { context } = mainRunHarness();
    const running = context.runCodex({}, { runId: "cleanup-policy", prompt: "synthetic", ephemeral });
    await new Promise(resolve => setImmediate(resolve));
    const run = context.activeRuns.get("cleanup-policy");
    context.rememberCodexThreadSandbox(run.threadId, { sandbox: { type: "workspaceWrite", networkAccess: true } }, run.workspacePath);
    context.finishRun(run, "completed");
    await running;
    assert.equal(context.codexThreadSandboxPolicies.has(run.threadId), !ephemeral);
  }
});

test("PLAUD reservations outlive turn acceptance and release only at a terminal task outcome", async () => {
  for (const outcome of ["completed", "failed", "stopped", "waiting-input"]) {
    const { context } = mainRunHarness();
    const running = context.runCodex({}, { runId: outcome, prompt: "synthetic", workflowId: "domi-router" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.startingCodexRunIds.has(outcome), false, "runCodex outer finally has executed");
    assert.equal(context.plaudOwners.has(outcome), true, "returning completion must retain the profile owner");
    const run = context.activeRuns.get(outcome);
    assert.equal(run.plaudWorkflowReserved, true);
    context.finishRun(run, outcome);
    assert.equal((await running).ok, outcome !== "failed");
    assert.equal(context.plaudOwners.size, 0);
    context.finishRun(run, outcome);
    assert.equal(context.plaudOwners.size, 0, "duplicate finish remains idempotent");
  }
});

test("PLAUD preflight failures and cancellation release reservations without submitting a turn", async () => {
  for (const outcome of ["failed", "cancelled"]) {
    const entered = deferred();
    const pending = deferred();
    const { context, calls } = mainRunHarness();
    const client = context.getCodexClient();
    context.getCodexClient = () => ({ ...client, start: async () => { entered.resolve(); await pending.promise; } });
    const running = context.runCodex({}, { runId: outcome, prompt: "synthetic", plaudAccess: { kind: "remote" } });
    await entered.promise;
    assert.equal(context.plaudOwners.has(outcome), true);
    if (outcome === "cancelled") {
      await context.stopCodex(outcome);
      assert.equal(context.plaudOwners.size, 0);
      pending.resolve();
    } else pending.reject(new Error("synthetic startup failure"));
    const result = await running;
    assert.equal(result.ok, outcome === "cancelled");
    assert.equal(context.plaudOwners.size, 0);
    assert.equal(calls.some(call => call.method === "turn/start"), false);
  }
});

test("an explicitly rejected PLAUD turn start releases its reservation", async () => {
  const { context } = mainRunHarness();
  const client = context.getCodexClient();
  context.getCodexClient = () => ({ ...client, request: (method, params) => {
    if (method === "turn/start") throw Object.assign(new Error("rejected"), { responseReceived: true });
    return client.request(method, params);
  } });
  const result = await context.runCodex({}, { runId: "rejected", prompt: "synthetic", plaudAccess: { kind: "remote" } });
  assert.equal(result.ok, false);
  assert.equal(context.plaudOwners.size, 0);
  assert.equal(context.activeRuns.size, 0);
});

test("verified local PLAUD execution context reaches the model without reserving a browser", async () => {
  const { context, calls } = mainRunHarness();
  const running = context.runCodex({}, { runId: "local-transcript", prompt: "synthetic",
    plaudAccess: { kind: "local_transcript", transcriptPath: "/synthetic/transcript.md" } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.plaudOwners.size, 0);
  const turn = calls.find(call => call.method === "turn/start");
  assert.match(turn.params.additionalContext["domi-runtime"].value, /verified local transcript execution context/);
  context.finishRun(context.activeRuns.get("local-transcript"), "completed");
  assert.equal((await running).ok, true);
});

test("a PLAUD interrupt acknowledgement without a terminal turn keeps the profile reserved", async () => {
  for (const terminal of [false, true]) {
    const { context } = mainRunHarness({ setTimeout: callback => setImmediate(callback) });
    const client = context.getCodexClient();
    context.getCodexClient = () => ({ ...client, request: (method, params) => {
      if (method === "turn/interrupt") return Promise.resolve({});
      if (method === "thread/read") return Promise.resolve({ thread: { turns: [{ id: "new-turn", status: terminal ? "interrupted" : "inProgress" }] } });
      return client.request(method, params);
    } });
    const running = context.runCodex({}, { runId: "stopping", prompt: "synthetic", plaudAccess: { kind: "remote" } });
    await new Promise(resolve => setImmediate(resolve));
    const result = await context.stopCodex("stopping");
    assert.equal(result.ok, terminal);
    assert.equal(context.plaudOwners.has("stopping"), !terminal);
    if (!terminal) context.finishRun(context.activeRuns.get("stopping"), "stopped");
    await running;
  }
});

test("idle timeout retains an uncertain PLAUD task instead of locally declaring it finished", async () => {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const implementation = main.match(/function armRunIdleTimeout\([^]*?\n\}\n/)[0];
  let timeoutCallback, finishCalls = 0, stopCalls = 0;
  const run = { runId: "idle", plaudWorkflowReserved: true, turnId: "original-turn" };
  const context = { activeRuns: new Map([[run.runId, run]]), clearTimeout() {},
    setTimeout(callback) { timeoutCallback = callback; return { unref() {} }; },
    CODEX_RUN_IDLE_TIMEOUT_MS: 1000, finishRun() { finishCalls++; }, publishCodexEvent() {},
    stopCodex: async () => { stopCalls++; return { ok: false }; } };
  vm.createContext(context); vm.runInContext(implementation, context);
  context.armRunIdleTimeout(run);
  timeoutCallback(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopCalls, 1);
  assert.equal(finishCalls, 0);
  assert.equal(context.activeRuns.get(run.runId), run);
  assert.equal(run.plaudWorkflowReserved, true);
});

test("resume refuses an active remote turn and preserves model settings for a completed thread", async () => {
  const { context } = mainRunHarness();
  let status = "inProgress";
  const calls = [];
  const client = { request: async (method, params) => {
    calls.push({ method, params });
    return method === "thread/turns/list" ? { data: [{ id: "old-turn", status }], nextCursor: null }
      : { thread: { id: "original", turns: [] } };
  } };
  const payload = { threadId: "original", model: "chosen-model", reasoningEffort: "high", serviceTier: "fast" };
  await assert.rejects(context.resolveThread(client, payload, "/synthetic/workspace", "workspace-write"), /仍有任务运行/);
  status = "completed";
  assert.equal(await context.resolveThread(client, payload, "/synthetic/workspace", "workspace-write"), "original");
  const resume = calls.findLast(call => call.method === "thread/resume");
  assert.equal(resume.params.model, "chosen-model");
  assert.equal(resume.params.config.model_reasoning_effort, "high");
  assert.equal(resume.params.serviceTier, "fast");
  assert.equal(resume.params.excludeTurns, true);
});

for (const phase of ["entity", "runtime", "client"]) {
  test(`cancel during ${phase} preparation never submits a turn`, async () => {
    const pending = deferred();
    const entered = deferred();
    const wait = () => { entered.resolve(); return pending.promise; };
    const { context, calls } = mainRunHarness(phase === "entity"
      ? { resolveCanonicalEntityWorkspace: wait }
      : phase === "runtime" ? { ensureCodexRuntimeReady: wait } : {});
    if (phase === "client") {
      const client = context.getCodexClient();
      context.getCodexClient = () => ({ ...client, start: wait });
    }
    const running = context.runCodex({}, { runId: "cancel-me", prompt: "synthetic", externalType: "project", externalRecordId: "fake-project" });
    await entered.promise;
    assert.equal((await context.stopCodex("cancel-me")).ok, true);
    pending.resolve({ ok: true, workspacePath: "/synthetic/entity" });
    const result = await running;
    assert.equal(result.stopped, true);
    assert.equal(calls.some(call => call.method === "turn/start"), false);
    assert.equal(context.startingCodexRunIds.size, 0);
  });
}

test("a lost turn/start response recovers the new final answer through the delivery gate without resending", async () => {
  let turnStarts = 0;
  const { context, calls } = mainRunHarness({ getCodexClient: () => ({
    start: async () => {}, capabilities: () => ({ experimentalApi: true }),
    request: async (method, params) => {
      if (method === "thread/resume") return { thread: { id: params.threadId, turns: [] } };
      if (method === "thread/turns/list") return { data: [{ id: "old", status: "completed" }], nextCursor: null };
      if (method === "turn/start") {
        turnStarts += 1;
        throw Object.assign(new Error("lost response"), { code: "DOMI_CODEX_REQUEST_TIMEOUT", requestSent: true });
      }
      assert.equal(method, "thread/read");
      return { thread: { turns: [
        { id: "old", status: "completed", items: [{ type: "agentMessage", text: "Previous answer" }] },
        { id: "new", status: "completed", items: [{ type: "agentMessage", phase: "final_answer", text: "Recovered exact answer" }] }
      ] } };
    }
  }) });
  const result = await context.runCodex({}, { runId: "lost", threadId: "original", prompt: "new request" });
  assert.equal(result.ok, true);
  assert.equal(result.output, "Recovered exact answer");
  assert.equal(turnStarts, 1);
  assert.equal(calls.filter(call => call.method === "quality-gate").length, 1);
});

test("an unknown submission keeps its owner and blocks a different run id on the same thread", async () => {
  const read = deferred();
  const { context } = mainRunHarness({ getCodexClient: () => ({
    start: async () => {}, capabilities: () => ({ experimentalApi: true }),
    request: async (method, params) => {
      if (method === "thread/resume") return { thread: { id: params.threadId, turns: [] } };
      if (method === "thread/turns/list") return { data: [{ id: "old", status: "completed" }], nextCursor: null };
      if (method === "turn/start") throw Object.assign(new Error("timeout"), { requestSent: true });
      read.resolve();
      return { thread: { turns: [{ id: "old", status: "completed", items: [{ type: "agentMessage", text: "Old result" }] }] } };
    }
  }) });
  const running = context.runCodex({}, { runId: "original-run", threadId: "original", prompt: "new request", plaudAccess: { kind: "remote" } });
  await read.promise;
  const retry = await context.runCodex({}, { runId: "different-run", threadId: "original", prompt: "new request" });
  assert.equal(retry.ok, false);
  assert.match(retry.error, /避免重复提交/);
  const run = context.activeRuns.get("original-run");
  assert.ok(run);
  assert.equal(run.output, "");
  assert.equal(run.startOutcomeUnknown, true);
  assert.equal(context.plaudOwners.has("original-run"), true, "uncertain submissions must retain their PLAUD owner");
  const recovered = await context.recoverCodexThread("original");
  assert.equal(recovered.status, "running");
  assert.equal(recovered.output, "", "reopening the renderer must not show the previous answer as this submission");
  assert.equal(recovered.turnId, "");
  context.handleCodexNotification("turn/completed", { threadId: "original", turnId: "late-turn", turn: { id: "late-turn", status: "completed" } });
  assert.equal((await running).ok, true);
  assert.equal(context.plaudOwners.size, 0);
});

test("a stop requested before the turn id arrives interrupts that same turn when it becomes known", async () => {
  const sent = deferred();
  const response = deferred();
  const interrupts = [];
  const { context } = mainRunHarness({ getCodexClient: () => ({
    start: async () => {}, capabilities: () => ({ experimentalApi: true }),
    request: async (method, params) => {
      if (method === "thread/start") return { thread: { id: "original" } };
      if (method === "turn/start") { sent.resolve(); return response.promise; }
      assert.equal(method, "turn/interrupt");
      interrupts.push(params.turnId);
      context.handleCodexNotification("turn/completed", { threadId: "original", turnId: "late", turn: { id: "late", status: "interrupted" } });
      return {};
    }
  }) });
  const running = context.runCodex({}, { runId: "cancel-sent", prompt: "synthetic", plaudAccess: { kind: "remote" } });
  await sent.promise;
  const stopping = context.stopCodex("cancel-sent");
  assert.equal(context.activeRuns.get("cancel-sent").stopRequested, true);
  assert.equal(context.plaudOwners.has("cancel-sent"), true);
  response.resolve({ turn: { id: "late" } });
  assert.equal((await running).stopped, true);
  assert.equal((await stopping).ok, true);
  assert.deepEqual(interrupts, ["late"]);
  assert.equal(context.plaudOwners.size, 0);
});

test("safe app updates wait for a task in preflight without counting it twice once active", () => {
  const main = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const implementation = main.match(/function criticalUpdateActivity\(\) \{[\s\S]*?\n\}\n/)[0];
  const context = {
    activeRuns: new Map(),
    startingCodexRunIds: new Set(["preparing-task"]),
    pendingRunPostProcessing: new Set(),
    domiPluginActivationGate: null,
    domiIntegration: { criticalOperationSnapshot: () => ({ total: 0 }) },
    serviceCoordinator: { snapshot: () => [] }
  };
  vm.createContext(context);
  vm.runInContext(implementation, context);
  assert.equal(context.criticalUpdateActivity().total, 1);
  assert.equal(context.criticalUpdateActivity().counts.codexPreflight, 1);
  context.activeRuns.set("preparing-task", {});
  assert.equal(context.criticalUpdateActivity().total, 1);
  assert.equal(context.criticalUpdateActivity().counts.codexPreflight, 0);
  context.startingCodexRunIds.clear();
  assert.equal(context.criticalUpdateActivity().total, 1);
  context.activeRuns.clear();
  assert.equal(context.criticalUpdateActivity().total, 0);
  context.domiPluginActivationGate = { pending: Promise.resolve() };
  assert.equal(context.criticalUpdateActivity().total, 1);
  context.domiPluginActivationGate = { pending: null, readers: 1 };
  assert.equal(context.criticalUpdateActivity().total, 1);
});

test("a correction accepts early next-turn events without replaying the retired turn", () => {
  const run = { runId: "run-slides", threadId: "thread-slides", turnId: "turn-original" };
  prepareCodexRunForNextTurn(run);
  assert.equal(run.turnId, "");
  const stale = resolveCodexActiveRun([run], {
    threadId: run.threadId, turnId: "turn-original"
  });
  assert.equal(stale.run, null);
  assert.equal(stale.rejectionReason, "retired-turn-id");
  const early = resolveCodexActiveRun([run], {
    threadId: run.threadId, turnId: "turn-correction"
  });
  assert.equal(early.run, run);
  assert.equal(early.matchedBy, "threadId");
  assert.equal(bindCodexRunToTurn(run, "turn-correction"), true);
  // A delayed turn/start response from the original call must not overwrite
  // the next turn, even when its completion arrived before that response.
  assert.equal(bindCodexRunToTurn(run, "turn-original"), false);
  assert.equal(run.turnId, "turn-correction");
  assert.equal(resolveCodexActiveRun([run], {
    threadId: run.threadId, turnId: "turn-correction"
  }).run, run);
  assert.equal(resolveCodexActiveRun([run], {
    threadId: run.threadId, turnId: "turn-original"
  }).run, null);
});

test("background runs create ephemeral Codex threads", () => {
  assert.deepEqual(threadPersistenceOptions({ ephemeral: true }), { ephemeral: true });
  assert.deepEqual(threadPersistenceOptions({ ephemeral: false }), {});
  assert.deepEqual(threadPersistenceOptions({}), {});
});

test("connection maintenance distinguishes background automation from user tasks", () => {
  assert.equal(codexRunExecutionMode({ background: true }), "background");
  assert.equal(codexRunExecutionMode({ background: false }), "foreground");
  assert.equal(codexRunExecutionMode({}), "foreground");

  const automaticRun = { runId: "radar", executionMode: "background" };
  const userRun = { runId: "user-task", executionMode: "foreground" };
  const legacyRun = { runId: "legacy-task" };
  assert.deepEqual(
    partitionCodexRuns([automaticRun, userRun, legacyRun]),
    {
      background: [automaticRun],
      foreground: [userRun, legacyRun]
    }
  );
});

test("active run routing checks every turn before considering a thread fallback", () => {
  const earlierRunWithSameThread = {
    runId: "run-earlier",
    threadId: "thread-shared",
    turnId: "turn-earlier"
  };
  const exactTurnRun = {
    runId: "run-exact",
    threadId: "thread-shared",
    turnId: "turn-exact"
  };

  const result = resolveCodexActiveRun(
    [earlierRunWithSameThread, exactTurnRun],
    { threadId: "thread-shared", turnId: "turn-exact" }
  );

  assert.equal(result.run, exactTurnRun);
  assert.equal(result.matchedBy, "turnId");
  assert.deepEqual(result.ambiguousCandidates, []);
  assert.deepEqual(result.conflictingCandidates, []);
});

test("an exact turn match wins even when the event thread id is stale", () => {
  const threadCandidate = {
    runId: "run-thread",
    threadId: "thread-stale",
    turnId: "turn-other"
  };
  const exactTurnRun = {
    runId: "run-turn",
    threadId: "thread-current",
    turnId: "turn-current"
  };

  const result = resolveCodexActiveRun(
    [threadCandidate, exactTurnRun],
    { threadId: "thread-stale", turnId: "turn-current" }
  );

  assert.equal(result.run, exactTurnRun);
  assert.equal(result.matchedBy, "turnId");
});

test("active run routing rejects a duplicated exact turn instead of picking the first run", () => {
  const first = {
    runId: "run-first-turn",
    threadId: "thread-a",
    turnId: "turn-duplicated"
  };
  const second = {
    runId: "run-second-turn",
    threadId: "thread-b",
    turnId: "turn-duplicated"
  };

  const result = resolveCodexActiveRun(
    [first, second],
    { threadId: "thread-a", turnId: "turn-duplicated" }
  );

  assert.equal(result.run, null);
  assert.equal(result.matchedBy, null);
  assert.deepEqual(result.ambiguousCandidates, [first, second]);
});

test("active run routing falls back to a unique unbound thread candidate", () => {
  const onlyRun = {
    runId: "run-only",
    threadId: "thread-only",
    turnId: null
  };

  const result = resolveCodexActiveRun(
    [onlyRun],
    { threadId: "thread-only", turnId: "turn-not-yet-known" }
  );

  assert.equal(result.run, onlyRun);
  assert.equal(result.matchedBy, "threadId");
  assert.deepEqual(result.ambiguousCandidates, []);
});

test("active run routing rejects a unique thread candidate bound to a different turn", () => {
  const boundRun = {
    runId: "run-bound",
    threadId: "thread-only",
    turnId: "turn-existing"
  };

  const result = resolveCodexActiveRun(
    [boundRun],
    { threadId: "thread-only", turnId: "turn-different" }
  );

  assert.equal(result.run, null);
  assert.equal(result.matchedBy, null);
  assert.deepEqual(result.ambiguousCandidates, []);
  assert.deepEqual(result.conflictingCandidates, [boundRun]);
  assert.equal(result.rejectionReason, "turn-id-conflict");
});

test("active run routing may use a unique bound thread only when the event omits turn id", () => {
  const boundRun = {
    runId: "run-bound",
    threadId: "thread-only",
    turnId: "turn-existing"
  };

  const result = resolveCodexActiveRun([boundRun], { threadId: "thread-only" });

  assert.equal(result.run, boundRun);
  assert.equal(result.matchedBy, "threadId");
});

test("active run routing rejects an ambiguous thread fallback", () => {
  const first = {
    runId: "run-first",
    threadId: "thread-shared",
    turnId: "turn-first"
  };
  const second = {
    runId: "run-second",
    threadId: "thread-shared",
    turnId: "turn-second"
  };

  const result = resolveCodexActiveRun(
    new Map([[first.runId, first], [second.runId, second]]).values(),
    { threadId: "thread-shared", turnId: "turn-unknown" }
  );

  assert.equal(result.run, null);
  assert.equal(result.matchedBy, null);
  assert.deepEqual(result.ambiguousCandidates, [first, second]);
});

test("Codex event routing normalizes turn ids from turn and item schemas", () => {
  assert.deepEqual(
    normalizeCodexRoutingParams({
      threadId: " thread-direct ",
      turn: { id: " turn-from-object " }
    }),
    {
      threadId: "thread-direct",
      turnId: "turn-from-object",
      turn: { id: " turn-from-object " }
    }
  );
  assert.equal(
    normalizeCodexRoutingParams({
      item: { threadId: "thread-from-item", turnId: "turn-from-item" }
    }).turnId,
    "turn-from-item"
  );
  assert.equal(
    normalizeCodexRoutingParams({
      turnId: "turn-direct",
      turn: { id: "turn-nested" },
      item: { turnId: "turn-item" }
    }).turnId,
    "turn-direct"
  );
});

test("runtime preflight is application context instead of user prompt text", () => {
  assert.deepEqual(runtimeAdditionalContext("飞书预检已通过"), {
    "domi-runtime": {
      kind: "application",
      value: "飞书预检已通过"
    }
  });
  assert.equal(runtimeAdditionalContext("  "), undefined);
  assert.deepEqual(codexTurnContext("更新行业动态", "飞书预检已通过"), {
    input: [{ type: "text", text: "更新行业动态" }],
    additionalContext: {
      "domi-runtime": {
        kind: "application",
        value: "飞书预检已通过"
      }
    }
  });
});

test("stable compatibility mode never sends additionalContext", () => {
  const context = codexTurnContext("更新行业动态", "飞书预检已通过", {
    capabilities: { experimentalApi: false }
  });
  assert.equal(Object.hasOwn(context, "additionalContext"), false);
  assert.match(context.input[0].text, /^更新行业动态/);
  assert.match(context.input[0].text, /mode="compatibility"/);
  assert.match(context.input[0].text, /飞书预检已通过/);
});

test("turn start retries once with stable input when additionalContext is rejected", async () => {
  const calls = [];
  const compatibilityEvents = [];
  const client = {
    capabilities: () => ({ experimentalApi: true }),
    request: async (method, params) => {
      calls.push({ method, params });
      if (calls.length === 1) {
        throw new Error("turn/start.additionalContext requires experimentalApi capability");
      }
      return { turn: { id: "turn-compatible" } };
    }
  };

  const result = await requestCodexTurn(
    client,
    { threadId: "thread-1", cwd: "/tmp/project" },
    "更新行业动态",
    "飞书预检已通过",
    { onCompatibility: (event) => compatibilityEvents.push(event) }
  );

  assert.equal(result.turn.id, "turn-compatible");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].params.additionalContext);
  assert.equal(Object.hasOwn(calls[1].params, "additionalContext"), false);
  assert.match(calls[1].params.input[0].text, /飞书预检已通过/);
  assert.equal(compatibilityEvents[0].reason, "additional-context-rejected");
});

test("stable clients use compatibility input without a failed first request", async () => {
  const calls = [];
  const compatibilityEvents = [];
  const client = {
    capabilities: () => ({ experimentalApi: false }),
    request: async (method, params) => {
      calls.push({ method, params });
      return { turn: { id: "turn-stable" } };
    }
  };

  const result = await requestCodexTurn(
    client,
    { threadId: "thread-2" },
    "更新行业动态",
    "飞书预检已通过",
    { onCompatibility: (event) => compatibilityEvents.push(event) }
  );

  assert.equal(result.turn.id, "turn-stable");
  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0].params, "additionalContext"), false);
  assert.equal(compatibilityEvents[0].reason, "stable-client");
});
