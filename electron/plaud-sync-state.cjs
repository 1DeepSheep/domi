const fs = require("node:fs");

const PLAUD_RECOVERY_STAGES = new Set([
  "generation_submitting", "generating", "generation_unknown", "generation_failed",
  "generation_timeout", "download_failed", "failed", "uploaded"
]);
const PLAUD_TRANSCRIPT_STAGES = new Set([
  "transcript_ready", "context_pending", "context_ready", "notes_project", "notes_non_project",
  "reviewed", "documented", "managed", "discussion_notes_ready", "discussion_complete"
]);
const OUTCOMES = new Set(["ready", "waiting", "retryable", "failed"]);

function readablePlaudTranscript(filePath) {
  if (!filePath) return false;
  try {
    const stat = fs.statSync(filePath);
    fs.accessSync(filePath, fs.constants.R_OK);
    return stat.isFile() && stat.size > 0;
  } catch { return false; }
}

function plaudStageProtected(record) {
  return PLAUD_TRANSCRIPT_STAGES.has(String(record?.stage || record?.queueStage || ""));
}

function plaudRecordReady(record) {
  return readablePlaudTranscript(record?.transcriptPath);
}

function plaudRecoveryCandidate(record) {
  const stage = String(record?.stage || record?.queueStage || "");
  if (!record?.fileId || String(record.fileId).startsWith("local:") || plaudRecordReady(record)
    || plaudStageProtected(record) || !PLAUD_RECOVERY_STAGES.has(stage)) return false;
  if (["PLAUD_GENERATION_REJECTED", "PLAUD_GENERATION_NOT_SUBMITTED", "PLAUD_TRANSCRIPT_INVALID",
    "PLAUD_AUTH_REQUIRED", "PLAUD_ACCESS_DENIED"].includes(record.errorCode)) return false;
  if (record.generationAttemptId && !record.generationAcceptedAt
    && record.generationRejection?.attemptId === record.generationAttemptId) return false;
  if (stage === "uploaded") return Boolean(record.generationRequestedAt || record.generationAcceptedAt
    || record.generationAttemptId || (record.syncOutcome === "retryable"
      && ["PLAUD_READ_TRANSIENT", "PLAUD_TRANSCRIPT_EMPTY", "PLAUD_RATE_LIMITED"].includes(record.errorCode)));
  return true;
}

function normalizePlaudSyncItem(item, { source = "generated", retryableError = false, safeError = "" } = {}) {
  const stage = String(item?.stage || item?.queueStage || "");
  const rawError = String(item?.error || "");
  const pending = /Transcript not found|transcript.*not ready|未就绪|尚未生成|PLAUD_TRANSCRIPT_PENDING/i.test(rawError);
  let outcome = OUTCOMES.has(item?.outcome) ? item.outcome
    : OUTCOMES.has(item?.syncOutcome) ? item.syncOutcome : "";
  const artifactReady = plaudRecordReady(item);
  const artifactMissing = !artifactReady && (outcome === "ready" || item?.ok === true || plaudStageProtected(item));
  if (artifactReady) outcome = "ready";
  else if (artifactMissing) outcome = "failed";
  if (!outcome) {
    outcome = pending ? (stage === "uploaded" && !item?.generationRequestedAt && !item?.generationAttemptId && !item?.generationAcceptedAt ? "failed" : "waiting")
      : item?.retryable === true || retryableError ? "retryable"
        : ["generation_submitting", "generating", "generation_unknown", "generation_timeout"].includes(stage)
          ? "waiting" : "failed";
  }
  const detectedCode = rawError.match(/\bPLAUD_(?:TRANSCRIPT_ARTIFACT_MISSING|TRANSCRIPT_EMPTY|TRANSCRIPT_INVALID|GENERATION_REJECTED|GENERATION_NOT_SUBMITTED|AUTH_REQUIRED|ACCESS_DENIED|RATE_LIMITED)\b/)?.[0];
  const errorCode = outcome === "ready" ? "" : String((artifactMissing ? "PLAUD_TRANSCRIPT_ARTIFACT_MISSING" : "") || item?.errorCode || detectedCode || (
    pending && stage === "uploaded" && outcome === "failed" ? "PLAUD_GENERATION_NOT_SUBMITTED" : plaudStageProtected(item) ? "PLAUD_TRANSCRIPT_ARTIFACT_MISSING" : outcome === "waiting" ? "PLAUD_TRANSCRIPT_PENDING"
      : outcome === "retryable" ? "PLAUD_READ_TRANSIENT" : "PLAUD_TRANSCRIPT_READ_FAILED"
  ));
  return {
    fileId: String(item?.fileId || ""),
    ...(item?.fileName ? { fileName: String(item.fileName) } : {}),
    ok: outcome === "ready",
    outcome,
    stage,
    source: item?.source === "recovered" || item?.source === "generated" ? item.source : typeof item?.reused === "boolean" ? (item.reused ? "recovered" : "generated") : source,
    ...(item?.transcriptPath ? { transcriptPath: String(item.transcriptPath) } : {}),
    retryable: outcome === "retryable",
    errorCode,
    error: outcome === "ready" ? "" : artifactMissing
      ? "PLAUD_TRANSCRIPT_ARTIFACT_MISSING: 本地原始文字稿文件缺失，请恢复原文件；已保留现有纪要和归档。"
      : safeError || rawError
  };
}

function mergePlaudSyncItems(items) {
  const merged = new Map();
  for (const item of items) {
    if (!item.fileId) continue;
    const previous = merged.get(item.fileId);
    // A stale failed read must never overwrite a successfully retained artifact.
    if (previous?.outcome === "ready" && item.outcome !== "ready") continue;
    // One recording has one result and one provenance, even if both phases saw it.
    if (previous?.outcome === "ready" && item.outcome === "ready") {
      merged.set(item.fileId, { ...previous, ...item, source: previous.source });
    } else merged.set(item.fileId, item);
  }
  return [...merged.values()];
}

function summarizePlaudSync(items, { listRefreshFailed = false, operationFailed = false } = {}) {
  const results = mergePlaudSyncItems(items);
  const generatedCount = results.filter(item => item.outcome === "ready" && item.source === "generated").length;
  const recoveredCount = results.filter(item => item.outcome === "ready" && item.source !== "generated").length;
  const failedCount = results.filter(item => item.outcome === "failed").length;
  const waitingCount = results.filter(item => item.outcome === "waiting").length;
  const retryableCount = results.filter(item => item.outcome === "retryable").length;
  const ready = generatedCount + recoveredCount;
  const unresolved = failedCount + waitingCount + retryableCount > 0 || listRefreshFailed || operationFailed;
  const status = ready > 0 && unresolved ? "partial"
    : failedCount > 0 ? "failed"
      : waitingCount + retryableCount > 0 ? "waiting"
        : listRefreshFailed || operationFailed ? "failed" : "complete";
  return { ok: status === "complete", status, generatedCount, recoveredCount, failedCount,
    waitingCount, retryableCount, listRefreshFailed, results };
}

module.exports = { PLAUD_RECOVERY_STAGES, PLAUD_TRANSCRIPT_STAGES, readablePlaudTranscript,
  plaudRecordReady, plaudStageProtected, plaudRecoveryCandidate, normalizePlaudSyncItem, mergePlaudSyncItems, summarizePlaudSync };
