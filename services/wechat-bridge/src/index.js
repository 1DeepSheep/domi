import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { Codex } from "@openai/codex-sdk";

import { extractInbound, getUpdates, sendText } from "./common.js";
import { codexInputFor, downloadInboundMedia, sendLocalAttachment } from "./media.js";
import {
  extractLocalAttachments,
  messageIdentity,
  replaceLocalAttachmentLinks,
  wantsFileDelivery,
} from "./protocol.js";
import {
  CREDENTIALS_PATH,
  METRICS_PATH,
  PREFERENCES_PATH,
  SEEN_PATH,
  SESSIONS_PATH,
  STATE_DIR,
  SYNC_PATH,
  TASKS_PATH,
  migrateLegacyState,
  pruneDirectory,
  readJson,
  writeJsonPrivate,
} from "./state.js";
import { TaskManager } from "./task-manager.js";

migrateLegacyState();
pruneDirectory(path.join(STATE_DIR, "inbound"), 7 * 24 * 60 * 60_000);

const credentials = readJson(CREDENTIALS_PATH, null);
if (!credentials?.token || !credentials?.accountId) {
  console.error("尚未绑定微信。请先运行：npm run wechat:login");
  process.exit(1);
}

const fullAccess = process.env.CODEX_WECHAT_FULL_ACCESS !== "0";
const agentWorkspace = path.resolve(
  process.env.CODEX_WECHAT_WORKDIR || path.join(os.homedir(), "Documents", "Codex"),
);
if (fullAccess && !credentials.ownerUserId) {
  console.error("拒绝启动全权限模式：微信凭证缺少绑定用户标识。");
  process.exit(1);
}
fs.mkdirSync(agentWorkspace, { recursive: true });

const DEFAULT_PREFERENCE = { model: "gpt-5.6-sol", reasoningEffort: "xhigh" };
const MODEL_CHOICES = {
  sol: { model: "gpt-5.6-sol", defaultEffort: "high", label: "Sol（最高能力）" },
  terra: { model: "gpt-5.6-terra", defaultEffort: "medium", label: "Terra（均衡）" },
  luna: { model: "gpt-5.6-luna", defaultEffort: "low", label: "Luna（快速）" },
};
const MODEL_ALIASES = new Map([
  ["sol", "sol"], ["gpt-5.6-sol", "sol"], ["智能", "sol"],
  ["terra", "terra"], ["gpt-5.6-terra", "terra"], ["均衡", "terra"],
  ["luna", "luna"], ["gpt-5.6-luna", "luna"], ["快速", "luna"],
]);
const EFFORT_ALIASES = new Map([
  ["minimal", "minimal"], ["最低", "minimal"],
  ["low", "low"], ["低", "low"],
  ["medium", "medium"], ["中", "medium"],
  ["high", "high"], ["高", "high"],
  ["xhigh", "xhigh"], ["超高", "xhigh"],
]);

const preferenceState = readJson(PREFERENCES_PATH, { bySender: {} });
const seenState = readJson(SEEN_PATH, { ids: [] });
const seenIds = new Set(seenState.ids || []);
let cursor = readJson(SYNC_PATH, { cursor: "" }).cursor ?? "";
let stopping = false;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function preferenceFor(senderId) {
  return preferenceState.bySender[senderId] ?? DEFAULT_PREFERENCE;
}

function formatPreference(preference) {
  const choice = Object.values(MODEL_CHOICES).find((entry) => entry.model === preference.model);
  return `${choice?.label ?? preference.model} / 推理 ${preference.reasoningEffort}`;
}

function parseModelCommand(text) {
  const match = text.match(/^\/(?:model|模型)(?:\s+(.*))?$/i);
  if (!match) return null;
  const args = match[1]?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!args.length) return { action: "show" };
  if (["reset", "default", "重置", "默认"].includes(args[0].toLowerCase())) {
    return args.length === 1 ? { action: "set", preference: DEFAULT_PREFERENCE } : { action: "error" };
  }
  const key = MODEL_ALIASES.get(args[0].toLowerCase());
  if (!key || args.length > 2) return { action: "error" };
  const choice = MODEL_CHOICES[key];
  const effort = args[1] ? EFFORT_ALIASES.get(args[1].toLowerCase()) : choice.defaultEffort;
  return effort
    ? { action: "set", preference: { model: choice.model, reasoningEffort: effort } }
    : { action: "error" };
}

function modelHelp() {
  return [
    "/model luna low  快速",
    "/model terra medium  均衡",
    "/model sol high  最高能力",
    "/model reset  恢复默认",
  ].join("\n");
}

async function replyMessage(message, text) {
  await sendText({
    credentials,
    toUserId: message.from_user_id,
    contextToken: message.context_token,
    runId: message.run_id,
    text,
  });
}

const codex = new Codex();
const taskManager = new TaskManager({
  codex,
  statePath: TASKS_PATH,
  metricsPath: METRICS_PATH,
  preferenceFor,
  log,
  threadOptionsFor: (task) => ({
    model: task.preference?.model || DEFAULT_PREFERENCE.model,
    modelReasoningEffort: task.preference?.reasoningEffort || DEFAULT_PREFERENCE.reasoningEffort,
    workingDirectory: agentWorkspace,
    skipGitRepoCheck: true,
    sandboxMode: fullAccess ? "danger-full-access" : "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: fullAccess,
  }),
  sendTaskText: async (task, text, job) => {
    await sendText({
      credentials,
      toUserId: task.senderId,
      contextToken: job.contextToken || task.lastContextToken,
      runId: job.runId || task.lastRunId,
      text,
    });
  },
  deliverTaskResult: async (task, response, job) => {
    const attachments = extractLocalAttachments(response);
    const shouldSendFiles = job.wantsFiles && attachments.length > 0;
    let visibleResponse = response;
    if (attachments.length) {
      visibleResponse = shouldSendFiles
        ? replaceLocalAttachmentLinks(response, attachments)
        : attachments.reduce(
            (text, attachment) => text.replace(
              attachment.fullMatch,
              `本机文件：${path.basename(attachment.filePath)}（需要时可让我发送附件）`,
            ),
            response,
          );
    }
    await sendText({
      credentials,
      toUserId: task.senderId,
      contextToken: job.contextToken || task.lastContextToken,
      runId: job.runId || task.lastRunId,
      text: `【${task.id}】${visibleResponse}`,
    });
    if (!shouldSendFiles) return;
    for (const attachment of attachments) {
      try {
        await sendLocalAttachment({
          credentials,
          toUserId: task.senderId,
          contextToken: job.contextToken || task.lastContextToken,
          runId: job.runId || task.lastRunId,
          filePath: attachment.filePath,
        });
      } catch (error) {
        await sendText({
          credentials,
          toUserId: task.senderId,
          contextToken: job.contextToken || task.lastContextToken,
          runId: job.runId || task.lastRunId,
          text: `【${task.id}】附件“${path.basename(attachment.filePath)}”发送失败：${error?.message ?? error}`,
        });
      }
    }
  },
});
const legacySessions = readJson(SESSIONS_PATH, { threads: {} });
for (const [senderId, threadId] of Object.entries(legacySessions.threads || {})) {
  taskManager.adoptLegacyThread(senderId, threadId);
}

function rememberMessage(message) {
  const identity = messageIdentity(message);
  if (seenIds.has(identity)) return false;
  seenIds.add(identity);
  while (seenIds.size > 500) seenIds.delete(seenIds.values().next().value);
  writeJsonPrivate(SEEN_PATH, { ids: [...seenIds] });
  return true;
}

async function handleBuiltIn(message, text) {
  const senderId = message.from_user_id;
  if (text === "/help") {
    await replyMessage(message, [
      "直接发送任务、截图或文件即可。每项任务会获得独立编号。",
      "/status 查看桥接和最近任务",
      "/tasks 查看最近任务",
      "/cancel W001 取消任务",
      "/new 让下一条消息创建新任务",
      "/model 查看或切换模型",
    ].join("\n"));
    return true;
  }
  if (text === "/new") {
    taskManager.focus(senderId, "");
    await replyMessage(message, "已清除当前任务焦点。下一条消息会创建独立任务。");
    return true;
  }
  if (text === "/tasks") {
    await replyMessage(message, taskManager.statusText(senderId));
    return true;
  }
  const statusMatch = text.match(/^\/(?:status|状态)(?:\s+(.+))?$/i);
  if (statusMatch) {
    const taskId = statusMatch[1] ? taskManager.referenceFromText(statusMatch[1]) : "";
    const tasks = taskManager.statusText(senderId, taskId);
    await replyMessage(
      message,
      `微信桥接在线\n模型：${formatPreference(preferenceFor(senderId))}\n权限：${fullAccess ? "全权限" : "受限"}\n\n${tasks}`,
    );
    return true;
  }
  const cancelMatch = text.match(/^\/(?:cancel|取消)\s+(.+)$/i);
  if (cancelMatch) {
    const taskId = taskManager.referenceFromText(cancelMatch[1]);
    const result = taskManager.cancel(senderId, taskId);
    await replyMessage(message, result.ok ? `【${taskId}】已请求取消。` : result.error);
    return true;
  }
  const modelCommand = parseModelCommand(text);
  if (modelCommand) {
    if (modelCommand.action === "show") {
      await replyMessage(message, `当前：${formatPreference(preferenceFor(senderId))}\n\n${modelHelp()}`);
      return true;
    }
    if (modelCommand.action === "error") {
      await replyMessage(message, `指令格式不正确。\n\n${modelHelp()}`);
      return true;
    }
    preferenceState.bySender[senderId] = modelCommand.preference;
    writeJsonPrivate(PREFERENCES_PATH, preferenceState);
    taskManager.focus(senderId, "");
    await replyMessage(message, `已切换为${formatPreference(modelCommand.preference)}。新任务开始生效。`);
    return true;
  }
  return false;
}

async function prepareTask(message, task, inbound) {
  try {
    const attachments = [];
    for (const item of inbound.mediaItems) {
      const attachment = await downloadInboundMedia(item, { credentials, taskId: task.id });
      if (attachment) attachments.push(attachment);
    }
    const inputText = inbound.text || (attachments.length ? "请处理我发送的附件。" : "");
    taskManager.enqueue(task, {
      text: inputText,
      attachments,
      codexInput: codexInputFor({ text: inputText, attachments }),
      contextToken: message.context_token,
      runId: message.run_id,
      wantsFiles: wantsFileDelivery(inputText),
    });
  } catch (error) {
    taskManager.failPreparation(task, error);
    await replyMessage(message, `【${task.id}】附件接收失败：${error?.message ?? error}`);
  }
}

async function handleMessage(message) {
  const senderId = message.from_user_id;
  if (!senderId || !rememberMessage(message)) return;
  if (credentials.ownerUserId && senderId !== credentials.ownerUserId) {
    log("忽略非绑定账号消息。");
    return;
  }
  const inbound = extractInbound(message);
  if (!inbound.text && !inbound.mediaItems.length) return;
  log(`收到微信消息 id=${messageIdentity(message)} media=${inbound.mediaItems.length}`);
  if (inbound.text && await handleBuiltIn(message, inbound.text)) return;

  const { task, isNew, ambiguousTasks } = taskManager.resolveTask({
    senderId,
    text: inbound.text,
    quotedText: inbound.quotedText,
  });
  if (ambiguousTasks?.length) {
    await replyMessage(
      message,
      `这条补充属于哪个任务？请在消息前加任务编号：\n${ambiguousTasks.slice(0, 5).map((entry) => `【${entry.id}】${entry.title}`).join("\n")}`,
    );
    return;
  }
  await replyMessage(
    message,
    isNew
      ? `已收到，任务【${task.id}】开始处理：${task.title}`
      : `已收到，补充内容已加入任务【${task.id}】：${task.title}`,
  );
  void prepareTask(message, task, inbound);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    log(`收到${signal}，正在停止…`);
  });
}

log(`微信桥接已启动。权限=${fullAccess ? "全权限" : "受限"} 并发任务=2`);
while (!stopping) {
  try {
    const response = await getUpdates({
      baseUrl: credentials.baseUrl,
      token: credentials.token,
      cursor,
    });
    if (response.ret && response.ret !== 0) {
      throw new Error(`getupdates ret=${response.ret}: ${response.errmsg ?? "unknown error"}`);
    }
    for (const message of response.msgs ?? []) await handleMessage(message);
    if (typeof response.get_updates_buf === "string") {
      cursor = response.get_updates_buf;
      writeJsonPrivate(SYNC_PATH, { cursor });
    }
  } catch (error) {
    log(`收取微信消息失败：${error?.message ?? error}；5秒后重试。`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
log("微信桥接已停止。");
