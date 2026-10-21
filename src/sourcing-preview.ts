import type { SourcingSnapshot } from "./sourcing-types";

// Explicit preview route only. These UI examples never seed the user's library.
// Names and discovery routes come from the reference workbook; all timestamps,
// run results, intake decisions and record identifiers below are demonstration data.
const at = (minute: number) => Date.parse(`2026-10-21T09:${String(minute).padStart(2, "0")}:00+08:00`);
export const previewSourcingSnapshot: SourcingSnapshot = {
  ok: true,
  configured: true,
  settings: { enabled: true, localHour: 9, timeZone: "Asia/Shanghai", autoIntake: true },
  run: { status: "idle", lastAttemptAt: at(0), lastSuccessAt: at(18), nextRunAt: Date.parse("2026-10-22T09:00:00+08:00"), coverage: { checked: 6, failed: 0, pending: 0 } },
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
    { id: "preview-xiao", name: "萧屹枫", kind: "person", founders: ["萧屹枫"], summary: "个人经历中的创业信号，保留为创始人观察线索。", domain: "AI 研究与应用", tags: ["人物观察"], signal: "个人主页披露创业相关经历，尚需确认对应团队与产品。", discoveredAt: at(13), lastSeenAt: at(13), stage: "new", confidence: "medium", sources: [{ url: "https://yfxiao16.github.io/experiences/", title: "萧屹枫 · Experiences", type: "person" }], discoveryPath: ["研究者主页", "职业变化", "潜在创始人"], relatedEntities: [], intake: { status: "pending", reason: "预览示例：先留在候选池，核验后再建立人脉档案与团队关系。" }, nextAction: "核实创业主体、联合创始人和公开联络路径。" },
    { id: "preview-second", name: "第二次启蒙", kind: "company", founders: ["薛天禄"], summary: "从创始人访谈延展，核验旗下产品与公司主体。", domain: "AI 应用", tags: ["连续创业"], signal: "访谈出现公司与产品信息，按同一主体整理多产品关系。", discoveredAt: at(11), lastSeenAt: at(11), stage: "new", confidence: "high", sources: [{ url: "https://dinehq.com/news/tianlu-interview/", title: "Dine · 薛天禄访谈", type: "event" }], discoveryPath: ["创始人访谈", "薛天禄", "第二次启蒙"], relatedEntities: [], intake: { status: "created", projectId: "preview-project-second", personIds: ["preview-person-xue"], reason: "预览示例：主体核验通过后建立项目与创始人档案，多产品关联到同一家公司。" }, nextAction: "继续跟踪产品发布、用户验证与商业进展。" },
    { id: "preview-chorus", name: "Chorus", kind: "product", founders: ["陈逸斐"], summary: "从社区项目追到开源作者，创业主体仍待核实。", domain: "AI Agent", tags: ["开源产品"], signal: "开源作者与产品线索可以关联，但尚不足以确认独立公司。", discoveredAt: at(9), lastSeenAt: at(9), stage: "new", confidence: "low", sources: [{ url: "https://github.com/ChenNima", title: "陈逸斐 · GitHub", type: "open_source" }], discoveryPath: ["社区项目", "GitHub 作者", "Chorus"], relatedEntities: [], intake: { status: "needs_review", reason: "预览示例：保留独立产品候选，不将开源仓库自动等同创业公司。" }, nextAction: "确认开发者与产品的关系、是否独立创业，以及当前投入程度。" },
    { id: "preview-phai", name: "PhAI lab", kind: "company", founders: ["吴英成"], summary: "人物主页的新身份，补充到已有项目关系。", domain: "AI for Science", tags: ["已有项目关联"], signal: "吴英成的创业身份指向 PhAI lab，与现有主体合并关联。", discoveredAt: at(7), lastSeenAt: at(7), stage: "watching", confidence: "high", sources: [{ url: "https://charles-wu.com/", title: "吴英成 · 个人主页", type: "project" }], discoveryPath: ["已有人物线索", "本人主页", "PhAI lab"], relatedEntities: [{ type: "project", id: "preview-project-phai", name: "PhAI lab", relation: "同一创业主体，补充创始人关系" }], intake: { status: "matched", projectId: "preview-project-phai", reason: "预览示例：识别人物别名与公司关系，补充已有档案，避免重复建立隐形团队。" }, nextAction: "围绕共同作者、团队成员与相关实验室继续延展。" },
  ],
};
