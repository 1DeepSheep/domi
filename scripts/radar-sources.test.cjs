const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  RadarSourceService,
  normalizePublicUrl,
  parseRadarSourceBulkText,
  parsePodcastRss,
  parseXiaoyuzhouEpisode,
  parseXiaoyuzhouEpisodeLinks
} = require("../electron/radar-sources.cjs");
const { DomiIntegration } = require("../electron/domi-integration.cjs");

function memoryStore() {
  const settings = new Map();
  const cache = new Map();
  let tick = 1_700_000_000_000;
  const metrics = { saveAppSettingsCount: 0, saveCacheCount: 0 };
  return {
    metrics,
    loadAppSettings(key, fallback) {
      return settings.get(key) || { value: fallback, updatedAt: 0 };
    },
    saveAppSettings(key, value) {
      metrics.saveAppSettingsCount += 1;
      const stored = { value, updatedAt: tick += 1 };
      settings.set(key, stored);
      return stored;
    },
    loadCache(key) {
      return cache.get(key) || null;
    },
    saveCache(key, value) {
      metrics.saveCacheCount += 1;
      const stored = { value, updatedAt: tick += 1 };
      cache.set(key, stored);
      return stored;
    }
  };
}

{
  const names = Array.from({ length: 700 }, (_value, index) => `重点公众号 ${String(index + 1).padStart(3, "0")}`);
  const startedAt = Date.now();
  const parsed = parseRadarSourceBulkText([
    ...names,
    "  重点公众号 001  ",
    "x".repeat(121),
    ""
  ].join("\n"), { kind: "wechat", fileName: "accounts.list", priority: "important" });
  assert.equal(parsed.format, "list");
  assert.equal(parsed.sources.length, 700);
  assert.equal(parsed.stats.duplicateCount, 1);
  assert.equal(parsed.stats.invalidCount, 1);
  assert.equal(parsed.stats.blankCount, 1);
  assert.equal(parsed.sources[0].priority, "important");
  assert.ok(Date.now() - startedAt < 2_000, "700-row plain-text parsing should remain interactive");
}

{
  const csv = parseRadarSourceBulkText([
    "公众号名称,关键词,链接,优先级,启用",
    '"芯片,前沿","芯片;AI",https://example.com/account,重点,是',
    "同链接别名,芯片,https://example.com/account,重点,是",
    "自动驾驶观察,智能出行,,普通,否",
    ",缺少名称,,,"
  ].join("\n"), { kind: "wechat", fileName: "accounts.csv" });
  assert.equal(csv.format, "csv");
  assert.equal(csv.sources.length, 2);
  assert.equal(csv.sources[0].name, "芯片,前沿");
  assert.deepEqual(csv.sources[0].keywords, ["芯片", "AI"]);
  assert.equal(csv.sources[0].priority, "important");
  assert.equal(csv.sources[1].enabled, false);
  assert.equal(csv.stats.duplicateCount, 1);
  assert.equal(csv.stats.invalidCount, 1);

  const tsv = parseRadarSourceBulkText(
    "名称\t关键词\t优先级\n机器人前沿\t具身智能；机器人\t重点",
    { kind: "wechat", fileName: "accounts.tsv" }
  );
  assert.equal(tsv.format, "tsv");
  assert.deepEqual(tsv.sources[0].keywords, ["具身智能", "机器人"]);
  assert.equal(tsv.sources[0].priority, "important");

  const malformed = parseRadarSourceBulkText('公众号名称,关键词\n"未闭合,芯片', {
    kind: "wechat",
    fileName: "bad.csv"
  });
  assert.equal(malformed.sources.length, 0);
  assert.equal(malformed.stats.invalidCount, 1);
}

const rss = `<?xml version="1.0"?>
<rss><channel><title>测试播客</title>
  <item>
    <title><![CDATA[芯片设计访谈 &amp; 趋势]]></title>
    <description><![CDATA[<p>围绕公司与行业展开。</p>]]></description>
    <link>https://pod.example.com/episodes/1</link>
    <pubDate>Thu, 06 Aug 2026 10:00:00 GMT</pubDate>
    <itunes:duration>01:02:03</itunes:duration>
    <enclosure url="https://cdn.example.com/audio/1.mp3" type="audio/mpeg" />
  </item>
</channel></rss>`;

const xiaoyuzhouEpisodeHtml = `<!doctype html><html><head>
<meta property="og:title" content="小宇宙公开单集" />
<meta property="og:audio" content="https://media.xyzcdn.net/example/episode.m4a" />
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@type":"PodcastEpisode",
  "name":"AI 芯片设计公司的产品路径",
  "description":"公开单集描述",
  "datePublished":"2026-08-05T08:00:00+08:00",
  "duration":"PT1H7M",
  "isAccessibleForFree":true,
  "associatedMedia":{"@type":"MediaObject","contentUrl":"https://media.xyzcdn.net/example/episode.m4a"},
  "partOfSeries":{"name":"投资人访谈"}
}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"episode":{"payType":"FREE","isPrivateMedia":false}}}}</script>
</head></html>`;

{
  const episodes = parsePodcastRss(rss, "https://pod.example.com/feed.xml");
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].title, "芯片设计访谈 & 趋势");
  assert.equal(episodes[0].durationSec, 3723);
  assert.equal(episodes[0].mediaUrl, "https://cdn.example.com/audio/1.mp3");
  assert.equal(episodes[0].podcastTitle, "测试播客");
}

{
  const episode = parseXiaoyuzhouEpisode(
    xiaoyuzhouEpisodeHtml,
    "https://www.xiaoyuzhoufm.com/episode/6a6c2305b581962ce2be583e"
  );
  assert.equal(episode.title, "AI 芯片设计公司的产品路径");
  assert.equal(episode.durationSec, 4020);
  assert.equal(episode.podcastTitle, "投资人访谈");
  assert.equal(episode.mediaUrl, "https://media.xyzcdn.net/example/episode.m4a");

  const privateHtml = xiaoyuzhouEpisodeHtml
    .replace('"payType":"FREE"', '"payType":"PAID"')
    .replace('"isAccessibleForFree":true', '"isAccessibleForFree":false');
  assert.throws(
    () => parseXiaoyuzhouEpisode(privateHtml, "https://www.xiaoyuzhoufm.com/episode/private123"),
    /付费或私密/
  );
}

{
  const links = parseXiaoyuzhouEpisodeLinks(`
    <a href="/episode/aaa111">A</a>
    <a href="https://www.xiaoyuzhoufm.com/episode/bbb222?source=share">B</a>
    <a href="/episode/aaa111">duplicate</a>
    <a href="https://evil.example.com/episode/ccc333">bad</a>
  `, "https://www.xiaoyuzhoufm.com/podcast/abc123");
  assert.deepEqual(links, [
    "https://www.xiaoyuzhoufm.com/episode/aaa111",
    "https://www.xiaoyuzhoufm.com/episode/bbb222"
  ]);
}

assert.throws(() => normalizePublicUrl("file:///tmp/private"), /http/);
assert.throws(() => normalizePublicUrl("http://127.0.0.1:8080/feed"), /本机或内网/);
assert.throws(() => normalizePublicUrl("https://user:pass@example.com/feed"), /凭据/);

{
  const store = memoryStore();
  const service = new RadarSourceService({ stateStore: store, now: () => 1_700_000_000_100 });
  service.save({ kind: "wechat", name: "已经关注", keywords: ["存量"] });
  store.metrics.saveAppSettingsCount = 0;
  const text = [
    "已经关注",
    ...Array.from({ length: 700 }, (_value, index) => `批量公众号 ${String(index + 1).padStart(3, "0")}`),
    "批量公众号 001",
    "x".repeat(121)
  ].join("\n");

  const preview = service.bulkImport({
    kind: "wechat",
    text,
    fileName: "重点公众号.txt",
    previewOnly: true,
    priority: "important"
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.stats.existingCount, 1);
  assert.equal(preview.stats.importableCount, 700);
  assert.equal(preview.stats.duplicateCount, 1);
  assert.equal(preview.stats.invalidCount, 1);
  assert.equal(preview.stats.importedCount, 0);
  assert.equal(preview.items.length, 200);
  assert.equal(preview.previewTruncated, true);
  assert.equal(store.metrics.saveAppSettingsCount, 0, "preview must not persist");

  const startedAt = Date.now();
  const imported = service.bulkImport({
    kind: "wechat",
    text,
    fileName: "重点公众号.txt",
    priority: "important"
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.stats.importedCount, 700);
  assert.equal(imported.sources.length, 701);
  assert.equal(store.metrics.saveAppSettingsCount, 1, "700 rows must be persisted in one settings write");
  assert.ok(Date.now() - startedAt < 2_000, "700-row bulk import should remain interactive");

  const afterUpgradeService = new RadarSourceService({ stateStore: store, now: () => 1_700_000_000_200 });
  assert.equal(afterUpgradeService.list().sources.length, 701, "saved sources must survive service/app upgrades");
  const repeated = afterUpgradeService.bulkImport({ kind: "wechat", text, fileName: "重点公众号.txt" });
  assert.equal(repeated.stats.importedCount, 0);
  assert.equal(repeated.stats.existingCount, 701);
  assert.equal(store.metrics.saveAppSettingsCount, 1, "a no-op duplicate import must not rewrite settings");
}

(async () => {
  const store = memoryStore();
  const requests = [];
  const routeFetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/podcast/")) {
      return new Response('<a href="/episode/6a6c2305b581962ce2be583e">episode</a>', {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    if (String(url).includes("/episode/")) {
      return new Response(xiaoyuzhouEpisodeHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const service = new RadarSourceService({
    stateStore: store,
    cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), "domi-radar-cache-")),
    fetchImpl: routeFetch,
    now: () => 1_700_000_000_100
  });
  const created = service.save({
    kind: "podcast",
    name: "公开小宇宙节目",
    url: "https://www.xiaoyuzhoufm.com/podcast/671b5914e98205cea744fd3c",
    priority: "important",
    keywords: ["芯片", "AI"]
  });
  assert.equal(created.source.priority, "important");
  assert.equal(created.source.keywords.length, 2);
  const synced = await service.sync({ sourceId: created.source.id });
  assert.equal(synced.ok, true);
  assert.equal(synced.jobs.length, 1);
  assert.equal(synced.jobs[0].status, "discovered");
  assert.ok(requests.every((request) => request.options.credentials === "omit"));
  assert.ok(requests.every((request) => !Object.keys(request.options.headers).some((key) => key.toLowerCase() === "cookie")));

  const edited = service.save({
    id: created.source.id,
    kind: "podcast",
    name: "公开小宇宙节目",
    url: created.source.url,
    priority: "normal"
  });
  assert.equal(edited.source.priority, "normal");

  const deleted = service.delete(created.source.id);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.jobs.length, 0);
})();

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-radar-download-"));
  const store = memoryStore();
  let audioMode = "success";
  const service = new RadarSourceService({
    stateStore: store,
    cacheDir: tempRoot,
    fetchImpl: async (url) => {
      if (String(url).endsWith("feed.xml")) {
        return new Response(rss, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      const body = audioMode === "success" ? Buffer.from("audio-bytes") : Buffer.alloc(2048, 1);
      return new Response(body, { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
  });
  const source = service.save({ kind: "podcast", name: "RSS", url: "https://pod.example.com/feed.xml" }).source;
  const synced = await service.sync({ sourceId: source.id });
  const job = synced.jobs[0];
  const downloaded = await service.download(job.id, { maxBytes: 1024 });
  assert.equal(downloaded.ok, true);
  assert.equal(fs.readFileSync(downloaded.path, "utf8"), "audio-bytes");
  await service.removeAudio(downloaded.path);
  audioMode = "oversize";
  await assert.rejects(() => service.download(job.id, { maxBytes: 1024 }), /大小限制/);
  assert.equal(fs.readdirSync(tempRoot).filter((name) => name.includes(".part")).length, 0);
  fs.rmSync(tempRoot, { recursive: true, force: true });
})();

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-podcast-process-"));
  const audioPath = path.join(tempRoot, "episode.m4a");
  const transcriptPath = path.join(tempRoot, "episode.md");
  fs.writeFileSync(audioPath, "audio");
  fs.writeFileSync(transcriptPath, "# transcript");
  let currentJob = {
    id: "job-1",
    sourceId: "source-1",
    title: "公开播客",
    status: "downloaded",
    localAudioPath: audioPath,
    transcriptPath: "",
    plaudFileId: "",
    error: ""
  };
  const commands = [];
  const radarSourceService = {
    getJob: () => ({ ...currentJob }),
    updateJob: (_id, patch) => {
      currentJob = { ...currentJob, ...patch };
      return { job: { ...currentJob } };
    },
    download: async () => ({ ok: true, path: audioPath }),
    removeAudio: async (target) => {
      fs.rmSync(target, { force: true });
      return true;
    },
    list: () => ({ ok: true, sources: [], jobs: [currentJob], updatedAt: 0 }),
    save: () => ({}),
    delete: () => ({}),
    sync: async () => ({})
  };
  const integration = new DomiIntegration({
    stateStore: memoryStore(),
    configProvider: () => ({ plaudConnectionMode: "enabled", plaudBrowser: "chrome" }),
    radarSourceService,
    mediaRuntime: { ffmpegPath: "", ffprobePath: "" },
    plaudBroker: { stop: async () => undefined, request: async () => ({}) },
    plaudOutputDir: tempRoot
  });
  integration.plaudPaths = () => ({ plugin: { root: tempRoot }, script: "/plugin/plaud.js" });
  integration.runJson = async (binary, args, options) => {
    commands.push({ binary, args, options });
    return { ok: true, fileId: "plaud-file-1", transcriptPath };
  };
  const result = await integration.processPodcastEpisode({ jobId: "job-1" });
  assert.equal(result.ok, true);
  assert.equal(result.transcriptPath, transcriptPath);
  assert.equal(result.plaudFileId, "plaud-file-1");
  assert.equal(result.audioRemoved, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].args[1], "transcribe-local");
  assert.equal(commands[0].args[2], audioPath);
  assert.equal(commands[0].options.queue, "plaud");
  fs.rmSync(tempRoot, { recursive: true, force: true });
})();

process.on("beforeExit", () => {
  console.log("radar-sources tests passed");
});
