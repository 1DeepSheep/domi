import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TaskManager } from "../src/task-manager.js";

function fakeThread(threadId, responses, usages = []) {
  return {
    async runStreamed() {
      async function* events() {
        yield { type: "thread.started", thread_id: threadId };
        yield { type: "item.started", item: { type: "web_search", query: "example" } };
        yield { type: "item.completed", item: { type: "agent_message", text: responses.shift() || "完成" } };
        yield { type: "turn.completed", usage: usages.shift() ?? null };
      }
      return { events: events() };
    },
  };
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

test("turn usage is normalized, accumulated per task, and persisted without message content", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-usage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const metricsPath = path.join(directory, "metrics.jsonl");
  const responses = ["第一次完成", "第二次完成"];
  const usages = [
    {
      input_tokens: 120,
      cached_input_tokens: 80,
      cache_write_input_tokens: 10,
      output_tokens: 30,
      reasoning_output_tokens: 20,
    },
    {
      input_tokens: 70,
      input_tokens_details: { cached_tokens: 500, cache_write_tokens: 6 },
      output_tokens: 25,
      output_tokens_details: { reasoning_tokens: 15 },
    },
  ];
  const thread = fakeThread("thread-usage", responses, usages);
  const manager = new TaskManager({
    codex: { startThread: () => thread, resumeThread: () => thread },
    statePath: path.join(directory, "tasks.json"),
    metricsPath,
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "max" }),
    sendTaskText: async () => {},
    deliverTaskResult: async () => {},
  });
  const task = manager.createTask("private-sender", "包含敏感内容的研究任务");
  manager.enqueue(task, { text: "第一条敏感消息", codexInput: "第一条敏感提示" });
  await waitFor(() => task.turns === 1 && task.status === "completed");
  manager.enqueue(task, { text: "第二条敏感消息", codexInput: "第二条敏感提示" });
  await waitFor(() => task.turns === 2 && task.status === "completed");

  assert.deepEqual(task.tokenUsage, {
    inputTokens: 190,
    cachedInputTokens: 150,
    uncachedInputTokens: 40,
    cacheWriteInputTokens: 16,
    outputTokens: 55,
    reasoningTokens: 35,
  });
  assert.equal(task.tokenUsageSamples, 2);

  const metrics = readJsonLines(metricsPath);
  assert.equal(metrics.length, 2);
  assert.deepEqual(metrics[0].tokenUsage, {
    inputTokens: 120,
    cachedInputTokens: 80,
    uncachedInputTokens: 40,
    cacheWriteInputTokens: 10,
    outputTokens: 30,
    reasoningTokens: 20,
  });
  assert.deepEqual(metrics[1].tokenUsage, {
    inputTokens: 70,
    cachedInputTokens: 70,
    uncachedInputTokens: 0,
    cacheWriteInputTokens: 6,
    outputTokens: 25,
    reasoningTokens: 15,
  });
  assert.deepEqual(metrics[1].taskTokenUsage, task.tokenUsage);
  assert.equal(metrics[1].usageAvailable, true);
  assert.equal(metrics[1].usageSamples, 1);
  assert.equal(metrics[1].usageScope, "completed_turns");
  assert.equal(metrics[1].usageComplete, true);
  assert.equal(metrics[1].taskUsageSamples, 2);
  assert.equal(metrics[1].taskUsageComplete, true);
  for (const metric of metrics) {
    assert.equal(Object.hasOwn(metric, "senderId"), false);
    assert.equal(Object.hasOwn(metric, "text"), false);
    assert.equal(Object.hasOwn(metric, "codexInput"), false);
    const serialized = JSON.stringify(metric);
    assert.equal(serialized.includes("private-sender"), false);
    assert.equal(serialized.includes("敏感"), false);
  }
});

test("null turn usage records an unavailable zero sample without breaking the task", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-null-usage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const metricsPath = path.join(directory, "metrics.jsonl");
  const manager = new TaskManager({
    codex: { startThread: () => fakeThread("thread-null-usage", ["完成"]) },
    statePath: path.join(directory, "tasks.json"),
    metricsPath,
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "max" }),
    sendTaskText: async () => {},
    deliverTaskResult: async () => {},
  });
  const task = manager.createTask("owner", "usage为空仍可完成");
  manager.enqueue(task, { text: "开始", codexInput: "开始" });
  await waitFor(() => task.status === "completed");

  const [metric] = readJsonLines(metricsPath);
  assert.equal(metric.usageAvailable, false);
  assert.equal(metric.usageSamples, 0);
  assert.deepEqual(metric.tokenUsage, {
    inputTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  });
  assert.equal(metric.usageScope, "completed_turns");
  assert.equal(metric.usageComplete, false);
  assert.equal(metric.taskUsageComplete, false);
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
  assert.equal(manager.resolveTask({ senderId: "owner", text: "W01 补充融资金额", quotedText: "" }).task.id, first.id);
  const newTask = manager.resolveTask({ senderId: "owner", text: "研究一家新的公司", quotedText: "" });
  assert.equal(newTask.isNew, true);
  assert.notEqual(newTask.task.id, first.id);
  assert.notEqual(newTask.task.id, second.id);
});

test("cross-entity file requests and mixed research actions create independent tasks", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-new-intent-"));
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
  const oldTask = manager.createTask("owner", "研究一下ojo项目并入库");
  oldTask.status = "waiting_user";
  oldTask.finalResponse = "OJO旧结果";
  oldTask.delivery = { status: "delivered" };
  manager.persist();

  const rating = manager.resolveTask({
    senderId: "owner",
    text: "请对 ojo 进行评级，并把研究报告pdf发我看看",
    quotedText: "",
  });
  assert.equal(rating.isNew, true);
  assert.equal(rating.routingReason, "new_task");
  assert.notEqual(rating.task.id, oldTask.id);

  const otherCompany = manager.resolveTask({
    senderId: "owner",
    text: "赵动科技的纪要发我看看",
    quotedText: "",
  });
  assert.equal(otherCompany.isNew, true);
  assert.equal(otherCompany.routingReason, "new_task");
  assert.notEqual(otherCompany.task.id, oldTask.id);
  assert.notEqual(otherCompany.task.id, rating.task.id);

  const quotedNewRequest = manager.resolveTask({
    senderId: "owner",
    text: "请把赵动科技的会议纪要发我",
    quotedText: `【${oldTask.id}】OJO 旧结果`,
  });
  assert.equal(quotedNewRequest.isNew, true);
  assert.equal(quotedNewRequest.routingReason, "new_task");
  assert.notEqual(quotedNewRequest.task.id, oldTask.id);

  const quotedResultRequest = manager.resolveTask({
    senderId: "owner",
    text: "把之前的报告发我",
    quotedText: `【${oldTask.id}】OJO 旧结果`,
  });
  assert.equal(quotedResultRequest.isNew, false);
  assert.equal(quotedResultRequest.routingReason, "quoted_reference");
  assert.equal(quotedResultRequest.task.id, oldTask.id);

  const quotedOwnRequest = manager.resolveTask({
    senderId: "owner",
    text: "风险呢？",
    quotedText: "研究一下ojo项目并入库",
  });
  assert.equal(quotedOwnRequest.isNew, false);
  assert.equal(quotedOwnRequest.routingReason, "quoted_message");
  assert.equal(quotedOwnRequest.task.id, oldTask.id);

  const missingReference = manager.resolveTask({
    senderId: "owner",
    text: "W19 把报告发我",
    quotedText: "",
  });
  assert.equal(missingReference.task, null);
  assert.equal(missingReference.routingReason, "missing_reference");
  assert.equal(missingReference.missingTaskId, "W19");
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

test("new task numbers stay within W01-W20 and reuse only free labels", (t) => {
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
  manager.state.nextSequence = 20;
  manager.state.tasks.W20 = { id: "W20", senderId: "owner", status: "completed", updatedAt: "2026-08-20" };
  manager.state.tasks.W01 = { id: "W01", senderId: "owner", status: "completed", updatedAt: "2026-08-21" };

  const first = manager.createTask("owner", "循环编号");
  assert.equal(first.id, "W02");
  assert.equal(manager.state.nextSequence, 3);
  delete manager.state.tasks.W01;
  manager.state.nextSequence = 20;
  const recycled = manager.createTask("owner", "复用空位");
  assert.equal(recycled.id, "W01");
  assert.equal(manager.state.nextSequence, 2);
});

test("legacy three-digit ids migrate without losing task focus or threads", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-task-migration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "tasks.json");
  fs.writeFileSync(statePath, JSON.stringify({
    nextSequence: 11,
    tasks: {
      W001: { id: "W001", senderId: "owner", status: "completed", threadId: "thread-one", updatedAt: "2026-08-20" },
      W010: { id: "W010", senderId: "owner", status: "completed", threadId: "thread-ten", updatedAt: "2026-08-21" },
    },
    activeBySender: { owner: "W010" },
    jobs: [],
  }));
  const manager = new TaskManager({
    codex: {},
    statePath,
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async () => {},
  });

  assert.deepEqual(Object.keys(manager.state.tasks).sort(), ["W01", "W10"]);
  assert.equal(manager.state.activeBySender.owner, "W10");
  assert.equal(manager.task("W10").threadId, "thread-ten");
  assert.ok(manager.task("W10").uid);
});

test("transient transport timeouts retry the same task without spending progress quota", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-retry-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let attempts = 0;
  const sent = [];
  const delivered = [];
  const metricsPath = path.join(directory, "metrics.jsonl");
  const manager = new TaskManager({
    codex: {
      startThread() {
        return {
          async runStreamed() {
            attempts += 1;
            async function* events() {
              yield { type: "thread.started", thread_id: "thread-retry" };
              if (attempts === 1) {
                yield { type: "turn.failed", error: { message: "Reconnecting... 2/5 (request timed out)" } };
                return;
              }
              yield { type: "item.completed", item: { type: "agent_message", text: "恢复成功" } };
              yield {
                type: "turn.completed",
                usage: {
                  input_tokens: 40,
                  cached_input_tokens: 30,
                  cache_write_input_tokens: 4,
                  output_tokens: 8,
                  reasoning_output_tokens: 3,
                },
              };
            }
            return { events: events() };
          },
        };
      },
      resumeThread(threadId) {
        assert.equal(threadId, "thread-retry");
        return this.startThread();
      },
    },
    statePath: path.join(directory, "tasks.json"),
    metricsPath,
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async (_task, text) => sent.push(text),
    deliverTaskResult: async (_task, response) => delivered.push(response),
    transportRetryDelaysMs: [0, 0],
  });
  const task = manager.createTask("owner", "网络恢复任务");
  manager.enqueue(task, { text: "开始", codexInput: "开始" });
  await waitFor(() => task.status === "completed");

  assert.equal(attempts, 2);
  assert.equal(task.lastError, "");
  assert.deepEqual(delivered, ["恢复成功"]);
  assert.deepEqual(sent, [], "Short retries must preserve the reply quota for the final result.");
  const [metric] = readJsonLines(metricsPath);
  assert.equal(metric.usageComplete, true);
  assert.equal(metric.usageSamples, 1);
  assert.equal(metric.tokenUsage.cacheWriteInputTokens, 4);
});

test("canceled jobs retain observed completed-turn usage but mark it incomplete", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-canceled-usage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const metricsPath = path.join(directory, "metrics.jsonl");
  const manager = new TaskManager({
    codex: {
      startThread() {
        return {
          async runStreamed() {
            async function* events() {
              yield { type: "thread.started", thread_id: "thread-canceled-usage" };
              await new Promise((resolve) => setTimeout(resolve, 25));
              yield {
                type: "turn.completed",
                usage: {
                  input_tokens: 25,
                  cached_input_tokens: 10,
                  output_tokens: 5,
                  reasoning_output_tokens: 2,
                },
              };
            }
            return { events: events() };
          },
        };
      },
    },
    statePath: path.join(directory, "tasks.json"),
    metricsPath,
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "max" }),
    sendTaskText: async () => {},
    deliverTaskResult: async () => {},
  });
  const task = manager.createTask("owner", "取消中的用量任务");
  manager.enqueue(task, { text: "开始", codexInput: "开始" });
  await waitFor(() => task.status === "running");
  manager.cancel("owner", task.id);
  await waitFor(() => fs.existsSync(metricsPath) && readJsonLines(metricsPath).length === 1);

  const [metric] = readJsonLines(metricsPath);
  assert.equal(metric.status, "canceled");
  assert.equal(metric.usageSamples, 1);
  assert.equal(metric.tokenUsage.inputTokens, 25);
  assert.equal(metric.usageComplete, false);
  assert.equal(metric.taskUsageComplete, false);
});

test("delivery rejection preserves the completed result and retries with fresh context", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-delivery-outbox-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let attempts = 0;
  const contexts = [];
  const manager = new TaskManager({
    codex: { startThread: () => fakeThread("thread-outbox", ["已保存的最终结果"]) },
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async (_task, _response, job) => {
      attempts += 1;
      contexts.push(job.contextToken);
      if (attempts === 1) throw new Error("sendmessage ret=-2: prepare failed");
    },
  });
  const task = manager.createTask("owner", "保存结果");
  manager.enqueue(task, { text: "开始", codexInput: "开始", contextToken: "old-context" });
  await waitFor(() => task.delivery?.status === "pending");

  assert.equal(task.status, "completed");
  assert.equal(task.finalResponse, "已保存的最终结果");
  assert.equal(task.progress.includes("自动发送"), true);
  manager.noteInboundContext("owner", { contextToken: "fresh-context", runId: "fresh-run" });
  assert.deepEqual(await manager.flushPendingDeliveries("owner", task.id), [task.id]);
  assert.equal(task.delivery.status, "delivered");
  assert.deepEqual(contexts, ["old-context", "fresh-context"]);
});

test("slides delivery policy and correction count survive the task outbox", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-slides-policy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const deliveries = [];
  const manager = new TaskManager({
    codex: { startThread: () => fakeThread("thread-slides", ["Slides完成"]) },
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async (_task, _response, job) => deliveries.push(job),
  });
  const task = manager.createTask("owner", "做成PPT");
  manager.enqueue(task, {
    text: "做成PPT",
    codexInput: "做成PPT",
    wantsFiles: true,
    slidesDeliveryPolicy: "html_pdf",
    slidesCorrectionAttempts: 1,
  });
  await waitFor(() => task.delivery?.status === "delivered");

  assert.equal(deliveries[0].slidesDeliveryPolicy, "html_pdf");
  assert.equal(deliveries[0].slidesCorrectionAttempts, 1);
  assert.equal(task.delivery.slidesDeliveryPolicy, "html_pdf");
  assert.equal(task.delivery.slidesCorrectionAttempts, 1);
});

test("a targeted pending-delivery flush never sends a different task result", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-targeted-outbox-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const delivered = [];
  const manager = new TaskManager({
    codex: {},
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async (task) => delivered.push(task.id),
  });
  const first = manager.createTask("owner", "旧任务");
  first.status = "completed";
  first.finalResponse = "旧任务结果";
  first.delivery = { status: "pending" };
  const active = manager.createTask("owner", "当前任务");
  active.status = "completed";
  active.finalResponse = "当前任务结果";
  active.delivery = { status: "delivered" };
  manager.persist();

  assert.deepEqual(
    await manager.flushPendingDeliveries("owner", active.id, 1, { preferredOnly: true }),
    [],
  );
  assert.deepEqual(delivered, []);
  assert.deepEqual(
    await manager.flushPendingDeliveries("owner", first.id, 1, { preferredOnly: true }),
    [first.id],
  );
  assert.deepEqual(delivered, [first.id]);
});

test("long tasks send at most the configured milestone notices", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-progress-budget-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sent = [];
  const manager = new TaskManager({
    codex: {
      startThread() {
        return {
          async runStreamed() {
            async function* events() {
              yield { type: "thread.started", thread_id: "thread-progress" };
              yield { type: "item.started", item: { type: "web_search" } };
              await new Promise((resolve) => setTimeout(resolve, 45));
              yield { type: "item.completed", item: { type: "agent_message", text: "完成" } };
            }
            return { events: events() };
          },
        };
      },
    },
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async (_task, text) => sent.push(text),
    deliverTaskResult: async () => {},
    progressNotificationDelaysMs: [0, 15],
    progressPollIntervalMs: 5,
  });
  const task = manager.createTask("owner", "长任务");
  manager.enqueue(task, { text: "开始", codexInput: "开始" });
  await waitFor(() => task.status === "completed");

  assert.equal(sent.length, 2);
  assert.equal(sent.every((text) => text.includes("仍在处理")), true);
});

test("task history keeps five visible recent items and ten delivered terminal tasks", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-task-history-"));
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
  for (let index = 0; index < 12; index += 1) {
    const task = manager.createTask("owner", `任务${index + 1}`);
    task.status = "completed";
    task.updatedAt = new Date(Date.UTC(2026, 7, 20, 0, index)).toISOString();
    manager.pruneTasks("owner");
  }

  assert.equal(Object.values(manager.state.tasks).filter((task) => task.status === "completed").length, 10);
  assert.equal(manager.recentTasks("owner").length, 5);
});

test("recoverable Codex reconnect events stay inside one CLI attempt", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-stream-reconnect-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let attempts = 0;
  const delivered = [];
  const manager = new TaskManager({
    codex: {
      startThread() {
        return {
          async runStreamed() {
            attempts += 1;
            async function* events() {
              yield { type: "thread.started", thread_id: "thread-stream-reconnect" };
              yield { type: "error", message: "Reconnecting... 2/5 (request timed out)" };
              yield { type: "item.completed", item: { type: "agent_message", text: "连接恢复成功" } };
              yield { type: "turn.completed", usage: null };
            }
            return { events: events() };
          },
        };
      },
    },
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async (_task, response) => delivered.push(response),
    transportRetryDelaysMs: [0, 0],
  });
  const task = manager.createTask("owner", "等待CLI内部恢复");
  manager.enqueue(task, { text: "开始", codexInput: "开始" });
  await waitFor(() => task.status === "completed");

  assert.equal(attempts, 1);
  assert.deepEqual(delivered, ["连接恢复成功"]);
});

test("exhausted transport retries keep context and hide raw reconnect errors", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-retry-exhausted-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let attempts = 0;
  const sent = [];
  const metricsPath = path.join(directory, "metrics.jsonl");
  const thread = {
    async runStreamed() {
      attempts += 1;
      async function* events() {
        yield { type: "thread.started", thread_id: "thread-exhausted" };
        yield { type: "turn.failed", error: { message: "Reconnecting... 2/5 (request timed out)" } };
      }
      return { events: events() };
    },
  };
  const manager = new TaskManager({
    codex: { startThread: () => thread, resumeThread: () => thread },
    statePath: path.join(directory, "tasks.json"),
    metricsPath,
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async (_task, text) => sent.push(text),
    deliverTaskResult: async () => {},
    transportRetryDelaysMs: [0, 0],
  });
  const task = manager.createTask("owner", "始终超时的任务");
  manager.enqueue(task, { text: "开始", codexInput: "开始" });
  await waitFor(() => task.status === "failed");

  assert.equal(attempts, 3);
  assert.equal(task.threadId, "thread-exhausted");
  assert.equal(task.lastError.includes("已自动重试2次"), true);
  assert.equal(task.lastError.includes(`回复“${task.id} 重试”继续`), true);
  assert.equal(sent.at(-1).includes("Reconnecting"), false);
  const [metric] = readJsonLines(metricsPath);
  assert.equal(metric.status, "failed");
  assert.equal(metric.usageAvailable, false);
  assert.equal(metric.usageComplete, false);
  assert.equal(metric.taskUsageComplete, false);
});

test("transport failures after work starts never repeat possible side effects", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-wechat-no-duplicate-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let attempts = 0;
  const manager = new TaskManager({
    codex: {
      startThread() {
        return {
          async runStreamed() {
            attempts += 1;
            async function* events() {
              yield { type: "thread.started", thread_id: "thread-side-effect" };
              yield { type: "item.started", item: { type: "command_execution", command: "write result" } };
              yield { type: "turn.failed", error: { message: "request timed out" } };
            }
            return { events: events() };
          },
        };
      },
      resumeThread() {
        throw new Error("must not retry after work starts");
      },
    },
    statePath: path.join(directory, "tasks.json"),
    metricsPath: path.join(directory, "metrics.jsonl"),
    threadOptionsFor: () => ({}),
    preferenceFor: () => ({ model: "test", reasoningEffort: "low" }),
    sendTaskText: async () => {},
    deliverTaskResult: async () => {},
    transportRetryDelaysMs: [0, 0],
  });
  const task = manager.createTask("owner", "不可重复副作用");
  manager.enqueue(task, { text: "开始", codexInput: "开始" });
  await waitFor(() => task.status === "failed");

  assert.equal(attempts, 1);
  assert.equal(task.lastError.includes("已自动重试"), false);
  assert.equal(task.lastError.includes(`回复“${task.id} 重试”继续`), true);
});
