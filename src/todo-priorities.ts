import type { DomiTask } from "./env.d.ts";

export type TodoPriorityItem = {
  task: DomiTask;
  whyNow: string;
  nextAction: string;
  deadlineLabel?: string;
};

type Deadline = { at: number; days: number; overdue: boolean; label: string };
const DAY = 86_400_000;
const priorityOrder = { P1: 0, P2: 1, P3: 2 };
const text = (value: string | undefined | null) => (value || "").trim();
const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY;

function deadlineFor(value: string | null, now: number): Deadline | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let due: Date;
  if (dateOnly) {
    const [, year, month, day] = dateOnly.map(Number);
    // A date without a time means the end of that local calendar day.
    due = new Date(year, month - 1, day, 23, 59, 59, 999);
    if (due.getFullYear() !== year || due.getMonth() !== month - 1 || due.getDate() !== day) return null;
  } else {
    due = new Date(value);
  }
  const at = due.getTime();
  if (!Number.isFinite(at)) return null;
  const days = dayNumber(due) - dayNumber(new Date(now));
  const overdue = at < now;
  const label = overdue
    ? days < 0 ? `已逾期 ${Math.abs(days)} 天` : "已过截止时间"
    : days === 0 ? "今天到期"
      : days === 1 ? "明天到期"
        : days <= 7 ? `${days} 天后到期`
          : `${due.getMonth() + 1} 月 ${due.getDate()} 日到期`;
  return { at, days, overdue, label };
}

function duplicateKey(task: DomiTask): string {
  const identity = text(task.source.recordId);
  if (!identity) return `id:${task.id}`;
  const source = `${task.source.kind}:${identity}`;
  const purpose = text(task.purposeKey);
  if (purpose) return `${source}:purpose:${purpose}`;
  // Older ledgers can contain both a new-entry and a follow-up invitation
  // for the same meeting. Keep separate research/review purposes visible.
  if (task.suggestedAction.kind === "schedule") return `${source}:meeting`;
  return `id:${task.id}`;
}

function urgency(task: DomiTask, deadline: Deadline | null): number {
  if (deadline?.overdue) return 0;
  if (deadline?.days === 0) return 1;
  if (deadline && deadline.days <= 7) return 2;
  if (task.status === "in_progress") return 3;
  return 4;
}

/** Read-only shortlist. Existing evidence and deadlines stay authoritative. */
export function selectTodoPriorities(
  tasks: readonly DomiTask[],
  now: number,
  limit = 3
): TodoPriorityItem[] {
  if (!Number.isFinite(now)) return [];
  const count = Math.min(3, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 3)));
  const ranked = tasks
    .filter(task => task.status === "open" || task.status === "in_progress")
    .map(task => ({ task, deadline: deadlineFor(task.dueAt, now) }))
    .sort((a, b) => {
      const bucket = urgency(a.task, a.deadline) - urgency(b.task, b.deadline);
      if (bucket) return bucket;
      // Within a dated urgent group, the nearest real commitment comes first.
      if (urgency(a.task, a.deadline) < 3 && a.deadline && b.deadline) {
        const dueOrder = a.deadline.at - b.deadline.at;
        if (dueOrder) return dueOrder;
      }
      const priority = (priorityOrder[a.task.priority] ?? 2) - (priorityOrder[b.task.priority] ?? 2);
      if (priority) return priority;
      const dueOrder = (a.deadline?.at ?? Infinity) - (b.deadline?.at ?? Infinity);
      if (dueOrder && Number.isFinite(dueOrder)) return dueOrder;
      if (Boolean(a.deadline) !== Boolean(b.deadline)) return a.deadline ? -1 : 1;
      // Stable tie-breaker: refreshing an unchanged ledger must not shuffle it.
      return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
    });

  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const result: TodoPriorityItem[] = [];
  for (const { task, deadline } of ranked) {
    if (result.length >= count) break;
    const key = duplicateKey(task);
    if (seen.has(key) || seenIds.has(task.id)) continue;
    seen.add(key);
    seenIds.add(task.id);
    const reason = text(task.reason) || text(task.summary);
    const timing = deadline?.label || (task.status === "in_progress" ? "正在推进，继续完成下一步" : "");
    result.push({
      task,
      whyNow: [timing, reason].filter(Boolean).join(" · ") || "按现有待办优先级排序",
      nextAction: text(task.suggestedAction.label) || text(task.title),
      ...(deadline ? { deadlineLabel: deadline.label } : {})
    });
  }
  return result;
}
