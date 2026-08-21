import crypto from "node:crypto";

import {
  appendJsonLinePrivate,
  readJson,
  writeJsonPrivate,
} from "./state.js";
import {
  canonicalTaskId,
  compactTaskTitle,
  describeProgressItem,
  findTaskReference,
  likelyWaitingReply,
  responseWaitsForUser,
  shouldContinueActiveTask,
  taskNumber,
} from "./protocol.js";

const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);
const MAX_TASK_SEQUENCE = 999;
const DEFAULT_TRANSPORT_RETRY_DELAYS_MS = [2_000, 5_000];
const STATUS_LABELS = {
  queued: "排队中",
  running: "运行中",
  waiting_user: "等待补充",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
  interrupted: "已中断",
};

function defaultState() {
  return { nextSequence: 1, tasks: {}, activeBySender: {}, jobs: [] };
}

function cleanText(value, maximum = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function isTransientTransportError(error) {
  const message = cleanText(error?.message ?? error, 500);
  return /(?:reconnecting|request timed out|timed out while waiting|econnreset|econnrefused|etimedout|eai_again|enetunreach|socket hang up|network (?:error|unavailable)|connection (?:closed|lost|reset))/i.test(message);
}

export class TaskManager {
  constructor({
    codex,
    statePath,
    metricsPath,
    threadOptionsFor,
    sendTaskText,
    deliverTaskResult,
    preferenceFor,
    log = () => {},
    maxConcurrent = 2,
    transportRetryDelaysMs = DEFAULT_TRANSPORT_RETRY_DELAYS_MS,
  }) {
    this.codex = codex;
    this.statePath = statePath;
    this.metricsPath = metricsPath;
    this.threadOptionsFor = threadOptionsFor;
    this.sendTaskText = sendTaskText;
    this.deliverTaskResult = deliverTaskResult;
    this.preferenceFor = preferenceFor;
    this.log = log;
    this.maxConcurrent = maxConcurrent;
    this.transportRetryDelaysMs = transportRetryDelaysMs;
    this.runningCount = 0;
    this.activeControllers = new Map();
    this.state = readJson(statePath, defaultState());
    this.state.tasks ||= {};
    this.state.activeBySender ||= {};
    this.state.jobs ||= [];
    const restoredSequence = Number(this.state.nextSequence);
    this.state.nextSequence = Number.isInteger(restoredSequence)
      && restoredSequence >= 1
      && restoredSequence <= MAX_TASK_SEQUENCE
      ? restoredSequence
      : 1;
    for (const task of Object.values(this.state.tasks)) {
      if (task.status === "running") {
        task.status = "interrupted";
        task.progress = "桥接服务上次退出时任务仍在运行，请发送任务编号继续。";
      }
    }
    this.persist();
    queueMicrotask(() => this.pump());
  }

  persist() {
    writeJsonPrivate(this.statePath, this.state);
  }

  task(taskId) {
    return this.state.tasks[taskId] || null;
  }

  resolveTask({ senderId, text, quotedText }) {
    const combined = `${quotedText || ""}\n${text || ""}`;
    const referencedId = findTaskReference(combined, this.state.tasks);
    if (referencedId) return { task: this.task(referencedId), isNew: false };
    const waitingTasks = Object.values(this.state.tasks).filter(
      (task) => task.senderId === senderId && task.status === "waiting_user",
    );
    const waitingReply = likelyWaitingReply(text);
    if (waitingTasks.length > 1 && waitingReply) {
      return {
        task: null,
        isNew: false,
        ambiguousTasks: waitingTasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      };
    }
    if (waitingTasks.length === 1 && waitingReply) return { task: waitingTasks[0], isNew: false };
    const activeId = this.state.activeBySender[senderId];
    const activeTask = activeId ? this.task(activeId) : null;
    if (shouldContinueActiveTask(text, activeTask)) return { task: activeTask, isNew: false };
    return { task: this.createTask(senderId, text), isNew: true };
  }

  createTask(senderId, text) {
    this.pruneTasks(senderId);
    let sequence = this.state.nextSequence;
    let taskId = canonicalTaskId(sequence);
    let attempts = 0;
    while (this.state.tasks[taskId] && attempts < MAX_TASK_SEQUENCE) {
      sequence = sequence >= MAX_TASK_SEQUENCE ? 1 : sequence + 1;
      taskId = canonicalTaskId(sequence);
      attempts += 1;
    }
    if (!taskId || this.state.tasks[taskId]) {
      throw new Error("微信任务编号已用满，请先完成或取消部分旧任务。");
    }
    this.state.nextSequence = sequence >= MAX_TASK_SEQUENCE ? 1 : sequence + 1;
    const now = new Date().toISOString();
    const task = {
      id: taskId,
      senderId,
      title: compactTaskTitle(text),
      status: "queued",
      progress: "等待开始",
      threadId: "",
      createdAt: now,
      updatedAt: now,
      turns: 0,
      pendingCount: 0,
      lastError: "",
      preference: this.preferenceFor(senderId),
    };
    this.state.tasks[taskId] = task;
    this.state.activeBySender[senderId] = taskId;
    this.pruneTasks(senderId);
    this.persist();
    return task;
  }

  adoptLegacyThread(senderId, threadId) {
    if (!senderId || !threadId || this.recentTasks(senderId, 1).length) return null;
    const task = this.createTask(senderId, "迁移前微信会话");
    task.threadId = String(threadId);
    task.status = "completed";
    task.progress = "已保留原Codex上下文";
    task.updatedAt = new Date().toISOString();
    this.persist();
    return task;
  }

  pruneTasks(senderId) {
    const owned = Object.values(this.state.tasks)
      .filter((task) => task.senderId === senderId && TERMINAL_STATES.has(task.status))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const task of owned.slice(80)) delete this.state.tasks[task.id];
  }

  focus(senderId, taskId) {
    if (taskId && this.state.tasks[taskId]?.senderId === senderId) {
      this.state.activeBySender[senderId] = taskId;
    } else {
      delete this.state.activeBySender[senderId];
    }
    this.persist();
  }

  enqueue(task, input) {
    const job = {
      id: crypto.randomUUID(),
      taskId: task.id,
      senderId: task.senderId,
      text: String(input.text || ""),
      attachments: input.attachments || [],
      codexInput: input.codexInput,
      contextToken: input.contextToken || "",
      runId: input.runId || "",
      wantsFiles: input.wantsFiles === true,
      createdAt: new Date().toISOString(),
    };
    this.state.jobs.push(job);
    task.pendingCount = (task.pendingCount || 0) + 1;
    if (task.status !== "running") task.status = "queued";
    task.progress = task.status === "running" ? "补充内容已排队" : "等待执行";
    task.updatedAt = new Date().toISOString();
    this.state.activeBySender[task.senderId] = task.id;
    this.persist();
    this.pump();
    return job;
  }

  pump() {
    while (this.runningCount < this.maxConcurrent && this.state.jobs.length) {
      const eligibleIndex = this.state.jobs.findIndex((candidate) => !this.activeControllers.has(candidate.taskId));
      if (eligibleIndex < 0) return;
      const [job] = this.state.jobs.splice(eligibleIndex, 1);
      const task = this.task(job.taskId);
      if (!task || task.status === "canceled") {
        this.persist();
        continue;
      }
      this.runningCount += 1;
      this.persist();
      void this.runJob(task, job).finally(() => {
        this.runningCount -= 1;
        this.pump();
      });
    }
  }

  async safeSend(task, text, job) {
    try {
      await this.sendTaskText(task, text, job);
    } catch (error) {
      this.log(`任务 ${task.id} 状态消息发送失败：${error?.message ?? error}`);
    }
  }

  async runJob(task, job) {
    const startedAt = Date.now();
    const controller = new AbortController();
    this.activeControllers.set(task.id, controller);
    task.status = "running";
    task.progress = "Codex正在理解任务";
    task.pendingCount = Math.max(0, (task.pendingCount || 1) - 1);
    task.updatedAt = new Date().toISOString();
    task.turns = (task.turns || 0) + 1;
    task.lastContextToken = job.contextToken;
    task.lastRunId = job.runId;
    this.persist();

    let lastProgressAt = startedAt;
    let lastProgress = "";
    let finalResponse = "";
    let transportRetries = 0;
    const tools = new Set();
    const heartbeat = setInterval(() => {
      if (Date.now() - lastProgressAt < 55_000) return;
      lastProgressAt = Date.now();
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
      void this.safeSend(task, `【${task.id}】仍在处理：${task.progress}（已运行约${elapsed}分钟）`, job);
    }, 15_000);

    try {
      const options = this.threadOptionsFor(task);
      while (true) {
        let attemptProducedResult = false;
        let attemptStartedWork = false;
        try {
          const thread = task.threadId
            ? this.codex.resumeThread(task.threadId, options)
            : this.codex.startThread(options);
          const streamed = await thread.runStreamed(job.codexInput, { signal: controller.signal });
          for await (const event of streamed.events) {
            if (event.type === "thread.started") {
              task.threadId = event.thread_id;
              this.persist();
              continue;
            }
            if (event.type === "item.completed" && event.item?.type === "agent_message") {
              finalResponse = event.item.text || finalResponse;
              attemptProducedResult = Boolean(finalResponse);
              continue;
            }
            if ((event.type === "item.started" || event.type === "item.updated") && event.item) {
              const progress = describeProgressItem(event.item);
              if (!progress) continue;
              attemptStartedWork = true;
              tools.add(event.item.type);
              task.progress = progress;
              task.updatedAt = new Date().toISOString();
              this.persist();
              if (progress !== lastProgress && Date.now() - lastProgressAt >= 20_000) {
                lastProgress = progress;
                lastProgressAt = Date.now();
                await this.safeSend(task, `【${task.id}】${progress}`, job);
              }
            }
            if (event.type === "turn.failed") throw new Error(event.error?.message || "Codex任务失败");
            if (event.type === "error") throw new Error(event.message || "Codex事件流中断");
          }
          break;
        } catch (error) {
          const retryDelay = this.transportRetryDelaysMs[transportRetries];
          const canRetry = !controller.signal.aborted
            && retryDelay !== undefined
            && isTransientTransportError(error)
            && !attemptProducedResult
            && !attemptStartedWork;
          if (!canRetry) throw error;
          transportRetries += 1;
          task.progress = `网络连接不稳定，正在自动重试（${transportRetries}/${this.transportRetryDelaysMs.length}）`;
          task.lastError = "";
          task.updatedAt = new Date().toISOString();
          this.persist();
          lastProgress = task.progress;
          lastProgressAt = Date.now();
          await this.safeSend(task, `【${task.id}】${task.progress}，任务仍在处理。`, job);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          if (controller.signal.aborted) throw new Error("任务已取消");
        }
      }
      if (controller.signal.aborted) throw new Error("任务已取消");
      if (!finalResponse) finalResponse = "Codex已完成处理，但没有返回文字结果。";
      task.status = responseWaitsForUser(finalResponse) ? "waiting_user" : "completed";
      task.progress = task.status === "waiting_user" ? "等待用户补充" : "已完成";
      task.lastError = "";
      task.updatedAt = new Date().toISOString();
      this.persist();
      await this.deliverTaskResult(task, finalResponse, job);
      this.recordMetric(task, job, startedAt, "completed", tools);
    } catch (error) {
      const canceled = controller.signal.aborted || task.status === "canceled";
      const transientFailure = !canceled && isTransientTransportError(error);
      task.status = canceled ? "canceled" : "failed";
      task.progress = canceled ? "已取消" : "执行失败";
      task.lastError = transientFailure
        ? `网络连接暂时不可用${transportRetries ? `，已自动重试${transportRetries}次` : ""}。任务内容和上下文已保留，请回复“${task.id} 重试”继续。`
        : cleanText(error?.message ?? error, 240);
      task.updatedAt = new Date().toISOString();
      this.persist();
      await this.safeSend(
        task,
        canceled
          ? `【${task.id}】已取消。`
          : transientFailure
            ? `【${task.id}】${task.lastError}`
            : `【${task.id}】执行失败：${task.lastError || "未知错误"}`,
        job,
      );
      this.recordMetric(task, job, startedAt, canceled ? "canceled" : "failed", tools);
    } finally {
      clearInterval(heartbeat);
      this.activeControllers.delete(task.id);
    }
  }

  recordMetric(task, job, startedAt, status, tools) {
    appendJsonLinePrivate(this.metricsPath, {
      taskId: task.id,
      timestamp: new Date().toISOString(),
      status,
      durationMs: Date.now() - startedAt,
      model: task.preference?.model || "",
      reasoningEffort: task.preference?.reasoningEffort || "",
      attachmentCount: job.attachments?.length || 0,
      toolKinds: [...tools].sort(),
      turn: task.turns,
    });
  }

  cancel(senderId, taskId) {
    const task = this.task(taskId);
    if (!task || task.senderId !== senderId) return { ok: false, error: "没有找到这个任务。" };
    this.state.jobs = this.state.jobs.filter((job) => job.taskId !== taskId);
    this.activeControllers.get(taskId)?.abort();
    task.status = "canceled";
    task.progress = "已取消";
    task.pendingCount = 0;
    task.updatedAt = new Date().toISOString();
    this.persist();
    return { ok: true, task };
  }

  failPreparation(task, error) {
    task.status = "failed";
    task.progress = "附件准备失败";
    task.lastError = cleanText(error?.message ?? error, 240);
    task.updatedAt = new Date().toISOString();
    this.persist();
  }

  recentTasks(senderId, limit = 8) {
    return Object.values(this.state.tasks)
      .filter((task) => task.senderId === senderId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit);
  }

  statusText(senderId, taskId = "") {
    const selected = taskId ? [this.task(taskId)].filter(Boolean) : this.recentTasks(senderId);
    const owned = selected.filter((task) => task.senderId === senderId);
    if (!owned.length) return taskId ? "没有找到这个任务。" : "当前还没有微信任务。";
    return owned.map((task) => {
      const pending = task.pendingCount ? ` · ${task.pendingCount}条补充待处理` : "";
      const error = task.lastError ? `\n  原因：${task.lastError}` : "";
      return `【${task.id}】${STATUS_LABELS[task.status] || task.status}${pending}\n  ${task.title}\n  ${task.progress}${error}`;
    }).join("\n\n");
  }

  referenceFromText(text) {
    return findTaskReference(text, this.state.tasks);
  }

  taskLabel(task) {
    return `${taskNumber(task.id)}号任务`;
  }
}
