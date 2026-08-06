import assert from "node:assert/strict";
import test from "node:test";
import {
  mentionedProjectCandidates,
  normalizedEntityMention,
  parseDomiEntityResult,
  projectMentionMatches
} from "../src/entity-routing.ts";

const projects = [
  { recordId: "project-a", name: "示例芯片 ExampleSilicon" },
  { recordId: "project-b", name: "示例数据科技" },
  { recordId: "project-c", name: "ExampleTrust AI" }
];

test("project matching returns every explicit candidate instead of silently picking one", () => {
  assert.deepEqual(
    mentionedProjectCandidates(projects, "比较示例数据科技和 ExampleTrust AI"),
    [projects[1], projects[2]]
  );
});

test("project matching normalizes punctuation and case", () => {
  assert.equal(normalizedEntityMention("ExampleTrust-AI"), "exampletrustai");
  assert.deepEqual(
    mentionedProjectCandidates(projects, "继续研究 EXAMPLETRUST-AI"),
    [projects[2]]
  );
});

test("project matching recognizes either side of a bilingual canonical name", () => {
  assert.deepEqual(mentionedProjectCandidates(projects, "继续研究示例芯片"), [projects[0]]);
  assert.deepEqual(mentionedProjectCandidates(projects, "继续研究 ExampleSilicon"), [projects[0]]);
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
    { recordId: "short", name: "甲乙" },
    { recordId: "mixed", name: "A9 芯片" }
  ];
  assert.deepEqual(
    projectMentionMatches(lowConfidenceProjects, "继续看甲乙"),
    [{ project: lowConfidenceProjects[0], confidence: "low", matchedKey: "甲乙" }]
  );
  assert.deepEqual(
    projectMentionMatches(lowConfidenceProjects, "分析 A9 芯片"),
    [{ project: lowConfidenceProjects[1], confidence: "low", matchedKey: "a9芯片" }]
  );
});

test("long canonical names remain high confidence", () => {
  assert.deepEqual(
    projectMentionMatches(projects, "继续研究 ExampleSilicon"),
    [{ project: projects[0], confidence: "high", matchedKey: "examplesilicon" }]
  );
});

test("project matching never joins words across punctuation boundaries", () => {
  const boundaryProjects = [{ recordId: "future-props", name: "甲乙丙丁" }];
  assert.deepEqual(
    projectMentionMatches(boundaryProjects, "我们讨论甲乙，丙丁行业还需要继续观察"),
    []
  );
  assert.deepEqual(
    mentionedProjectCandidates(boundaryProjects, "继续研究甲乙丙丁"),
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
