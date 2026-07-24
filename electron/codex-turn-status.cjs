const stoppedStatuses = new Set(["interrupted", "cancelled", "canceled"]);

function classifyCodexTurnStatus(turnStatus, hasActiveRun = false) {
  if (hasActiveRun) return "running";

  const normalizedStatus = String(turnStatus || "").trim().toLowerCase();
  if (normalizedStatus === "completed") return "completed";
  if (stoppedStatuses.has(normalizedStatus)) return "stopped";
  if (normalizedStatus === "failed") return "failed";
  return "unknown";
}

module.exports = { classifyCodexTurnStatus };
