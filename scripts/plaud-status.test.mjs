import assert from "node:assert/strict";
import test from "node:test";
import { canGeneratePlaudNotes, hasImmediatelyRecoverablePlaudItems, hasRecoverablePlaudItems, plaudItemPresentation, plaudQueueSummary, plaudSafeError, plaudSnapshotForScope, plaudSyncFeedback } from "../src/plaud-status.ts";
import { restorePlaudOnStartup } from "../src/plaud-startup.ts";

const item = (patch = {}) => ({ fileId: "synthetic", fileName: "合成录音", duration: 60, createdAt: 1,
  editedAt: 1, hasTranscript: false, hasSummary: false, processing: false,
  queueStage: "", transcriptPath: "", error: "", ...patch });

test("confirmed generation, uncertain submission and unsubmitted recordings have distinct states", () => {
  assert.equal(plaudItemPresentation(item({ queueStage: "generating", processing: true, error: "timeout" })).label, "等待远端生成");
  assert.equal(plaudItemPresentation(item({ queueStage: "generation_unknown", syncOutcome: "waiting" })).label, "等待提交确认");
  const uploaded = item({ queueStage: "uploaded", syncOutcome: "retryable", retryable: true, resumeEligible: false, error: "timeout" });
  assert.equal(plaudItemPresentation(uploaded).label, "等待连接恢复");
  assert.equal(hasRecoverablePlaudItems({ items: [uploaded] }), false);
  assert.match(plaudItemPresentation(uploaded).detail, /再次同步/);
});

test("a local transcript or final workflow result wins over obsolete errors", () => {
  for (const patch of [{ transcriptPath: "/synthetic/transcript.md" }, { queueStage: "managed" }, { queueStage: "notes_non_project" }]) {
    const value = item({ ...patch, error: "old failure", syncOutcome: "failed", resumeEligible: true });
    assert.equal(plaudItemPresentation(value).detail, "");
    assert.equal(hasRecoverablePlaudItems({ items: [value] }), false);
  }
});

test("remote transcript readiness wins over a stale processing flag without promising unqueued downloads", () => {
  for (const queueStage of ["", "uploaded", "generating", "generation_unknown"]) {
    const value = item({ queueStage, hasTranscript: true, processing: true, syncOutcome: "waiting", resumeEligible: false });
    const status = plaudItemPresentation(value);
    assert.equal(status.label, "文字稿已就绪");
    assert.equal(status.tone, "neutral");
    assert.equal(status.detail, "");
    assert.equal(canGeneratePlaudNotes(value), true);
    assert.equal(hasRecoverablePlaudItems({ items: [value] }), false);
    assert.equal(hasImmediatelyRecoverablePlaudItems({ ok: true, items: [value] }), false);
  }
});

test("remote summary alone does not claim the full transcript is ready", () => {
  const value = item({ hasSummary: true, processing: true, resumeEligible: false });
  const status = plaudItemPresentation(value);
  assert.equal(status.label, "远端已有内容，待同步");
  assert.equal(status.detail, "");
  assert.equal(hasImmediatelyRecoverablePlaudItems({ ok: true, items: [value] }), false);
});

test("unqueued remote generation does not promise an automatic local download", () => {
  const value = item({ processing: true, resumeEligible: false });
  assert.equal(plaudItemPresentation(value).label, "等待远端生成");
  assert.match(plaudItemPresentation(value).detail, /稍后刷新/);
  assert.doesNotMatch(plaudItemPresentation(value).detail, /继续检查|自动下载/);
  assert.equal(hasRecoverablePlaudItems({ items: [value] }), false);
  const queued = { ...value, queueStage: "generating", resumeEligible: true };
  assert.match(plaudItemPresentation(queued).detail, /继续检查并自动下载/);
});

test("fresh remote transcripts immediately resume only explicitly eligible existing local work", () => {
  const value = item({ queueStage: "generating", hasTranscript: true, processing: true, syncOutcome: "waiting", resumeEligible: true });
  const snapshot = { ok: true, remoteStatus: "connected", items: [value] };
  assert.equal(plaudItemPresentation(value).label, "待自动补下载");
  assert.doesNotMatch(plaudItemPresentation(value).detail, /仍在处理|等待远端/);
  assert.equal(hasImmediatelyRecoverablePlaudItems(snapshot), true);
  for (const patch of [{ ok: false }, { stale: true }, { remoteStatus: "auth_required" },
    { remoteStatus: "access_denied" }, { remoteStatus: "network_error" }, { remoteStatus: "rate_limited" }]) {
    assert.equal(hasImmediatelyRecoverablePlaudItems({ ...snapshot, ...patch }), false);
  }
  for (const patch of [{ queueStage: "" }, { resumeEligible: undefined }, { resumeEligible: false },
    { hasTranscript: false, hasSummary: true }, { transcriptPath: "/synthetic/transcript.md" },
    { queueStage: "managed" }, { syncOutcome: "failed" }, { errorCode: "PLAUD_GENERATION_NOT_SUBMITTED" }]) {
    assert.equal(hasImmediatelyRecoverablePlaudItems({ ...snapshot, items: [{ ...value, ...patch }] }), false);
  }
});

test("remote readiness never hides a permanent refusal or missing source artifact", () => {
  for (const errorCode of ["PLAUD_AUTH_REQUIRED", "PLAUD_ACCESS_DENIED", "PLAUD_GENERATION_REJECTED", "PLAUD_TRANSCRIPT_INVALID", "PLAUD_TRANSCRIPT_ARTIFACT_MISSING"]) {
    const value = item({ hasTranscript: true, processing: true, queueStage: "generating", syncOutcome: "waiting", resumeEligible: true, errorCode });
    assert.equal(plaudItemPresentation(value).tone, "attention");
    assert.equal(canGeneratePlaudNotes(value), false);
    assert.equal(hasRecoverablePlaudItems({ items: [value] }), false);
    assert.equal(hasImmediatelyRecoverablePlaudItems({ ok: true, items: [value] }), false);
  }
});

test("an explicit per-record refusal remains visible even when remote text exists", () => {
  const value = item({ hasTranscript: true, syncOutcome: "failed", error: "PLAUD_ACCESS_DENIED: synthetic" });
  assert.equal(plaudItemPresentation(value).label, "需要处理");
  assert.match(plaudItemPresentation(value).detail, /权限/);
});

test("explicit missing source artifacts remain actionable without downgrading completed notes", () => {
  const value = item({ transcriptPath: "/synthetic/missing.md", queueStage: "managed", syncOutcome: "failed", errorCode: "PLAUD_TRANSCRIPT_ARTIFACT_MISSING" });
  const status = plaudItemPresentation(value);
  assert.equal(status.tone, "attention");
  assert.match(status.label, /纪要已生成/);
  assert.match(status.detail, /已有纪要和归档保留/);
  assert.match(status.detail, /不会重新生成/);
  assert.equal(hasRecoverablePlaudItems({ items: [value] }), false);
});

test("temporary download errors retain automatic recovery and never request another generation", () => {
  const value = item({ hasTranscript: true, queueStage: "download_failed", syncOutcome: "retryable", retryable: true, resumeEligible: true, error: "timeout" });
  assert.equal(plaudItemPresentation(value).label, "待自动补下载");
  assert.match(plaudItemPresentation(value).detail, /不会重复生成/);
  assert.equal(hasRecoverablePlaudItems({ items: [value] }), true);
});

test("all failures are never green, including legacy ok:true results", () => {
  for (const status of [undefined, "complete", "failed"]) {
    const result = plaudSyncFeedback({ ok: true, status, failedCount: 2 });
    assert.equal(result.tone, "failed");
    assert.doesNotMatch(result.text, /同步完成/);
    assert.match(result.text, /2 份需要处理/);
  }
});

test("partial completion retains successful counts and explains list refresh failure", () => {
  const result = plaudSyncFeedback({ ok: false, status: "partial", recoveredCount: 1,
    waitingCount: 2, failedCount: 1, listRefreshFailed: true });
  assert.equal(result.tone, "partial");
  for (const expected of [/已补下载 1 份/, /2 份等待/, /1 份需要处理/, /已保留本地成果/]) assert.match(result.text, expected);
});

test("unsubmitted retryable records are not advertised as remote generation or automatic resubmission", () => {
  const result = plaudSyncFeedback({ ok: false, status: "waiting", retryableCount: 1,
    results: [{ fileId: "new", ok: false, outcome: "retryable", stage: "uploaded", errorCode: "PLAUD_GENERATION_NOT_SUBMITTED" }] });
  assert.match(result.text, /尚未提交生成/);
  assert.match(result.text, /再次同步/);
  assert.doesNotMatch(result.text, /远端生成|会继续检查并补下载/);
});

test("a generation budget timeout before submission is a manual next step, never remote processing", () => {
  const value = item({ queueStage: "uploaded", syncOutcome: "waiting", resumeEligible: true, errorCode: "PLAUD_GENERATION_NOT_SUBMITTED" });
  assert.equal(plaudItemPresentation(value).label, "待生成");
  assert.match(plaudItemPresentation(value).detail, /本轮尚未提交/);
  assert.equal(hasRecoverablePlaudItems({ items: [value] }), false);
});

test("legacy not-submitted failures remain pending until remote content is actually available", () => {
  const value = item({ queueStage: "uploaded", syncOutcome: "failed", resumeEligible: true, errorCode: "PLAUD_GENERATION_NOT_SUBMITTED" });
  assert.equal(plaudItemPresentation(value).label, "待生成");
  assert.equal(canGeneratePlaudNotes(value), false);
  const remoteReady = { ...value, hasTranscript: true, processing: true };
  assert.equal(plaudItemPresentation(remoteReady).label, "文字稿已就绪");
  assert.equal(plaudItemPresentation(remoteReady).detail, "");
  assert.equal(canGeneratePlaudNotes(remoteReady), true);
  assert.equal(hasImmediatelyRecoverablePlaudItems({ ok: true, items: [remoteReady] }), false);
});

test("queue summary does not hide a real failure behind pending recordings", () => {
  const summary = plaudQueueSummary({ pendingCount: 2, items: [
    item({ processing: true }), item({ syncOutcome: "failed", error: "权限不足" })
  ] });
  assert.match(summary, /1 个等待远端生成/);
  assert.match(summary, /1 个需处理/);
});

test("fallback errors omit credential forms, links and stack lines", () => {
  const value = plaudSafeError("拒绝访问 token=synthetic-secret https://example.test/private\nstack trace");
  assert.doesNotMatch(value, /synthetic-secret|example.test|stack trace/);
  assert.match(value, /拒绝访问/);
});

test("a transient authorization renewal or browser network failure does not demand login", () => {
  assert.doesNotMatch(plaudSafeError("PLAUD_UNAUTHORIZED: synthetic renewal"), /重新登录|失效/);
  assert.match(plaudSafeError("PLAUD_AUTH_REQUIRED: synthetic login"), /重新登录/);
  for (const error of ["Failed to fetch", "net::ERR_CONNECTION_CLOSED"]) assert.match(plaudSafeError(error), /暂时中断/);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function startupFixture(patch = {}) {
  const calls = [];
  const operations = {
    isCurrent: () => true,
    pendingList: () => null,
    pendingSync: () => null,
    pendingMutation: () => null,
    resume: async () => { calls.push("resume"); return { ok: true, resumePendingCount: 0 }; },
    list: async () => { calls.push("list"); return { ok: true, items: [] }; },
    ...patch
  };
  return { calls, operations };
}

test("startup reads the recent list after a genuinely empty local resume", async () => {
  const { calls, operations } = startupFixture();
  await restorePlaudOnStartup(operations);
  assert.deepEqual(calls, ["resume", "list"]);
});

test("startup reuses a recovery snapshot including offline/auth results without extra remote reads", async () => {
  for (const snapshot of [
    { ok: true, items: [item({ transcriptPath: "/synthetic/ready.md" })] },
    { ok: false, remoteStatus: "auth_required" },
    { ok: false, remoteStatus: "network_error" }
  ]) {
    const { calls, operations } = startupFixture({ resume: async () => ({ ok: snapshot.ok, snapshot }) });
    await restorePlaudOnStartup(operations);
    assert.deepEqual(calls, []);
  }
});

test("startup joins manual reads and syncs without another generation or list", async () => {
  for (const kind of ["pendingList", "pendingSync"]) {
    const active = deferred();
    const { calls, operations } = startupFixture({ [kind]: () => active.promise });
    const restore = restorePlaudOnStartup(operations);
    assert.deepEqual(calls, []);
    const snapshot = { ok: true, items: [item()] };
    active.resolve(kind === "pendingList" ? snapshot : { ok: true, snapshot });
    await restore;
    assert.deepEqual(calls, []);
  }
});

test("startup continues after a busy empty recovery or title mutation releases its lock", async () => {
  for (const kind of ["pendingSync", "pendingMutation"]) {
    const active = deferred();
    let busy = true;
    const { calls, operations } = startupFixture({ [kind]: () => busy ? active.promise : null });
    const restore = restorePlaudOnStartup(operations);
    assert.deepEqual(calls, []);
    busy = false;
    active.resolve(kind === "pendingSync" ? { ok: true, resumePendingCount: 0 } : undefined);
    await restore;
    assert.deepEqual(calls, kind === "pendingSync" ? ["list"] : ["resume", "list"]);
  }
});

test("disabled, cancelled and superseded startup scopes never launch a later read", async () => {
  const disabled = startupFixture({ isCurrent: () => false });
  await restorePlaudOnStartup(disabled.operations);
  assert.deepEqual(disabled.calls, []);
  for (const kind of ["resume", "pendingList", "pendingSync", "pendingMutation"]) {
    const active = deferred();
    let current = true;
    const { calls, operations } = startupFixture({ isCurrent: () => current, [kind]: () => active.promise });
    const restore = restorePlaudOnStartup(operations);
    current = false;
    active.resolve(kind === "pendingList" || kind === "pendingMutation" ? null : { ok: true });
    await restore;
    assert.deepEqual(calls, []);
  }
});

test("a failed startup probe is followed by at most one list attempt", async () => {
  const { calls, operations } = startupFixture({ resume: async () => null,
    list: async () => { calls.push("list"); return null; } });
  await restorePlaudOnStartup(operations);
  assert.deepEqual(calls, ["list"]);
});

test("an unverified startup/browser scope cannot display the global fallback cache", () => {
  const cached = { ok: true, items: [item()], syncedAt: 123 };
  const failed = { ...cached, ok: false, stale: true, remoteStatus: "auth_required", lastSuccessfulSnapshot: cached };
  const hidden = plaudSnapshotForScope(failed, false);
  assert.deepEqual(hidden.items, []);
  assert.equal(hidden.lastSuccessfulSnapshot, undefined);
  assert.equal(hidden.syncedAt, undefined);
  assert.equal(hidden.remoteStatus, "auth_required");
  assert.match(hidden.error, /登录/);
  assert.equal(plaudSnapshotForScope(failed, true), failed, "A verified current scope may retain its existing fallback");
  assert.equal(plaudSnapshotForScope(cached, false), cached, "A successful fresh read establishes the current scope");
});
