import assert from "node:assert/strict";
import { test } from "node:test";
import { selectTodoPriorities } from "../src/todo-priorities.ts";

process.env.TZ = "Asia/Shanghai";
const now = new Date(2026, 9, 26, 10).getTime();
const task = (id, overrides = {}) => ({
  id, title: `跟进合成项目 ${id}`, summary: "确认试点进展", reason: "试点反馈已到，需要决定是否继续验证",
  priority: "P2", category: "project-follow-up", status: "open", signalKey: `signal-${id}`,
  source: { kind: "project", recordId: `synthetic-${id}`, displayName: `合成项目 ${id}` },
  dueAt: null, suggestedAction: { kind: "review", label: "核对试点结果并决定下一步", prompt: "读取已归档试点反馈" },
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", ...overrides
});
const ids = tasks => selectTodoPriorities(tasks, now).map(item => item.task.id);

test("real overdue and near deadlines take precedence over undated P1 tasks", () => {
  const input = [task("undated", { priority: "P1" }), task("soon", { dueAt: "2026-10-28", priority: "P3" }),
    task("overdue", { dueAt: "2026-10-25", priority: "P3" }), task("today", { dueAt: "2026-10-26" })];
  assert.deepEqual(ids(input), ["overdue", "today", "soon"]);
  assert.match(selectTodoPriorities(input, now)[0].whyNow, /^已逾期 1 天 · 试点反馈已到/);
});

test("ongoing tasks precede undated tasks while distant commitments do not crowd urgent work", () => {
  assert.deepEqual(ids([task("future", { priority: "P3", dueAt: "2027-02-01" }),
    task("normal", { priority: "P2" }), task("critical", { priority: "P1" }),
    task("ongoing", { status: "in_progress", priority: "P3" })]), ["ongoing", "critical", "normal"]);
});

test("local date-only deadline stays current all day then becomes overdue after midnight", () => {
  const input = [task("date", { dueAt: "2026-10-26" })];
  assert.equal(selectTodoPriorities(input, new Date(2026, 9, 26, 23, 59, 59).getTime())[0].deadlineLabel, "今天到期");
  assert.equal(selectTodoPriorities(input, new Date(2026, 9, 27, 0, 0, 0).getTime())[0].deadlineLabel, "已逾期 1 天");
  assert.equal(selectTodoPriorities([task("time", { dueAt: "2026-10-26T09:00:00+08:00" })], now)[0].deadlineLabel, "已过截止时间");
});

test("invalid dates and absent reasons do not invent urgency or a deadline", () => {
  for (const dueAt of [null, "unknown", "2026-02-30"]) {
    const [item] = selectTodoPriorities([task("undated", { dueAt, reason: "", summary: "" })], now);
    assert.equal(item.deadlineLabel, undefined);
    assert.equal(item.whyNow, "按现有待办优先级排序");
  }
});

test("completed and ignored tasks are excluded without altering their ledger state", () => {
  const input = [task("complete", { status: "done", dueAt: "2026-10-01" }),
    task("ignored", { status: "ignored", priority: "P1" }), task("active")];
  const before = structuredClone(input);
  assert.deepEqual(ids(input), ["active"]);
  assert.deepEqual(input, before);
});

test("same entity and meeting purpose is represented once, distinct purposes stay separate", () => {
  const source = { kind: "project", recordId: "synthetic-shared", displayName: "合成项目" };
  const meeting = { kind: "schedule", label: "确认访谈时间", prompt: "准备访谈" };
  const input = [task("new", { source, category: "new-entry", suggestedAction: meeting }),
    task("follow-up", { source, suggestedAction: meeting, dueAt: "2026-10-27" }),
    task("review", { source, purposeKey: "investment-review" }),
    task("other-meeting", { source, purposeKey: "technical-interview", suggestedAction: meeting })];
  assert.deepEqual(ids(input), ["follow-up", "other-meeting", "review"]);
  assert.equal(selectTodoPriorities([task("a", { source, purposeKey: "same-purpose" }),
    task("b", { source, purposeKey: "same-purpose" })], now).length, 1);
});

test("ties are stable across input order, with a maximum of three recommendations", () => {
  const input = [task("d"), task("b"), task("a"), task("c")];
  assert.deepEqual(ids(input), ["a", "b", "c"]);
  assert.deepEqual(ids(input.toReversed()), ["a", "b", "c"]);
  assert.equal(selectTodoPriorities(input, now, 10).length, 3);
  assert.deepEqual(selectTodoPriorities(input, now, 0), []);
  assert.deepEqual(selectTodoPriorities(input, NaN), []);
});

test("missing source IDs do not collapse unrelated manual tasks", () => {
  const source = { kind: "manual", recordId: "", displayName: "" };
  assert.deepEqual(ids([task("a", { source, purposeKey: "review" }), task("b", { source, purposeKey: "review" })]), ["a", "b"]);
});

test("next action and evidence remain the stored content without embellishment", () => {
  const [item] = selectTodoPriorities([task("plain", { reason: "", summary: "等待客户反馈后再决定测试范围" })], now);
  assert.equal(item.whyNow, "等待客户反馈后再决定测试范围");
  assert.equal(item.nextAction, "核对试点结果并决定下一步");
});
