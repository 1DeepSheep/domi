const stoppedStatuses = new Set(["interrupted", "cancelled", "canceled"]);

function classifyCodexTurnStatus(turnStatus, hasActiveRun = false) {
  if (hasActiveRun) return "running";

  const normalizedStatus = String(turnStatus || "").trim().toLowerCase();
  if (normalizedStatus === "completed") return "completed";
  if (stoppedStatuses.has(normalizedStatus)) return "stopped";
  if (normalizedStatus === "failed") return "failed";
  return "unknown";
}

function codexReconnectNotice(params = {}) {
  const message = String(
    params?.error?.message
      || params?.message
      || ""
  ).trim();
  const match = message.match(
    /\b(?:reconnecting|retrying)(?:\s*(?:\.{2,}|\u2026)\s*)?\s*(\d+)\s*\/\s*(\d+)\b/i
  );
  const explicitlyRetrying = params?.willRetry === true
    || params?.retrying === true
    || params?.error?.willRetry === true
    || params?.error?.retrying === true;
  if (!match && !explicitlyRetrying) return null;

  const attempt = match ? Number(match[1]) : null;
  const total = match ? Number(match[2]) : null;
  return {
    message,
    attempt: Number.isFinite(attempt) ? attempt : null,
    total: Number.isFinite(total) ? total : null,
    summary: attempt && total
      ? `连接波动，正在自动恢复（${attempt}/${total}）`
      : "连接波动，正在自动恢复"
  };
}

module.exports = { classifyCodexTurnStatus, codexReconnectNotice };
