import assert from "node:assert/strict";
import test from "node:test";
import { parseRadarResult, radarRejectionSummary } from "../src/radar-result.ts";

const selected = ["AI", "消费", "生物医药"];

test("radar result checkpoints only domains with explicit query coverage", () => {
  const output = `done\nRADAR_RESULT ${JSON.stringify({
    added: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    checked_through: "2026-08-14T05:24:19.267Z",
    discovery_from: "2026-08-12T04:43:51.049Z",
    candidates: 4,
    rejected: { duplicate: 1, not_event: 1, unverified: 2, unavailable: 0, out_of_scope: 0 },
    coverage: {
      searched_domains: ["AI", "生物医药"],
      queries_by_domain: { AI: 2, 消费: 0, 生物医药: 1 },
      deeptech_checked: true,
      configured_sources_attempted: 1,
      configured_sources_failed: 0
    }
  })}`;
  const result = parseRadarResult(output, selected, 1);
  assert.ok(result);
  assert.deepEqual(result.completedDomains, ["AI", "生物医药"]);
  assert.deepEqual(result.incompleteDomains, ["消费"]);
  assert.deepEqual(result.checkpointDomains, ["AI", "生物医药"]);
  assert.match(radarRejectionSummary(result), /重复 1 条/);
  assert.match(radarRejectionSummary(result), /未充分核验 2 条/);
});

test("radar result refuses every checkpoint when required source coverage is unverifiable", () => {
  const output = `RADAR_RESULT ${JSON.stringify({
    checked_through: "2026-08-14T05:24:19.267Z",
    candidates: 0,
    rejected: {},
    coverage: {
      searched_domains: selected,
      queries_by_domain: { AI: 1, 消费: 1, 生物医药: 1 },
      deeptech_checked: false,
      configured_sources_attempted: 0,
      configured_sources_failed: 0
    }
  })}`;
  const result = parseRadarResult(output, selected, 1);
  assert.ok(result);
  assert.deepEqual(result.completedDomains, selected);
  assert.deepEqual(result.checkpointDomains, []);
  assert.match(result.coverageIssues.join("；"), /DeepTech/);
  assert.match(result.coverageIssues.join("；"), /0\/1/);
});

test("radar result rejects legacy marker without coverage evidence", () => {
  const output = 'RADAR_RESULT {"added":0,"checked_through":"2026-08-14T05:24:19.267Z","candidates":0,"rejected":{}}';
  const result = parseRadarResult(output, selected, 0);
  assert.ok(result);
  assert.deepEqual(result.completedDomains, []);
  assert.deepEqual(result.checkpointDomains, []);
});

test("radar result refuses checkpoints when the candidate funnel does not reconcile", () => {
  const output = `RADAR_RESULT ${JSON.stringify({
    added: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    checked_through: "2026-08-14T05:24:19.267Z",
    candidates: 3,
    rejected: { duplicate: 1, not_event: 0, unverified: 0, unavailable: 0, out_of_scope: 0 },
    coverage: {
      searched_domains: selected,
      queries_by_domain: { AI: 1, 消费: 1, 生物医药: 1 },
      deeptech_checked: true,
      configured_sources_attempted: 0,
      configured_sources_failed: 0
    }
  })}`;
  const result = parseRadarResult(output, selected, 0);
  assert.ok(result);
  assert.deepEqual(result.checkpointDomains, []);
  assert.match(result.coverageIssues.join("；"), /漏斗合计 1 条.*候选总数 3 条/);
});

test("radar result ignores malformed markers", () => {
  assert.equal(parseRadarResult("RADAR_RESULT nope", selected, 0), null);
});
