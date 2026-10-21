import type { SourcingSnapshot } from "./sourcing-types";

// Explicit preview route only. These UI examples never seed the user's library.
// Some names and discovery routes come from the reference workbook; the explicitly
// named synthetic research-assistant example has no real people or relationships. All timestamps,
// run results, intake decisions and record identifiers below are demonstration data.
const at = (minute: number) => Date.parse(`2026-10-21T09:${String(minute).padStart(2, "0")}:00+08:00`);
export const previewSourcingSnapshot: SourcingSnapshot = {
  ok: true,
  configured: true,
  focusConfigured: true,
  settings: { enabled: true, localHour: 9, timeZone: "Asia/Shanghai", autoIntake: true },
  run: { status: "idle", lastAttemptAt: at(0), lastSuccessAt: at(18), nextRunAt: Date.parse("2026-10-22T09:00:00+08:00"), coverage: { checked: 6, failed: 0, pending: 0 } },
  // Illustrative focus choices only; these do not describe the user's settings.
  focuses: [
    { id: "preview-focus-agent", name: "关注 AI Agent 和具身智能，重点看 MMLab 校友、相关开源作者，以及已有人脉周围有创业迹象的人。优先寻找还没有大规模公开曝光的新团队。", type: "freeform", keywords: [], excludedKeywords: [], relations: [], urls: [], enabled: true },
    { id: "preview-focus-science", name: "围绕 PhAI lab、吴英成的共同作者和合作者寻找潜在创业者，重点关注 AI for Science。希望看到可核验的团队、产品或职业变化，暂不看纯硬件代工。", type: "freeform", keywords: [], excludedKeywords: [], relations: [], urls: [], enabled: true },
    { id: "preview-focus-product", name: "持续寻找华人创始人的 AI 应用和基础设施项目。可以从创始人访谈、活动名单、GitHub 产品和现有项目库延展，并与已有项目、人脉查重。", type: "freeform", keywords: [], excludedKeywords: [], relations: [], urls: [], enabled: true }
  ],
  sources: [
    { id: "preview-source-mmlab", name: "MMLab · 成员与校友", type: "lab", url: "https://liuziwei7.github.io/team.html", enabled: true, lastCheckedAt: at(3), status: "checked", detail: "沿校友去向、个人主页与新团队继续查找。" },
    { id: "preview-source-xiao", name: "萧屹枫 · 个人主页", type: "person", url: "https://yfxiao16.github.io/experiences/", enabled: true, lastCheckedAt: at(5), status: "checked", detail: "关注职业变化、创业身份与公开产品。" },
    { id: "preview-source-phai", name: "PhAI lab · 关联创始人", type: "project", url: "https://charles-wu.com/", enabled: true, lastCheckedAt: at(7), status: "checked", detail: "从已有项目向团队成员、共同作者与合作者延展。" },
    { id: "preview-source-dine", name: "Dine · 创始人访谈", type: "event", url: "https://dinehq.com/news/tianlu-interview/", enabled: true, lastCheckedAt: at(10), status: "checked", detail: "从访谈人物继续核验公司、产品与创业阶段。" },
    { id: "preview-source-chorus", name: "Chorus · 开源作者", type: "open_source", url: "https://github.com/ChenNima", enabled: true, lastCheckedAt: at(12), status: "checked", detail: "观察作者身份、独立产品与持续开发信号。" },
    { id: "preview-source-shareai", name: "ShareAI Lab · 开源项目", type: "open_source", url: "https://github.com/shareAI-lab", enabled: true, lastCheckedAt: at(14), status: "checked", detail: "从公开代码与组织主页检查产品、团队和创业线索。" },
  ],
  candidates: [
    { id: "preview-genux", name: "GenuX", kind: "team", founders: ["许牧天"], summary: "从研究者去向中发现的早期创业团队线索。", domain: "AI 基础设施", tags: ["校友创业"], signal: "校友名录出现团队线索，继续追踪本人主页与创业身份。", discoveredAt: at(15), lastSeenAt: at(15), stage: "new", confidence: "medium", sources: [{ url: "https://liuziwei7.github.io/team.html", title: "MMLab 成员与校友名单", type: "lab" }], discoveryPath: ["MMLab 校友", "许牧天", "GenuX"], relatedEntities: [], intake: { status: "needs_review", reason: "预览示例：公司主体与团队关系仍需核验，不直接创建正式公司。" }, nextAction: "确认创始人身份、公司主体与当前产品，再判断是否建立项目档案。" },
    {
      id: "preview-research-assistant", name: "示例项目·研究助手", kind: "product", founders: ["示例创始人·林博士"],
      summary: "面向研究员的文献检索、观点核验与研究工作流助手。", domain: "AI 研究工具", tags: ["合成界面示例"],
      signal: "示例产品页出现研究助手与创始人介绍，可进一步核验产品和创业主体。", discoveredAt: at(17), lastSeenAt: at(17), stage: "new", confidence: "medium",
      sources: [
        { url: "https://example.com/research-assistant", title: "示例产品介绍（合成演示）", type: "other" },
        { url: "https://example.com/research-meetup", title: "示例研究社区活动（合成演示）", type: "event" }
      ],
      discoveryPath: ["研究工作流方向", "公开产品页", "示例项目·研究助手"], relatedEntities: [],
      contactPaths: {
        status: "found", note: "仅展示可询问的线索，尚未确认引荐意愿。", checkedAt: at(17),
        items: [
          {
            via: { type: "person", id: "preview-person-chen", name: "示例联系人·陈女士" },
            chain: ["示例联系人·陈女士", "前同事：示例创始人·林博士", "示例项目·研究助手"], basis: "library_record",
            reason: "示例人脉档案记载，陈女士与林博士曾在同一研究团队共事；可先向陈女士核实目前是否仍有联系。",
            nextStep: "询问陈女士是否仍认识林博士，以及是否愿意帮助介绍。",
            evidence: [{ kind: "library", entity: { type: "person", id: "preview-person-chen", name: "示例联系人·陈女士" }, quote: "合成档案示例：陈女士与林博士曾在同一研究团队共事，未记录引荐意愿。", documentPath: "/preview/contacts/chen-notes.md" }]
          },
          {
            via: { type: "project", id: "preview-project-knowledge-assistant", name: "示例项目·知识助手" },
            chain: ["知识助手的产品负责人", "同场研究社区活动", "示例创始人·林博士"], basis: "public_overlap",
            reason: "示例项目中的产品负责人与林博士出现在同一公开活动名单，现有材料尚未证明两人熟识。",
            nextStep: "先问知识助手的产品负责人是否认识林博士，再确认是否愿意介绍。",
            evidence: [
              { kind: "library", entity: { type: "project", id: "preview-project-knowledge-assistant", name: "示例项目·知识助手" }, quote: "合成档案示例：知识助手的产品负责人参与研究者社区，未记录与林博士的私人关系。" },
              { kind: "web", url: "https://example.com/research-meetup", quote: "合成活动示例：知识助手产品负责人与林博士同列嘉宾；同场出席不能证明彼此认识。" }
            ]
          }
        ]
      },
      researchLinks: {
        status: "found", note: "以下是合成示例的研究对照，不代表真实项目关系。", checkedAt: at(17),
        items: [
          {
            target: { type: "project", id: "preview-project-knowledge-assistant", name: "示例项目·知识助手" }, relation: "similar_product",
            reason: "都提供文档检索、引用回溯与结论整理，服务需要核对信息来源的用户。",
            difference: "研究助手聚焦学术文献与研究计划；知识助手侧重企业内部文档和团队知识协作。",
            evidence: [
              { kind: "library", entity: { type: "project", id: "preview-project-knowledge-assistant", name: "示例项目·知识助手" }, quote: "合成项目档案：知识助手支持企业内部文档检索、引用回溯与团队知识协作。" },
              { kind: "web", url: "https://example.com/research-assistant", quote: "合成产品介绍：研究助手面向学术文献检索、证据核对与研究计划整理。" }
            ]
          },
          {
            target: { type: "project", id: "preview-project-lab-workflow", name: "示例项目·实验协作助手" }, relation: "same_direction",
            reason: "共同关注科研工作流，用 AI 整理研究输入并支持团队协作。",
            difference: "研究助手处理论文与证据；实验协作助手处理实验日志、共享任务和进度流转。",
            evidence: [
              { kind: "library", entity: { type: "project", id: "preview-project-lab-workflow", name: "示例项目·实验协作助手" }, quote: "合成项目档案：实验协作助手面向实验日志、共享任务和研究团队进度流转。" },
              { kind: "web", url: "https://example.com/research-assistant", quote: "合成产品介绍：研究助手围绕文献和证据核对组织科研工作流。" }
            ]
          }
        ]
      },
      intake: { status: "pending", reason: "纯合成界面示例，未创建真实项目或人脉记录。" }, nextAction: "先核验创业主体，再询问有依据的联系人是否愿意帮助介绍。"
    },
    { id: "preview-second", name: "第二次启蒙", kind: "company", founders: ["薛天禄"], summary: "从创始人访谈延展，核验旗下产品与公司主体。", domain: "AI 应用", tags: ["连续创业"], signal: "访谈出现公司与产品信息，按同一主体整理多产品关系。", discoveredAt: at(11), lastSeenAt: at(11), stage: "new", confidence: "high", sources: [{ url: "https://dinehq.com/news/tianlu-interview/", title: "Dine · 薛天禄访谈", type: "event" }], discoveryPath: ["创始人访谈", "薛天禄", "第二次启蒙"], relatedEntities: [], intake: { status: "created", projectId: "preview-project-second", personIds: ["preview-person-xue"], reason: "预览示例：主体核验通过后建立项目与创始人档案，多产品关联到同一家公司。" }, nextAction: "继续跟踪产品发布、用户验证与商业进展。" },
    { id: "preview-chorus", name: "Chorus", kind: "product", founders: ["陈逸斐"], summary: "从社区项目追到开源作者，创业主体仍待核实。", domain: "AI Agent", tags: ["开源产品"], signal: "开源作者与产品线索可以关联，但尚不足以确认独立公司。", discoveredAt: at(9), lastSeenAt: at(9), stage: "new", confidence: "low", sources: [{ url: "https://github.com/ChenNima", title: "陈逸斐 · GitHub", type: "open_source" }], discoveryPath: ["社区项目", "GitHub 作者", "Chorus"], relatedEntities: [], intake: { status: "needs_review", reason: "预览示例：保留独立产品候选，不将开源仓库自动等同创业公司。" }, nextAction: "确认开发者与产品的关系、是否独立创业，以及当前投入程度。" },
    { id: "preview-phai", name: "PhAI lab", kind: "company", founders: ["吴英成"], summary: "人物主页的新身份，补充到已有项目关系。", domain: "AI for Science", tags: ["已有项目关联"], signal: "吴英成的创业身份指向 PhAI lab，与现有主体合并关联。", discoveredAt: at(7), lastSeenAt: at(7), stage: "watching", confidence: "high", sources: [{ url: "https://charles-wu.com/", title: "吴英成 · 个人主页", type: "project" }], discoveryPath: ["已有人物线索", "本人主页", "PhAI lab"], relatedEntities: [{ type: "project", id: "preview-project-phai", name: "PhAI lab", relation: "同一创业主体，补充创始人关系" }], intake: { status: "matched", projectId: "preview-project-phai", reason: "预览示例：识别人物别名与公司关系，补充已有档案，避免重复建立隐形团队。" }, nextAction: "围绕共同作者、团队成员与相关实验室继续延展。" },
  ],
};
