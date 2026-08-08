const path = require("node:path");

const FEISHU_DOCUMENT_PATTERN = /(?:飞书|lark).{0,12}(?:文档|docx?|知识库)|(?:文档|docx?|知识库).{0,12}(?:飞书|lark)/i;
const CREATE_IN_FEISHU_PATTERN = /(?:(?:创建|新建|生成).{0,18}(?:飞书|lark).{0,8}(?:文档|docx?)|(?:飞书|lark).{0,12}(?:创建|新建|生成).{0,8}(?:文档|docx?))/i;
const COPY_TO_FEISHU_PATTERN = /(?:复制|拷贝|搬|导出|上传|发布|同步|转|发(?:送)?).{0,24}(?:到|至|进|为|成|上).{0,8}(?:飞书|lark).{0,8}(?:文档|docx?|知识库)/i;
const EDIT_PATTERN = /(?:编辑|修改|更新|覆盖|补充|追加|替换)/i;
const NEGATED_WRITE_PATTERN = /(?:不要|别|无需|不用|禁止|先不|暂不|不需要|不要再).{0,18}(?:创建|新建|生成|复制|拷贝|搬|导出|上传|发布|同步|转|发送|编辑|修改|更新|覆盖|补充|追加|替换).{0,18}(?:飞书|lark|文档)/i;
const IMPORT_TO_LOCAL_PATTERN = /(?:飞书|lark).{0,12}(?:文档|docx?|知识库).{0,24}(?:导入|下载|保存|复制|搬|同步|转).{0,12}(?:本地|domi|工作区|Markdown|项目库|人脉库)/i;

function classifyFeishuDocumentIntent(value) {
  const text = String(value || "").trim();
  if (
    !text
    || NEGATED_WRITE_PATTERN.test(text)
    || IMPORT_TO_LOCAL_PATTERN.test(text)
    || !FEISHU_DOCUMENT_PATTERN.test(text)
  ) return null;
  if (CREATE_IN_FEISHU_PATTERN.test(text) || COPY_TO_FEISHU_PATTERN.test(text)) {
    return { action: "publish-copy" };
  }
  if (EDIT_PATTERN.test(text)) return { action: "edit-existing" };
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
  feishuMarkdownSourceCandidates,
  safeFeishuExportContext
};
