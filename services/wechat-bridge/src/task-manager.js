import crypto from "node:crypto";
import { isContextualSlidesRevision } from "./slides-request-policy.js";
import { isSlidesInputRequest } from "./slides-response-policy.cjs";

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
  isResultOnlyRequest,
  likelyWaitingReply,
  looksLikeNewTask,
  responseWaitsForUser,
  shouldContinueActiveTask,
  taskReferenceToken,
  taskNumber,
} from "./protocol.js";

const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);
const MAX_TASK_SEQUENCE = 20;
const MAX_TERMINAL_TASKS_PER_SENDER = 10;
const DEFAULT_RECENT_TASK_LIMIT = 5;
const DEFAULT_TRANSPORT_RETRY_DELAYS_MS = [2_000, 5_000];
const DEFAULT_PROGRESS_NOTIFICATION_DELAYS_MS = [3 * 60_000, 10 * 60_000];
const STATUS_LABELS = {
  queued: "排队中",
  running: "运行中",
  waiting_user: "等待补充",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
  interrupted: "已中断",
};

const EMPTY_TOKEN_USAGE = Object.freeze({
  inputTokens: 0,
  cachedInputTokens: 0,
  uncachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
});

function defaultState() {
  return { nextSequence: 1, tasks: {}, activeBySender: {}, contextBySender: {}, jobs: [] };
}

function cleanText(value, maximum = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function isTransientTransportError(error) {
  const message = cleanText(error?.message ?? error, 500);
  return /(?:reconnecting|request timed out|timed out while waiting|econnreset|econnrefused|etimedout|eai_again|enetunreach|socket hang up|network (?:error|unavailable)|connection (?:closed|lost|reset))/i.test(message);
}

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function nestedValue(source, path) {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function firstTokenCount(source, paths) {
  for (const path of paths) {
    const value = nestedValue(source, path);
    if (value !== undefined && value !== null) return tokenCount(value);
  }
  return 0;
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = firstTokenCount(usage, [
    ["input_tokens"],
    ["inputTokens"],
    ["prompt_tokens"],
    ["promptTokens"],
  ]);
  const rawCachedInputTokens = firstTokenCount(usage, [
    ["cached_input_tokens"],
    ["cachedInputTokens"],
    ["input_tokens_details", "cached_tokens"],
    ["inputTokensDetails", "cachedTokens"],
    ["prompt_tokens_details", "cached_tokens"],
    ["promptTokensDetails", "cachedTokens"],
  ]);
  const cachedInputTokens = Math.min(inputTokens, rawCachedInputTokens);
  const cacheWriteInputTokens = firstTokenCount(usage, [
    ["cache_write_input_tokens"],
    ["cacheWriteInputTokens"],
    ["input_tokens_details", "cache_write_tokens"],
    ["inputTokensDetails", "cacheWriteTokens"],
    ["prompt_tokens_details", "cache_write_tokens"],
    ["promptTokensDetails", "cacheWriteTokens"],
  ]);
  const outputTokens = firstTokenCount(usage, [
    ["output_tokens"],
    ["outputTokens"],
    ["completion_tokens"],
    ["completionTokens"],
  ]);
  const reasoningTokens = firstTokenCount(usage, [
    ["reasoning_output_tokens"],
    ["reasoningOutputTokens"],
    ["output_tokens_details", "reasoning_tokens"],
    ["outputTokensDetails", "reasoningTokens"],
    ["completion_tokens_details", "reasoning_tokens"],
    ["completionTokensDetails", "reasoningTokens"],
  ]);
  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: inputTokens - cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningTokens,
  };
}

function addTokenUsage(left = EMPTY_TOKEN_USAGE, right = EMPTY_TOKEN_USAGE) {
  return {
    inputTokens: tokenCount(left.inputTokens) + tokenCount(right.inputTokens),
    cachedInputTokens: tokenCount(left.cachedInputTokens) + tokenCount(right.cachedInputTokens),
    uncachedInputTokens: tokenCount(left.uncachedInputTokens) + tokenCount(right.uncachedInputTokens),
    cacheWriteInputTokens: tokenCount(left.cacheWriteInputTokens)
      + tokenCount(right.cacheWriteInputTokens),
    outputTokens: tokenCount(left.outputTokens) + tokenCount(right.outputTokens),
    reasoningTokens: tokenCount(left.reasoningTokens) + tokenCount(right.reasoningTokens),
  };
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
    progressNotificationDelaysMs = DEFAULT_PROGRESS_NOTIFICATION_DELAYS_MS,
    progressPollIntervalMs = 15_000,
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
    this.progressNotificationDelaysMs = progressNotificationDelaysMs;
    this.progressPollIntervalMs = progressPollIntervalMs;
    this.runningCount = 0;
    this.activeControllers = new Map();
    this.state = readJson(statePath, defaultState());
    this.state.tasks ||= {};
    this.state.activeBySender ||= {};
    this.state.contextBySender ||= {};
    this.state.jobs ||= [];
    this.normalizePersistedState();
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
    for (const senderId of new Set(Object.values(this.state.tasks).map((task) => task.senderId).filter(Boolean))) {
      this.pruneTasks(senderId);
    }
    this.persist();
    queueMicrotask(() => this.pump());
  }

  normalizePersistedState() {
    const originalTasks = Object.entries(this.state.tasks || {});
    const originalActive = { ...(this.state.activeBySender || {}) };
    const prioritized = originalTasks.sort(([, left], [, right]) => {
      const leftActive = Object.values(originalActive).includes(left.id) ? 1 : 0;
      const rightActive = Object.values(originalActive).includes(right.id) ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      const leftOpen = TERMINAL_STATES.has(left.status) ? 0 : 1;
      const rightOpen = TERMINAL_STATES.has(right.status) ? 0 : 1;
      if (leftOpen !== rightOpen) return rightOpen - leftOpen;
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });
    const normalized = {};
    const idMap = new Map();
    const used = new Set();
    for (const [legacyId, task] of prioritized) {
      const legacyNumber = taskNumber(task.id || legacyId);
      let nextId = legacyNumber >= 1 && legacyNumber <= MAX_TASK_SEQUENCE
        ? canonicalTaskId(legacyNumber)
        : "";
      if (!nextId || used.has(nextId)) {
        nextId = Array.from({ length: MAX_TASK_SEQUENCE }, (_, index) => canonicalTaskId(index + 1))
          .find((candidate) => !used.has(candidate)) || "";
      }
      if (!nextId) continue;
      used.add(nextId);
      idMap.set(legacyId, nextId);
      if (task.id) idMap.set(task.id, nextId);
      task.id = nextId;
      task.uid ||= crypto.randomUUID();
      normalized[nextId] = task;
    }
    this.state.tasks = normalized;
    this.state.jobs = (this.state.jobs || []).flatMap((job) => {
      const taskId = idMap.get(job.taskId) || (normalized[job.taskId] ? job.taskId : "");
      return taskId ? [{ ...job, taskId }] : [];
    });
    this.state.activeBySender = Object.fromEntries(
      Object.entries(originalActive).flatMap(([senderId, legacyId]) => {
        const taskId = idMap.get(legacyId) || (normalized[legacyId] ? legacyId : "");
        return taskId ? [[senderId, taskId]] : [];
      }),
    );
  }

  persist() {
    writeJsonPrivate(this.statePath, this.state);
  }

  noteInboundContext(senderId, { contextToken = "", runId = "" } = {}) {
    if (!senderId || !contextToken) return;
    this.state.contextBySender[senderId] = {
      contextToken,
      runId,
      updatedAt: new Date().toISOString(),
    };
    this.persist();
  }

  deliveryContext(task, fallback = {}) {
    const latest = this.state.contextBySender[task.senderId] || {};
    return {
      contextToken: latest.contextToken || fallback.contextToken || task.lastContextToken || "",
      runId: latest.runId || fallback.runId || task.lastRunId || "",
      wantsFiles: task.delivery?.wantsFiles === true,
      slidesDeliveryPolicy: task.delivery?.slidesDeliveryPolicy
        || fallback.slidesDeliveryPolicy
        || "",
      slidesCorrectionAttempts: Number(
        task.delivery?.slidesCorrectionAttempts
        ?? fallback.slidesCorrectionAttempts
        ?? 0,
      ),
    };
  }

  async attemptDelivery(task, fallback = {}) {
    if (!task?.finalResponse || task.delivery?.status !== "pending") return false;
    const deliveryContext = this.deliveryContext(task, fallback);
    const awaitingSlidesInput = Boolean(deliveryContext.slidesDeliveryPolicy)
      && isSlidesInputRequest(task.finalResponse);
    const requiresSlidesQa = Boolean(deliveryContext.slidesDeliveryPolicy) && !awaitingSlidesInput;
    if (awaitingSlidesInput) {
      task.status = "waiting_user";
      task.progress = "等待用户补充";
      task.completedAt = "";
      task.delivery.awaitingSlidesInput = true;
      task.delivery.slidesQaPassed = false;
    }
    if (requiresSlidesQa) {
      // Revalidate even on a manual resend: a prior pass cannot bless changed files.
      task.delivery.slidesQaPassed = false;
      task.status = "running";
      task.progress = "Slides 产物质量验收中";
      task.completedAt = "";
      task.updatedAt = new Date().toISOString();
      this.persist();
    }
    try {
      const outcome = await this.deliverTaskResult(task, task.finalResponse, deliveryContext);
      if (outcome?.status === "correcting" || outcome?.status === "quality_failed") {
        const correcting = outcome.status === "correcting";
        task.delivery.status = outcome.status;
        task.delivery.error = cleanText(outcome.error, 240);
        task.delivery.deliveredAt = "";
        task.status = correcting ? "queued" : "failed";
        task.progress = correcting ? "Slides 未通过质量门，正在自动修正" : "Slides 未通过质量门，未交付";
        task.lastError = correcting ? "" : task.delivery.error;
        task.completedAt = "";
        task.updatedAt = new Date().toISOString();
        this.persist();
        return false;
      }
      task.delivery.status = "delivered";
      task.delivery.deliveredAt = new Date().toISOString();
      task.delivery.error = "";
      if (requiresSlidesQa) {
        task.status = "completed";
        task.completedAt = new Date().toISOString();
      }
      task.progress = task.status === "waiting_user" ? "等待用户补充" : "已完成";
      task.updatedAt = new Date().toISOString();
      this.pruneTasks(task.senderId);
      this.persist();
      return true;
    } catch (error) {
      if (requiresSlidesQa && task.delivery.slidesQaPassed !== true) {
        task.delivery.status = "quality_failed";
        task.delivery.error = `Slides 验收异常：${cleanText(error?.message ?? error, 220)}`;
        task.delivery.deliveredAt = "";
        task.status = "failed";
        task.progress = "Slides 验收异常，未交付";
        task.lastError = task.delivery.error;
        task.completedAt = "";
        task.updatedAt = new Date().toISOString();
        this.persist();
        this.log(`任务 ${task.id} ${task.delivery.error}`);
        return false;
      }
      task.delivery.status = "pending";
      task.delivery.error = cleanText(error?.message ?? error, 240);
      if (requiresSlidesQa) {
        task.status = "completed";
        task.completedAt = new Date().toISOString();
      }
      task.progress = awaitingSlidesInput
        ? "等待用户补充，问题将在下一条微信消息后自动发送"
        : "已完成，等待下一条微信消息后自动发送";
      task.updatedAt = new Date().toISOString();
      this.persist();
      this.log(`任务 ${task.id} 结果已保存，微信发送暂缓：${task.delivery.error}`);
      return false;
    }
  }

  async flushPendingDeliveries(senderId, preferredTaskId = "", limit = 1, { preferredOnly = false } = {}) {
    const pending = Object.values(this.state.tasks)
      .filter((task) => task.senderId === senderId
        && task.finalResponse
        && task.delivery?.status === "pending"
        && (!preferredOnly || task.id === preferredTaskId))
      .sort((left, right) => {
        if (left.id === preferredTaskId) return -1;
        if (right.id === preferredTaskId) return 1;
        return String(right.updatedAt).localeCompare(String(left.updatedAt));
      });
    const delivered = [];
    for (const task of pending.slice(0, Math.max(0, limit))) {
      if (!await this.attemptDelivery(task)) break;
      delivered.push(task.id);
    }
    return delivered;
  }

  async redeliver(task, { wantsFiles = true } = {}) {
    if (!task?.finalResponse) return false;
    const slidesDeliveryPolicy = task.delivery?.slidesDeliveryPolicy || "";
    const slidesCorrectionAttempts = Number(task.delivery?.slidesCorrectionAttempts || 0);
    task.delivery = {
      status: "pending",
      wantsFiles: wantsFiles || task.delivery?.wantsFiles === true,
      slidesDeliveryPolicy,
      slidesCorrectionAttempts,
      textSent: false,
      textChunks: {},
      files: {},
      createdAt: new Date().toISOString(),
      deliveredAt: "",
      error: "",
    };
    this.persist();
    return this.attemptDelivery(task);
  }

  task(taskId) {
    return this.state.tasks[taskId] || null;
  }

  resolveTask({ senderId, text, quotedText }) {
    const directReference = taskReferenceToken(text);
    if (directReference) {
      const referencedTask = this.task(directReference);
      if (!referencedTask || referencedTask.senderId !== senderId) {
        return {
          task: null,
          isNew: false,
          routingReason: "missing_reference",
          missingTaskId: directReference,
        };
      }
      return { task: referencedTask, isNew: false, routingReason: "explicit_reference" };
    }
    const bodyStartsNewTask = looksLikeNewTask(text);
    const quotedReference = taskReferenceToken(quotedText);
    if (quotedReference && !bodyStartsNewTask) {
      const referencedTask = this.task(quotedReference);
      if (!referencedTask || referencedTask.senderId !== senderId) {
        return {
          task: null,
          isNew: false,
          routingReason: "missing_quoted_reference",
          missingTaskId: quotedReference,
        };
      }
      return { task: referencedTask, isNew: false, routingReason: "quoted_reference" };
    }
    const quotedTask = !bodyStartsNewTask ? this.taskFromQuotedText(senderId, quotedText) : null;
    if (quotedTask) {
      return { task: quotedTask, isNew: false, routingReason: "quoted_message" };
    }
    const activeId = this.state.activeBySender[senderId];
    const activeTask = activeId ? this.task(activeId) : null;
    if (activeTask && isContextualSlidesRevision(text, activeTask.delivery?.slidesDeliveryPolicy)) {
      return { task: activeTask, isNew: false, routingReason: "active_slides_revision" };
    }
    const waitingTasks = Object.values(this.state.tasks).filter(
      (task) => task.senderId === senderId && task.status === "waiting_user",
    );
    const waitingReply = likelyWaitingReply(text);
    if (waitingTasks.length > 1 && waitingReply) {
      return {
        task: null,
        isNew: false,
        routingReason: "ambiguous_waiting_reply",
        ambiguousTasks: waitingTasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      };
    }
    if (waitingTasks.length === 1 && waitingReply) {
      return { task: waitingTasks[0], isNew: false, routingReason: "waiting_reply" };
    }
    if (shouldContinueActiveTask(text, activeTask)) {
      return {
        task: activeTask,
        isNew: false,
        routingReason: isResultOnlyRequest(text) ? "active_existing_result" : "active_follow_up",
      };
    }
    return { task: this.createTask(senderId, text), isNew: true, routingReason: "new_task" };
  }

  taskFromQuotedText(senderId, quotedText) {
    const source = cleanText(quotedText, 1_000);
    if (!source) return null;
    const fragments = [source, ...source.split(/\s+\|\s+/)].filter(Boolean);
    const matches = Object.values(this.state.tasks).filter((task) => {
      if (task.senderId !== senderId || !task.title) return false;
      return fragments.some((fragment) => {
        const compacted = compactTaskTitle(fragment, "");
        if (compacted === task.title) return true;
        return task.title.endsWith("…") && fragment.startsWith(task.title.slice(0, -1));
      });
    });
    return matches.length === 1 ? matches[0] : null;
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
      uid: crypto.randomUUID(),
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
      finalResponse: "",
      delivery: null,
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
      .filter((task) => task.senderId === senderId
        && TERMINAL_STATES.has(task.status)
        && task.delivery?.status !== "pending")
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const task of owned.slice(MAX_TERMINAL_TASKS_PER_SENDER)) {
      delete this.state.tasks[task.id];
      if (this.state.activeBySender[senderId] === task.id) delete this.state.activeBySender[senderId];
    }
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
      slidesDeliveryPolicy: String(input.slidesDeliveryPolicy || ""),
      slidesCorrectionAttempts: Number(input.slidesCorrectionAttempts || 0),
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
      await this.sendTaskText(task, text, this.deliveryContext(task, job));
      return true;
    } catch (error) {
      this.log(`任务 ${task.id} 状态消息发送失败：${error?.message ?? error}`);
      return false;
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

    let finalResponse = "";
    let transportRetries = 0;
    let progressNoticeIndex = 0;
    const tools = new Set();
    let jobTokenUsage = { ...EMPTY_TOKEN_USAGE };
    let usageSamples = 0;
    let completedTurnObserved = false;
    let jobUsageComplete = false;
    let usageCommitted = false;
    const priorTaskUsageComplete = typeof task.tokenUsageComplete === "boolean"
      ? task.tokenUsageComplete
      : task.turns <= 1 && !task.threadId;
    const commitTokenUsage = () => {
      if (usageCommitted) return;
      task.tokenUsage = addTokenUsage(task.tokenUsage, jobTokenUsage);
      task.tokenUsageSamples = tokenCount(task.tokenUsageSamples) + usageSamples;
      task.tokenUsageScope = "completed_turns";
      task.tokenUsageComplete = priorTaskUsageComplete && jobUsageComplete;
      usageCommitted = true;
    };
    const heartbeat = setInterval(() => {
      const nextDelay = this.progressNotificationDelaysMs[progressNoticeIndex];
      if (nextDelay === undefined || Date.now() - startedAt < nextDelay) return;
      progressNoticeIndex += 1;
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
      void this.safeSend(task, `【${task.id}】仍在处理：${task.progress}（已运行约${elapsed}分钟）`, job);
    }, this.progressPollIntervalMs);

    try {
      const options = this.threadOptionsFor(task);
      while (true) {
        let attemptProducedResult = false;
        let attemptStartedWork = false;
        let attemptCompleted = false;
        let recoverableStreamError = null;
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
            }
            if (event.type === "turn.failed") throw new Error(event.error?.message || "Codex任务失败");
            if (event.type === "turn.completed") {
              attemptCompleted = true;
              completedTurnObserved = true;
              const usage = normalizeTokenUsage(
                event.usage ?? event.response?.usage ?? event.result?.usage,
              );
              if (usage) {
                jobTokenUsage = addTokenUsage(jobTokenUsage, usage);
                usageSamples += 1;
              }
              continue;
            }
            if (event.type === "error") {
              const streamError = new Error(event.message || "Codex事件流中断");
              if (!isTransientTransportError(streamError)) throw streamError;
              recoverableStreamError = streamError;
              task.progress = "Codex连接短暂波动，正在恢复";
              task.updatedAt = new Date().toISOString();
              this.persist();
            }
          }
          if (!attemptCompleted && !attemptProducedResult && recoverableStreamError) throw recoverableStreamError;
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
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          if (controller.signal.aborted) throw new Error("任务已取消");
        }
      }
      if (controller.signal.aborted) throw new Error("任务已取消");
      jobUsageComplete = completedTurnObserved && usageSamples > 0;
      commitTokenUsage();
      if (!finalResponse) finalResponse = "Codex已完成处理，但没有返回文字结果。";
      const awaitingSlidesInput = Boolean(job.slidesDeliveryPolicy) && isSlidesInputRequest(finalResponse);
      task.status = awaitingSlidesInput ? "waiting_user" : job.slidesDeliveryPolicy ? "running" : responseWaitsForUser(finalResponse) ? "waiting_user" : "completed";
      task.progress = task.status === "waiting_user" ? "等待用户补充" : job.slidesDeliveryPolicy ? "Slides 产物质量验收中" : "已完成";
      task.lastError = "";
      task.finalResponse = finalResponse;
      task.completedAt = job.slidesDeliveryPolicy ? "" : new Date().toISOString();
      task.delivery = {
        status: "pending",
        wantsFiles: job.wantsFiles === true,
        slidesDeliveryPolicy: job.slidesDeliveryPolicy || "",
        slidesCorrectionAttempts: Number(job.slidesCorrectionAttempts || 0),
        awaitingSlidesInput,
        textSent: false,
        textChunks: {},
        files: {},
        createdAt: new Date().toISOString(),
        deliveredAt: "",
        error: "",
      };
      task.updatedAt = new Date().toISOString();
      this.persist();
      const delivered = await this.attemptDelivery(task, job);
      this.pruneTasks(task.senderId);
      this.persist();
      this.recordMetric(
        task,
        job,
        startedAt,
        delivered ? task.status === "waiting_user" ? "waiting_user" : "completed"
          : task.delivery?.status === "correcting" ? "slides_correction_queued"
            : task.delivery?.status === "quality_failed" ? "slides_quality_failed"
              : task.status === "waiting_user" ? "waiting_user_pending_delivery" : "completed_pending_delivery",
        tools,
        jobTokenUsage,
        usageSamples,
        jobUsageComplete,
      );
    } catch (error) {
      commitTokenUsage();
      const canceled = controller.signal.aborted || task.status === "canceled";
      const transientFailure = !canceled && isTransientTransportError(error);
      task.status = canceled ? "canceled" : "failed";
      task.progress = canceled ? "已取消" : "执行失败";
      task.lastError = transientFailure
        ? `网络连接暂时不可用${transportRetries ? `，已自动重试${transportRetries}次` : ""}。任务内容和上下文已保留，请回复“${task.id} 重试”继续。`
        : cleanText(error?.message ?? error, 240);
      task.updatedAt = new Date().toISOString();
      this.pruneTasks(task.senderId);
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
      this.recordMetric(
        task,
        job,
        startedAt,
        canceled ? "canceled" : "failed",
        tools,
        jobTokenUsage,
        usageSamples,
        jobUsageComplete,
      );
    } finally {
      clearInterval(heartbeat);
      this.activeControllers.delete(task.id);
    }
  }

  recordMetric(
    task,
    job,
    startedAt,
    status,
    tools,
    tokenUsage = EMPTY_TOKEN_USAGE,
    usageSamples = 0,
    usageComplete = false,
  ) {
    appendJsonLinePrivate(this.metricsPath, {
      taskId: task.id,
      taskUid: task.uid,
      timestamp: new Date().toISOString(),
      status,
      durationMs: Date.now() - startedAt,
      model: task.preference?.model || "",
      reasoningEffort: task.preference?.reasoningEffort || "",
      attachmentCount: job.attachments?.length || 0,
      toolKinds: [...tools].sort(),
      turn: task.turns,
      usageAvailable: usageSamples > 0,
      usageSamples,
      tokenUsage: addTokenUsage(EMPTY_TOKEN_USAGE, tokenUsage),
      usageScope: "completed_turns",
      usageComplete: Boolean(usageComplete),
      taskTokenUsage: addTokenUsage(EMPTY_TOKEN_USAGE, task.tokenUsage),
      taskUsageSamples: tokenCount(task.tokenUsageSamples),
      taskUsageScope: task.tokenUsageScope || "completed_turns",
      taskUsageComplete: task.tokenUsageComplete === true,
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
    this.pruneTasks(senderId);
    this.persist();
    return { ok: true, task };
  }

  failPreparation(task, error) {
    task.status = "failed";
    task.progress = "附件准备失败";
    task.lastError = cleanText(error?.message ?? error, 240);
    task.updatedAt = new Date().toISOString();
    this.pruneTasks(task.senderId);
    this.persist();
  }

  recentTasks(senderId, limit = DEFAULT_RECENT_TASK_LIMIT) {
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
      const delivery = task.delivery?.status === "pending" ? " · 结果待发送" : "";
      return `【${task.id}】${STATUS_LABELS[task.status] || task.status}${pending}${delivery}\n  ${task.title}\n  ${task.progress}${error}`;
    }).join("\n\n");
  }

  referenceFromText(text) {
    return findTaskReference(text, this.state.tasks);
  }

  taskLabel(task) {
    return `${taskNumber(task.id)}号任务`;
  }
}
