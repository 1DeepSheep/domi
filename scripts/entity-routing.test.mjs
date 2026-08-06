import assert from "node:assert/strict";
import test from "node:test";
import {
  mentionedProjectCandidates,
  normalizedEntityMention,
  parseDomiEntityResult,
  projectMentionMatches
} from "../src/entity-routing.ts";

const projects = [
  { recordId: "project-a", name: "芯星元 NovaSilicon" },
  { recordId: "project-b", name: "曼孚科技" },
  { recordId: "project-c", name: "AutoTrust AI" }
];

test("project matching returns every explicit candidate instead of silently picking one", () => {
  assert.deepEqual(
    mentionedProjectCandidates(projects, "比较曼孚科技和 AutoTrust AI"),
    [projects[1], projects[2]]
  );
});

test("project matching normalizes punctuation and case", () => {
  assert.equal(normalizedEntityMention("AutoTrust-AI"), "autotrustai");
  assert.deepEqual(
    mentionedProjectCandidates(projects, "继续研究 AUTOTRUST-AI"),
    [projects[2]]
  );
});

test("project matching recognizes either side of a bilingual canonical name", () => {
  assert.deepEqual(mentionedProjectCandidates(projects, "继续研究芯星元"), [projects[0]]);
  assert.deepEqual(mentionedProjectCandidates(projects, "继续研究 NovaSilicon"), [projects[0]]);
});

test("generic, common and pure numeric fragments never silently identify a project", () => {
  const unsafeProjects = [
    { recordId: "generic", name: "AI 科技" },
    { recordId: "numeric", name: "360" }
  ];
  assert.deepEqual(mentionedProjectCandidates(unsafeProjects, "研究科技项目"), []);
  assert.deepEqual(mentionedProjectCandidates(unsafeProjects, "2026360年度材料"), []);
});

test("short or alpha-numeric names are marked low confidence for confirmation", () => {
  const lowConfidenceProjects = [
    { recordId: "short", name: "界时" },
    { recordId: "mixed", name: "A9 芯片" }
  ];
  assert.deepEqual(
    projectMentionMatches(lowConfidenceProjects, "继续看界时"),
    [{ project: lowConfidenceProjects[0], confidence: "low", matchedKey: "界时" }]
  );
  assert.deepEqual(
    projectMentionMatches(lowConfidenceProjects, "分析 A9 芯片"),
    [{ project: lowConfidenceProjects[1], confidence: "low", matchedKey: "a9芯片" }]
  );
});

test("long canonical names remain high confidence", () => {
  assert.deepEqual(
    projectMentionMatches(projects, "继续研究 NovaSilicon"),
    [{ project: projects[0], confidence: "high", matchedKey: "novasilicon" }]
  );
});

test("project matching never joins words across punctuation boundaries", () => {
  const boundaryProjects = [{ recordId: "future-props", name: "未来道具" }];
  assert.deepEqual(
    projectMentionMatches(boundaryProjects, "我们讨论未来，道具行业还需要继续观察"),
    []
  );
  assert.deepEqual(
    mentionedProjectCandidates(boundaryProjects, "继续研究未来道具"),
    boundaryProjects
  );
});

test("entity result parser accepts the stable hidden marker", () => {
  assert.deepEqual(
    parseDomiEntityResult(
      '完成。\n<!-- DOMI_ENTITY_RESULT_V1 {"entityType":"project","recordId":"project-new","name":"新项目"} -->'
    ),
    { entityType: "project", recordId: "project-new", name: "新项目" }
  );
});

test("entity result parser rejects incomplete or unrelated output", () => {
  assert.equal(parseDomiEntityResult("DOMI_ENTITY_RESULT: not-json"), null);
  assert.equal(
    parseDomiEntityResult('DOMI_ENTITY_RESULT {"entityType":"project","recordId":"project-new"}'),
    null
  );
});
