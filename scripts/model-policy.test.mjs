import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DOMI_ECONOMY_MODEL_ID,
  DOMI_PREMIUM_MODEL_ID,
  domiModelPolicyClass,
  resolveDomiModelPolicy
} from "../src/model-policy.ts";

const models = [
  {
    id: DOMI_ECONOMY_MODEL_ID,
    supportedReasoningEfforts: [{ id: "low" }, { id: "medium" }],
    serviceTiers: [{ id: "priority" }]
  },
  {
    id: DOMI_PREMIUM_MODEL_ID,
    supportedReasoningEfforts: [{ id: "medium" }, { id: "high" }, { id: "max" }],
    serviceTiers: [{ id: "priority" }, { id: "flex" }]
  }
];

function resolve(workflowId, overrides = {}) {
  return resolveDomiModelPolicy({
    workflowId,
    models,
    userModel: "user-selected-model",
    userReasoningEffort: "high",
    userServiceTier: "priority",
    ...overrides
  });
}

test("radar and Todo use Terra medium at standard speed", () => {
  for (const workflowId of ["investment-radar", "task"]) {
    assert.deepEqual(resolve(workflowId), {
      policyClass: "economy",
      model: DOMI_ECONOMY_MODEL_ID,
      reasoningEffort: "medium",
      serviceTier: "standard"
    });
  }
});

test("externally deliverable workflows use Sol max and preserve the user speed tier", () => {
  const workflows = [
    "domi-router",
    "quick-discussion",
    "meeting-note",
    "meeting-prep",
    "project-research",
    "project-intake",
    "desk-research",
    "investment-review",
    "investment-analysis",
    "ic-memo"
  ];
  for (const workflowId of workflows) {
    assert.deepEqual(resolve(workflowId, { userServiceTier: "flex" }), {
      policyClass: "premium",
      model: DOMI_PREMIUM_MODEL_ID,
      reasoningEffort: "max",
      serviceTier: "flex"
    });
  }
});

test("podcast archive is explicitly pinned to the premium policy", () => {
  assert.equal(domiModelPolicyClass(undefined, "podcast-archive"), "premium");
  assert.deepEqual(resolveDomiModelPolicy({
    runKind: "podcast-archive",
    models,
    userModel: "default",
    userReasoningEffort: "default",
    userServiceTier: "default"
  }), {
    policyClass: "premium",
    model: DOMI_PREMIUM_MODEL_ID,
    reasoningEffort: "max",
    serviceTier: "default"
  });
});

test("ordinary and unclassified workflows inherit every user selection", () => {
  assert.deepEqual(resolve("schedule"), {
    policyClass: "inherit",
    model: "user-selected-model",
    reasoningEffort: "high",
    serviceTier: "priority"
  });
  assert.deepEqual(resolve(undefined), {
    policyClass: "inherit",
    model: "user-selected-model",
    reasoningEffort: "high",
    serviceTier: "priority"
  });
});

test("a missing model/list fails closed instead of silently falling back", () => {
  assert.throws(
    () => resolve("investment-radar", { models: [] }),
    /model\/list.*不会静默/
  );
  assert.throws(
    () => resolve("ic-memo", { models: undefined }),
    /model\/list.*不会静默/
  );
});

test("missing models and reasoning capabilities fail closed", () => {
  assert.throws(
    () => resolve("investment-radar", { models: models.slice(1) }),
    new RegExp(`${DOMI_ECONOMY_MODEL_ID}.*不会静默降级`)
  );
  assert.throws(
    () => resolve("ic-memo", {
      models: [{
        id: DOMI_PREMIUM_MODEL_ID,
        supportedReasoningEfforts: [{ id: "high" }],
        serviceTiers: [{ id: "priority" }]
      }]
    }),
    /不支持策略要求的 max.*不会静默降级/
  );
});

test("premium work never silently changes an unsupported user speed tier", () => {
  assert.throws(
    () => resolve("meeting-note", { userServiceTier: "unsupported-fast" }),
    /不支持用户选择的 unsupported-fast.*不会静默改档/
  );
});

test("every renderer entry point uses the centralized policy before starting or persisting a run", () => {
  const appSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "App.tsx"),
    "utf8"
  );
  const segment = (startMarker, endMarker) => {
    const start = appSource.indexOf(startMarker);
    const end = appSource.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing App segment: ${startMarker}`);
    return appSource.slice(start, end);
  };

  const radar = segment("async function scanWeeklyNews", "async function archivePodcastTranscript");
  assert.match(radar, /resolveRunModelPolicy\(radarWorkflow\.id\)/);
  assert.match(radar, /model: runModelPolicy\.model/);
  assert.doesNotMatch(radar, /model,\s*\n\s*reasoningEffort,\s*\n\s*serviceTier/);

  const podcast = segment("async function archivePodcastTranscript", "async function notifyImportantWeeklyNews");
  assert.match(podcast, /runKind: "podcast-archive"/);
  assert.match(podcast, /model: runModelPolicy\.model/);

  const todo = segment("async function syncManagedTasks", "async function resolveDomiEntityWorkspacePath");
  assert.match(todo, /resolveRunModelPolicy\(todoWorkflow\.id\)/);
  assert.match(todo, /serviceTier: runModelPolicy\.serviceTier/);

  const submit = segment("async function submitToCodexInternal", "function handleSubmit");
  assert.match(submit, /resolveRunModelPolicy\(workflow\?\.id/);
  assert.match(submit, /model: runModelPolicy\.model/);

  const queue = segment("function enqueueSubmission", "function removeQueuedSubmission");
  assert.match(queue, /resolveRunModelPolicy\(workflow\?\.id\)/);
  assert.match(queue, /model: runModelPolicy\.model/);
});

test("programmatic Radar and Todo prompts request only their compact execution contracts", () => {
  const workflowSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "workflows.ts"),
    "utf8"
  );
  assert.match(workflowSource, /investment-radar[\s\S]*quick_scan[^]*?只需读取 quick_scan 明确要求的最小引用集/);
  assert.match(workflowSource, /DOMI_TODO_CLIENT_SNAPSHOT_V1[^]*?不再读取 suggestion-rules、todo-ledger-schema、storage-backends/);
});
