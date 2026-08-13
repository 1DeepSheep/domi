import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_RADAR_DEFAULT_DOMAINS,
  RADAR_DOMAIN_ORDER,
  normalizeRadarDomains,
  radarDomainForStoredDomain,
  radarTaxonomyPrompt
} from "../src/radar-domains.ts";

test("legacy users retain the previous five followed domains", () => {
  assert.deepEqual(normalizeRadarDomains(undefined), LEGACY_RADAR_DEFAULT_DOMAINS);
  assert.deepEqual(RADAR_DOMAIN_ORDER.slice(-2), ["消费", "生物医药"]);
});

test("followed domains are deduplicated, canonical and may be empty", () => {
  assert.deepEqual(normalizeRadarDomains(["生物医药", "AI", "AI", "未知"], []), ["AI", "生物医药"]);
  assert.deepEqual(normalizeRadarDomains([], []), []);
});

test("legacy consumer technology news is displayed under consumer without rewriting storage", () => {
  assert.equal(radarDomainForStoredDomain("消费科技"), "消费");
  assert.equal(radarDomainForStoredDomain("半导体"), "半导体");
});

test("prompt contains only selected taxonomy and the compatibility boundary", () => {
  const prompt = radarTaxonomyPrompt(["AI", "生物医药"]);
  assert.match(prompt, /AI：/);
  assert.match(prompt, /生物医药：创新药/);
  assert.doesNotMatch(prompt, /半导体：/);
  assert.match(prompt, /历史值“消费科技”只在读取时归入“消费”/);
});
