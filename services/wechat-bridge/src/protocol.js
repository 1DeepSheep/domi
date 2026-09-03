import fs from "node:fs";
import path from "node:path";
import { isContextualSlidesRevision } from "./slides-request-policy.js";

const TASK_REFERENCE_PATTERNS = [
  /(?:^|\s|【|\[|#)W0*(\d{1,6})(?:\b|】|\])/i,
  /(?:回到|继续|切换到|反馈|补充)?\s*第?\s*(\d{1,6})\s*号任务/i,
  /任务\s*#?\s*(\d{1,6})/i,
];

const FOLLOW_UP_PATTERN = /^(?:继续|补充|更正|修改|修正|反馈|参会人|背景|是的|不是|好的|可以|不对|刚才|这个|那个|另外|还有|再补充|它|其中)/;
const AFFIRMATIVE_FOLLOW_UP_PATTERN = /^(?:对|对的|是的|不是|好的|可以|不对)[。！!？?]*$/;
const CONTEXTUAL_FOLLOW_UP_PATTERN = /^对(?:这|那|该|当前|本|上述|上面|刚才|之前|其|风险|估值|团队|融资|竞争|市场|产品|技术|收入|成本|客户|创始人|商业模式)/;
const NEW_TASK_PATTERN = /^(?:重新)?(?:研究|调研|分析|了解|整理|查看|看下|看一下|看一看|看看|查询|查下|查一下|查一查|查查|搜索|搜搜|搜一下|创建|新建|生成|写|做|安排|发送|同步|总结|评估|评级|评价|比较|对比|查找)/;
const EXPLICIT_NEW_TASK_MARKER_PATTERN = /^(?:新任务|另一个任务|再开一个任务|换个问题|换一个问题|另一个问题|换个公司|换家公司)(?:[：:,，\s]|$)/;
const WAITING_PATTERN = /(?:请补充|请确认|需要你|等待你|告诉我|回复.+(?:继续|确认)|是否要|你希望|请提供|\?|？)\s*$/;
const FILE_REQUEST_PATTERN = /(?:发|发送|给我|附件|文件|下载|完整纪要|源文件|报告|memo|pdf|html?|markdown|md\b|pptx?|powerpoint|slides?|deck|幻灯片|演示文稿)/i;
const EXISTING_RESULT_PATTERN = /(?:(?:只|仅)?(?:发送|发|给)(?:我)?[^。！？\n]{0,24}(?:已有)?(?:结果|纪要|报告|文件|附件|PDF|Markdown)|(?:结果|纪要|报告|文件|附件|PDF|Markdown)[^。！？\n]{0,24}(?:发我|给我|我看下|我看看|看下|看看|看一下|打开|下载))/i;
const RESULT_NOUN_PATTERN = /(?:研究)?(?:结果|纪要|报告|文件|附件|PDF|Markdown|MD\b)/i;
const RESULT_DELIVERY_PATTERN = /(?:发送|发(?:给)?我(?:下|一下)?|发(?:下|一下)|给我|我看(?:下|看|一下)?|看(?:下|看|一下)|打开|下载)/i;
const DELIVERY_BEFORE_RESULT_PATTERN = /^(?:只|仅)?(?:重新|再次|再)?(?:(?:发送|发)(?:给)?我(?:看下|看一下|看一看|看看|下|一下)?|给我(?:看下|看一下|看一看|看看)?|发送|发(?:下|一下)?|给)(?:一次|一遍|一下)?/;
const RESULT_TRANSFORM_PATTERN = /(?:修改|补充|分析|重新生成|翻译|评级|评估|评价|总结|改写|更新|润色|完善|重写|提炼)/;
const CONTEXTUAL_RESULT_PREFIX_PATTERN = /^(?:这(?:个(?:项目|公司|任务)?|家(?:公司)?|一?份)|那(?:个(?:项目|公司|任务)?|家(?:公司)?|一?份)|它|(?:刚才|刚刚|上面|上述|前面|之前)(?:的|那)?(?:一?份)?|当前(?:项目|公司|任务)?|现有|已有|本次|该(?:项目|公司|任务)?|本(?:项目|公司|任务)?|研究)$/;
const EXPLICIT_SUBJECT_ACTION_PATTERN = /^(?:对|为|给|用|根据)\s*(.+?)(?:进行|做(?:一?个|一下)?|再)?(?:研究|调研|分析|了解|整理|评级|评估|评价|比较|对比|判断|查询|查找|搜索|同步|总结|生成|撰写|制作|怎么看|看法|打(?:一?个)?分)/;
const CONTEXTUAL_SUBJECT_PATTERN = /^(?:这(?:个|家|项|份|些).*|那(?:个|家|项|份|些).*|该(?:项目|公司|任务|团队|融资|估值|风险|市场|产品|技术)(?:的.*)?|当前(?:项目|公司|任务|团队|融资|估值|风险|市场|产品|技术)(?:的.*)?|(?:上述|上面|刚才|之前)(?:的)?.*|其|其(?:的.*|项目|公司|任务|团队|融资|估值|风险|市场|产品|技术|商业模式).*|其中(?:的.*)?|本(?:项目|公司|任务)(?:的.*)?|它(?:的.*)?|继续|接着|再继续|项目|公司|任务|(?:风险|估值|团队|融资|竞争|市场|产品|技术|收入|成本|客户|创始人|商业模式)(?:情况|方面|部分|问题)?)$/;
const LEADING_ACTION_SUBJECT_PATTERN = /^(?:重新)?(?:研究|调研|分析|了解|整理|查看|看下|看一下|看一看|看看|查询|查下|查一下|查一查|查查|搜索|搜搜|搜一下|同步|总结|评估|评级|评价|比较|对比|查找)(?:一下|下)?\s*(.+)$/;
const BARE_FOLLOW_UP_ACTION_PATTERN = /^(?:继续|接着|再继续)?(?:研究|调研|分析|了解|整理|查看|看下|看一下|看一看|看看|查询|查下|查一下|查一查|查查|搜索|搜搜|搜一下|同步|总结|评估|评级|评价|比较|对比|查找)(?:一下|下)?(?:后)?(?:发(?:给)?我|给我)?[？?。！!]*$/;
const NAMED_ENTITY_QUESTION_PATTERN = /^(.{1,60}?)(?:(?:是否)?值得(?:投|投资|推进)(?:吗)?|能投吗|怎么样|怎么看)[？?。！!]*$/;
const BASED_ON_ACTION_TAIL_PATTERN = /(?:给|做|进行)?(?:一?个)?(?:评级|评估|评价|分析|判断)(?:一下)?(?:并.*)?[？?。！!]*$/;
const SUBJECT_POSTFIX_ACTION_PATTERN = /^(.{1,60}?)(?:做(?:一?个)?|进行)?(?:评级|评估|评价|分析|研究|判断)(?:一下)?[？?。！!]*$/;
const OTHER_ENTITY_PATTERN = /(?:另一家(?:公司)?|另外一家(?:公司)?|另一个(?:项目|公司)|其他(?:项目|公司)|一家新公司)/;
const ACTION_KEYWORD_PATTERN = /(?:研究|调研|分析|了解|整理|查看|看下|看一下|看一看|看看|查询|查下|查一下|查一查|查查|搜索|搜搜|搜一下|总结|评估|评级|评价|比较|对比|判断|打分)/;
const LEADING_RESULT_DELIVERY_PATTERN = /^(?:(?:重新|再次|再)?(?:(?:发送|发)(?:给)?我(?:看下|看一下|看一看|看看|下|一下)?|发(?:下|一下)|给我(?:看下|看一下|看一看|看看)?|我看(?:下|看|一下)?|看(?:下|看|一下)|打开|下载)(?:一次|一遍|一下)?)/;
const NEGATED_ACTION_PATTERN = /(?:不要|无需|不需要|不用|别)(?:(?:再|重新|继续)?(?:帮我)?(?:进行|做)?(?:任何)?\s*)?(?:研究|调研|分析|了解|整理|查看|查询|搜索|总结|评估|评级|评价|比较|对比|判断|打分|修改|补充|重新生成|翻译|改写|更新|润色|完善|重写|提炼)/g;
const INLINE_ACTION_BOUNDARY_PATTERN = /([^，,；;。])(?=(?:(?:接着|然后|再|另外|顺便|随后|之后|同时|并且|以及|并(?:再)?)(?:帮我)?(?:对|为|给|用|根据|研究|调研|分析|了解|整理|查看|查询|搜索|评估|评级|评价|总结)|(?:另一个任务|新任务|再开一个任务|换个问题|换一个问题|另一个问题|换个公司|换家公司)[：:\s]*(?:研究|调研|分析|了解|整理|查看|查询|搜索|评估|评级|评价|总结)))/g;
const INLINE_EXPLICIT_NEW_TASK_PATTERN = /(?:另一个任务|新任务|再开一个任务|换个问题|换一个问题|另一个问题|换个公司|换家公司)[：:\s]*(?:研究|调研|分析|了解|整理|查看|查询|搜索|评估|评级|评价|总结)/;
const RECENT_ELLIPTICAL_FOLLOW_UP_PATTERN = /^(?:那|那么|然后|接着|所以|为什么|怎么|能否|可否|可以再|还可以|有没有|再说|说下|展开|详细|具体)/;
const RECENT_FACET_FOLLOW_UP_PATTERN = /^(?:风险|团队|融资|估值|竞争|市场|产品|技术)(?:呢|吗|怎么样|怎么看|怎么处理)?[？?。！!]*$/;
const RECENT_FOCUS_GRACE_MS = 10 * 60_000;
const CODEX_FILE_CITATION_PATTERN = /:codex-file-citation\{((?:[^}"']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*)\}/g;
const DELIVERABLE_FILE_EXTENSION_PATTERN = /\.(?:md|markdown|html?|pdf|docx?|xlsx?|pptx?|txt|csv|zip)$/i;

function withoutLeadingTaskReference(text) {
  return String(text || "")
    .trim()
    .replace(/^(?:【|\[|#)?W0*\d{1,6}(?:】|\])?\s*/i, "")
    .replace(/^(?:回到|继续|切换到|反馈|补充)?\s*第?\s*\d{1,6}\s*号任务\s*/i, "")
    .replace(/^任务\s*#?\s*\d{1,6}\s*/i, "")
    .trim();
}

function normalizedCommandText(text) {
  let value = withoutLeadingTaskReference(text);
  for (let index = 0; index < 6; index += 1) {
    const previous = value;
    value = value.replace(/^(?:请问|我想(?:请你)?|想请你|想)\s*/, "").trim();
    value = value.replace(/^请(?:先|再)?\s*/, "").trim();
    value = value.replace(/^(?:帮我|替我)\s*/, "").trim();
    value = value.replace(/^(?:麻烦|烦请)(?:帮我|替我)?\s*/, "").trim();
    value = value.replace(/^(?:再次|再)\s*/, "").trim();
    value = value.replace(/^把\s*/, "").trim();
    if (value === previous) break;
  }
  return value;
}

function actionCommandText(text) {
  return normalizedCommandText(text)
    .replace(/^(?:另外|还有|然后|接着|随后|之后|同时|并且|以及|并(?:再)?|换个问题|换一个问题|另一个问题|换个公司|换家公司|进一步|深入|顺便)[，,：:\s]*/, "")
    .trim();
}

function actionClauses(text) {
  return normalizedCommandText(text)
    .replace(INLINE_ACTION_BOUNDARY_PATTERN, "$1，")
    .split(/[，,；;。]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function normalizedResultPrefix(prefix) {
  let value = String(prefix || "").replace(/\s+/g, "").replace(/^(?:只|仅)/, "");
  value = value.replace(DELIVERY_BEFORE_RESULT_PATTERN, "");
  value = value.replace(DELIVERY_BEFORE_RESULT_PATTERN, "");
  value = value.replace(/^(?:已有|现有)/, "");
  value = value.replace(/的$/, "");
  value = value.replace(/(?:最新版|最终版|最新|完整|会议|交流|访谈|研究)+$/g, "");
  value = value.replace(/的$/, "");
  value = value.replace(/^(刚才|刚刚|上面|上述|前面|之前)(?:生成|提到|提及)$/, "$1");
  return value;
}

function looksLikeNamedResultRequest(text) {
  const normalized = normalizedCommandText(text);
  if (normalized.startsWith("基于")) return false;
  const result = RESULT_NOUN_PATTERN.exec(normalized);
  if (!result) return false;
  const prefix = normalizedResultPrefix(normalized.slice(0, result.index));
  return Boolean(prefix) && !CONTEXTUAL_RESULT_PREFIX_PATTERN.test(prefix);
}

function looksLikeExplicitSubjectAction(text) {
  const normalized = actionCommandText(text);
  const match = EXPLICIT_SUBJECT_ACTION_PATTERN.exec(normalized);
  if (!match) return false;
  const subject = match[1].replace(/[\s，,。！？!?]+/g, "");
  return Boolean(subject) && !CONTEXTUAL_SUBJECT_PATTERN.test(subject);
}

function looksLikeContextualExplicitSubjectAction(text) {
  const match = EXPLICIT_SUBJECT_ACTION_PATTERN.exec(actionCommandText(text));
  if (!match) return false;
  const subject = match[1].replace(/[\s，,。！？!?]+/g, "");
  return Boolean(subject) && CONTEXTUAL_SUBJECT_PATTERN.test(subject);
}

function looksLikeContextualLeadingAction(text) {
  const match = LEADING_ACTION_SUBJECT_PATTERN.exec(actionCommandText(text));
  if (!match) return false;
  const subject = match[1].replace(/[\s，,。！？!?]+/g, "");
  return Boolean(subject) && CONTEXTUAL_SUBJECT_PATTERN.test(subject);
}

function looksLikeNamedEntityQuestion(text) {
  const normalized = actionCommandText(text);
  if (/^(?:对|为|给)/.test(normalized)) return false;
  const match = NAMED_ENTITY_QUESTION_PATTERN.exec(normalized);
  if (!match) return false;
  const subject = match[1].replace(/[\s，,。！？!?]+/g, "");
  return Boolean(subject) && !CONTEXTUAL_SUBJECT_PATTERN.test(subject);
}

function looksLikeContextualEntityQuestion(text) {
  const normalized = actionCommandText(text);
  if (/^(?:对|为|给)/.test(normalized)) return false;
  const match = NAMED_ENTITY_QUESTION_PATTERN.exec(normalized);
  if (!match) return false;
  const subject = match[1].replace(/[\s，,。！？!?]+/g, "");
  return Boolean(subject) && CONTEXTUAL_SUBJECT_PATTERN.test(subject);
}

function postfixActionSubject(text) {
  const normalized = actionCommandText(text);
  if (/^(?:对|为|给|基于)/.test(normalized)) return "";
  const match = SUBJECT_POSTFIX_ACTION_PATTERN.exec(normalized);
  return match ? match[1].replace(/[\s，,。！？!?]+/g, "") : "";
}

function looksLikeNamedPostfixAction(text) {
  const subject = postfixActionSubject(text);
  return Boolean(subject) && !CONTEXTUAL_SUBJECT_PATTERN.test(subject);
}

function looksLikeContextualPostfixAction(text) {
  const subject = postfixActionSubject(text);
  return Boolean(subject) && CONTEXTUAL_SUBJECT_PATTERN.test(subject);
}

function looksLikeBasedOnAction(text) {
  const normalized = actionCommandText(text);
  if (!normalized.startsWith("基于")) return false;
  const action = BASED_ON_ACTION_TAIL_PATTERN.exec(normalized);
  if (!action) return false;
  const subject = normalized
    .slice(2, action.index)
    .replace(/(?:的)?(?:研究结果|纪要|报告|材料|文件)\s*$/i, "")
    .replace(/[\s，,。！？!?]+/g, "");
  return Boolean(subject) && !CONTEXTUAL_SUBJECT_PATTERN.test(subject);
}

function clauseHasAction(text) {
  const affirmative = normalizedCommandText(text).replace(NEGATED_ACTION_PATTERN, "").trim();
  if (!affirmative) return false;
  const normalized = actionCommandText(affirmative);
  return EXPLICIT_NEW_TASK_MARKER_PATTERN.test(affirmative)
    || NEW_TASK_PATTERN.test(normalized)
    || EXPLICIT_SUBJECT_ACTION_PATTERN.test(normalized)
    || SUBJECT_POSTFIX_ACTION_PATTERN.test(normalized)
    || BASED_ON_ACTION_TAIL_PATTERN.test(normalized);
}

function hasAdditionalActionClause(text) {
  return actionClauses(text).slice(1).some(clauseHasAction);
}

function actionAfterResultClause(text) {
  const normalized = normalizedCommandText(text);
  const result = RESULT_NOUN_PATTERN.exec(normalized);
  if (!result) return "";
  const tail = normalized
    .slice(result.index + result[0].length)
    .replace(/^的/, "")
    .replace(LEADING_RESULT_DELIVERY_PATTERN, "")
    .replace(NEGATED_ACTION_PATTERN, "")
    .trim();
  return ACTION_KEYWORD_PATTERN.test(tail) ? tail : "";
}

function looksLikeContextualResultTransform(text) {
  const normalized = normalizedCommandText(text).replace(NEGATED_ACTION_PATTERN, "");
  if (!RESULT_TRANSFORM_PATTERN.test(normalized)) return false;
  const result = RESULT_NOUN_PATTERN.exec(normalized);
  if (!result) return false;
  const rawPrefix = normalized.slice(0, result.index);
  const contextualLead = /^(?:基于|用|根据)(.+)$/.exec(rawPrefix);
  if (contextualLead) {
    const subject = contextualLead[1].replace(/的$/, "").replace(/[\s，,。！？!?]+/g, "");
    return Boolean(subject) && CONTEXTUAL_SUBJECT_PATTERN.test(subject);
  }
  const prefix = normalizedResultPrefix(rawPrefix);
  return !prefix || CONTEXTUAL_RESULT_PREFIX_PATTERN.test(prefix);
}

function looksLikeNewIntentCore(text) {
  const normalized = normalizedCommandText(text).replace(NEGATED_ACTION_PATTERN, "").trim();
  const actionText = actionCommandText(normalized);
  if (!normalized
    || BARE_FOLLOW_UP_ACTION_PATTERN.test(actionText)
    || looksLikeContextualResultTransform(normalized)
    || looksLikeContextualLeadingAction(normalized)
    || looksLikeContextualExplicitSubjectAction(normalized)
    || looksLikeContextualPostfixAction(normalized)) return false;
  return EXPLICIT_NEW_TASK_MARKER_PATTERN.test(normalized)
    || (OTHER_ENTITY_PATTERN.test(normalized) && ACTION_KEYWORD_PATTERN.test(normalized))
    || NEW_TASK_PATTERN.test(actionText)
    || looksLikeExplicitSubjectAction(normalized)
    || looksLikeNamedResultRequest(normalized)
    || looksLikeNamedEntityQuestion(normalized)
    || looksLikeBasedOnAction(normalized)
    || looksLikeNamedPostfixAction(normalized);
}

export function canonicalTaskId(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 20) return "";
  return `W${String(number).padStart(2, "0")}`;
}

export function taskNumber(taskId) {
  return Number(String(taskId || "").replace(/^W/i, "")) || 0;
}

export function taskReferenceToken(text) {
  const normalized = String(text || "");
  for (const pattern of TASK_REFERENCE_PATTERNS) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const number = Number(match[1]);
    if (Number.isInteger(number) && number >= 0) return `W${String(number).padStart(2, "0")}`;
  }
  return "";
}

export function findTaskReference(text, tasks = {}) {
  const taskId = taskReferenceToken(text);
  return taskId && tasks[taskId] ? taskId : "";
}

export function shouldContinueActiveTask(text, activeTask, now = Date.now()) {
  if (!activeTask) return false;
  if (isContextualSlidesRevision(text, activeTask.delivery?.slidesDeliveryPolicy)) return true;
  const updatedAt = Date.parse(activeTask.updatedAt || "");
  const recentlyActive = Number.isFinite(updatedAt) && now - updatedAt <= RECENT_FOCUS_GRACE_MS;
  if (looksLikeNewTask(text)) return false;
  if (isResultOnlyRequest(text)) return recentlyActive;
  if (activeTask.status === "waiting_user") return likelyWaitingReply(text);
  if (looksLikeFollowUp(text)) return true;
  return recentlyActive
    && (RECENT_ELLIPTICAL_FOLLOW_UP_PATTERN.test(String(text || "").trim())
      || RECENT_FACET_FOLLOW_UP_PATTERN.test(String(text || "").trim()));
}

export function looksLikeFollowUp(text) {
  const normalized = normalizedCommandText(text);
  const resultAction = actionAfterResultClause(text);
  return FOLLOW_UP_PATTERN.test(normalized)
    || AFFIRMATIVE_FOLLOW_UP_PATTERN.test(normalized)
    || CONTEXTUAL_FOLLOW_UP_PATTERN.test(normalized)
    || BARE_FOLLOW_UP_ACTION_PATTERN.test(actionCommandText(text))
    || looksLikeContextualLeadingAction(text)
    || looksLikeContextualExplicitSubjectAction(text)
    || looksLikeContextualPostfixAction(text)
    || looksLikeContextualEntityQuestion(text)
    || looksLikeContextualResultTransform(text)
    || (Boolean(resultAction) && !looksLikeNewIntentCore(resultAction))
    || actionClauses(text).slice(1).some((clause) => (
      looksLikeContextualLeadingAction(clause)
      || looksLikeContextualExplicitSubjectAction(clause)
      || looksLikeContextualPostfixAction(clause)
    ));
}

export function looksLikeNewTask(text) {
  const normalized = normalizedCommandText(text);
  if (!normalized) return false;
  if (INLINE_EXPLICIT_NEW_TASK_PATTERN.test(normalized)) return true;
  const contextualResultTransform = looksLikeContextualResultTransform(text);
  const resultAction = actionAfterResultClause(text);
  if (resultAction && !contextualResultTransform && looksLikeNewIntentCore(resultAction)) return true;
  if (actionClauses(text).slice(1).some(looksLikeNewIntentCore)) return true;
  if (contextualResultTransform) return false;
  if (isResultOnlyRequest(text)) return false;
  return looksLikeNewIntentCore(text);
}

export function requestsExistingResult(text) {
  return EXISTING_RESULT_PATTERN.test(String(text || "").trim());
}

export function isResultOnlyRequest(text) {
  const normalized = normalizedCommandText(text);
  const affirmativeText = normalized.replace(NEGATED_ACTION_PATTERN, "");
  if (RESULT_TRANSFORM_PATTERN.test(affirmativeText)
    || hasAdditionalActionClause(text)
    || actionAfterResultClause(text)) return false;
  const result = RESULT_NOUN_PATTERN.exec(normalized);
  if (!result
    || (!RESULT_DELIVERY_PATTERN.test(normalized)
      && !DELIVERY_BEFORE_RESULT_PATTERN.test(normalized))) return false;
  const rawPrefix = normalized.slice(0, result.index).replace(/\s+/g, "");
  const prefix = normalizedResultPrefix(rawPrefix);
  return !prefix || CONTEXTUAL_RESULT_PREFIX_PATTERN.test(prefix);
}

export function shouldRedeliverExistingResult({ text, routingReason, hasFinalResponse, deliveryStatus = "" }) {
  return deliveryStatus !== "pending"
    && targetsExistingResult({ text, routingReason, hasFinalResponse });
}

export function targetsExistingResult({ text, routingReason, hasFinalResponse }) {
  return Boolean(hasFinalResponse)
    && isResultOnlyRequest(text)
    && ["explicit_reference", "quoted_reference", "quoted_message", "active_existing_result"].includes(routingReason);
}

export function shouldFlushPendingDeliveriesForMessage(text) {
  return !looksLikeNewTask(text);
}

export function likelyWaitingReply(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return true;
  if (looksLikeNewTask(normalized)) return false;
  return looksLikeFollowUp(normalized) || isResultOnlyRequest(normalized) || !looksLikeNewTask(normalized);
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

function decodedAttributeValue(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return String(value || "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function parseCitationAttributes(source) {
  const attributes = {};
  const pattern = /([A-Za-z_][\w-]*)\s*=\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of String(source || "").matchAll(pattern)) {
    attributes[match[1]] = decodedAttributeValue(match[2]);
  }
  return attributes;
}

function safeCitationLabel(attributes) {
  const requested = String(attributes?.label || "").trim();
  const filePath = normalizeLinkedPath(attributes?.path);
  return (requested || (filePath ? path.basename(filePath) : "文件引用不可用"))
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 180) || "文件引用不可用";
}

export function extractLocalAttachments(text, maximum = 3, { includeJson = false } = {}) {
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

  const codePath = includeJson
    ? /`((?:file:\/\/)?\/[^`\n]+\.(?:md|markdown|html?|pdf|docx?|xlsx?|pptx?|txt|csv|zip|json))`/gi
    : /`((?:file:\/\/)?\/[^`\n]+\.(?:md|markdown|html?|pdf|docx?|xlsx?|pptx?|txt|csv|zip))`/gi;
  for (const match of source.matchAll(codePath)) add(match[1], path.basename(match[1]), match[0]);

  for (const match of source.matchAll(CODEX_FILE_CITATION_PATTERN)) {
    const attributes = parseCitationAttributes(match[1]);
    const filePath = normalizeLinkedPath(attributes.path);
    if (!filePath || !(DELIVERABLE_FILE_EXTENSION_PATTERN.test(filePath) || (includeJson && /\.json$/i.test(filePath)))) continue;
    add(filePath, safeCitationLabel(attributes), match[0]);
  }
  return found;
}

export function replaceLocalAttachmentLinks(text, attachments) {
  let result = String(text || "");
  for (const attachment of attachments) {
    result = result.replace(attachment.fullMatch, `附件：${path.basename(attachment.filePath)}`);
  }
  return result;
}

export function redactInternalFileCitations(text) {
  const source = String(text || "");
  const replaced = source.replace(CODEX_FILE_CITATION_PATTERN, (_fullMatch, attributeSource) => {
    const attributes = parseCitationAttributes(attributeSource);
    return `文件：${safeCitationLabel(attributes)}`;
  });
  // Never expose a partially generated internal marker. Limit the fallback to
  // one line so ordinary text after the malformed citation remains untouched.
  return replaced.replace(/:codex-file-citation\{[^\r\n}]*(?:\}|$)/g, "文件引用不可用");
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
