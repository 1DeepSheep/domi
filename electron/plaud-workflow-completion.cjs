const fs = require("node:fs");
const path = require("node:path");

function readRecord(stateFile, fileId) {
  if (!path.isAbsolute(String(stateFile || ""))) throw new Error("invalid state path");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (!state?.records || !Object.hasOwn(state.records, fileId)) return null;
  const record = state.records[fileId];
  return record && typeof record === "object" && !Array.isArray(record)
    && record.fileId === fileId ? record : null;
}

function hasLocalFile(filePath) {
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
  try {
    const stat = fs.statSync(filePath);
    fs.accessSync(filePath, fs.constants.R_OK);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

// An isolated PLAUD task can stop for context or finish without creating any
// entity. These are the only exceptions to the renderer's entity receipt guard.
// Read the exact local record and use the existing plugin's full notes verifier;
// neither a cached remote list nor prose in an assistant reply proves completion.
async function readPlaudWorkflowCompletion({ fileId, stateFile, verifyNotes } = {}) {
  const id = typeof fileId === "string" ? fileId.trim() : "";
  let stage = "";
  const fail = (errorCode, error) => ({ ok: false, fileId: id, stage, errorCode, error });
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(id)) {
    return fail("PLAUD_WORKFLOW_ID_INVALID", "无法确定当前任务对应的录音。");
  }
  let record;
  try {
    record = readRecord(stateFile, id);
  } catch {
    return fail("PLAUD_WORKFLOW_STATE_UNAVAILABLE", "无法读取本地录音工作流状态。");
  }
  if (!record) return fail("PLAUD_WORKFLOW_RECORD_MISSING", "本地工作流中不存在对应录音。");
  stage = typeof record.stage === "string" ? record.stage : "";
  if (!["context_pending", "notes_non_project"].includes(stage)) {
    return fail("PLAUD_WORKFLOW_ENTITY_RECEIPT_REQUIRED", "当前阶段仍需按原工作流核验实体归档结果。");
  }
  if (!hasLocalFile(record.transcriptPath)) {
    return fail("PLAUD_WORKFLOW_TRANSCRIPT_MISSING", "当前录音的本地文字稿缺失或不可读取。");
  }
  if (stage === "context_pending") {
    return { ok: true, fileId: id, stage, outcome: "waiting-input" };
  }
  if (!hasLocalFile(record.notesPath) || typeof verifyNotes !== "function") {
    return fail("PLAUD_WORKFLOW_NOTES_UNVERIFIED", "非项目纪要尚未通过本地质量核验。");
  }
  let verification;
  try {
    verification = await verifyNotes(id);
  } catch {
    return fail("PLAUD_WORKFLOW_NOTES_UNVERIFIED", "非项目纪要的正文或质量回执核验未通过。");
  }
  if (verification?.ok !== true || verification.fileId !== id
    || verification.stage !== stage || verification.checks?.notesAudit !== "passed") {
    return fail("PLAUD_WORKFLOW_NOTES_UNVERIFIED", "非项目纪要的正文或质量回执核验未通过。");
  }
  try {
    // A different recording may progress during verification. Only changes to
    // this exact record invalidate its verified result.
    if (JSON.stringify(readRecord(stateFile, id)) !== JSON.stringify(record)) {
      return fail("PLAUD_WORKFLOW_STATE_CHANGED", "录音工作流在核验期间已变化，请重新核验。");
    }
  } catch {
    return fail("PLAUD_WORKFLOW_STATE_CHANGED", "录音工作流在核验期间已变化，请重新核验。");
  }
  return { ok: true, fileId: id, stage, outcome: "completed" };
}

module.exports = { readPlaudWorkflowCompletion };
