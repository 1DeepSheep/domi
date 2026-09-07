const test = require("node:test");
const assert = require("node:assert/strict");
const { RadarSourceService, normalizePublicUrl } = require("../electron/radar-sources.cjs");
const { parseNewsFeed, discoverySnapshot } = require("../electron/news-discovery.cjs");

function store() {
  const settings = new Map(), cache = new Map();
  return { loadAppSettings: (key, value) => settings.get(key) || { value, updatedAt: 0 },
    saveAppSettings: (key, value) => { const row = { value, updatedAt: Date.now() }; settings.set(key, row); return row; },
    loadCache: (key) => cache.get(key), saveCache: (key, value) => { const row = { value, updatedAt: Date.now() }; cache.set(key, row); return row; } };
}
const feed = '<rss><channel><item><title>收入更新</title><link>https://news.example.com/article?id=1</link><description>发现线索，需原文核验</description></item><item><title>另一则</title><link>https://news.example.com/article?id=2</link></item></channel></rss>';

test("RSS and Atom retain distinct article query IDs and disclose invalid/omitted candidates", () => {
  const parsed = parseNewsFeed(feed, "https://news.example.com/feed", normalizePublicUrl);
  assert.equal(parsed.candidates.length, 2);
  assert.notEqual(parsed.candidates[0].id, parsed.candidates[1].id);
  const atom = parseNewsFeed('<feed><entry><title>Atom 条目</title><link rel="self" href="/api"/><link rel="alternate" href="/article?x=1&amp;y=2"/><updated>2026-09-07T00:00:00Z</updated></entry><entry><title>缺链接</title></entry></feed>', "https://news.example.com/feed", normalizePublicUrl);
  assert.equal(atom.candidates[0].url, "https://news.example.com/article?x=1&y=2");
  assert.equal(atom.invalidCount, 1);
  assert.equal(parseNewsFeed("<html>website</html>", "https://news.example.com", normalizePublicUrl), null);
  assert.throws(() => parseNewsFeed('<!DOCTYPE rss [<!ENTITY unsafe SYSTEM "file:///private">]><rss/>', "https://news.example.com", normalizePublicUrl), /实体声明/);
  const large = parseNewsFeed(`<rss>${Array.from({ length: 1003 }, (_, n) => `<item><title>${n}</title><link>https://news.example.com/${n}</link></item>`).join("")}</rss>`, "https://news.example.com/feed", normalizePublicUrl);
  assert.equal(large.candidates.length, 1000); assert.equal(large.omittedCount, 3);
  assert.throws(() => parseNewsFeed('<rss><channel><item><title>unfinished</title>', "https://news.example.com/feed", normalizePublicUrl), /不完整/);
  assert.throws(() => parseNewsFeed(feed.replace("</channel>", "<item><title>truncated</title>"), "https://news.example.com/feed", normalizePublicUrl), /闭合/);
  assert.equal(parseNewsFeed('<rss><channel><item><title>有效条目</title><link>https://news.example.com/valid</link><description><![CDATA[示例 <item><title>半段</title>]]></description></item></channel></rss>', "https://news.example.com/feed", normalizePublicUrl).candidates.length, 1);
});

test("conditional requests reuse discovery only for the same source URL; failures remain visible", async () => {
  const stateStore = store(); let phase = 0; const seen = [];
  const service = new RadarSourceService({ stateStore, fetchImpl: async (_, options) => {
    seen.push(options.headers);
    if (phase === 0) return new Response(feed, { headers: { etag: '"v1"', "last-modified": "Mon, 07 Sep 2026 00:00:00 GMT" } });
    if (phase === 1) return new Response(null, { status: 304 });
    throw new Error("offline");
  } });
  const source = service.save({ kind: "news", name: "测试源", url: "https://news.example.com/feed", enabled: true }).source;
  const initial = await service.sync({ kind: "news", limit: 1 });
  assert.equal(initial.discovery.sources[0].status, "fetched");
  assert.equal(initial.discovery.sources[0].omittedCount, 1);
  phase = 1; const unchanged = await service.sync({ kind: "news" });
  assert.equal(seen[1]["If-None-Match"], '"v1"');
  assert.equal(unchanged.discovery.sources[0].status, "unchanged");
  assert.equal(unchanged.discovery.sources[0].candidates.length, 2);
  phase = 2; const failed = await service.sync({ kind: "news" });
  assert.equal(failed.discovery.sources[0].status, "failed");
  assert.equal(failed.discovery.sources[0].candidates.length, 2);
  service.save({ ...source, url: "https://news.example.com/new-feed" });
  const changed = discoverySnapshot(stateStore, service.loadSources().sources);
  assert.equal(changed.sources[0].status, "requires_search");
  assert.equal(changed.sources[0].candidates.length, 0);
});

test("HTML-only sources require model search and never claim successful collection", async () => {
  const stateStore = store(); const service = new RadarSourceService({ stateStore, fetchImpl: async () => new Response("<html>公众号主页</html>") });
  service.save({ kind: "wechat", name: "公众号", url: "https://news.example.com/account", enabled: true });
  const result = await service.sync({ kind: "news" });
  assert.equal(result.results[0].collected, false);
  assert.equal(result.discovery.sources[0].status, "requires_search");
  assert.equal(Number(result.sources[0].lastSuccessAt) || 0, 0);
});

test("discovery has four bounded workers and preserves source edits during requests", async () => {
  const stateStore = store(); let active = 0, peak = 0;
  const service = new RadarSourceService({ stateStore, fetchImpl: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active--;
    return new Response(feed);
  } });
  for (let n = 0; n < 9; n++) service.save({ kind: "news", name: `源 ${n}`, url: `https://news.example.com/feed/${n}`, enabled: true });
  const first = service.loadSources().sources[0];
  const running = service.sync({ kind: "news" });
  service.save({ ...first, name: "用户新名字", url: "https://news.example.com/replaced" });
  const result = await running;
  assert.equal(peak, 4);
  assert.equal(result.sources[0].name, "用户新名字");
  assert.equal(result.discovery.sources[0].status, "requires_search");
  assert.equal(result.results.length, 9);
});
