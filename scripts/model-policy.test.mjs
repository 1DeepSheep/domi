import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DOMI_ECONOMY_MODEL_ID,
  DOMI_PREMIUM_MODEL_ID,
  domiModelPolicyClass,
  isDomiPremiumNaturalLanguageTask,
  resolveDomiModelPolicy
} from "../src/model-policy.ts";
import {
  domiSlidesDeliveryPolicyForText,
  workflowPrompt,
  workflows,
} from "../src/workflows.ts";

const models = [
  {
    id: DOMI_ECONOMY_MODEL_ID,
    supportedReasoningEfforts: [{ id: "low" }, { id: "medium" }],
    serviceTiers: [{ id: "priority" }]
  },
  {
    id: DOMI_PREMIUM_MODEL_ID,
    supportedReasoningEfforts: [{ id: "medium" }, { id: "high" }, { id: "max" }],
    serviceTiers: [{ id: "priority" }, { id: "flex" }]
  }
];

function resolve(workflowId, overrides = {}) {
  return resolveDomiModelPolicy({
    workflowId,
    models,
    userModel: "user-selected-model",
    userReasoningEffort: "high",
    userServiceTier: "priority",
    ...overrides
  });
}

function resolveNaturalLanguage(requestText, overrides = {}) {
  return resolve(undefined, {
    useDomiPlugin: true,
    requestText,
    domiSlidesDeliveryPolicy: domiSlidesDeliveryPolicyForText(requestText),
    ...overrides
  });
}

test("radar and Todo use Terra medium at standard speed", () => {
  for (const workflowId of ["investment-radar", "task"]) {
    assert.deepEqual(resolve(workflowId), {
      policyClass: "economy",
      model: DOMI_ECONOMY_MODEL_ID,
      reasoningEffort: "medium",
      serviceTier: "standard"
    });
  }
});

test("externally deliverable workflows use Sol max and preserve the user speed tier", () => {
  const workflows = [
    "domi-router",
    "meeting-note",
    "meeting-prep",
    "project-research",
    "project-intake",
    "desk-research",
    "investment-review",
    "investment-analysis",
    "ic-memo"
  ];
  for (const workflowId of workflows) {
    assert.deepEqual(resolve(workflowId, { userServiceTier: "flex" }), {
      policyClass: "premium",
      model: DOMI_PREMIUM_MODEL_ID,
      reasoningEffort: "max",
      serviceTier: "flex"
    });
  }
});

test("podcast archive is explicitly pinned to the premium policy", () => {
  assert.equal(domiModelPolicyClass(undefined, "podcast-archive"), "premium");
  assert.deepEqual(resolveDomiModelPolicy({
    runKind: "podcast-archive",
    models,
    userModel: "default",
    userReasoningEffort: "default",
    userServiceTier: "default"
  }), {
    policyClass: "premium",
    model: DOMI_PREMIUM_MODEL_ID,
    reasoningEffort: "max",
    serviceTier: "default"
  });
});

test("ordinary and unclassified workflows inherit every user selection", () => {
  assert.deepEqual(resolve("schedule"), {
    policyClass: "inherit",
    model: "user-selected-model",
    reasoningEffort: "high",
    serviceTier: "priority"
  });
  assert.deepEqual(resolve(undefined), {
    policyClass: "inherit",
    model: "user-selected-model",
    reasoningEffort: "high",
    serviceTier: "priority"
  });
});

test("A-E free-form Chinese domi requests use the premium Sol max policy", () => {
  const requests = [
    "同步这条 PLAUD 管理层访谈，生成纪要、评级并入库",
    "把这份普通客户访谈整理成纪要",
    "研究某创业公司并入库",
    "做一份投研 slides",
    "对某上市公司做一份高质量投资分析"
  ];

  for (const requestText of requests) {
    assert.equal(
      isDomiPremiumNaturalLanguageTask(
        requestText,
        domiSlidesDeliveryPolicyForText(requestText)
      ),
      true,
      requestText
    );
    assert.deepEqual(resolveNaturalLanguage(requestText, { userServiceTier: "flex" }), {
      policyClass: "premium",
      model: DOMI_PREMIUM_MODEL_ID,
      reasoningEffort: "max",
      serviceTier: "flex"
    });
  }
});

test("free-form premium semantics apply only while the domi plugin is enabled", () => {
  const requestText = "深度研究这家公司的基本面并给出投资评分";
  assert.deepEqual(resolveNaturalLanguage(requestText, { useDomiPlugin: false }), {
    policyClass: "inherit",
    model: "user-selected-model",
    reasoningEffort: "high",
    serviceTier: "priority"
  });
  assert.deepEqual(resolveNaturalLanguage("你好，随便聊聊今天的安排"), {
    policyClass: "inherit",
    model: "user-selected-model",
    reasoningEffort: "high",
    serviceTier: "priority"
  });
});

test("diagnostics and ordinary file edits do not become premium by keyword collision", () => {
  const ordinaryRequests = [
    "PLAUD 同步失败，一直报错，帮我排查客户端故障",
    "项目研究入库失败，请诊断工作流错误",
    "投资分析功能为什么不能用？",
    "为什么这个 PPT 打不开？",
    "帮我修复 investment-analysis.ts 文件里的 TypeScript 报错",
    "把“项目研究.md”文件重命名为“研究归档.md”",
    "把 IC memo 文档里的字体换成宋体",
    "修改这份投资分析报告里的错别字",
    "修正这个 PPT 的拼写和页码"
  ];

  for (const requestText of ordinaryRequests) {
    assert.deepEqual(resolveNaturalLanguage(requestText), {
      policyClass: "inherit",
      model: "user-selected-model",
      reasoningEffort: "high",
      serviceTier: "priority"
    }, requestText);
  }
});

test("explicit business retries override a preceding failure diagnostic", () => {
  const retryRequests = [
    "PLAUD 同步失败了，请重新同步这条并生成纪要",
    "PLAUD 同步失败了请重新同步这条并生成纪要",
    "项目入库失败，请重新研究并入库",
    "项目入库失败，再研究并入库",
    "投资分析报错了，请重做这家公司的投资分析",
    "IC memo 生成失败了，请重做",
    "投资分析报错了，请重试",
    "PLAUD 同步失败了，再试一次",
    "项目入库失败了，再来一次",
    "投资分析失败了，再做一次",
    "IC memo 生成失败，重新来一遍",
    "项目研究失败，恢复执行"
  ];

  for (const requestText of retryRequests) {
    assert.deepEqual(resolveNaturalLanguage(requestText, { userServiceTier: "flex" }), {
      policyClass: "premium",
      model: DOMI_PREMIUM_MODEL_ID,
      reasoningEffort: "max",
      serviceTier: "flex"
    }, requestText);
  }
});

test("retry wording does not upgrade troubleshooting or mechanical reruns", () => {
  const diagnosticRequests = [
    "PLAUD 同步失败了，帮我排查为什么失败",
    "项目入库失败，请修复客户端故障",
    "投资分析报错了，请重新启动客户端并排查错误",
    "项目研究.md 报错，请重新执行这个脚本",
    "项目研究报错，请重新分析错误原因",
    "投资分析失败，请重新分析失败原因",
    "项目研究报错，请重新研究报错原因",
    "PLAUD 处理失败，请重新处理错误日志",
    "IC memo 报错，请重新启动客户端",
    "PLAUD 同步失败了，会重新同步并生成纪要吗？",
    "investment-analysis.ts 报错，请重新格式化这个文件",
    "项目研究.md 文件报错，请重试"
  ];

  for (const requestText of diagnosticRequests) {
    assert.deepEqual(resolveNaturalLanguage(requestText), {
      policyClass: "inherit",
      model: "user-selected-model",
      reasoningEffort: "high",
      serviceTier: "priority"
    }, requestText);
  }
});

test("explicit compact workflows outrank premium-looking natural language", () => {
  for (const workflowId of ["investment-radar", "task"]) {
    assert.deepEqual(resolve(workflowId, {
      useDomiPlugin: true,
      requestText: "深度研究上市公司并生成投资分析"
    }), {
      policyClass: "economy",
      model: DOMI_ECONOMY_MODEL_ID,
      reasoningEffort: "medium",
      serviceTier: "standard"
    });
  }
});

test("project-library phrasing and substantive revisions remain premium", () => {
  const requests = [
    "把这份研究材料整理入项目库",
    "核查这家公司的融资历史和投资人背景",
    "补充这份投资分析报告的估值、风险和证据",
    "修改这个 PPT，并补充估值和投资建议"
  ];
  for (const requestText of requests) {
    assert.equal(resolveNaturalLanguage(requestText).policyClass, "premium", requestText);
  }
});

test("a missing model/list fails closed instead of silently falling back", () => {
  assert.throws(
    () => resolve("investment-radar", { models: [] }),
    /model\/list.*不会静默/
  );
  assert.throws(
    () => resolve("ic-memo", { models: undefined }),
    /model\/list.*不会静默/
  );
});

test("missing models and reasoning capabilities fail closed", () => {
  assert.throws(
    () => resolve("investment-radar", { models: models.slice(1) }),
    new RegExp(`${DOMI_ECONOMY_MODEL_ID}.*不会静默降级`)
  );
  assert.throws(
    () => resolve("ic-memo", {
      models: [{
        id: DOMI_PREMIUM_MODEL_ID,
        supportedReasoningEfforts: [{ id: "high" }],
        serviceTiers: [{ id: "priority" }]
      }]
    }),
    /不支持策略要求的 max.*不会静默降级/
  );
});

test("premium work never silently changes an unsupported user speed tier", () => {
  assert.throws(
    () => resolve("meeting-note", { userServiceTier: "unsupported-fast" }),
    /不支持用户选择的 unsupported-fast.*不会静默改档/
  );
});

test("every renderer entry point uses the centralized policy before starting or persisting a run", () => {
  const appSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "App.tsx"),
    "utf8"
  );
  const segment = (startMarker, endMarker) => {
    const start = appSource.indexOf(startMarker);
    const end = appSource.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing App segment: ${startMarker}`);
    return appSource.slice(start, end);
  };

  const radar = segment("async function scanWeeklyNews", "async function archivePodcastTranscript");
  assert.match(radar, /resolveRunModelPolicy\(radarWorkflow\.id\)/);
  assert.match(radar, /model: runModelPolicy\.model/);
  assert.doesNotMatch(radar, /model,\s*\n\s*reasoningEffort,\s*\n\s*serviceTier/);

  const podcast = segment("async function archivePodcastTranscript", "async function notifyImportantWeeklyNews");
  assert.match(podcast, /runKind: "podcast-archive"/);
  assert.match(podcast, /model: runModelPolicy\.model/);

  const todo = segment("async function syncManagedTasks", "async function resolveDomiEntityWorkspacePath");
  assert.match(todo, /resolveRunModelPolicy\(todoWorkflow\.id\)/);
  assert.match(todo, /serviceTier: runModelPolicy\.serviceTier/);

  const submit = segment("async function submitToCodexInternal", "function handleSubmit");
  assert.match(submit, /resolveRunModelPolicy\(workflow\?\.id/);
  assert.match(submit, /useDomiPlugin,\s*\n\s*requestText: messageText/);
  assert.match(submit, /model: runModelPolicy\.model/);

  const queue = segment("function enqueueSubmission", "function removeQueuedSubmission");
  assert.match(queue, /resolveRunModelPolicy\(workflow\?\.id\s*,/);
  assert.match(queue, /useDomiPlugin: domiPluginEnabled,\s*\n\s*requestText: messageText/);
  assert.match(queue, /model: runModelPolicy\.model/);

  const resolver = segment("function resolveRunModelPolicy", "const deferredThreadQuery");
  assert.match(resolver, /domiSlidesDeliveryPolicyForText\(semanticRequestText\)/);
  assert.match(resolver, /useDomiPlugin: options\.useDomiPlugin/);
  assert.match(resolver, /requestText: semanticRequestText/);
});

test("programmatic Radar and Todo prompts request only their compact execution contracts", () => {
  const workflowSource = fs.readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "workflows.ts"),
    "utf8"
  );
  assert.match(workflowSource, /investment-radar[\s\S]*quick_scan[^]*?只需读取 quick_scan 明确要求的最小引用集/);
  assert.match(workflowSource, /DOMI_TODO_CLIENT_SNAPSHOT_V1[^]*?不再读取 suggestion-rules、todo-ledger-schema、storage-backends/);
});

test("context efficiency is lossless and never lowers premium reasoning quality", () => {
  const request = "研究一家创业公司并结构化入库";
  const prompt = workflowPrompt(undefined, request, "", true);

  assert.match(prompt, /不得降低模型等级、推理强度、证据覆盖/);
  assert.match(prompt, /不得因 token 预算提前停止、截断材料或以有损摘要替代原文/);
  assert.match(prompt, /只读任务不得为了节省 token 新增资料库、交付文件或外部副本/);
  assert.match(prompt, /不得扩张持久化或外部写入权限/);
  assert.match(prompt, /工件路径、内容哈希、实体 ID、Evidence Ledger／来源索引/);
  assert.match(prompt, /路由、授权或信息范围不确定时，保守加载完整规则与原始材料/);
  assert.deepEqual(resolve("project-intake"), {
    policyClass: "premium",
    model: DOMI_PREMIUM_MODEL_ID,
    reasoningEffort: "max",
    serviceTier: "priority"
  });
});

test("free-form domi investment slides are hard-routed to the Morgan Stanley HTML and PDF workflow", () => {
  const request = "把 H 股 AI 制药三家公司技术与管线做成 PPT";
  const prompt = workflowPrompt(undefined, request, "", true);

  assert.equal(domiSlidesDeliveryPolicyForText(request), "html_pdf");
  assert.match(prompt, /DOMI_INVESTMENT_SLIDES_POLICY_V1/);
  assert.match(prompt, /\$domi:investment-analysis/);
  assert.match(prompt, /investment-banking-slides\.md/);
  assert.match(prompt, /Morgan Stanley/);
  assert.match(prompt, /HTML.*PDF/);
  assert.match(prompt, /不得创建或交付 \.pptx/);
});

test("selected research workflows retain their skill while applying the domi slides contract", () => {
  const workflow = workflows.find((entry) => entry.id === "desk-research");
  const prompt = workflowPrompt(workflow, "请生成一份行业 slides", "", true);

  assert.match(prompt, /必须采用 domi 插件中的 Skill：\$domi:desk-research/);
  assert.match(prompt, /\$domi:investment-analysis/);
  assert.match(prompt, /若当前另有显式选择的 domi 研究 Skill，保留其研究职责/);
});

test("explicit editable PowerPoint requests permit PPTX but keep the domi style and QA contract", () => {
  const request = "输出可编辑 PowerPoint 源文件（PPTX）";
  const prompt = workflowPrompt(undefined, request, "", true);

  assert.equal(domiSlidesDeliveryPolicyForText(request), "explicit_pptx");
  assert.match(prompt, /允许交付 \.pptx/);
  assert.match(prompt, /Morgan Stanley/);
  assert.match(prompt, /contact sheet/);
  assert.doesNotMatch(prompt, /不得创建或交付 \.pptx/);
});

test("PowerPoint troubleshooting does not trigger a deck-generation workflow", () => {
  assert.equal(domiSlidesDeliveryPolicyForText("为什么这个 PPT 打不开？"), "");
  assert.equal(domiSlidesDeliveryPolicyForText("请修改这个 PPT 并保持原模板"), "");
  assert.equal(
    domiSlidesDeliveryPolicyForText("为什么这个 PPT 这么丑，请修复改进"),
    "html_pdf",
  );
  const prompt = workflowPrompt(undefined, "为什么这个 PPT 打不开？", "", true);
  assert.doesNotMatch(prompt, /DOMI_INVESTMENT_SLIDES_POLICY_V1/);
});
