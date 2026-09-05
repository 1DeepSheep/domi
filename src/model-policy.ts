export const DOMI_ECONOMY_MODEL_ID = "gpt-5.6-terra";
export const DOMI_PREMIUM_MODEL_ID = "gpt-5.6-sol";

export type DomiModelPolicyClass = "economy" | "premium" | "inherit";
export type DomiModelPolicyRunKind = "podcast-archive";

export type DomiModelCapability = {
  id: string;
  supportedReasoningEfforts?: Array<{ id: string }>;
  serviceTiers?: Array<{ id: string }>;
};

export type DomiModelPolicyRequest = {
  workflowId?: string;
  runKind?: DomiModelPolicyRunKind;
  useDomiPlugin?: boolean;
  requestText?: string;
  domiSlidesDeliveryPolicy?: string;
  models?: readonly DomiModelCapability[];
  userModel: string;
  userReasoningEffort: string;
  userServiceTier: string;
};

export type DomiModelPolicySelection = {
  policyClass: DomiModelPolicyClass;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
};

const ECONOMY_WORKFLOW_IDS = new Set([
  "investment-radar",
  "task"
]);

const PREMIUM_WORKFLOW_IDS = new Set([
  "domi-router",
  "meeting-note",
  "meeting-prep",
  "project-research",
  "project-intake",
  "desk-research",
  "investment-review",
  "investment-analysis",
  "slides",
  "ic-memo"
]);

const TECHNICAL_DIAGNOSTIC_CONTEXT_PATTERN = /(?:\bplaud\b|录音|音频|转写|同步|导入|入库|归档|上传|下载|文件|文档|应用|客户端|插件|功能|工作流|workflow|模型|投资分析|项目研究|深度研究|评级|评分|纪要|投委会|\bic\s*memo\b|\bpptx?\b|powerpoint|slides?|幻灯片|演示文稿)/i;
const TECHNICAL_DIAGNOSTIC_FAILURE_PATTERN = /(?:报错|错误(?:码|提示)?|故障|异常|失败|打不开|无法(?:打开|连接|下载|上传|导入|同步|发送|运行|启动|读取|识别|转写)|连接不上|卡住|崩溃|闪退|没反应|不工作|不能用|同步不了|排查|诊断|debug|troubleshoot)/i;
const ORDINARY_FILE_EDIT_PATTERN = /(?:(?:重命名|改名|移动|复制|删除|压缩|解压|上传|下载|打开|合并|拆分|改字体|换字体|改格式|格式化|改错别字|修正错别字|校对|翻译|修改|编辑|修复|替换).{0,18}(?:文件|文档|代码|脚本|扩展名|文件名)|(?:文件|文档|代码|脚本|扩展名|文件名).{0,18}(?:重命名|改名|移动|复制|删除|压缩|解压|上传|下载|打开|合并|拆分|改字体|换字体|改格式|格式化|改错别字|修正错别字|校对|翻译|修改|编辑|修复|替换))/i;
const MECHANICAL_DELIVERABLE_EDIT_PATTERN = /(?:(?:错别字|拼写|标点|字体|字号|页码|文件名|扩展名|格式).{0,18}(?:报告|表格|\bpptx?\b|powerpoint|slides?|幻灯片|演示文稿)|(?:报告|表格|\bpptx?\b|powerpoint|slides?|幻灯片|演示文稿).{0,18}(?:错别字|拼写|标点|字体|字号|页码|文件名|扩展名|格式))/i;
const MECHANICAL_FILE_DIAGNOSTIC_PATTERN = /(?:\.(?:ts|tsx|js|jsx|mjs|cjs|json|py|sh|css|scss|html?|md|markdown|txt|csv|docx?|xlsx?|pptx?|pdf)\b|(?:代码|脚本)文件).{0,20}(?:文件)?\s*(?:报错|错误|打不开|无法打开)/i;
const SUBSTANTIVE_REVISION_PATTERN = /(?:补充|重做|重新(?:研究|分析|评估)|完善).{0,16}(?:研究|分析|估值|盈利预测|投资判断|投资建议|风险|证据|评级|评分)/i;

const RECORDING_SOURCE_PATTERN = /(?:\bplaud\b|录音|音频|逐字稿|转写稿|访谈|会议记录|会议文字稿|播客)/i;
const RECORDING_DELIVERABLE_PATTERN = /(?:(?:生成|整理|输出|制作|撰写|写成|形成|转写|精修|提炼|总结|同步|处理).{0,20}(?:纪要|会议记录|文字稿|逐字稿|转写稿|笔记|评级|评分|入库|归档)|(?:纪要|会议记录|文字稿|逐字稿|转写稿|笔记).{0,20}(?:生成|整理|输出|制作|撰写|形成|精修|入库|归档))/i;
const DEEP_RESEARCH_PATTERN = /(?:深度研究|深入研究|系统性研究|全面研究|深度调研|深入调研|\bdesk\s+research\b|\bdeep\s+(?:research|dive)\b)/i;
const PROJECT_RESEARCH_CONTEXT_PATTERN = /(?:创业公司|初创公司|公司|企业|项目|标的|创始人|团队|赛道|行业|市场|竞品)/i;
const PROJECT_RESEARCH_ACTION_PATTERN = /(?:研究|调研|尽调|深挖|分析|评估|估值|扫描|梳理|画像|核查|查证)/i;
const PROJECT_INTAKE_CONTEXT_PATTERN = /(?:项目|公司|企业|标的|创始人|团队|研究|材料|资料库|项目库|watching\s*list)/i;
const PROJECT_INTAKE_ACTION_PATTERN = /(?:入库|建档|归档|录入(?:资料库|项目库)|写入(?:资料库|项目库)|整理(?:并)?(?:录)?入(?:资料库|项目库)|归入(?:资料库|项目库)|存入(?:资料库|项目库)|收录(?:到|进)(?:资料库|项目库)|纳入(?:资料库|项目库|watching\s*list))/i;
const INVESTMENT_CONTEXT_PATTERN = /(?:投资|上市公司|股票|证券|基本面|财报|年报|季报|招股书|\bs-1\b|\ba股\b|\bh股\b|港股|美股|标的)/i;
const INVESTMENT_ANALYSIS_ACTION_PATTERN = /(?:分析|研究|评估|估值|前瞻|复盘|解读|预测|建模|拆解|判断|评级|评分|打分|投资意见|投资建议)/i;
const INVESTMENT_RATING_PATTERN = /(?:(?:项目|公司|企业|标的|创始人|团队).{0,20}(?:评分|评级|打分|投资意见|投资建议)|(?:评分|评级|打分).{0,20}(?:项目|公司|企业|标的|创始人|团队))/i;
const IC_DELIVERABLE_PATTERN = /(?:(?:写|撰写|起草|生成|制作|准备|整理|输出|完成|做(?:一份|一个)?).{0,20}(?:\bic\s*memo\b|投委会(?:报告|材料)?|上会材料|决策报告)|(?:\bic\s*memo\b|投委会(?:报告|材料)?|上会材料|决策报告).{0,20}(?:写|撰写|起草|生成|制作|准备|整理|输出|完成))/i;
const EXPLICIT_RETRY_REQUEST_PATTERN = /(?:^|[，,。；;！!\n]\s*|(?:请(?:你)?|麻烦(?:你)?|帮我|烦请)\s*)(?:重新来一遍|再来一次|再做一次|再试一次|恢复执行|继续执行|重新|重做|重试|再次|继续|恢复|再(?=(?:同步|处理|生成|整理|研究|调研|分析|评估|评级|评分|入库|建档|归档|撰写|制作|输出|完成|做)))/gi;
const RETRY_QUESTION_PATTERN = /(?:吗|么|呢|怎么样|如何|是否|会不会|能否|可否)[？?]?\s*$/i;
const RETRY_TROUBLESHOOTING_ACTION_PATTERN = /(?:(?:排查|诊断|调试|修复).{0,12}(?:客户端|应用|插件|功能|工作流|模型|脚本|代码|文件|故障|错误|报错)|(?:分析|研究|排查|诊断|定位|查看).{0,10}(?:故障|错误|报错|异常|失败)(?:原因|日志|信息|代码|详情|问题)?|(?:处理|整理|分析|研究).{0,8}(?:错误|报错|异常|故障)(?:日志|信息|代码|原因)|(?:重启|启动|安装|登录|连接).{0,8}(?:客户端|应用|插件|工作流|模型|服务))/i;
const BARE_RETRY_ACTION_PATTERN = /^(?:[，,。；;！!\n]\s*)?(?:(?:请(?:你)?|麻烦(?:你)?|帮我|烦请)\s*)?(?:重试|重新执行|恢复执行|继续执行|再次执行|再执行一次|重新运行|再运行一次|再试一次|再来一次|再做一次|重新来一遍|重做(?:一遍|一次)?)(?:这项任务|本任务|一下|一遍|一次)?[。！!]?\s*$/i;
const RETRY_RATING_ACTION_PATTERN = /(?:评分|评级|打分|投资意见|投资建议)/i;
const RETRY_IC_CONTEXT_PATTERN = /(?:\bic\s*memo\b|投委会(?:报告|材料)?|上会材料|决策报告)/i;
const RETRY_IC_ACTION_PATTERN = /(?:(?:重新|再次|继续).{0,20}(?:撰写|起草|生成|制作|准备|整理|输出|完成|\bic\s*memo\b|投委会|上会材料|决策报告)|重做(?:一遍|一次|这份|这个)?[。！!]?\s*$)/i;
const RETRY_SLIDES_ACTION_PATTERN = /(?:重新|重做|再次|再来一次|再做一次|继续).{0,28}(?:生成|制作|创建|输出|设计|改版|修改|完善|优化|排版|投研|\bpptx?\b|powerpoint|slides?|幻灯片|演示文稿)/i;

function normalizedPreference(value: string | undefined, fallback: string) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function explicitRetryActionText(requestText: string) {
  const failure = requestText.match(TECHNICAL_DIAGNOSTIC_FAILURE_PATTERN);
  const failureEnd = failure?.index === undefined
    ? 0
    : failure.index + failure[0].length;
  for (const match of requestText.matchAll(EXPLICIT_RETRY_REQUEST_PATTERN)) {
    // A retry word inside the failure description (for example “重试失败”)
    // is history, not the user's current instruction.
    if ((match.index ?? 0) < failureEnd) continue;
    const retryText = requestText.slice(match.index).trim();
    if (!retryText || RETRY_QUESTION_PATTERN.test(retryText)) continue;
    return retryText;
  }
  return "";
}

function hasDomiPremiumFailedBusinessContext(
  fullRequest: string,
  domiSlidesDeliveryPolicy: string
) {
  if (
    RECORDING_SOURCE_PATTERN.test(fullRequest)
    && /(?:同步|处理|转写|纪要|文字稿|逐字稿|转写稿|评级|评分|入库|归档)/i.test(fullRequest)
  ) {
    return true;
  }
  if (DEEP_RESEARCH_PATTERN.test(fullRequest)) return true;
  if (
    PROJECT_INTAKE_CONTEXT_PATTERN.test(fullRequest)
    && PROJECT_INTAKE_ACTION_PATTERN.test(fullRequest)
  ) {
    return true;
  }
  if (
    PROJECT_RESEARCH_CONTEXT_PATTERN.test(fullRequest)
    && PROJECT_RESEARCH_ACTION_PATTERN.test(fullRequest)
  ) {
    return true;
  }
  if (INVESTMENT_RATING_PATTERN.test(fullRequest)) return true;
  if (
    INVESTMENT_CONTEXT_PATTERN.test(fullRequest)
    && INVESTMENT_ANALYSIS_ACTION_PATTERN.test(fullRequest)
  ) {
    return true;
  }
  return Boolean(
    RETRY_IC_CONTEXT_PATTERN.test(fullRequest)
    || domiSlidesDeliveryPolicy
  );
}

function isDomiPremiumRetryAction(
  fullRequest: string,
  retryAction: string,
  domiSlidesDeliveryPolicy: string
) {
  if (RETRY_TROUBLESHOOTING_ACTION_PATTERN.test(retryAction)) return false;
  if (BARE_RETRY_ACTION_PATTERN.test(retryAction)) {
    return hasDomiPremiumFailedBusinessContext(
      fullRequest,
      domiSlidesDeliveryPolicy
    );
  }
  if (
    RECORDING_SOURCE_PATTERN.test(fullRequest)
    && RECORDING_DELIVERABLE_PATTERN.test(retryAction)
  ) {
    return true;
  }
  if (DEEP_RESEARCH_PATTERN.test(retryAction)) return true;
  if (
    PROJECT_INTAKE_CONTEXT_PATTERN.test(fullRequest)
    && PROJECT_INTAKE_ACTION_PATTERN.test(retryAction)
  ) {
    return true;
  }
  if (
    PROJECT_RESEARCH_CONTEXT_PATTERN.test(fullRequest)
    && PROJECT_RESEARCH_ACTION_PATTERN.test(retryAction)
  ) {
    return true;
  }
  if (
    PROJECT_RESEARCH_CONTEXT_PATTERN.test(fullRequest)
    && RETRY_RATING_ACTION_PATTERN.test(retryAction)
  ) {
    return true;
  }
  if (
    INVESTMENT_CONTEXT_PATTERN.test(fullRequest)
    && INVESTMENT_ANALYSIS_ACTION_PATTERN.test(retryAction)
  ) {
    return true;
  }
  if (
    RETRY_IC_CONTEXT_PATTERN.test(fullRequest)
    && RETRY_IC_ACTION_PATTERN.test(retryAction)
  ) {
    return true;
  }
  return Boolean(
    domiSlidesDeliveryPolicy
    && RETRY_SLIDES_ACTION_PATTERN.test(retryAction)
  );
}

export function isDomiPremiumNaturalLanguageTask(
  requestText: string,
  domiSlidesDeliveryPolicy = ""
) {
  const request = String(requestText || "").trim();
  if (!request) return false;

  // Likewise, editing a filename, code file, typography or copy is not a new
  // investment deliverable merely because the file is named after one.
  if (
    (ORDINARY_FILE_EDIT_PATTERN.test(request)
      || MECHANICAL_DELIVERABLE_EDIT_PATTERN.test(request)
      || MECHANICAL_FILE_DIAGNOSTIC_PATTERN.test(request))
    && !SUBSTANTIVE_REVISION_PATTERN.test(request)
  ) {
    return false;
  }

  // A broken sync/file/workflow may mention a premium task by name without
  // asking to perform that task. Diagnostics inherit unless a later clause is
  // an explicit retry whose own action still describes premium business work.
  if (
    TECHNICAL_DIAGNOSTIC_CONTEXT_PATTERN.test(request)
    && TECHNICAL_DIAGNOSTIC_FAILURE_PATTERN.test(request)
  ) {
    const retryAction = explicitRetryActionText(request);
    return Boolean(
      retryAction
      && isDomiPremiumRetryAction(
        request,
        retryAction,
        domiSlidesDeliveryPolicy
      )
    );
  }

  // Keep the renderer's established Slides policy authoritative after the
  // shared diagnostic/mechanical guards. It recognizes genuine deck authoring
  // requests, including edits that preserve an existing template while still
  // enforcing the Slides quality gate.
  if (domiSlidesDeliveryPolicy) return true;

  if (
    RECORDING_SOURCE_PATTERN.test(request)
    && RECORDING_DELIVERABLE_PATTERN.test(request)
  ) {
    return true;
  }
  if (DEEP_RESEARCH_PATTERN.test(request)) return true;
  if (
    PROJECT_INTAKE_CONTEXT_PATTERN.test(request)
    && PROJECT_INTAKE_ACTION_PATTERN.test(request)
  ) {
    return true;
  }
  if (
    PROJECT_RESEARCH_CONTEXT_PATTERN.test(request)
    && PROJECT_RESEARCH_ACTION_PATTERN.test(request)
  ) {
    return true;
  }
  if (INVESTMENT_RATING_PATTERN.test(request)) return true;
  if (
    INVESTMENT_CONTEXT_PATTERN.test(request)
    && INVESTMENT_ANALYSIS_ACTION_PATTERN.test(request)
  ) {
    return true;
  }
  return IC_DELIVERABLE_PATTERN.test(request);
}

export function domiModelPolicyClass(
  workflowId?: string,
  runKind?: DomiModelPolicyRunKind,
  semanticRequest: Pick<
    DomiModelPolicyRequest,
    "useDomiPlugin" | "requestText" | "domiSlidesDeliveryPolicy"
  > = {}
): DomiModelPolicyClass {
  if (runKind === "podcast-archive") return "premium";
  const normalizedWorkflowId = String(workflowId || "").trim();
  // Slides are a quality overlay: an explicitly selected personal/content
  // Skill keeps its own instructions, while the independent domi Slides Skill
  // still receives the premium model and maximum reasoning needed for layout
  // and visual QA.
  if (
    semanticRequest.useDomiPlugin
    && semanticRequest.domiSlidesDeliveryPolicy
  ) return "premium";
  if (ECONOMY_WORKFLOW_IDS.has(normalizedWorkflowId)) return "economy";
  if (PREMIUM_WORKFLOW_IDS.has(normalizedWorkflowId)) return "premium";
  if (normalizedWorkflowId) return "inherit";
  if (
    semanticRequest.useDomiPlugin
    && isDomiPremiumNaturalLanguageTask(
      semanticRequest.requestText || "",
      semanticRequest.domiSlidesDeliveryPolicy || ""
    )
  ) {
    return "premium";
  }
  return "inherit";
}

function requiredModel(
  models: readonly DomiModelCapability[] | undefined,
  modelId: string,
  policyClass: Exclude<DomiModelPolicyClass, "inherit">
) {
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error(
      `无法启动 ${policyClass === "economy" ? "高性价比" : "高质量交付"}工作流：Codex model/list 未返回可用模型，domi 不会静默改用其他模型。请检查 Codex 连接后重试。`
    );
  }
  const model = models.find((item) => item.id === modelId);
  if (!model) {
    throw new Error(
      `无法启动工作流：当前 Codex 不支持策略要求的模型 ${modelId}，domi 不会静默降级。请更新 Codex 或切换到支持该模型的连接。`
    );
  }
  return model;
}

function assertReasoningEffort(model: DomiModelCapability, effort: string) {
  if (!(model.supportedReasoningEfforts || []).some((item) => item.id === effort)) {
    throw new Error(
      `无法启动工作流：模型 ${model.id} 不支持策略要求的 ${effort} 推理强度，domi 不会静默降级。请更新 Codex 或模型连接后重试。`
    );
  }
}

function assertUserServiceTier(model: DomiModelCapability, serviceTier: string) {
  if (["default", "standard"].includes(serviceTier)) return;
  if (!(model.serviceTiers || []).some((item) => item.id === serviceTier)) {
    throw new Error(
      `无法启动高质量交付工作流：模型 ${model.id} 不支持用户选择的 ${serviceTier} 速度档位，domi 不会静默改档。请在运行设置中选择该模型支持的速度。`
    );
  }
}

/**
 * Resolve the one authoritative model policy for every renderer submission.
 *
 * Cost-sensitive background maintenance stays on Terra/medium/standard.
 * Externally deliverable work stays on Sol/max while preserving the user's
 * speed tier. With no explicit workflow, enabled domi requests use the same
 * premium policy when their natural-language task semantics require it.
 * Unclassified work keeps all user selections unchanged.
 */
export function resolveDomiModelPolicy(
  request: DomiModelPolicyRequest
): DomiModelPolicySelection {
  const policyClass = domiModelPolicyClass(request.workflowId, request.runKind, request);
  const userSelection = {
    model: normalizedPreference(request.userModel, "default"),
    reasoningEffort: normalizedPreference(request.userReasoningEffort, "default"),
    serviceTier: normalizedPreference(request.userServiceTier, "default")
  };
  if (policyClass === "inherit") {
    return { policyClass, ...userSelection };
  }

  const modelId = policyClass === "economy"
    ? DOMI_ECONOMY_MODEL_ID
    : DOMI_PREMIUM_MODEL_ID;
  const requiredEffort = policyClass === "economy" ? "medium" : "max";
  const model = requiredModel(request.models, modelId, policyClass);
  assertReasoningEffort(model, requiredEffort);

  const resolvedServiceTier = policyClass === "economy"
    ? "standard"
    : userSelection.serviceTier;
  if (policyClass === "premium") {
    assertUserServiceTier(model, resolvedServiceTier);
  }

  return {
    policyClass,
    model: modelId,
    reasoningEffort: requiredEffort,
    serviceTier: resolvedServiceTier
  };
}
