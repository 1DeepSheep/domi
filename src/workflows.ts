export type Workflow = {
  id: string;
  title: string;
  shortTitle: string;
  skill: string;
  description: string;
  output: string;
  defaultPrompt: string;
  quickStart?: boolean;
  hidden?: boolean;
  webSearch?: boolean;
  requiresPlaud?: boolean;
};

export const RADAR_MAX_LOOKBACK_MS = 72 * 60 * 60 * 1000;
export const RADAR_OVERLAP_MS = 48 * 60 * 60 * 1000;
export const TODO_NEW_ENTRY_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

export function radarDiscoveryWindow(now: number, checkpoint: number) {
  const earliestStart = now - RADAR_MAX_LOOKBACK_MS;
  const validCheckpoint = Number.isFinite(checkpoint) && checkpoint > 0 ? checkpoint : 0;
  const discoveryFrom = Math.max(
    earliestStart,
    validCheckpoint ? validCheckpoint - RADAR_OVERLAP_MS : earliestStart
  );
  return {
    discoveryFrom,
    checkedAfter: validCheckpoint
  };
}

type RadarPriorityPerson = {
  name?: string;
  organization?: string;
  status?: string;
  rating?: string;
};

function singleLine(value: unknown) {
  return String(value || "").replace(/[\r\n｜]+/g, " ").replace(/\s+/g, " ").trim();
}

export function radarPriorityPeopleContext(people: RadarPriorityPerson[] = []) {
  const seen = new Set<string>();
  const priorityPeople = people
    .filter((person) => /^(?:S|A\+?)$/i.test(singleLine(person.rating)))
    .map((person) => ({
      name: singleLine(person.name),
      organization: singleLine(person.organization),
      status: singleLine(person.status),
      rating: singleLine(person.rating).toUpperCase()
    }))
    .filter((person) => {
      if (!person.name) return false;
      const key = `${person.name}\u0000${person.organization}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const ratingOrder = (left.rating.startsWith("S") ? 0 : 1)
        - (right.rating.startsWith("S") ? 0 : 1);
      return ratingOrder || left.name.localeCompare(right.name, "zh-CN");
    });
  if (!priorityPeople.length) return "";

  const limit = 200;
  const rows = priorityPeople
    .slice(0, limit)
    .map((person) =>
      `- ${person.rating}｜${person.name}｜${person.organization || "组织待核验"}｜${person.status || "关系进展未填写"}`
    );
  return [
    `A/S 重点人物别名索引（本机缓存，共 ${priorityPeople.length} 人；关系进展只作消歧，不作为雷达准入条件）：`,
    ...rows,
    priorityPeople.length > limit
      ? `- 另有 ${priorityPeople.length - limit} 人未随本轮上下文传入；必须在覆盖缺口中披露。`
      : "",
    "该索引只用于宽搜结果的实体匹配与消歧，不得逐人发起搜索；命中姓名后再结合组织、角色或公开履历核验身份。"
  ].filter(Boolean).join("\n");
}

type TodoRecentProject = {
  recordId?: string;
  name?: string;
  domain?: string;
  subdomains?: string[];
  status?: string;
  rating?: string;
  notes?: string;
  createdAt?: number | null;
  lastFollowup?: number | null;
};

type TodoRecentPerson = {
  recordId?: string;
  name?: string;
  types?: string[];
  organization?: string;
  status?: string;
  rating?: string;
  createdAt?: number | null;
  lastContact?: number | null;
};

function todoEvidenceSummary(
  kind: "project" | "person",
  item: TodoRecentProject | TodoRecentPerson
) {
  const parts = kind === "project"
    ? [
        singleLine((item as TodoRecentProject).domain),
        ((item as TodoRecentProject).subdomains || []).map(singleLine).filter(Boolean).join("、"),
        singleLine((item as TodoRecentProject).notes)
      ]
    : [
        singleLine((item as TodoRecentPerson).organization),
        ((item as TodoRecentPerson).types || []).map(singleLine).filter(Boolean).join("、")
      ];
  const summary = parts.filter(Boolean).join("；");
  return summary.length > 160 ? `${summary.slice(0, 159)}…` : summary;
}

function todoRecentEntryLine(
  kind: "project" | "person",
  item: TodoRecentProject | TodoRecentPerson
) {
  const detail = todoEvidenceSummary(kind, item);
  return [
    kind,
    singleLine(item.recordId),
    singleLine(item.name),
    new Date(Number(item.createdAt)).toISOString(),
    singleLine(item.rating) || "未评级",
    singleLine(item.status) || "进展未填写",
    detail || (kind === "project" ? "领域未填写" : "组织未填写")
  ].join("｜");
}

function todoPriorityRating(value: unknown) {
  return /^(?:S|A\+?)$/i.test(singleLine(value));
}

function todoFollowupDate(value: unknown) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : "未填写";
}

export function todoRecentEntriesContext(
  projects: TodoRecentProject[] = [],
  people: TodoRecentPerson[] = [],
  now = Date.now()
) {
  const cutoff = now - TODO_NEW_ENTRY_WINDOW_MS;
  const recentProjects = projects
    .filter((item) =>
      singleLine(item.recordId)
      && singleLine(item.name)
      && Number(item.createdAt) >= cutoff
      && Number(item.createdAt) <= now
    )
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
  const recentPeople = people
    .filter((item) =>
      singleLine(item.recordId)
      && singleLine(item.name)
      && Number(item.createdAt) >= cutoff
      && Number(item.createdAt) <= now
    )
    .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));

  const priorityProjects = projects
    .filter((item) =>
      singleLine(item.recordId)
      && singleLine(item.name)
      && todoPriorityRating(item.rating)
    )
    .sort((left, right) =>
      (Number(left.lastFollowup) || 0) - (Number(right.lastFollowup) || 0)
    );
  const priorityPeople = people
    .filter((item) =>
      singleLine(item.recordId)
      && singleLine(item.name)
      && todoPriorityRating(item.rating)
    )
    .sort((left, right) =>
      (Number(left.lastContact) || 0) - (Number(right.lastContact) || 0)
    );

  if (
    !recentProjects.length
    && !recentPeople.length
    && !priorityProjects.length
    && !priorityPeople.length
  ) return "";

  const recentLimit = 48;
  const followupLimit = 48;
  const candidates = [
    ...recentProjects.map((item) => ({ kind: "project" as const, item })),
    ...recentPeople.map((item) => ({ kind: "person" as const, item }))
  ]
    .sort((left, right) => Number(right.item.createdAt) - Number(left.item.createdAt))
    .slice(0, recentLimit);
  const followupCandidates = [
    ...priorityProjects.map((item) => ({
      kind: "project" as const,
      item,
      timestamp: Number(item.lastFollowup) || 0
    })),
    ...priorityPeople.map((item) => ({
      kind: "person" as const,
      item,
      timestamp: Number(item.lastContact) || 0
    }))
  ]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(0, followupLimit);

  return [
    "DOMI_TODO_CLIENT_SNAPSHOT_V1",
    `最近 4 周新入库候选索引（刚由客户端刷新，共 ${recentProjects.length} 个项目、${recentPeople.length} 个人；格式：类型｜recordId｜名称｜系统入库时间｜评级｜进展｜价值证据摘要）：`,
    ...candidates.map(({ kind, item }) => `- ${todoRecentEntryLine(kind, item)}`),
    recentProjects.length + recentPeople.length > recentLimit
      ? `- 另有 ${recentProjects.length + recentPeople.length - recentLimit} 个较早候选未随上下文传入；需要时按 recordId 定向读取。`
      : "",
    "该索引是本轮已刷新资料的 new-entry 权威候选集；不要再次全量读取项目表或人脉表。其他分类已有同一对象，不得作为压制 new-entry 的理由；但同一对象最终都要求联系或约见时，应合并理由并只保留一个开放事项。",
    "若存在符合规则且未受 done/ignored 冷却约束的候选，本轮 new-entry 不得为 0；若全部排除，必须在执行结果中给出逐类排除数量。",
    `A/S 长期跟进候选索引（共 ${priorityProjects.length} 个项目、${priorityPeople.length} 个人；格式：类型｜recordId｜名称｜评级｜进展｜最后跟进或联系｜价值证据摘要）：`,
    ...followupCandidates.map(({ kind, item }) => {
      const detail = todoEvidenceSummary(kind, item)
        || (kind === "project" ? "领域未填写" : "组织未填写");
      const lastActivity = kind === "project"
        ? todoFollowupDate((item as TodoRecentProject).lastFollowup)
        : todoFollowupDate((item as TodoRecentPerson).lastContact);
      return `- ${kind}｜${singleLine(item.recordId)}｜${singleLine(item.name)}｜${singleLine(item.rating)}｜${singleLine(item.status) || "进展未填写"}｜${lastActivity}｜${detail}`;
    }),
    priorityProjects.length + priorityPeople.length > followupLimit
      ? `- 另有 ${priorityProjects.length + priorityPeople.length - followupLimit} 个候选未随上下文传入；需要时按 recordId 定向读取。`
      : "",
    "以上候选已由客户端从本轮项目／人脉快照按 Todo 规则筛出。生成 new-entry、relationship-follow-up 和 project-follow-up 时不得再次全量读取两张表；只允许为字段歧义或账本消歧按 recordId 点读。关键节点日期和已核验新动态仍按 Skill 做最小范围读取。"
  ].filter(Boolean).join("\n");
}

export const workflows: Workflow[] = [
  {
    id: "domi-router",
    title: "处理录音",
    shortTitle: "domi",
    skill: "$domi:domi-router",
    description: "恢复并运行 PLAUD → 纪要 → 投资快评 → 当前项目库主工作流。",
    output: "文字稿、结构化纪要、投资评分和项目库结果",
    defaultPrompt:
      "运行 domi PLAUD 投资录音主工作流：先检查并恢复未完成队列，再发现尚未生成文字稿的录音；严格按 domi Router 的阶段和确认规则执行。",
    hidden: true
  },
  {
    id: "investment-radar",
    title: "更新行业动态",
    shortTitle: "行业雷达",
    skill: "$domi:investment-radar",
    description: "联网检索关注领域的最新行业事件，完成原文核验、事件去重与评分，并更新行业信息追踪。",
    output: "已核验的行业事件、评分、原文链接和简洁归档结果",
    defaultPrompt:
      "请以 quick_scan 增量模式更新 domi 首页行业动态：使用 48 小时重叠回看发现迟发、迟索引内容，整体最长最近 72 小时；上次成功水位只用于标记增量，不得直接截断发现窗口。只覆盖 AI、半导体、智能出行、前沿科技、具身智能&机器人；不要扫描或返回消费、消费科技、互联网科技。直接使用本机重点项目快照、调用方提供的 A/S 重点人物别名索引和缓存分类，不重新读取完整项目库、人脉库或完整 schema；先一次性读取时间窗内既有事件建立去重索引，再并发检索五个一级领域。每轮必须完成一次中文专业科技媒体定向扫源，覆盖 DeepTech 深科技，并为对话、访谈、专访、公开观点等投资论点信号预留候选位。仅对宽搜已出现明确信号的重点对象做定向补查，不逐一扫描全部重点名单。完成原文核验、实体归一、事件级去重与评分后写入当前资料库的行业事件库，最后一次性回读验证并输出带候选/拒绝统计的 RADAR_RESULT。目标在 6 分钟内完成；没有合格增量也必须正常完成并返回 added=0。",
    hidden: true,
    webSearch: true
  },
  {
    id: "task",
    title: "同步待办事项",
    shortTitle: "待办事项",
    skill: "$domi:todo",
    description: "扫描项目、人脉、关键节点与最新动态，维护当前资料库的待办事项文档。",
    output: "按优先级去重的待办事项、下一动作和同步结果",
    defaultPrompt:
      "扫描当前项目库、人脉库、行业动态和关键日期，按关键节点、最近 4 周新入库约见、人脉跟进、项目跟踪四类更新当前资料库的待办事项文档：飞书模式使用 1.待办事项，本地模式使用工作区根目录的 0.待办事项.md。保留待办事项的内部状态，客户端只展示仍需行动的事项；写后回读验证，不要输出任何私人链接、邮箱、Base 标识或本机路径。",
    hidden: true
  },
  {
    id: "schedule",
    title: "约日程",
    shortTitle: "日程",
    skill: "$domi:schedule",
    description: "整理日程主题、时间和地点，并向用户指定的一个或多个参会人发送 Outlook 日程邀请。",
    output: "已发送的 Outlook 日程邀请及主题、时间、地点和参会人状态",
    defaultPrompt:
      "整理我提供的日程主题、时间和地点，并向一个或多个指定参会人发送 Outlook 日程邀请。若我没有选择参会人邮箱，必须先主动询问；不要自动群发常用参会人，也不要读取项目库、人脉库或待办事项文档。",
    quickStart: true
  },
  {
    id: "meeting-prep",
    title: "会前准备",
    shortTitle: "会前准备",
    skill: "$domi:domi-router",
    description: "围绕即将沟通的项目、人物或机构，汇总内部资料与最新动态，生成一页式会前简报和核心问题清单。",
    output: "会前背景摘要、历史互动、最新动态、信息缺口、核心问题和会后动作建议",
    defaultPrompt:
      "运行 domi 会前准备工作流。优先使用当前绑定项目、人物或用户输入的会议对象；对象不明确时，先询问公司／项目名、人物名、会议目的和时间。识别对象后完整读取 domi Router，并按场景采用插件内对应 Skill：项目场景查询 Watching List、Wiki、本地资料库和历史交流材料，按需采用 desk-research 补充最新公开信息；人物场景查询 People 人脉库，采用 sourcing 的 profile／relationship 模式核验履历、关系路径和历史互动；混合场景合并两条路径。输出适合会前快速阅读的一页式简报，包含背景与当前状态、历史互动、最新动态、关键判断、信息缺口、8–10 个优先问题、敏感点、会议目标和会后建议动作。默认保持只读，不做投资评级，不新建或更新项目、人脉及外部记录。",
    quickStart: true,
    hidden: true,
    webSearch: true
  },
  {
    id: "people-intake",
    title: "找人并入库",
    shortTitle: "找人入库",
    skill: "$domi:domi-router",
    description: "发现或核验目标人物，读取 People 人脉表实时结构并查重，将确认后的合格人选写入人脉库。",
    output: "候选人地图、人物画像、查重、字段变更计划和入库结果",
    defaultPrompt:
      "运行 domi 人物研究入库（people intake）工作流。优先使用用户输入的人物姓名、赛道、人才画像或关系线索；目标不明确时，先询问范围、用途、人数和排除条件。目标明确后完整读取 people-intake-workflow，依次执行 sourcing 发现与画像，并按当前资料库后端完成 schema 检查和多键查重；用户点名且身份唯一的单人可按规则直接 upsert，开放式发现或批量候选必须先展示精确变更计划并等待确认，再写入当前人脉库，最后按记录 ID 回读验证。",
    quickStart: true,
    hidden: true,
    webSearch: true
  },
  {
    id: "project-research",
    title: "项目研究",
    shortTitle: "研究项目",
    skill: "$domi:domi-router",
    description: "先读内部材料，再完成项目只读研究；不评级、不归档、不写入外部系统。",
    output: "项目研究、关键判断、信息缺口和是否继续评级入库的确认",
    defaultPrompt:
      "运行 domi 投资项目只读研究工作流。优先使用当前绑定项目或用户输入的项目目标；如果目标仍不明确，先询问项目名称、官网或材料。目标明确后调用 desk-research，先查询内部已有材料再开展公开研究；本轮不要评级、归档或写入外部系统，完成后询问是否继续评级并入库。",
    hidden: true,
    webSearch: true
  },
  {
    id: "project-intake",
    title: "研究并入库",
    shortTitle: "研究入库",
    skill: "$domi:domi-router",
    description: "串联项目研究、投资快评，并按当前资料库后端完成文档、材料与项目记录入库。",
    output: "研究报告、投资快评、项目档案和简洁入库结果",
    defaultPrompt:
      "运行 domi 投资项目研究并入库工作流。优先使用当前绑定项目或用户输入的项目目标；如果目标仍不明确，先询问项目名称、官网或材料。目标明确后严格按 desk-research → investment-review → investment-mgmt 执行，并由 storage-backends 契约选择飞书或本地资料库链路；写入前完成去重和字段校验，写入后验证结构化记录、文档与资料目录。",
    quickStart: true,
    hidden: true,
    webSearch: true
  },
  {
    id: "quick-discussion",
    title: "快速讨论",
    shortTitle: "讨论",
    skill: "$domi:domi-router",
    description: "立即开始本机录音，停止后自动串联 PLAUD、纪要、核心要点和跟进事项。",
    output: "PLAUD 文字稿、结构化纪要、核心要点和跟进事项",
    defaultPrompt:
      "开始 domi 快速讨论工作流：立即使用 mac-recording 以 workflow-kind quick-discussion 开始本机录音，不要先运行 doctor 或 status。用户停止录音后，继续执行 PLAUD 文字稿、ASR Notes 结构化纪要、核心要点和跟进事项。",
    hidden: true,
    requiresPlaud: true
  },
  {
    id: "meeting-note",
    title: "写纪要",
    shortTitle: "纪要",
    skill: "$domi:asr-notes",
    description: "把录音、ASR文字或会议原始记录整理成经过实体和数字核验的结构化纪要。",
    output: "结构化 Markdown 纪要和待确认项",
    defaultPrompt:
      "请处理我提供的录音或文字材料，确认说话人信息，核验实体和关键数字，并输出完整的结构化会议纪要。",
    webSearch: true
  },
  {
    id: "sourcing",
    title: "找人与人脉",
    shortTitle: "人脉",
    skill: "$domi:sourcing",
    description: "发现创业者、做背景调查、规划引荐路径并维护 People 人脉库。",
    output: "候选人地图、人物画像、关系路径和后续行动",
    defaultPrompt:
      "请根据当前输入选择 sourcing 模式；先查询 People 人脉库去重，再开展发现、画像或关系维护。",
    webSearch: true
  },
  {
    id: "desk-research",
    title: "桌面研究",
    shortTitle: "研究",
    skill: "$domi:desk-research",
    description: "结合公开资料、专业数据与内部知识库完成公司画像或赛道扫描。",
    output: "可追溯的公司画像、赛道扫描、核心判断和下一步",
    defaultPrompt:
      "请先识别当前项目或赛道的研究范围，检查内部已有材料，再完成标准深度的桌面研究。",
    webSearch: true
  },
  {
    id: "investment-review",
    title: "项目评级",
    shortTitle: "评级",
    skill: "$domi:investment-review",
    description: "围绕项目独有的关键问题，快速给出有立场的投不投判断。",
    output: "3-5个关键问题、对应判断、1-10分评分和B/A/S评级",
    defaultPrompt:
      "请基于当前项目材料完成投资快评；如果信息不足，明确列出缺口，不要编造项目数据。",
    webSearch: true
  },
  {
    id: "investment-analysis",
    title: "基本面深度分析",
    shortTitle: "深度分析",
    skill: "$domi:investment-analysis",
    description: "分析招股书、财务报表、模型或BP中的业务、财务与经营质量。",
    output: "研究底稿、财务拆解、关键风险和验证清单",
    defaultPrompt:
      "请识别当前材料类型，并按 Investment Analysis 的质量门完成公司基本面分析。",
    webSearch: true
  },
  {
    id: "ic-memo",
    title: "IC Memo",
    shortTitle: "Memo",
    skill: "$domi:ic-memo",
    description: "把项目材料编排成投委会可直接讨论的正式决策报告。",
    output: "投资概要、关键问题、团队、商业模式、交易方案与风险",
    defaultPrompt:
      "请基于当前项目及附件撰写 IC Memo；先检查材料完整度，对缺失内容明确标注，不要用假设填充关键事实。",
    webSearch: true
  },
  {
    id: "investment-mgmt",
    title: "投资管理",
    shortTitle: "项目库",
    skill: "$domi:investment-mgmt",
    description: "查询和维护当前项目库、项目文档与本地材料的一致性。",
    output: "项目查询、分类、状态更新或一致性检查结果",
    defaultPrompt:
      "请基于当前绑定项目查询当前资料库；如涉及写入，先按 storage-backends 契约锁定后端，再执行去重、字段校验和写后验证。"
  },
  {
    id: "deal-negotiation",
    title: "交易谈判",
    shortTitle: "谈判",
    skill: "$domi:deal-negotiation",
    description: "辅助估值、Term Sheet、保护性条款和创始人沟通策略。",
    output: "谈判策略、条款风险、话术和替代方案",
    defaultPrompt:
      "请先确认投资阶段、谈判环节和当前态势，再基于 domi 的交易谈判资料给出建议。"
  }
];

export const quickStartWorkflows = workflows.filter(
  (workflow) => workflow.quickStart
);

export function workflowPrompt(
  workflow: Workflow | undefined,
  userInput: string,
  domiContext = "",
  useDomiPlugin = false
) {
  const trimmed = userInput.trim();
  if (!workflow) {
    if (!useDomiPlugin) {
      return [
        "你正在 domi 投资工作台中运行，底层是本地 Codex。",
        "本轮未启用 domi 插件。不要采用或调用任何 $domi:* Skill；请使用 Codex 的通用能力，用中文直接完成用户任务。",
        "不得编造项目、人脉、融资、财务或会议事实。涉及外部写入时，先向用户确认。",
        domiContext ? `\n工作台当前绑定上下文：\n${domiContext}` : "",
        "",
        "用户请求：",
        trimmed
      ].filter(Boolean).join("\n");
    }
    return [
      "你正在 domi 投资工作台中运行，底层是本地 Codex。",
      "当前启用的分析师是 domi-AI分析师。必须使用已安装的 domi 插件完成本轮任务。",
      "开始前先采用并完整读取 domi 插件中的 $domi:domi-router；根据用户意图路由到插件内最匹配的投资 Skill，并在进入对应阶段前完整读取该 Skill 及其 references。不要使用同名的非 domi Skill 替代。",
      "如果请求不属于 Router 已定义的多阶段工作流，仍应从 domi 插件中选择最匹配的单项投资 Skill；确实没有匹配 Skill 时，再以投资分析师身份直接回答。",
      "请用中文直接完成任务。优先使用已有 Watching List、People、Wiki、本地资料库和下面的 domi 绑定上下文，避免重复研究；不得编造项目、人脉、融资、财务或会议事实；外部写入必须遵循对应 Skill 的确认、去重和字段校验规则。",
      domiContext ? `\ndomi 绑定上下文：\n${domiContext}` : "",
      "",
      "用户请求：",
      trimmed
    ].filter(Boolean).join("\n");
  }

  const outputFile = `./outputs/${new Date().toISOString().slice(0, 10)}-${workflow.id}.md`;
  if (workflow.id === "investment-radar") {
    return [
      "你正在 domi 投资工作台中运行，底层是本地 Codex。",
      "采用 domi 插件中的 $domi:investment-radar，并严格执行该 Skill 的 quick_scan 快速增量路径。只需读取 quick_scan 明确要求的最小引用集；不要先加载 domi Router、sourcing 全文、完整 Watching List 或 People 表。",
      "本轮是首页手动刷新：先建立一份覆盖重叠回看窗口的既有事件去重索引，再并发搜索；A/S 重点人物别名索引只用于匹配与消歧，有直接事件信号时才补查对象。每轮必须完成 DeepTech 深科技等中文专业媒体扫源，并为深度访谈/公开观点类投资论点信号预留候选位。把耗时控制在 6 分钟内，达到 12 条高质量候选或 8 条合格新增后停止扩展搜索。",
      "写入后进行一次批量回读；执行结束必须输出一行机器可读结果：RADAR_RESULT {\"added\":0,\"updated\":0,\"unchanged\":0,\"failed\":0,\"checked_through\":\"ISO-8601\",\"discovery_from\":\"ISO-8601\",\"candidates\":0,\"rejected\":{\"duplicate\":0,\"not_event\":0,\"unverified\":0,\"unavailable\":0,\"out_of_scope\":0}}。没有新增不是失败。",
      "不得编造新闻、融资或公司事实；不得修改 domi 应用源码。",
      domiContext ? `\ndomi 绑定上下文：\n${domiContext}` : "",
      "",
      "用户输入：",
      trimmed || workflow.defaultPrompt
    ].filter(Boolean).join("\n");
  }
  if (workflow.id === "task") {
    return [
      "你正在 domi 投资工作台后台运行待办事项同步，底层是本地 Codex。",
      "采用 domi 插件中的 $domi:todo，并执行该 Skill 的客户端快速同步路径。完整读取 Todo Skill、suggestion-rules 和 todo-ledger-schema；不要先加载 domi Router，也不要加载与当前后端无关的通用技能。",
      "客户端已先刷新项目与人脉。若上下文包含 DOMI_TODO_CLIENT_SNAPSHOT_V1，直接使用其中的新入库和 A/S 长期跟进候选；不得为这些分类再次全量读取项目表或人脉表。仅对关键节点日期、已核验关联动态、字段歧义或账本消歧做最小范围读取。",
      "客户端候选最后一列已经提供价值证据摘要；摘要足以解释下一步动作时，禁止再点读项目或人物记录。",
      "当前待办账本只读取一次，完成去重与排序后单次写入，再单次回读验证。保持完整规则、证据门槛和 12 项配额，不得用减少判断维度换取速度。",
      "本轮以待办文档成功写入并回读为完成条件；不要撰写长篇过程报告，写后只输出各分类计数和排除计数摘要。",
      "不得输出私人链接、邮箱、Base 标识或本机路径；不得修改 domi 应用源码。",
      domiContext ? `\ndomi 客户端候选上下文：\n${domiContext}` : "",
      "",
      "用户输入：",
      trimmed || workflow.defaultPrompt
    ].filter(Boolean).join("\n");
  }
  return [
    "你正在 domi 投资工作台中运行，底层是本地 Codex。",
    `必须采用 domi 插件中的 Skill：${workflow.skill}。进入执行阶段前完整读取该 Skill 及其要求的 references，不要用通用模板或同名非 domi Skill 替代。`,
    "",
    `工作流：${workflow.title}`,
    `目标：${workflow.description}`,
    `期望产物：${workflow.output}`,
    domiContext ? `\ndomi 绑定上下文：\n${domiContext}` : "",
    "",
    "执行要求：",
    "1. 遵循该 domi Skill 的去重、核验、信息不足和外部写入确认规则。",
    "2. 先使用已有 Watching List、People、Wiki 或本地资料库上下文，避免重复研究和重复建档。",
    "3. 不得编造项目、人脉、融资、财务或会议事实。",
    `4. 遵循 Skill 自己的产物路径；如 Skill 未指定路径，长产物写入 ${outputFile}。`,
    "5. 不要修改 domi 工作台应用源码。",
    "",
    "用户输入：",
    trimmed || workflow.defaultPrompt
  ].filter(Boolean).join("\n");
}
