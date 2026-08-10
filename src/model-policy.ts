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
  "quick-discussion",
  "meeting-note",
  "meeting-prep",
  "project-research",
  "project-intake",
  "desk-research",
  "investment-review",
  "investment-analysis",
  "ic-memo"
]);

function normalizedPreference(value: string | undefined, fallback: string) {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

export function domiModelPolicyClass(
  workflowId?: string,
  runKind?: DomiModelPolicyRunKind
): DomiModelPolicyClass {
  if (runKind === "podcast-archive") return "premium";
  const normalizedWorkflowId = String(workflowId || "").trim();
  if (ECONOMY_WORKFLOW_IDS.has(normalizedWorkflowId)) return "economy";
  if (PREMIUM_WORKFLOW_IDS.has(normalizedWorkflowId)) return "premium";
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
 * speed tier. Unclassified work keeps all user selections unchanged.
 */
export function resolveDomiModelPolicy(
  request: DomiModelPolicyRequest
): DomiModelPolicySelection {
  const policyClass = domiModelPolicyClass(request.workflowId, request.runKind);
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
