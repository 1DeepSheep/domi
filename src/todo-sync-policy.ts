import type { DomiSnapshot, DomiTaskBoardSnapshot, DomiTask, DomiWeeklyNewsSnapshot } from "./env.d.ts";

export const TODO_RULE_VERSION = "domi-todo-local-merge-v2";
const DAY = 86_400_000;
const SHA256 = /^[a-f0-9]{64}$/i;

export type TodoSyncCheckpoint = {
  fingerprint: string;
  ruleVersion: string;
  repositoryIdentity: string;
  verifiedAt: number;
  nextEvaluationAt: number;
  ledgerFingerprint: string;
};

export type TodoRunReceipt = {
  schema: "domi.todo-result.v1";
  runId: string;
  ledgerSha256: string;
  documentSha256: string;
  verified: true;
  taskIds: string[];
  updatedAt?: string;
};

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const sortedRecords = <T extends { recordId: string }>(items: T[]) =>
  [...items].sort((a, b) => a.recordId.localeCompare(b.recordId));

export function todoLedgerContent(tasks: DomiTask[]) {
  return [...tasks].sort((a, b) => a.id.localeCompare(b.id));
}

export function nextTodoEvaluationAt(snapshot: DomiSnapshot, tasks: DomiTask[], now: number): number {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  let next = tomorrow.getTime();
  const boundary = (at: number) => {
    if (Number.isFinite(at) && at > now) next = Math.min(next, at);
  };
  for (const item of [...snapshot.projects, ...snapshot.people]) {
    const created = Number(item.createdAt);
    if (created > 0) { boundary(created); boundary(created + 28 * DAY + 1); }
  }
  for (const item of snapshot.projects) if (item.lastFollowup) boundary(item.lastFollowup + 45 * DAY);
  for (const item of snapshot.people) if (item.lastContact) boundary(item.lastContact + 60 * DAY);
  for (const task of tasks) {
    const due = Date.parse(task.dueAt || "");
    boundary(due); boundary(due - 7 * DAY); boundary(due - 14 * DAY);
    if (task.status === "ignored") boundary(Date.parse(task.ignoredAt || task.updatedAt) + 30 * DAY);
  }
  return next;
}

export async function todoInputFingerprint(
  snapshot: DomiSnapshot,
  board: DomiTaskBoardSnapshot,
  news: DomiWeeklyNewsSnapshot,
  repositoryIdentity: string
) {
  // Full records (including Notes and document revisions), never the prompt's
  // bounded excerpts. Read health/scan timestamps are deliberately excluded.
  return fingerprint({
    ruleVersion: TODO_RULE_VERSION, repositoryIdentity,
    projects: sortedRecords(snapshot.projects), people: sortedRecords(snapshot.people),
    tasks: todoLedgerContent(board.tasks), newsRevision: news.contentUpdatedAt
  });
}

export function canSkipTodoSync(checkpoint: TodoSyncCheckpoint | null | undefined, input: {
  fingerprint: string; repositoryIdentity: string; now: number;
  snapshotFresh: boolean; board: DomiTaskBoardSnapshot; news: DomiWeeklyNewsSnapshot;
}) {
  return Boolean(checkpoint
    && checkpoint.ruleVersion === TODO_RULE_VERSION
    && checkpoint.fingerprint === input.fingerprint
    && checkpoint.repositoryIdentity === input.repositoryIdentity
    && SHA256.test(checkpoint.fingerprint) && SHA256.test(checkpoint.ledgerFingerprint)
    && checkpoint.verifiedAt > 0 && checkpoint.verifiedAt <= input.now
    && input.now < checkpoint.nextEvaluationAt
    && input.snapshotFresh && input.board.ok && input.board.configured && !input.board.stale
    && SHA256.test(input.board.documentSha256 || "")
    && checkpoint.ledgerFingerprint === input.board.documentSha256
    && input.news.ok && !input.news.cacheMiss && !input.news.stale
    && Number.isFinite(input.news.contentUpdatedAt) && Number(input.news.contentUpdatedAt) > 0);
}

export function parseTodoReceipt(output: string): TodoRunReceipt | null {
  const matches = [...output.matchAll(/<!--\s*DOMI_TODO_RESULT_V1\s+(\{[\s\S]*?\})\s*-->/g)];
  if (matches.length !== 1) return null;
  try { return JSON.parse(matches[0][1]) as TodoRunReceipt; } catch { return null; }
}

export function verifiedTodoReceipt(value: unknown, runId: string, board: DomiTaskBoardSnapshot): value is TodoRunReceipt {
  if (!value || typeof value !== "object" || !board.ok || board.stale) return false;
  const receipt = value as Partial<TodoRunReceipt>;
  return receipt.schema === "domi.todo-result.v1" && receipt.runId === runId && receipt.verified === true
    && SHA256.test(receipt.ledgerSha256 || "") && SHA256.test(receipt.documentSha256 || "")
    && receipt.documentSha256 === board.documentSha256
    && Array.isArray(receipt.taskIds) && receipt.taskIds.every((id) => typeof id === "string")
    && new Set(receipt.taskIds).size === receipt.taskIds.length
    && stableJson([...receipt.taskIds].sort()) === stableJson(board.tasks.map((task) => task.id).sort());
}
