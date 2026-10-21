import type { SourcingBeginResult, SourcingSnapshot } from "./sourcing-types.ts";

type SourcingRunDependencies = {
  begin: (request: { force: boolean }) => Promise<SourcingBeginResult>;
  execute: (lease: SourcingBeginResult) => Promise<{ ok: boolean; stopped?: boolean; error?: string }>;
  finish: (request: { runId: string; leaseToken: string; error?: string }) => Promise<SourcingSnapshot>;
  onSnapshot: (snapshot: SourcingSnapshot) => void;
};

/** The persisted merge receipt, never assistant text, determines completion. */
export async function executeSourcingRun(deps: SourcingRunDependencies, force = false) {
  const lease = await deps.begin({ force });
  deps.onSnapshot(lease);
  if (!lease.ok || !lease.started || !lease.runId || !lease.leaseToken) return lease;
  let error: string | undefined;
  try {
    const result = await deps.execute(lease);
    if (!result.ok || result.stopped) error = result.error || (result.stopped ? "发现任务已停止，将在稍后重试。" : "发现任务未成功完成。");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const snapshot = await deps.finish({ runId: lease.runId, leaseToken: lease.leaseToken, ...(error ? { error } : {}) });
  deps.onSnapshot(snapshot);
  return snapshot;
}

export function sourcingRequestText(lease: SourcingBeginResult, followedDomains: string[]) {
  return [
    "mode=underwater_discover",
    `runId=${lease.runId}`,
    `leaseToken=${lease.leaseToken}`,
    `ledgerPath=${lease.ledgerPath}`,
    `settings=${JSON.stringify(lease.settings)}`,
    `followed_domains=${JSON.stringify(followedDomains)}`,
    `sources=${JSON.stringify(lease.sources)}`,
    `last_success=${lease.run.lastSuccessAt ? new Date(lease.run.lastSuccessAt).toISOString() : "none; first run requires a baseline"}`,
    "先从当前项目库、人脉库全量分页读取建立实体与关系索引，再围绕已启用来源、重点实验室和相关人物/项目做发现。新增来源需验证真实公开入口；没有明确创业信号的人物保留为待观察线索。",
    "核验后同时完成项目和人物查重，保留实体层级、别名、来源链接、发现路径和首次发现时间；相同团队不同项目名不得重复建库。",
    "identityUrl 仅可填候选专属官网/个人主页，名单页和通用机构页不能当身份键。只按名称或共同来源不得合并人物。created 必须提交每个新建实体真实 finalize 返回的 intake.receipts（entityType/entityId/receiptPath/manifestPath），与本轮执行和实体绑定；matched 也需回读身份依据，不能借用同名或无关 ID。",
    lease.settings.autoIntake
      ? "用户已在水下项目设置中授权持续自动入库：身份明确、证据充分且查重无冲突的项目/人物写入当前本地库。疑似同名、同团队、仅有创业传闻或证据不足时保留待核验，禁止覆盖已有评级/状态。"
      : "自动入库已关闭：只更新候选池与发现范围，不新增或修改项目库、人脉库记录。",
    "真实完成本轮全部来源与检索范围才标记 checked；失败/未完成项保留 failed/pending，不得以零新增代替覆盖。无新候选仍需 merge candidates:[] 和真实 coverage。"
  ].join("\n");
}
