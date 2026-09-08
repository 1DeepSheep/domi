export type TaskNotificationOutcome = "completed" | "failed" | "waiting-input" | "stopped";

export type TaskNotificationMessage = {
  id: string;
  taskNotificationId?: string;
  taskNotificationOutcome?: TaskNotificationOutcome;
  taskNotificationRead?: boolean;
};

type NotificationThread = {
  id: string;
  hasUnreadCompletion?: boolean;
  messages: TaskNotificationMessage[];
};

export function isTaskResultVisible(context: {
  threadId: string;
  activeThreadId: string;
  workspaceView: string;
  windowFocused: boolean;
  visibilityState: string;
  documentPanelFocused: boolean;
}) {
  return context.threadId === context.activeThreadId
    && context.workspaceView === "conversation"
    && context.windowFocused
    && context.visibilityState === "visible"
    && !context.documentPanelFocused;
}

/** A local assistant message survives native run rebinding and renderer reloads. */
export function taskNotificationId(threadId: string, messageId: string) {
  return `task:${threadId}:${messageId}`;
}

export function taskNotificationContent(outcome: TaskNotificationOutcome, threadTitle: string) {
  const titleCharacters = Array.from(threadTitle.trim().split(/\r?\n/, 1)[0] || "未命名任务");
  const body = titleCharacters.length > 80 ? `${titleCharacters.slice(0, 79).join("")}…` : titleCharacters.join("");
  if (outcome === "stopped") return null;
  return {
    title: outcome === "completed"
      ? "domi 任务已完成"
      : outcome === "waiting-input"
        ? "domi 任务等待你的补充"
        : "domi 任务未完成",
    body
  };
}

export function recordTaskResult<T extends NotificationThread>(
  threads: T[], threadId: string, messageId: string,
  outcome: TaskNotificationOutcome, visible: boolean
): T[] {
  const notificationId = taskNotificationId(threadId, messageId);
  return threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    const message = thread.messages.find((item) => item.id === messageId);
    if (!message || message.taskNotificationId === notificationId) return thread;
    return {
      ...thread,
      hasUnreadCompletion: visible ? false : outcome !== "stopped" || thread.hasUnreadCompletion === true,
      messages: thread.messages.map((item) => item.id === messageId
        ? { ...item, taskNotificationId: notificationId, taskNotificationOutcome: outcome, taskNotificationRead: visible }
        : visible && item.taskNotificationId && !item.taskNotificationRead
          ? { ...item, taskNotificationRead: true }
          : item)
    };
  });
}

export function clearTaskResultUnread<T extends NotificationThread>(threads: T[], threadId: string): T[] {
  let changed = false;
  const next = threads.map((thread) => {
    if (thread.id !== threadId || (!thread.hasUnreadCompletion
      && !thread.messages.some((message) => message.taskNotificationId && !message.taskNotificationRead))) return thread;
    changed = true;
    return {
      ...thread,
      hasUnreadCompletion: false,
      messages: thread.messages.map((message) => message.taskNotificationId && !message.taskNotificationRead
        ? { ...message, taskNotificationRead: true }
        : message)
    };
  });
  return changed ? next : threads;
}

export function unreadTaskCount(threads: ReadonlyArray<{ hasUnreadCompletion?: boolean }>) {
  return threads.filter((thread) => thread.hasUnreadCompletion === true).length;
}

export async function navigateTaskNotification(
  target: { threadId: string; notificationId?: string },
  opened: Set<string>,
  inFlight: Set<string>,
  navigate: () => Promise<boolean>
) {
  const key = target.notificationId || `thread:${target.threadId}`;
  if (inFlight.has(key) || (target.notificationId && opened.has(target.notificationId))) return false;
  inFlight.add(key);
  try {
    if (!await navigate()) return false;
    if (target.notificationId) opened.add(target.notificationId);
    return true;
  } catch {
    return false;
  } finally {
    inFlight.delete(key);
  }
}
