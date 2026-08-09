const path = require("node:path");

const FEISHU_DOCUMENT_PATTERN = /(?:飞书|lark).{0,8}(?:wiki|文档|docs?|docx?|知识库)|(?:wiki|文档|docs?|docx?|知识库).{0,8}(?:飞书|lark)/i;
const FEISHU_RESOURCE_PATTERN = /(?:飞书|lark).{0,8}(?:base|多维表格|wiki|知识库|云文档|文档|docs?|docx?|云盘|drive|私聊|消息|群聊)/i;
const TO_FEISHU_DESTINATION_PATTERN = /(?:到|至|进|上|向|往|写入|添加到|上传到|发布到|移动到|同步到|保存到)\s*(?:飞书|lark)(?:\s*(?:base|多维表格|wiki|知识库|云文档|文档|docs?|docx?|云盘|drive|私聊|消息|群聊))?/i;
const LOCAL_TARGET_PATTERN = /(?:本地|domi|markdown|纪要|报告|项目库|人脉库|资料库|工作区|邮箱|邮件|本地通知|本地提醒)/i;
const LOCAL_WRITE_PATTERN = /(?:补充|更新|整理|写入|保存|合并|添加|同步|导入|下载|复制|搬|转换|生成|创建|新建|发送|推送)/i;
// A write verb must bind directly to its Feishu destination. Do not infer a
// remote write merely because one clause mentions Feishu while another clause
// creates or updates a local note.
const CREATE_IN_FEISHU_PATTERN = /(?:(?:创建|新建|生成)(?:一(?:篇|份|个))?(?:新)?\s*(?:飞书|lark)(?:\s*(?:wiki|知识库|云文档|文档|docs?|docx?))(?=$|[，。；！？、：,.;!?\n])|(?:在|到|向|往)\s*(?:飞书|lark)(?:\s*(?:wiki|知识库|云文档))?\s*(?:中|里|上)?\s*(?:创建|新建|生成)(?:一(?:篇|份|个))?(?:新)?(?:\s*(?:文档|页面|节点))?)/i;
const COPY_TO_FEISHU_PATTERN = /(?:复制|拷贝|搬|导出|上传|发布|同步|转(?:换)?|发(?:送)?)[^，。；！？、：,.;!?\n]{0,16}(?:到|至|进|为|成|上)\s*(?:飞书|lark)(?:\s*(?:wiki|知识库|云文档|文档|docs?|docx?))/i;
const EDIT_FEISHU_DOCUMENT_PATTERN = /(?:(?:编辑|修改|更新|覆盖|补充|追加|替换)(?:这篇|该|指定的|已有的|现有的|上述|目标)?\s*(?:飞书|lark)(?:\s*(?:wiki|知识库|云文档|文档|docs?|docx?))(?=$|[，。；！？、：,.;!?\n])|(?:在|对)\s*(?:这篇|该|指定的|已有的|现有的|上述|目标)?\s*(?:飞书|lark)(?:\s*(?:wiki|知识库|云文档|文档|docs?|docx?))\s*(?:中|里|上)?\s*(?:编辑|修改|更新|覆盖|补充|追加|替换))/i;
const NEGATED_WRITE_PATTERN = /(?:不要|别|无需|不用|禁止|先不|暂不|不需要|不要再).{0,18}(?:创建|新建|生成|复制|拷贝|搬|导出|上传|发布|同步|转|发送|编辑|修改|更新|覆盖|补充|追加|替换).{0,18}(?:飞书|lark|文档)/i;
const IMPORT_TO_LOCAL_PATTERN = /(?:飞书|lark).{0,12}(?:文档|docx?|知识库).{0,24}(?:导入|下载|保存|复制|搬|同步|转).{0,12}(?:本地|domi|工作区|Markdown|项目库|人脉库)/i;
const FEISHU_CHANNEL_WRITE_PATTERN = /(?:(?:发送|发给|推送)[^，。；！？、：,.;!?\n]{0,12}(?:到|至|给|向)\s*(?:我的)?\s*(?:飞书|lark)(?:\s*(?:私聊|消息|群聊))?|(?:发送|发给|推送)[^，。；！？、：,.;!?\n]{0,16}(?:飞书|lark)\s*(?:私聊|消息|群聊)|(?:飞书|lark)\s*(?:私聊|消息|群聊)[^，。；！？、：,.;!?\n]{0,12}(?:发送|发给|推送))/i;
const FEISHU_RESOURCE_WRITE_PATTERN = /(?:(?:在|向|往|对)\s*(?:这(?:个|条|份)|该|指定的|已有的|现有的)?\s*(?:飞书|lark)(?:\s*(?:base|多维表格|云盘|drive|wiki|知识库))?\s*(?:中|里|上)?\s*(?:新增|创建|编辑|修改|更新|覆盖|补充|追加|上传|移动|删除|整理)|(?:把|将)[^，。；！？、：,.;!?\n]{1,40}(?:写入|添加到|上传到|发布到|移动到|同步到|保存到)\s*(?:飞书|lark)(?:\s*(?:base|多维表格|云盘|drive|wiki|知识库))|(?:新增|创建|编辑|修改|更新|覆盖|补充|追加|上传|移动|删除|整理)\s*(?:这(?:个|条|份)|该|指定的|已有的|现有的)?\s*(?:飞书|lark)(?:\s*(?:base|多维表格|云盘|drive|wiki|知识库))(?=$|[，。；！？、：,.;!?\n]))/i;

function isFeishuReferenceWrittenLocally(text) {
  return !TO_FEISHU_DESTINATION_PATTERN.test(text)
    && FEISHU_RESOURCE_PATTERN.test(text)
    && LOCAL_TARGET_PATTERN.test(text)
    && LOCAL_WRITE_PATTERN.test(text);
}

function classifyFeishuDocumentIntent(value) {
  const text = String(value || "").trim();
  if (
    !text
    || NEGATED_WRITE_PATTERN.test(text)
    || IMPORT_TO_LOCAL_PATTERN.test(text)
    || isFeishuReferenceWrittenLocally(text)
    || !FEISHU_DOCUMENT_PATTERN.test(text)
  ) return null;
  if (CREATE_IN_FEISHU_PATTERN.test(text) || COPY_TO_FEISHU_PATTERN.test(text)) {
    return { action: "publish-copy" };
  }
  if (EDIT_FEISHU_DOCUMENT_PATTERN.test(text)) return { action: "edit-existing" };
  return null;
}

function classifyFeishuDocumentIntentFromRun(payload = {}) {
  if (payload.requestOrigin !== "user") return null;
  const userInstructionText = typeof payload.userInstructionText === "string"
    ? payload.userInstructionText
    : "";
  return classifyFeishuDocumentIntent(userInstructionText);
}

function classifyFeishuWriteIntentFromRun(payload = {}) {
  if (payload.requestOrigin !== "user") return null;
  const userInstructionText = typeof payload.userInstructionText === "string"
    ? payload.userInstructionText.trim()
    : "";
  if (!userInstructionText || NEGATED_WRITE_PATTERN.test(userInstructionText)) return null;
  const documentIntent = classifyFeishuDocumentIntent(userInstructionText);
  if (documentIntent) return documentIntent;
  if (isFeishuReferenceWrittenLocally(userInstructionText)) return null;
  if (FEISHU_CHANNEL_WRITE_PATTERN.test(userInstructionText)
    || FEISHU_RESOURCE_WRITE_PATTERN.test(userInstructionText)) {
    return { action: "external-write" };
  }
  return null;
}

function feishuMarkdownSourceCandidates(payload = {}) {
  const candidates = [
    payload.activeDocumentPath,
    ...(Array.isArray(payload.attachmentPaths) ? payload.attachmentPaths : [])
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => path.resolve(value))
    .filter((value) => [".md", ".markdown"].includes(path.extname(value).toLowerCase()));
  return [...new Set(candidates)];
}

function safeFeishuExportContext({ intent, candidates, result }) {
  if (!intent) return "";
  if (intent.action === "edit-existing") {
    return [
      "domi 本轮飞书文档写入事实：",
      "- 用户要求编辑已有飞书文档；主进程没有自动写入，因为目标文档必须由本轮用户明确指定并由飞书文档能力核对。",
      "- 可以按用户指令使用飞书文档能力；不得把飞书内容设为本地资料库的权威版本。"
    ].join("\n");
  }
  if (candidates.length !== 1) {
    return [
      "domi 本轮飞书 Markdown 副本事实：",
      `- 主进程没有写入：${candidates.length === 0 ? "没有唯一的本地 Markdown 文档" : "存在多个本地 Markdown 候选"}。`,
      "- 请在对话中让用户打开或附带唯一一篇 Markdown 后再继续；不要自行挑选其他本地文件，也不要声称已创建飞书副本。"
    ].join("\n");
  }
  if (!result) return "";
  const verification = result.verification || {};
  const cleanupReceipt = result.cleanupAttempted
    ? result.remoteCleaned
      ? "- 新建失败产生的飞书文档已由主进程清理。"
      : "- 新建失败产生的飞书文档未能自动清理；不得声称已回滚或已成功。"
    : "";
  const stageError = {
    connection: "飞书连接尚未就绪，请先在设置中连接飞书后重试。",
    preflight: "本地 Markdown 未通过无损发布预检，飞书端没有写入。",
    verification: "飞书回读与本地原文不一致，未确认交付成功。",
    write: "飞书写入没有完成，请在连接恢复后重试。",
    host: "主进程未能启动本次发布。"
  }[String(result.stage || "")] || "飞书副本未通过完整校验。";
  return [
    "domi 本轮飞书 Markdown 副本回执：",
    `- 主进程已按用户原始指令执行：${result.ok ? "成功" : "失败"}。`,
    `- 远端写入：${result.remoteWrite ? "已发生" : "未发生"}；回读校验：${verification.status || "未通过"}。`,
    result.target?.url ? `- 飞书文档：${result.target.url}` : "- 未返回可验证的飞书文档链接。",
    cleanupReceipt,
    result.error ? `- 错误：${stageError}` : "- 文字、结构、链接与图片必须以主进程回读报告为准。",
    "- 不要再次调用飞书创建或覆盖命令；本地 Markdown 始终是权威原件。"
  ].filter(Boolean).join("\n");
}

module.exports = {
  classifyFeishuDocumentIntent,
  classifyFeishuDocumentIntentFromRun,
  classifyFeishuWriteIntentFromRun,
  feishuMarkdownSourceCandidates,
  safeFeishuExportContext
};
