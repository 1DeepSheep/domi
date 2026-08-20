import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TaskManager } from "../src/task-manager.js";

function fakeThread(threadId, responses) {
  return {
    async runStreamed() {
      async function* events() {
        yield { type: "thread.started", thread_id: threadId };
        yield { type: "item.started", item: { type: "web_search", query: "example" } };
        yield { type: "item.completed", item: { type: "agent_message", text: responses.shift() || "完成" } };
        yield { type: "turn.completed", usage: null };
      }
      return { events: events() };
    },
  };
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for task manager");
}

test("separate Weixin tasks keep separate Codex thread ids", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-manager-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let sequence = 0;
  const responses = ["任务一完成", "任务二完成"];
  const delivered = [];
  const manager = new TaskManager({
    codex: {
      startThread() {
        sequence += 1;
        return fakeThread(`thread-${sequence}`, responses);
      },
      resumeThread(threadId) {
        return fakeThread(threadId, responses);
      },
    },
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async (task, response) => delivered.push([task.id, response]),
  });

  const first = manager.resolveTask({ senderId: "owner", text: "整理录音", quotedText: "" }).task;
  const second = manager.resolveTask({ senderId: "owner", text: "分析截图", quotedText: "" }).task;
  manager.enqueue(first, { text: "整理录音", codexInput: "整理录音" });
  manager.enqueue(second, { text: "分析截图", codexInput: "分析截图" });
  await waitFor(() => manager.task(first.id).status === "completed" && manager.task(second.id).status === "completed");

  assert.notEqual(manager.task(first.id).threadId, manager.task(second.id).threadId);
  assert.deepEqual(delivered.map(([taskId]) => taskId).sort(), [first.id, second.id].sort());
  assert.equal(manager.resolveTask({ senderId: "owner", text: "回到1号任务补充参会人", quotedText: "" }).task.id, first.id);
});

test("ambiguous replies never guess between multiple waiting tasks", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-routing-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manager = new TaskManager({
    codex: {},
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async () => {},
  });
  const first = manager.createTask("owner", "任务一");
  const second = manager.createTask("owner", "任务二");
  first.status = "waiting_user";
  second.status = "waiting_user";
  manager.persist();

  const ambiguous = manager.resolveTask({ senderId: "owner", text: "补充融资金额", quotedText: "" });
  assert.equal(ambiguous.task, null);
  assert.deepEqual(ambiguous.ambiguousTasks.map((task) => task.id).sort(), [first.id, second.id].sort());
  assert.equal(manager.resolveTask({ senderId: "owner", text: "W001 补充融资金额", quotedText: "" }).task.id, first.id);
  const newTask = manager.resolveTask({ senderId: "owner", text: "研究一家新的公司", quotedText: "" });
  assert.equal(newTask.isNew, true);
  assert.notEqual(newTask.task.id, first.id);
  assert.notEqual(newTask.task.id, second.id);
});

test("follow-ups for the same task run serially and reuse its thread", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-serial-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let activeRuns = 0;
  let maximumActiveRuns = 0;
  const resumedThreads = [];
  const thread = {
    async runStreamed() {
      async function* events() {
        activeRuns += 1;
        maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
        yield { type: "thread.started", thread_id: "thread-shared" };
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { type: "item.completed", item: { type: "agent_message", text: "完成" } };
        activeRuns -= 1;
      }
      return { events: events() };
    },
  };
  const manager = new TaskManager({
    codex: {
      startThread: () => thread,
      resumeThread(threadId) {
        resumedThreads.push(threadId);
        return thread;
      },
    },
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async () => {},
  });
  const task = manager.createTask("owner", "连续任务");
  manager.enqueue(task, { text: "第一条", codexInput: "第一条" });
  manager.enqueue(task, { text: "第二条", codexInput: "第二条" });
  await waitFor(() => task.turns === 2 && task.status === "completed");

  assert.equal(maximumActiveRuns, 1);
  assert.deepEqual(resumedThreads, ["thread-shared"]);
});

test("new task numbers wrap within W001-W999 without reusing retained tasks", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-task-pool-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manager = new TaskManager({
    codex: {},
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async () => {},
  });
  manager.state.nextSequence = 999;
  manager.state.tasks.W999 = { id: "W999", senderId: "owner", status: "completed", updatedAt: "2026-08-20" };
  manager.state.tasks.W001 = { id: "W001", senderId: "owner", status: "completed", updatedAt: "2026-08-21" };

  const first = manager.createTask("owner", "循环编号");
  assert.equal(first.id, "W002");
  assert.equal(manager.state.nextSequence, 3);
  delete manager.state.tasks.W001;
  manager.state.nextSequence = 999;
  const recycled = manager.createTask("owner", "复用空位");
  assert.equal(recycled.id, "W001");
  assert.equal(manager.state.nextSequence, 2);
});
