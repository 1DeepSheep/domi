import path from "node:path";

export const DOMI_WECHAT_PREMIUM_PREFERENCE = Object.freeze({
  model: "gpt-5.6-sol",
  reasoningEffort: "max",
});

export const DOMI_WECHAT_ECONOMY_PREFERENCE = Object.freeze({
  model: "gpt-5.6-terra",
  reasoningEffort: "medium",
});

const DIAGNOSTIC_CONTEXT_PATTERN = /(?:\bdomi\b|\bplaud\b|录音|音频|转写|同步|入库|归档|文件|文档|截图|应用|客户端|插件|功能|工作流|workflow|模型|投资分析|项目研究|深度研究|评级|评分|纪要|投委会|\bic\s*memo\b|\bpptx?\b|powerpoint|keynote|slides?|幻灯片|演示文稿|路演材料|汇报材料)/i;
const DIAGNOSTIC_FAILURE_PATTERN = /(?:报错|错误(?:码|提示)?|故障|异常|失败|打不开|无法(?:打开|连接|下载|上传|导入|同步|发送|运行|启动|读取|识别|转写)|连接不上|卡住|崩溃|闪退|没反应|不工作|不能用|同步不了|丑|不好看|版式(?:很)?差|排版(?:很)?差|排查|诊断|debug|troubleshoot)/i;
const EXPLICIT_RETRY_REQUEST_PATTERN = /(?:^|[，,。；;！!\n]\s*|(?:请帮我|请你|请|麻烦你?|帮我|烦请|现在|马上)\s*)(?:重新来一遍|再来一次|再做一次|再试一次|恢复执行|继续执行|重新|重做|重试|再次|继续|恢复|再(?=(?:同步|处理|生成|整理|研究|调研|分析|评估|评级|评分|打分|入库|建档|归档|撰写|制作|输出|完成|做)))/gi;
const RETRY_QUESTION_PATTERN = /(?:吗|么|呢|怎么样|如何|是否|会不会|能否|可否)[？?]?\s*$/i;
const RETRY_TROUBLESHOOTING_ACTION_PATTERN = /(?:(?:排查|诊断|调试|修复).{0,12}(?:客户端|应用|插件|功能|工作流|模型|脚本|代码|文件|故障|错误|报错)|(?:分析|研究|排查|诊断|定位|查看).{0,10}(?:故障|错误|报错|异常|失败)(?:原因|日志|信息|代码|详情|问题)?|(?:处理|整理|分析|研究).{0,8}(?:错误|报错|异常|故障)(?:日志|信息|代码|原因)|(?:重启|启动|安装|登录|连接).{0,8}(?:客户端|应用|插件|工作流|模型|服务))/i;
const BARE_RETRY_ACTION_PATTERN = /^(?:[，,。；;！!\n]\s*)?(?:(?:请帮我|请你|请|麻烦你?|帮我|烦请|现在|马上)\s*)?(?:重试|重新执行|恢复执行|继续执行|再次执行|再执行一次|重新运行|再运行一次|再试一次|再来一次|再做一次|重新来一遍|重做(?:一遍|一次)?)(?:这项任务|本任务|一下|一遍|一次)?[。！!]?\s*$/i;
const RECORDING_SOURCE_PATTERN = /(?:\bplaud\b|录音|音频|逐字稿|转写稿|访谈|会议记录|会议文字稿|播客)/i;
const RECORDING_DELIVERABLE_PATTERN = /(?:(?:生成|整理|输出|制作|撰写|写成|形成|转写|精修|提炼|总结|同步|处理).{0,20}(?:纪要|会议记录|文字稿|逐字稿|转写稿|笔记|评级|评分|入库|归档)|(?:纪要|会议记录|文字稿|逐字稿|转写稿|笔记).{0,20}(?:生成|整理|输出|制作|撰写|形成|精修|入库|归档))/i;
const RECORDING_ORCHESTRATION_PATTERN = /(?:\bplaud\b|同步|下载|队列|评级|评分|入库|归档|投资分析|估值|深度研究|尽调|\bic\s*memo\b|投委会|上会材料)/i;
const DEEP_RESEARCH_PATTERN = /(?:深度研究|深入研究|系统性研究|全面研究|桌面研究|深度调研|深入调研|\bdesk\s+research\b|\bdeep\s+(?:research|dive)\b)/i;
const PROJECT_CONTEXT_PATTERN = /(?:创业公司|初创公司|公司|企业|项目|标的|创始人|团队|赛道|行业|市场|竞品)/i;
const PROJECT_RESEARCH_ACTION_PATTERN = /(?:研究|调研|尽调|深挖|分析|评估|估值|扫描|梳理|画像|核查|查证)/i;
const PROJECT_INTAKE_PATTERN = /(?:入库|建档|归档|录入(?:资料库|项目库)|写入(?:资料库|项目库)|整理(?:并)?(?:录)?入(?:资料库|项目库)|归入(?:资料库|项目库)|存入(?:资料库|项目库)|收录(?:到|进)(?:资料库|项目库)|纳入(?:资料库|项目库|watching\s*list))/i;
const INVESTMENT_CONTEXT_PATTERN = /(?:投资|上市公司|股票|证券|基本面|财报|财务报表|datapack|商业计划书|\bbp\b|年报|季报|招股书|\bs-1\b|\ba股\b|\bh股\b|港股|美股|标的)/i;
const INVESTMENT_ANALYSIS_ACTION_PATTERN = /(?:分析|研究|评估|估值|前瞻|复盘|解读|预测|建模|拆解|判断|投资意见|投资建议)/i;
const INVESTMENT_RATING_PATTERN = /(?:(?:项目|公司|企业|标的|创始人|团队).{0,20}(?:评分|评级|打分|投资意见|投资建议)|(?:评分|评级|打分).{0,20}(?:项目|公司|企业|标的|创始人|团队))/i;
const IC_PATTERN = /(?:\bic\s*memo\b|投委会(?:报告|材料)?|上会材料|决策报告)/i;
const SLIDES_PATTERN = /(?:\bpptx?\b|powerpoint|keynote|slides?|幻灯片|演示文稿|路演材料|汇报(?:材料|演示)?)/i;
const RADAR_PATTERN = /(?:行业雷达|新闻雷达|行业动态|赛道动态|融资动态|每周动态|本周动态|最新动态|追踪.{0,12}(?:行业|赛道|新闻|融资)|扫描.{0,12}(?:行业|赛道|新闻|融资))/i;
const TODO_PATTERN = /(?:\btodo\b|待办事项|待办|任务建议|跟进事项|还有什么(?:需要|要)跟进|提醒我)/i;
const SOURCING_PATTERN = /(?:\bmapping\b|\bmap(?:ping)?\s+(?:founders?|talent|people|companies)|人才地图|人脉地图|创始人地图|(?:找|寻找|搜寻|筛选|推荐).{0,20}(?:创始人|创业者|行业专家|候选人|人才|项目))/i;
const DEAL_NEGOTIATION_PATTERN = /(?:谈判|交易条款|估值博弈|保护性条款|\bterm\s*sheet\b|\bsafe\b|\bspa\b|\bsha\b)/i;
const SCHEDULE_PATTERN = /(?:(?:安排|约|预约|邀请|日程|calendar).{0,30}(?:会议|会面|见面|电话|交流|时间|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[点时:])|(?:明天|后天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[点时:]).{0,30}(?:安排|约|预约|邀请|会议|会面|见面))/i;
const INVESTMENT_MGMT_PATTERN = /(?:(?:查看|查询|统计|修改|更新|补填|管理|列出|打开).{0,30}(?:项目库|资料库|watching\s*list)|(?:项目库|资料库|watching\s*list).{0,30}(?:查看|查询|统计|修改|更新|补填|管理|列出|打开))/i;
const ATTACHMENT_ANALYSIS_PATTERN = /(?:分析|研究|评级|评分|总结|提炼|写报告|出报告|整理纪要)/i;
const ATTACHMENT_FILE_OPERATION_PATTERN = /(?:(?:删除|移除|重命名|改名|移动|复制|打开|压缩|解压|上传|下载|发送).{0,16}(?:音频|录音|文件|附件)|(?:音频|录音|文件|附件).{0,16}(?:删除|移除|重命名|改名|移动|复制|打开|压缩|解压|上传|下载|发送))/i;
const DOMI_DOMAIN_PATTERN = /(?:\bdomi\b|\bplaud\b|录音|音频|逐字稿|转写|纪要|项目库|资料库|入库|归档|投资|项目|公司|企业|标的|创始人|赛道|行业|财报|财务报表|datapack|商业计划书|招股书|评级|评分|尽调|研究|投委会|\bic\s*memo\b|待办|行业雷达|新闻雷达|\bpptx?\b|powerpoint|slides?|幻灯片|演示文稿)/i;
const CASUAL_ONLY_PATTERN = /^(?:你好|您好|嗨|hello|hi|谢谢|多谢|收到|好的|好|没事|再见|晚安|早上好|下午好|晚上好)[！!。.，,？?\s]*$/i;
const VAGUE_CONTEXTUAL_FOLLOWUP_PATTERN = /^(?:请|麻烦)?(?:再|另外|还|也)?(?:补充|完善|展开|继续(?:分析|研究|处理)?|详细说明|看看)(?:一下)?/i;
const EXPLICIT_CURRENT_INTENT_PATTERN = /(?:入库|归档|建档|写库|发送|外发|上传|下载|删除|移除|重命名|改名|移动|复制|评级|评分|打分|生成|制作|创建|写(?:一份|一个)?|安排|预约|邀请|待办|行业雷达|新闻雷达|谈判|\bmapping\b|\bpptx?\b|powerpoint|slides?|幻灯片|演示文稿)/i;

function hasPowerPointAttachment(attachments) {
  return (attachments || []).some((attachment) => (
    [".ppt", ".pptx"].includes(path.extname(String(attachment?.filePath || "")).toLowerCase())
  ));
}

function hasAudioAttachment(attachments) {
  return (attachments || []).some((attachment) => {
    const extension = path.extname(String(attachment?.filePath || "")).toLowerCase();
    return attachment?.kind === "voice"
      || String(attachment?.mimeType || "").toLowerCase().startsWith("audio/")
      || [".aac", ".flac", ".m4a", ".mp3", ".ogg", ".silk", ".wav"].includes(extension);
  });
}

function isDiagnostic(request) {
  return DIAGNOSTIC_CONTEXT_PATTERN.test(request)
    && DIAGNOSTIC_FAILURE_PATTERN.test(request);
}

function explicitRetryActionText(request) {
  const failure = request.match(DIAGNOSTIC_FAILURE_PATTERN);
  const failureEnd = failure?.index === undefined
    ? 0
    : failure.index + failure[0].length;
  for (const match of request.matchAll(EXPLICIT_RETRY_REQUEST_PATTERN)) {
    // Ignore historical wording such as “重试失败”. Only an instruction
    // after the failure description can turn diagnosis into execution.
    if ((match.index ?? 0) < failureEnd) continue;
    const retryAction = request.slice(match.index).trim();
    if (!retryAction || RETRY_QUESTION_PATTERN.test(retryAction)) continue;
    return retryAction;
  }
  return "";
}

function hasPremiumDomiBusinessContext(request, slidesDeliveryPolicy = "") {
  if (slidesDeliveryPolicy || SLIDES_PATTERN.test(request)) return true;
  if (IC_PATTERN.test(request)) return true;
  if (
    RECORDING_SOURCE_PATTERN.test(request)
    && /(?:同步|处理|转写|纪要|文字稿|逐字稿|转写稿|评级|评分|入库|归档)/i.test(request)
  ) {
    return true;
  }
  if (DEEP_RESEARCH_PATTERN.test(request)) return true;
  if (PROJECT_CONTEXT_PATTERN.test(request) && PROJECT_INTAKE_PATTERN.test(request)) return true;
  if (PROJECT_CONTEXT_PATTERN.test(request) && PROJECT_RESEARCH_ACTION_PATTERN.test(request)) return true;
  if (INVESTMENT_RATING_PATTERN.test(request)) return true;
  return INVESTMENT_CONTEXT_PATTERN.test(request)
    && INVESTMENT_ANALYSIS_ACTION_PATTERN.test(request);
}

function retryRouteFor(request, slidesDeliveryPolicy = "") {
  if (slidesDeliveryPolicy || SLIDES_PATTERN.test(request)) return "$domi:slides";
  if (IC_PATTERN.test(request)) return "$domi:ic-memo";
  if (PROJECT_CONTEXT_PATTERN.test(request) && PROJECT_INTAKE_PATTERN.test(request)) {
    return "$domi:domi-router";
  }
  if (INVESTMENT_RATING_PATTERN.test(request)) return "$domi:investment-review";
  if (
    INVESTMENT_CONTEXT_PATTERN.test(request)
    && INVESTMENT_ANALYSIS_ACTION_PATTERN.test(request)
  ) {
    return "$domi:investment-analysis";
  }
  if (RECORDING_SOURCE_PATTERN.test(request)) {
    return RECORDING_ORCHESTRATION_PATTERN.test(request)
      ? "$domi:domi-router"
      : "$domi:asr-notes";
  }
  if (
    DEEP_RESEARCH_PATTERN.test(request)
    || (PROJECT_CONTEXT_PATTERN.test(request) && PROJECT_RESEARCH_ACTION_PATTERN.test(request))
  ) {
    return "$domi:desk-research";
  }
  return "$domi:domi-router";
}

/**
 * Only the user's current text and attachment types are classified; prior assistant output is
 * never allowed to turn a read-only follow-up into a write operation.
 */
function classifyDomiWechatRequestRaw({
  text,
  attachments = [],
  slidesDeliveryPolicy = "",
} = {}) {
  const request = String(text || "").trim();
  const hasFailureSignal = isDiagnostic(request) && !slidesDeliveryPolicy;
  const retryAction = hasFailureSignal ? explicitRetryActionText(request) : "";
  const explicitRetryExecution = Boolean(
    retryAction && !RETRY_TROUBLESHOOTING_ACTION_PATTERN.test(retryAction)
  );
  const premiumRetryExecution = explicitRetryExecution
    && hasPremiumDomiBusinessContext(request, slidesDeliveryPolicy);
  const diagnostic = hasFailureSignal && !explicitRetryExecution;
  const allowPriorRouteReuse = VAGUE_CONTEXTUAL_FOLLOWUP_PATTERN.test(request)
    && !EXPLICIT_CURRENT_INTENT_PATTERN.test(request);

  if (slidesDeliveryPolicy) {
    return {
      policyClass: "premium",
      route: "$domi:slides",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (diagnostic) {
    return {
      policyClass: "inherit",
      route: "$domi:domi-router",
      diagnostic: true,
      isDomiTask: true,
    };
  }

  if (IC_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: "$domi:ic-memo",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (RECORDING_SOURCE_PATTERN.test(request) && RECORDING_DELIVERABLE_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: RECORDING_ORCHESTRATION_PATTERN.test(request)
        ? "$domi:domi-router"
        : "$domi:asr-notes",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (PROJECT_CONTEXT_PATTERN.test(request) && PROJECT_INTAKE_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: "$domi:domi-router",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (INVESTMENT_RATING_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: "$domi:investment-review",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (
    INVESTMENT_CONTEXT_PATTERN.test(request)
    && INVESTMENT_ANALYSIS_ACTION_PATTERN.test(request)
  ) {
    return {
      policyClass: "premium",
      route: "$domi:investment-analysis",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (DEEP_RESEARCH_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: "$domi:desk-research",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  // Explicit compact workflows stay compact, but only after the specific
  // premium deliverable semantics above have had a chance to match.
  if (RADAR_PATTERN.test(request)) {
    return {
      policyClass: "economy",
      route: "$domi:investment-radar",
      diagnostic: false,
      isDomiTask: true,
    };
  }
  if (TODO_PATTERN.test(request)) {
    return {
      policyClass: "economy",
      route: "$domi:todo",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (SOURCING_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: "$domi:sourcing",
      diagnostic: false,
      isDomiTask: true,
    };
  }
  if (DEAL_NEGOTIATION_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: "$domi:deal-negotiation",
      diagnostic: false,
      isDomiTask: true,
    };
  }
  if (SCHEDULE_PATTERN.test(request)) {
    return {
      policyClass: "inherit",
      route: "$domi:schedule",
      diagnostic: false,
      isDomiTask: true,
    };
  }
  if (INVESTMENT_MGMT_PATTERN.test(request)) {
    return {
      policyClass: "inherit",
      route: "$domi:investment-mgmt",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (PROJECT_CONTEXT_PATTERN.test(request) && PROJECT_RESEARCH_ACTION_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: "$domi:desk-research",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (ATTACHMENT_FILE_OPERATION_PATTERN.test(request)) {
    return {
      policyClass: "inherit",
      route: "$domi:domi-router",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (attachments.length && ATTACHMENT_ANALYSIS_PATTERN.test(request)) {
    return {
      policyClass: "premium",
      route: "$domi:domi-router",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (explicitRetryExecution) {
    return {
      policyClass: premiumRetryExecution ? "premium" : "inherit",
      route: premiumRetryExecution
        ? retryRouteFor(request, slidesDeliveryPolicy)
        : "$domi:domi-router",
      diagnostic: false,
      isDomiTask: true,
      explicitRetryExecution: true,
    };
  }

  // Attachment type is a fallback, never the top-level intent. A recording
  // attached to an IC, rating/intake or investment-analysis request must stay
  // on that complete workflow instead of being collapsed into ASR-only work.
  if (hasAudioAttachment(attachments)) {
    return {
      policyClass: "premium",
      route: "$domi:asr-notes",
      diagnostic: false,
      isDomiTask: true,
    };
  }

  if (hasPowerPointAttachment(attachments) || DOMI_DOMAIN_PATTERN.test(request) || attachments.length) {
    return {
      policyClass: "inherit",
      route: "$domi:domi-router",
      diagnostic: false,
      isDomiTask: true,
      allowPriorRouteReuse,
    };
  }

  return {
    policyClass: "inherit",
    route: "",
    diagnostic: false,
    isDomiTask: false,
    casual: CASUAL_ONLY_PATTERN.test(request),
    allowPriorRouteReuse,
  };
}

export function classifyDomiWechatRequest(options = {}) {
  return {
    allowPriorRouteReuse: false,
    ...classifyDomiWechatRequestRaw(options),
  };
}

export function resolveDomiWechatTaskPreference({
  classification,
  currentPreference,
  priorPolicyClass = "inherit",
} = {}) {
  const priorClass = String(priorPolicyClass || "inherit");
  // A troubleshooting turn is explicitly outside the premium business run.
  // Do not let a prior premium task silently turn a read-only diagnosis into
  // another Sol/max execution.
  if (classification?.diagnostic) {
    return {
      policyClass: "inherit",
      preference: {
        model: String(currentPreference?.model || "gpt-5.6-sol"),
        reasoningEffort: String(currentPreference?.reasoningEffort || "xhigh"),
      },
    };
  }
  if (classification?.policyClass === "premium" || priorClass === "premium") {
    return {
      policyClass: "premium",
      preference: { ...DOMI_WECHAT_PREMIUM_PREFERENCE },
    };
  }
  if (classification?.policyClass === "economy") {
    return {
      policyClass: "economy",
      preference: { ...DOMI_WECHAT_ECONOMY_PREFERENCE },
    };
  }
  return {
    policyClass: priorClass === "economy" ? "economy" : "inherit",
    preference: {
      model: String(currentPreference?.model || "gpt-5.6-sol"),
      reasoningEffort: String(currentPreference?.reasoningEffort || "xhigh"),
    },
  };
}

export function applyDomiWechatPolicyToTask(task, options = {}) {
  const classification = classifyDomiWechatRequest(options);
  const resolved = resolveDomiWechatTaskPreference({
    classification,
    currentPreference: task?.preference,
    priorPolicyClass: task?.modelPolicyClass,
  });
  const priorRoute = String(task?.domiRoute || "");
  const canReusePriorRoute = classification.allowPriorRouteReuse === true && priorRoute;
  const effectiveRoute = canReusePriorRoute ? priorRoute : classification.route;
  if (task && typeof task === "object") {
    task.preference = resolved.preference;
    task.modelPolicyClass = resolved.policyClass;
    const shouldPersistRoute = effectiveRoute
      && !classification.diagnostic
      && (
        effectiveRoute !== "$domi:domi-router"
        || classification.policyClass !== "inherit"
        || !priorRoute
      );
    if (shouldPersistRoute) task.domiRoute = effectiveRoute;
  }
  return { classification, effectiveRoute, ...resolved };
}

export function domiWechatRoutingPolicyFor(options = {}) {
  const classification = classifyDomiWechatRequest(options);
  const selectedRoute = String(options.routeOverride || classification.route || "");
  if (!selectedRoute) return "";
  const routeRule = selectedRoute === "$domi:domi-router"
    ? "先完整读取已安装的 $domi:domi-router，再由它按当前请求选择精确的 $domi:* Skill；能直接路由后不要加载无关 Skill。"
    : `本轮直接使用已安装的 ${selectedRoute}；除非该 Skill 明确要求或当前请求确有歧义，不要再加载 domi Router 或无关 Skill。`;
  const diagnosticRule = classification.diagnostic
    ? "这是故障诊断，不是执行业务工作流：只读排查并解释原因；不得因为出现录音、入库、投资分析或 Slides 等关键词而处理录音、生成研究、写库、归档或外发。"
    : "只执行用户当前明确要求的动作；Skill 路由不新增写库、归档、发送、上传或其他外部副作用授权。只读请求必须保持只读。";

  return [
    "DOMI_WECHAT_ROUTING_POLICY_V1",
    routeRule,
    "业务路由必须选择 domi-managed 插件中带 $domi: 前缀的 Skill；禁止用无前缀或 ~/.codex/skills 下的同名全局副本替代。所选 domi Skill 明确要求时，可以把通用工具或执行型 Skill 作为下游工具使用，但不得让它取代 domi 的业务规则与质量门。若所需 domi Skill 不可用，明确报告并停止，不得静默降级。",
    diagnosticRule,
    "用户当前消息是本轮意图的最高优先级；可沿用同一任务的事实上下文，但不得重复上一轮动作或把旧 workflow 标签当成当前命令。",
    "质量门保持不变：不得降低研究深度、证据覆盖、可追溯性、判断质量、交付完整度或 QA；同一 Skill/reference 本任务只读取一次，确定性检查应批量执行。",
  ].join("\n");
}
