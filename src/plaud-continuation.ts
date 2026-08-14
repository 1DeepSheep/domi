export type PlaudContinuationMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  workflowId?: string;
  status?: "idle" | "running" | "done" | "error";
  entityExecutionIsolated?: boolean;
  executionCodexThreadId?: string;
};

export type PlaudContinuationThread = {
  projectId?: string;
  plaudFileId?: string;
  title?: string;
  messages?: readonly PlaudContinuationMessage[];
};

export type PlaudContinuationItem = {
  fileId: string;
  fileName: string;
  queueStage?: string;
  transcriptPath?: string;
};

export type PendingPlaudContinuation<T extends PlaudContinuationItem = PlaudContinuationItem> = {
  item: T;
  executionCodexThreadId?: string;
};

const CONTEXT_PENDING_STAGE = "context_pending";

function recordingNameFromThread(thread: PlaudContinuationThread) {
  const workflowLaunch = [...(thread.messages || [])]
    .reverse()
    .find((message) => message.role === "user" && message.workflowId === "domi-router");
  const messageMatch = workflowLaunch?.content.match(/生成[“"]([^”"]+)[”"]的纪要/);
  if (messageMatch?.[1]) return messageMatch[1].trim();
  const titleMatch = String(thread.title || "").match(/^(.+?)\s+纪要$/);
  return titleMatch?.[1]?.trim() || "";
}

/**
 * Resolve a user reply that belongs to a PLAUD context question.
 *
 * The local task is the durable owner. Entity binding may replace projectId,
 * so plaudFileId is authoritative for new tasks and the original workflow
 * launch/title is a migration fallback for tasks created by older clients.
 */
export function pendingPlaudContinuation<T extends PlaudContinuationItem>(
  thread: PlaudContinuationThread,
  items: readonly T[]
): PendingPlaudContinuation<T> | null {
  const pendingItems = items.filter((item) => item.queueStage === CONTEXT_PENDING_STAGE);
  if (!pendingItems.length) return null;

  const persistedFileId = String(thread.plaudFileId || "").trim();
  const legacyProjectFileId = String(thread.projectId || "").startsWith("plaud-")
    ? String(thread.projectId).slice("plaud-".length)
    : "";
  const expectedFileId = persistedFileId || legacyProjectFileId;
  let item = expectedFileId
    ? pendingItems.find((candidate) => candidate.fileId === expectedFileId)
    : undefined;

  if (!item) {
    const recordingName = recordingNameFromThread(thread);
    const matches = recordingName
      ? pendingItems.filter((candidate) => candidate.fileName === recordingName)
      : [];
    if (matches.length === 1) item = matches[0];
  }
  if (!item) return null;

  const assistant = [...(thread.messages || [])]
    .reverse()
    .find((message) =>
      message.role === "assistant"
      && message.workflowId === "domi-router"
      && message.status === "done"
      && message.entityExecutionIsolated === true
      && Boolean(message.executionCodexThreadId)
    );
  return {
    item,
    executionCodexThreadId: assistant?.executionCodexThreadId
  };
}

export function plaudContinuationPrompt(
  basePrompt: string,
  supplementalContext: string
) {
  return [
    basePrompt.trim(),
    "",
    "这是用户对该录音上一轮 context_pending 问题的补充信息：",
    supplementalContext.trim(),
    "",
    "续接要求：把上述信息作为该 fileId 的对话上下文，标记 context_ready 后直接继续既有文字稿的纪要、判断与归档阶段。不得启动麦克风、不得创建新录音、不得重新生成或下载已有文字稿。"
  ].join("\n");
}
