import fs from "node:fs";
import path from "node:path";

const TASK_REFERENCE_PATTERNS = [
  /(?:^|\s|【|\[|#)W0*(\d{1,6})(?:\b|】|\])/i,
  /(?:回到|继续|切换到|反馈|补充)?\s*第?\s*(\d{1,6})\s*号任务/i,
  /任务\s*#?\s*(\d{1,6})/i,
];

const FOLLOW_UP_PATTERN = /^(?:继续|补充|更正|修改|修正|反馈|参会人|背景|对|是的|不是|好的|可以|不对|刚才|这个|那个|另外|还有|再补充|请把|把它|其中)/;
const NEW_TASK_PATTERN = /^(?:请)?(?:帮我|替我)?(?:研究|分析|整理|查看|查询|查一下|搜索|创建|新建|生成|写|做|安排|发送|同步|总结|评估|比较|对比)/;
const WAITING_PATTERN = /(?:请补充|请确认|需要你|等待你|告诉我|回复.+(?:继续|确认)|是否要|你希望|请提供|\?|？)\s*$/;
const FILE_REQUEST_PATTERN = /(?:发|发送|给我|附件|文件|下载|完整纪要|源文件|报告|memo|pdf|markdown|md\b)/i;

export function canonicalTaskId(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 999999) return "";
  return `W${String(number).padStart(3, "0")}`;
}

export function taskNumber(taskId) {
  return Number(String(taskId || "").replace(/^W/i, "")) || 0;
}

export function findTaskReference(text, tasks = {}) {
  const normalized = String(text || "");
  for (const pattern of TASK_REFERENCE_PATTERNS) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const taskId = canonicalTaskId(match[1]);
    if (taskId && tasks[taskId]) return taskId;
  }
  return "";
}

export function shouldContinueActiveTask(text, activeTask) {
  if (!activeTask) return false;
  if (activeTask.status === "waiting_user") return likelyWaitingReply(text);
  return looksLikeFollowUp(text);
}

export function looksLikeFollowUp(text) {
  return FOLLOW_UP_PATTERN.test(String(text || "").trim());
}

export function likelyWaitingReply(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return true;
  return looksLikeFollowUp(normalized) || !NEW_TASK_PATTERN.test(normalized);
}

export function responseWaitsForUser(text) {
  return WAITING_PATTERN.test(String(text || "").trim());
}

export function compactTaskTitle(text, fallback = "微信任务") {
  const firstLine = String(text || "").replace(/\s+/g, " ").trim();
  if (!firstLine) return fallback;
  return firstLine.length > 34 ? `${firstLine.slice(0, 34)}…` : firstLine;
}

export function splitText(text, limit = 5200) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];
  if (normalized.length <= limit) return [normalized];
  const chunks = [];
  let rest = normalized;
  while (rest.length > limit) {
    let splitAt = rest.lastIndexOf("\n", limit);
    if (splitAt < Math.floor(limit * 0.55)) splitAt = rest.lastIndexOf("。", limit) + 1;
    if (splitAt < Math.floor(limit * 0.55)) splitAt = limit;
    chunks.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function normalizeLinkedPath(rawPath) {
  let value = String(rawPath || "").trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if (value.startsWith("file://")) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      return "";
    }
  }
  return path.isAbsolute(value) ? path.normalize(value) : "";
}

export function extractLocalAttachments(text, maximum = 3) {
  const source = String(text || "");
  const found = [];
  const seen = new Set();
  const add = (rawPath, label, fullMatch) => {
    if (found.length >= maximum) return;
    const filePath = normalizeLinkedPath(rawPath);
    if (!filePath || seen.has(filePath)) return;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 100 * 1024 * 1024) return;
    } catch {
      return;
    }
    seen.add(filePath);
    found.push({ filePath, label: label || path.basename(filePath), fullMatch });
  };

  const markdownLink = /\[([^\]]+)\]\(\s*(<?(?:file:\/\/)?\/[^)\n]+>?)\s*\)/g;
  for (const match of source.matchAll(markdownLink)) add(match[2], match[1], match[0]);

  const codePath = /`((?:file:\/\/)?\/[^`\n]+\.(?:md|markdown|pdf|docx?|xlsx?|pptx?|txt|csv|zip))`/gi;
  for (const match of source.matchAll(codePath)) add(match[1], path.basename(match[1]), match[0]);
  return found;
}

export function replaceLocalAttachmentLinks(text, attachments) {
  let result = String(text || "");
  for (const attachment of attachments) {
    result = result.replace(attachment.fullMatch, `附件：${path.basename(attachment.filePath)}`);
  }
  return result;
}

export function wantsFileDelivery(text) {
  return FILE_REQUEST_PATTERN.test(String(text || ""));
}

export function describeProgressItem(item) {
  if (!item || typeof item !== "object") return "";
  if (item.type === "web_search") return "正在检索和核验资料";
  if (item.type === "mcp_tool_call") return "正在读取或更新连接的数据";
  if (item.type === "command_execution") return "正在执行本机工作流";
  if (item.type === "file_change") return "正在整理并保存结果";
  if (item.type === "todo_list") {
    const completed = item.items?.filter((entry) => entry.completed).length || 0;
    const total = item.items?.length || 0;
    return total ? `正在推进任务步骤 ${completed}/${total}` : "正在规划处理步骤";
  }
  return "";
}

export function messageIdentity(message) {
  return String(
    message?.message_id
      || message?.client_id
      || message?.run_id
      || `${message?.from_user_id || "unknown"}:${message?.create_time_ms || 0}`,
  );
}
