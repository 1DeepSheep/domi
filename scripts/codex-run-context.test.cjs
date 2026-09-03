const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
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
  assert.match(main, /startingCodexRunIds\.add\(runId\);\s*try\s*\{\s*await ensureCodexRuntimeReady/);
  assert.match(main, /finally\s*\{\s*startingCodexRunIds\.delete\(runId\);\s*schedulePendingSkillHubCodexReload\(\)/);
  assert.match(main, /if \(activeRuns\.has\(runId\) \|\| startingCodexRunIds\.has\(runId\)\)/);
  assert.match(main, /function activateImportedSkillsWhenSafe\(\)[\s\S]*?codexClientIdleForSkillReload\(activeRuns, startingCodexRunIds\)/);
  assert.match(main, /startsWith\("user-skill:"\) && skillHubCodexReloadPending/);
  assert.match(main, /用户 Skill 更新正在等待当前任务结束后生效/);
  assert.match(main, /\["skill-creator", "[^"\n]*Codex 用户 Skill 目录/);
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
