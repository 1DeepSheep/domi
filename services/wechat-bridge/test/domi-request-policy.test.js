import assert from "node:assert/strict";
import test from "node:test";

import {
  DOMI_WECHAT_ECONOMY_PREFERENCE,
  DOMI_WECHAT_PREMIUM_PREFERENCE,
  applyDomiWechatPolicyToTask,
  classifyDomiWechatRequest,
  domiWechatRoutingPolicyFor,
  resolveDomiWechatTaskPreference,
} from "../src/domi-request-policy.js";

function resolve(text, {
  slidesDeliveryPolicy = "",
  currentPreference = { model: "gpt-5.6-luna", reasoningEffort: "low" },
  priorPolicyClass = "inherit",
  attachments = [],
} = {}) {
  const classification = classifyDomiWechatRequest({
    text,
    attachments,
    slidesDeliveryPolicy,
  });
  return {
    classification,
    resolved: resolveDomiWechatTaskPreference({
      classification,
      currentPreference,
      priorPolicyClass,
    }),
  };
}

test("A-E high-value WeChat tasks use an explicit domi route and Sol max", () => {
  const cases = [
    [
      "同步这条 PLAUD 管理层访谈，生成纪要、评级并入库",
      "",
      "$domi:domi-router",
    ],
    ["把这份普通客户访谈整理成纪要", "", "$domi:asr-notes"],
    ["研究某创业公司并入库", "", "$domi:domi-router"],
    ["做一份投研 slides", "html_pdf", "$domi:investment-analysis"],
    ["对某上市公司做一份高质量投资分析", "", "$domi:investment-analysis"],
  ];

  for (const [text, slidesDeliveryPolicy, expectedRoute] of cases) {
    const { classification, resolved } = resolve(text, { slidesDeliveryPolicy });
    assert.equal(classification.policyClass, "premium", text);
    assert.equal(classification.route, expectedRoute, text);
    assert.deepEqual(resolved, {
      policyClass: "premium",
      preference: { ...DOMI_WECHAT_PREMIUM_PREFERENCE },
    }, text);
    const routing = domiWechatRoutingPolicyFor({ text, slidesDeliveryPolicy });
    assert.match(routing, /DOMI_WECHAT_ROUTING_POLICY_V1/, text);
    assert.ok(routing.includes(expectedRoute), text);
    assert.match(routing, /禁止用无前缀.*同名全局副本/, text);
    assert.match(routing, /只读请求必须保持只读/, text);
  }
});

test("Radar and Todo keep the compact Terra medium policy and precise domi skills", () => {
  const cases = [
    ["扫描本周 AI 行业动态", "$domi:investment-radar"],
    ["整理我的待办事项", "$domi:todo"],
  ];
  for (const [text, expectedRoute] of cases) {
    const { classification, resolved } = resolve(text);
    assert.equal(classification.policyClass, "economy", text);
    assert.equal(classification.route, expectedRoute, text);
    assert.deepEqual(resolved, {
      policyClass: "economy",
      preference: { ...DOMI_WECHAT_ECONOMY_PREFERENCE },
    }, text);
  }
});

test("Domi diagnostics route safely but inherit the user's model preference", () => {
  const currentPreference = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  const text = "PLAUD 同步失败，一直报错，帮我排查客户端故障";
  const { classification, resolved } = resolve(text, { currentPreference });

  assert.equal(classification.diagnostic, true);
  assert.equal(classification.route, "$domi:domi-router");
  assert.deepEqual(resolved, { policyClass: "inherit", preference: currentPreference });
  const routing = domiWechatRoutingPolicyFor({ text });
  assert.match(routing, /这是故障诊断，不是执行业务工作流/);
  assert.match(routing, /不得因为出现录音.*关键词而处理录音/);
});

test("a failure plus an explicit re-execution request runs the current business workflow", () => {
  const cases = [
    [
      "PLAUD 同步失败了，请重新同步这条并生成纪要",
      "$domi:domi-router",
    ],
    [
      "项目入库失败，请重新研究并入库",
      "$domi:domi-router",
    ],
    [
      "投资分析报错了，请重做这家公司投资分析",
      "$domi:investment-analysis",
    ],
    [
      "投资分析报错了，请帮我重试",
      "$domi:investment-analysis",
    ],
    [
      "PLAUD 同步失败了，再试一次",
      "$domi:domi-router",
    ],
    [
      "项目入库失败了，再来一次",
      "$domi:domi-router",
    ],
    [
      "投资分析失败了，再做一次",
      "$domi:investment-analysis",
    ],
    [
      "IC memo 生成失败，重新来一遍",
      "$domi:ic-memo",
    ],
    [
      "项目研究失败，恢复执行",
      "$domi:desk-research",
    ],
  ];
  for (const [text, route] of cases) {
    const result = resolve(text);
    assert.equal(result.classification.diagnostic, false, text);
    assert.equal(result.classification.route, route, text);
    assert.equal(result.resolved.policyClass, "premium", text);
    assert.deepEqual(result.resolved.preference, { ...DOMI_WECHAT_PREMIUM_PREFERENCE }, text);
  }

  const diagnostics = [
    "PLAUD 同步失败，一直报错，请帮我排查原因",
    "PLAUD 同步失败后为什么一直重试？",
    "投资分析失败，请重新分析失败原因",
    "项目研究报错，请重新研究报错原因",
    "PLAUD 处理失败，请重新处理错误日志",
  ];
  for (const text of diagnostics) {
    const currentPreference = { model: "gpt-5.6-luna", reasoningEffort: "low" };
    const pureDiagnostic = resolve(text, {
      currentPreference,
      priorPolicyClass: "premium",
    });
    assert.equal(pureDiagnostic.classification.diagnostic, true, text);
    assert.equal(pureDiagnostic.resolved.policyClass, "inherit", text);
    assert.deepEqual(pureDiagnostic.resolved.preference, currentPreference, text);
  }
});

test("ordinary non-domi chat is neither rewritten nor upgraded", () => {
  const currentPreference = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  const text = "你好，随便聊聊今天的安排";
  const { classification, resolved } = resolve(text, { currentPreference });

  assert.equal(classification.isDomiTask, false);
  assert.equal(classification.route, "");
  assert.equal(domiWechatRoutingPolicyFor({ text }), "");
  assert.deepEqual(resolved, { policyClass: "inherit", preference: currentPreference });
});

test("a premium task never downgrades on a compact-looking follow-up", () => {
  const { resolved } = resolve("整理待办事项", {
    currentPreference: { model: "gpt-5.6-sol", reasoningEffort: "max" },
    priorPolicyClass: "premium",
  });
  assert.deepEqual(resolved, {
    policyClass: "premium",
    preference: { ...DOMI_WECHAT_PREMIUM_PREFERENCE },
  });
});

test("the bridge helper writes the enforced preference onto the actual task", () => {
  const task = {
    preference: { model: "gpt-5.6-luna", reasoningEffort: "low" },
    modelPolicyClass: "inherit",
  };
  const result = applyDomiWechatPolicyToTask(task, {
    text: "对某项目进行评级并给出投资意见",
  });
  assert.equal(result.classification.route, "$domi:investment-review");
  assert.equal(result.effectiveRoute, "$domi:investment-review");
  assert.equal(task.modelPolicyClass, "premium");
  assert.deepEqual(task.preference, { ...DOMI_WECHAT_PREMIUM_PREFERENCE });
});

test("a vague follow-up reuses the task's precise domi skill instead of loading the router", () => {
  const task = {
    preference: { model: "gpt-5.6-sol", reasoningEffort: "max" },
    modelPolicyClass: "premium",
    domiRoute: "$domi:desk-research",
  };
  const result = applyDomiWechatPolicyToTask(task, {
    text: "请再补充一下创始人的背景",
  });
  assert.equal(result.classification.route, "$domi:domi-router");
  assert.equal(result.classification.allowPriorRouteReuse, true);
  assert.equal(result.effectiveRoute, "$domi:desk-research");
  assert.equal(task.domiRoute, "$domi:desk-research");
});

test("mechanical file operations never inherit a prior research skill", () => {
  const cases = [
    {
      text: "请删除这个音频文件",
      attachments: [{ filePath: "/tmp/interview.mp3", mimeType: "audio/mpeg", kind: "file" }],
    },
    { text: "请把这个文件重命名为 final.pdf", attachments: [] },
  ];
  for (const current of cases) {
    const task = {
      preference: { model: "gpt-5.6-sol", reasoningEffort: "max" },
      modelPolicyClass: "premium",
      domiRoute: "$domi:desk-research",
    };
    const result = applyDomiWechatPolicyToTask(task, current);
    assert.notEqual(result.classification.allowPriorRouteReuse, true, current.text);
    assert.equal(result.effectiveRoute, "$domi:domi-router", current.text);
    // A one-off file operation must not erase the task's last precise business
    // route, but it also must not execute through that route in this turn.
    assert.equal(task.domiRoute, "$domi:desk-research", current.text);
  }
});

test("an explicit new high-value intent replaces the prior route", () => {
  const task = {
    preference: { model: "gpt-5.6-sol", reasoningEffort: "max" },
    modelPolicyClass: "premium",
    domiRoute: "$domi:desk-research",
  };
  const result = applyDomiWechatPolicyToTask(task, {
    text: "对这家上市公司做投资分析并给出估值判断",
  });
  assert.notEqual(result.classification.allowPriorRouteReuse, true);
  assert.equal(result.effectiveRoute, "$domi:investment-analysis");
  assert.equal(task.domiRoute, "$domi:investment-analysis");
});

test("attached work artifacts use the domi router without changing inherited quality", () => {
  const currentPreference = { model: "gpt-5.6-sol", reasoningEffort: "high" };
  const attachments = [{ filePath: "/tmp/material.pdf", kind: "file" }];
  const { classification, resolved } = resolve("请看看附件", {
    currentPreference,
    attachments,
  });
  assert.equal(classification.route, "$domi:domi-router");
  assert.deepEqual(resolved, { policyClass: "inherit", preference: currentPreference });
});

test("audio deliverables are premium, but mechanical audio file operations are not", () => {
  const attachments = [{ filePath: "/tmp/interview.mp3", mimeType: "audio/mpeg", kind: "file" }];
  const audioWork = resolve("请整理这个附件", { attachments });
  assert.equal(audioWork.classification.route, "$domi:asr-notes");
  assert.equal(audioWork.resolved.policyClass, "premium");

  const mechanical = resolve("请删除这个音频文件", { attachments });
  assert.equal(mechanical.classification.route, "$domi:domi-router");
  assert.equal(mechanical.resolved.policyClass, "inherit");
});

test("an audio attachment never overrides a higher-level investment workflow", () => {
  const attachments = [{ filePath: "/tmp/management-interview.mp3", mimeType: "audio/mpeg", kind: "file" }];
  const cases = [
    [
      "把这份管理层访谈整理成纪要、完成评级并入库",
      "$domi:domi-router",
    ],
    [
      "根据这份访谈写一份 IC memo",
      "$domi:ic-memo",
    ],
    [
      "根据这份录音对这家上市公司做投资分析和估值",
      "$domi:investment-analysis",
    ],
    [
      "把这份访谈整理成纪要，再做投资分析和估值",
      "$domi:domi-router",
    ],
  ];
  for (const [text, route] of cases) {
    const result = resolve(text, { attachments });
    assert.equal(result.classification.route, route, text);
    assert.equal(result.resolved.policyClass, "premium", text);
  }

  const asrOnly = resolve("请把这个音频转写并整理成纪要", { attachments });
  assert.equal(asrOnly.classification.route, "$domi:asr-notes");
  assert.equal(asrOnly.resolved.policyClass, "premium");
});

test("other domi workbench intents choose their precise plugin skill", () => {
  const cases = [
    ["帮我 mapping 这个赛道的创始人", "$domi:sourcing", "premium"],
    ["帮我准备 Term Sheet 谈判策略", "$domi:deal-negotiation", "premium"],
    ["约王总明天下午三点开会", "$domi:schedule", "inherit"],
    ["查看项目库里的 AI 公司", "$domi:investment-mgmt", "inherit"],
  ];
  for (const [text, route, policyClass] of cases) {
    const result = resolve(text);
    assert.equal(result.classification.route, route, text);
    assert.equal(result.resolved.policyClass, policyClass, text);
  }
});
