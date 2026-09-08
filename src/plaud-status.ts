import type { DomiPlaudItem, DomiPlaudSnapshot, DomiPlaudSyncResult } from "./env";

export type PlaudFeedbackTone = "complete" | "partial" | "waiting" | "failed";
export type PlaudFeedback = { text: string; tone: PlaudFeedbackTone };
export type PlaudItemPresentation = { label: string; tone: "complete" | "attention" | "waiting" | "neutral"; detail: string };

export function plaudSafeError(error: unknown, fallback = "暂时无法连接 PLAUD，请稍后刷新。") {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/PLAUD_TRANSCRIPT_ARTIFACT_MISSING/.test(message)) return "本地原始文字稿文件缺失，请恢复原文件；不会重新生成。";
  if (/PLAUD_AUTH_REQUIRED/.test(message)) return "PLAUD 登录已失效，请在设置中重新登录。";
  if (/PLAUD_UNAUTHORIZED/.test(message)) return "本轮授权尚未完成，已保留进度；请稍后检查连接。";
  if (/PLAUD_ACCESS_DENIED/.test(message)) return "PLAUD 未允许访问这条录音，请检查账户权限。";
  if (/PLAUD_RATE_LIMITED/.test(message)) return "PLAUD 暂时限制了请求频率，请稍后再试。";
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ERR_CONNECTION_CLOSED|fetch failed|failed to fetch|network error/i.test(message)) {
    return "连接 PLAUD 暂时中断，已保留当前进度。";
  }
  // The bridge returns safe user-facing text. Do not display multiline traces,
  // raw URLs or common credential forms if an older runtime returns an error.
  return message.split(/\r?\n/, 1)[0].replace(/https?:\/\/\S+/gi, "远端服务")
    .replace(/(?:Bearer\s+|(?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "[已隐藏]")
    .trim().slice(0, 220) || fallback;
}

export function hasPlaudArtifactError(item: DomiPlaudItem) {
  return item.errorCode === "PLAUD_TRANSCRIPT_ARTIFACT_MISSING"
    || /PLAUD_TRANSCRIPT_ARTIFACT_MISSING/.test(item.error);
}

export function plaudItemPresentation(item: DomiPlaudItem): PlaudItemPresentation {
  if (hasPlaudArtifactError(item)) return {
    label: ["managed", "notes_non_project"].includes(item.queueStage) ? "纪要已生成 · 原文需处理" : "原文文件需处理",
    tone: "attention",
    detail: "本地原始文字稿文件缺失，已有纪要和归档保留。请恢复原文件，不会重新生成。"
  };
  if (item.queueStage === "managed") return { label: "已生成并入库", tone: "complete", detail: "" };
  if (item.queueStage === "notes_non_project") return { label: "纪要已生成", tone: "complete", detail: "" };
  if (item.transcriptPath || ["transcript_ready", "context_pending", "context_ready", "notes_project", "reviewed", "documented"].includes(item.queueStage)) {
    return { label: "文字稿待整理", tone: "neutral", detail: "" };
  }
  if (item.errorCode === "PLAUD_GENERATION_NOT_SUBMITTED") return {
    label: "待生成", tone: "neutral",
    detail: "本轮尚未提交生成，请点击“同步 PLAUD 并生成文字稿”继续处理。"
  };
  if (item.syncOutcome === "failed") {
    return { label: "需要处理", tone: "attention", detail: plaudSafeError(item.error || item.errorCode, "这条录音暂时无法处理，请检查 PLAUD 中的录音状态。") };
  }
  if (item.syncOutcome === "retryable" || item.retryable) {
    if (item.queueStage === "uploaded") return {
      label: item.generationRequestedAt ? "等待提交确认" : "等待连接恢复", tone: "waiting",
      detail: `${plaudSafeError(item.error || item.errorCode)} domi 会先确认状态；尚未提交的录音需要再次同步才会开始生成。`
    };
    return {
      label: item.hasTranscript || item.hasSummary ? "待自动补下载" : "等待自动恢复",
      tone: "waiting",
      detail: `${plaudSafeError(item.error || item.errorCode, "PLAUD 暂时未能返回文字稿。")} domi 会继续查询已有任务，不会重复生成。`
    };
  }
  if (item.queueStage === "uploaded") return {
    label: "未生成文字稿", tone: "neutral",
    detail: item.syncOutcome === "waiting" ? "尚未提交生成，请点击“同步 PLAUD 并生成文字稿”继续。" : ""
  };
  if (item.syncOutcome === "waiting" || item.processing || ["generation_submitting", "generation_unknown", "generating"].includes(item.queueStage)) {
    const unconfirmed = ["generation_submitting", "generation_unknown"].includes(item.queueStage) && !item.generationAcceptedAt;
    return {
      label: unconfirmed ? "等待提交确认" : "等待远端生成",
      tone: "waiting",
      detail: unconfirmed
        ? "正在确认 PLAUD 是否已接收请求，不会重复提交。"
        : "PLAUD 仍在处理，domi 会继续检查并自动下载文字稿。"
    };
  }
  if (item.error) return { label: "需要处理", tone: "attention", detail: plaudSafeError(item.error) };
  if (item.hasTranscript || item.hasSummary) return { label: "文字稿待同步", tone: "neutral", detail: "" };
  return { label: "未生成文字稿", tone: "neutral", detail: "" };
}

export function hasRecoverablePlaudItems(snapshot: DomiPlaudSnapshot | null) {
  return (snapshot?.items || []).some(item => {
    if (item.transcriptPath || hasPlaudArtifactError(item) || item.errorCode === "PLAUD_GENERATION_NOT_SUBMITTED" || item.syncOutcome === "failed" || ["managed", "notes_non_project"].includes(item.queueStage)) return false;
    if (typeof item.resumeEligible === "boolean") return item.resumeEligible;
    return item.queueStage !== "uploaded" && plaudItemPresentation(item).tone === "waiting";
  });
}

export function plaudQueueSummary(snapshot: DomiPlaudSnapshot) {
  if (!snapshot.items?.length && snapshot.pendingCount) return `${snapshot.pendingCount} 个待确认`;
  const counts = new Map<string, number>();
  for (const item of snapshot.items || []) {
    const presentation = plaudItemPresentation(item);
    if (presentation.tone === "complete") continue;
    const label = presentation.tone === "attention" ? "需处理"
      : presentation.label === "文字稿待整理" ? "待整理"
        : presentation.label === "文字稿待同步" ? "待同步"
          : presentation.label === "未生成文字稿" ? "待生成"
            : presentation.label;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, count]) => `${count} 个${label}`).join(" · ") || "队列已清";
}

export function plaudSyncFeedback(result: DomiPlaudSyncResult): PlaudFeedback {
  const count = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
  const generated = count(result.generatedCount);
  const recovered = count(result.recoveredCount);
  const waiting = count(result.waitingCount);
  const retryable = count(result.retryableCount);
  const failed = count(result.failedCount);
  const completed = generated + recovered;
  const pending = waiting + retryable;
  const unsubmitted = (result.results || []).filter(item => item.errorCode === "PLAUD_GENERATION_NOT_SUBMITTED");
  const uncertainUploads = (result.results || []).filter(item => item.stage === "uploaded" && item.outcome !== "ready" && item.errorCode !== "PLAUD_GENERATION_NOT_SUBMITTED");
  const unsubmittedWaiting = unsubmitted.filter(item => item.outcome === "waiting").length;
  const unsubmittedRetryable = unsubmitted.filter(item => item.outcome === "retryable").length;
  const uploadedWaiting = unsubmittedWaiting + uncertainUploads.filter(item => item.outcome === "waiting").length;
  const uploadedRetryable = unsubmittedRetryable + uncertainUploads.filter(item => item.outcome === "retryable").length;
  // Legacy runtimes can report ok:true with failedCount>0. Never color such a
  // result green or announce completion merely because the command exited zero.
  const tone: PlaudFeedbackTone = failed || result.listRefreshFailed ? completed ? "partial" : "failed"
    : pending ? completed ? "partial" : "waiting"
      : result.status || (result.ok ? "complete" : "failed");
  const parts = [
    generated ? `已生成 ${generated} 份文字稿` : "",
    recovered ? `已补下载 ${recovered} 份文字稿` : "",
    waiting > uploadedWaiting ? `${waiting - uploadedWaiting} 份等待远端生成或确认` : "",
    retryable > uploadedRetryable ? `${retryable - uploadedRetryable} 份等待自动恢复` : "",
    uncertainUploads.length ? `${uncertainUploads.length} 份等待连接恢复或提交确认` : "",
    unsubmitted.length ? `${unsubmitted.length} 份尚未提交生成` : "",
    failed ? `${failed} 份需要处理` : ""
  ].filter(Boolean);
  const title = tone === "complete" ? "同步完成" : tone === "partial" ? "部分完成"
    : tone === "waiting" ? pending > unsubmitted.length ? "等待 PLAUD 处理" : "等待继续同步" : "同步未完成";
  const warning = result.warning || (result.listRefreshFailed ? "最近录音暂时无法刷新，已保留本地成果。" : "");
  const reason = tone === "failed" && result.error ? plaudSafeError(result.error) : "";
  return {
    tone,
    text: [parts.length ? `${title}：${parts.join("；")}` : title === "同步完成" ? "已同步到最新 PLAUD 队列" : title,
      pending > unsubmitted.length ? "domi 会继续确认状态并补下载现有文字稿，不会重复提交。" : "",
      unsubmitted.length ? "尚未提交的录音请稍后再次同步以开始生成。" : "",
      warning ? plaudSafeError(warning) : "", reason].filter(Boolean).join(" ")
  };
}
