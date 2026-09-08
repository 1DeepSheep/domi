import assert from "node:assert/strict";
import test from "node:test";
import { hasRecoverablePlaudItems, plaudItemPresentation, plaudQueueSummary, plaudSafeError, plaudSyncFeedback } from "../src/plaud-status.ts";

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
