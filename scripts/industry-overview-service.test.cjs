const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LocalDomiRepository } = require("../electron/local-domi-repository.cjs");
const { IndustryOverviewCache, loadIndustryOverviews } = require("../electron/industry-overview-service.cjs");

test("preserved edits remain readable and a failed refresh does not block the next read", async () => {
  const conflict = { ok: false, entries: [{ title: "AI", path: "/synthetic/AI/行业速览.md" }], conflicts: [{ path: "edited" }], warnings: [] };
  let calls = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.deepEqual(await loadIndustryOverviews(() => { calls += 1; return conflict; }), conflict);
  }
  assert.equal(calls, 5);
  const failure = await loadIndustryOverviews(() => { throw new Error("source unavailable"); });
  assert.deepEqual(failure, { ok: false, entries: [], error: "source unavailable" });
  assert.deepEqual(await loadIndustryOverviews(() => conflict), conflict);
});

function fixture(t, label = "示例项目", count = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-industry-cache-"));
  const source = { backend: "local", localDatabasePath: path.join(root, "private", "repository.sqlite3"), localLibraryDir: path.join(root, "library") };
  const repository = new LocalDomiRepository({ databasePath: source.localDatabasePath, libraryDir: source.localLibraryDir });
  t.after(() => { repository.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const insert = repository.database.prepare("INSERT INTO projects (id,name,normalized_name,domain,subdomains_json,document_path,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1)");
  const homes = [];
  for (let index = 0; index < count; index += 1) {
    const id = `project-${index}`, name = `${label}${index}`, home = path.join(source.localLibraryDir, "2.项目库", name, "项目主页.md");
    fs.mkdirSync(path.dirname(home), { recursive: true });
    fs.writeFileSync(home, `---\nproject_id: ${id}\n---\n# ${name}\n\n## 公司定位\n\n公司研发工业软件。\n\n## 商业进展\n\n收入100万元，已签约10家客户。\n`);
    insert.run(id, name, name, "AI", '["AI数据"]', home);
    homes.push(home);
  }
  const stored = new Map();
  const stateStore = { loadCache: key => stored.has(key) ? { value: JSON.parse(stored.get(key)) } : null,
    saveCache: (key, value) => stored.set(key, JSON.stringify(value)) };
  let refreshCount = 0;
  const refresh = requested => {
    refreshCount += 1;
    const repo = new LocalDomiRepository({ databasePath: requested.localDatabasePath, libraryDir: requested.localLibraryDir });
    try { return repo.refreshIndustryOverviews(); } finally { repo.close(); }
  };
  const createCache = () => new IndustryOverviewCache({ stateStore, refresh });
  return { root, source, repository, homes, stored, stateStore, refresh, createCache, cache: createCache(), count: () => refreshCount };
}

test("repeat navigation and process restart reuse validated results without reading Markdown or regenerating pages", t => {
  const data = fixture(t);
  const first = data.cache.read(data.source);
  assert.equal(first.cached, false);
  let markdownReads = 0;
  const originalRead = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    if (/\.md$/i.test(String(file))) markdownReads += 1;
    return originalRead.call(this, file, ...args);
  };
  try {
    for (let index = 0; index < 4; index += 1) assert.equal(data.cache.read(data.source).cached, true);
    const reopened = data.createCache().read(data.source);
    assert.equal(reopened.cached, true);
    assert.deepEqual(reopened.entries, first.entries);
    assert.equal(markdownReads, 0);
    assert.equal(data.count(), 1);
  } finally { fs.readFileSync = originalRead; }
  assert.equal(data.cache.read(data.source, { force: true }).cached, false);
  assert.equal(data.count(), 2);
});

test("project values, indexed evidence, taxonomy and missing output files invalidate the cached board", t => {
  const data = fixture(t);
  data.cache.read(data.source);
  // Even direct SQL writes that preserve updated_at must invalidate the source snapshot.
  data.repository.database.prepare("UPDATE projects SET rating='A' WHERE id=?").run("project-0");
  assert.equal(data.cache.read(data.source).cached, false);
  fs.appendFileSync(data.homes[0], "\n## 关键进展\n\n新增客户交付。\n");
  assert.equal(data.cache.read(data.source).cached, false);
  const document = path.join(path.dirname(data.homes[0]), "研究.md");
  fs.writeFileSync(document, "## 行业趋势\n\n软件交付转向标准化产品。\n");
  data.repository.database.prepare("INSERT INTO documents (id,owner_type,owner_id,kind,title,path,created_at,updated_at) VALUES ('doc-1','project','project-0','research','研究',?,1,1)").run(document);
  assert.equal(data.cache.read(data.source).cached, false);
  fs.appendFileSync(document, "\n## 商业进展\n\n已完成首批客户交付。\n");
  assert.equal(data.cache.read(data.source).cached, false);
  data.repository.database.prepare("INSERT INTO custom_taxonomy (id,parent_domain,name,normalized_name,created_at,updated_at) VALUES ('custom-1','AI','测试方向','测试方向',1,1)").run();
  const taxonomyChanged = data.cache.read(data.source);
  assert.equal(taxonomyChanged.cached, false);
  assert.ok(taxonomyChanged.entries.some(entry => entry.subdomain === "测试方向"));
  fs.unlinkSync(taxonomyChanged.entries[0].path);
  assert.equal(data.cache.read(data.source).cached, false);
  assert.equal(data.cache.read(data.source).cached, true);
  assert.equal(data.count(), 7);
});

test("human edits remain untouched, create a conflict notice, and are themselves cacheable", t => {
  const data = fixture(t);
  const first = data.cache.read(data.source);
  const target = first.entries[0].path;
  const edited = fs.readFileSync(target, "utf8").replace("## 行业现状与判断", "## 人工行业判断");
  fs.writeFileSync(target, edited);
  const changed = data.cache.read(data.source);
  assert.equal(changed.cached, false);
  assert.equal(changed.ok, false);
  assert.equal(changed.conflicts.length, 1);
  assert.equal(fs.readFileSync(target, "utf8"), edited);
  assert.equal(data.cache.read(data.source).cached, true);
  fs.unlinkSync(changed.conflicts[0].candidatePath);
  assert.equal(data.cache.read(data.source).cached, false);
  assert.equal(data.cache.read(data.source).cached, true);
});

test("news changes refresh the cards without regenerating industry documents or self-invalidating cache writes", t => {
  const data = fixture(t);
  data.repository.database.exec("CREATE TABLE board_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const stateStore = {
    loadCache: key => { const row = data.repository.database.prepare("SELECT value FROM board_cache WHERE key=?").get(key); return row && { value: JSON.parse(row.value) }; },
    saveCache: (key, value) => data.repository.database.prepare("INSERT OR REPLACE INTO board_cache VALUES (?,?)").run(key, JSON.stringify(value))
  };
  const cache = new IndustryOverviewCache({ stateStore, refresh: data.refresh });
  cache.read(data.source);
  assert.equal(cache.read(data.source).cached, true);
  const tomorrow = Date.now() + 86_400_000;
  data.repository.database.prepare("INSERT INTO news_events (event_id,title,domains_json,published_at,created_at,updated_at) VALUES ('news-1','示例行业动态','[\"AI\"]',?,1,1)").run(tomorrow);
  const changed = cache.read(data.source);
  assert.equal(changed.cached, true);
  assert.equal(changed.news[0].title, "示例行业动态");
  assert.equal(changed.news[0].publishedAt, tomorrow, "Include future-dated archived rows for the renderer's current-time filter");
  assert.equal(cache.read(data.source).cached, true);
  const reopened = new IndustryOverviewCache({ stateStore, refresh: data.refresh }).read(data.source);
  assert.equal(reopened.cached, true);
  assert.equal(reopened.news.length, 1);
  assert.equal(data.count(), 1);
});

test("library changes and failed reads never substitute another library's cached content", async t => {
  const first = fixture(t, "示例甲", 1), second = fixture(t, "示例乙", 2);
  const cache = first.cache;
  assert.equal(cache.read(first.source).projectCount, 1);
  assert.equal(cache.read(second.source).projectCount, 2);
  assert.equal(cache.read(first.source).projectCount, 1);
  const unavailable = { ...second.source, localDatabasePath: path.join(second.root, "missing", "broken.sqlite3"), localLibraryDir: "/dev/null/not-a-library" };
  const failed = await loadIndustryOverviews(() => cache.read(unavailable));
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.entries, []);
  assert.throws(() => cache.read({ ...first.source, backend: "feishu" }), /本地资料库/);
  assert.equal(cache.read(first.source).cached, true);
});

test("a 280-project board performs generation once and uses lightweight validation on subsequent visits", t => {
  const data = fixture(t, "示例企业", 280);
  const started = performance.now();
  data.cache.read(data.source);
  const generationMs = performance.now() - started;
  const reads = [];
  for (let index = 0; index < 5; index += 1) {
    const begin = performance.now();
    assert.equal(data.cache.read(data.source).cached, true);
    reads.push(performance.now() - begin);
  }
  assert.equal(data.count(), 1);
  // Wall-clock measurements are diagnostic; correctness never relies on a flaky speed threshold.
  t.diagnostic(JSON.stringify({ projects: 280, generationMs: Math.round(generationMs), repeatedValidationMs: reads.map(ms => Math.round(ms)), generated: data.count() }));
});

test("a post-generation validation failure does not discard readable content or persist an unverified cache", t => {
  const data = fixture(t);
  let snapshots = 0;
  const cache = new IndustryOverviewCache({
    stateStore: data.stateStore,
    refresh: data.refresh,
    snapshot: () => {
      if (++snapshots % 2 === 0) throw new Error("database briefly unavailable");
      return { fingerprint: "source-revision", news: [{ title: "已归档动态" }], newsFingerprint: "news-revision" };
    }
  });
  const result = cache.read(data.source);
  assert.equal(result.ok, true);
  assert.ok(result.entries.length > 0);
  assert.equal(result.news[0].title, "已归档动态");
  assert.equal(result.cached, false);
  assert.equal(data.stored.size, 0);
  assert.equal(cache.read(data.source).cached, false);
  assert.equal(data.count(), 2);
});

test("concurrent source edits do not persist a mixed revision as fresh", t => {
  const data = fixture(t);
  let revision = 0;
  const cache = new IndustryOverviewCache({ stateStore: data.stateStore, refresh: data.refresh,
    snapshot: () => ({ fingerprint: `revision-${++revision}`, news: [], newsFingerprint: "news" }) });
  assert.equal(cache.read(data.source).cached, false);
  assert.equal(cache.read(data.source).cached, false);
  assert.equal(data.stored.size, 0);
  assert.equal(data.count(), 2);
});

test("a failed forced refresh cannot replace the previous verified cache", async t => {
  const data = fixture(t);
  data.cache.read(data.source);
  const persisted = JSON.stringify([...data.stored.entries()]);
  data.cache.refresh = () => { throw new Error("temporary generation error"); };
  const failed = await loadIndustryOverviews(() => data.cache.read(data.source, { force: true }));
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify([...data.stored.entries()]), persisted);
  assert.equal(data.cache.read(data.source).cached, true);
});

test("DomiIntegration honors force and captures the currently configured library for each request", t => {
  const { DomiIntegration } = require("../electron/domi-integration.cjs");
  const first = fixture(t, "示例甲", 1), second = fixture(t, "示例乙", 2);
  let settings = { storageBackend: "local", localDatabasePath: first.source.localDatabasePath, localRepositoryDir: first.source.localLibraryDir };
  const integration = new DomiIntegration({ stateStore: first.stateStore, configProvider: () => settings,
    plaudOutputDir: path.join(first.root, "plaud-output"), plaudStateDir: path.join(first.root, "plaud-state") });
  assert.equal(integration.refreshIndustryOverviews().projectCount, 1);
  assert.equal(integration.refreshIndustryOverviews().cached, true);
  assert.equal(integration.refreshIndustryOverviews({ force: true }).cached, false);
  settings = { ...settings, localDatabasePath: second.source.localDatabasePath, localRepositoryDir: second.source.localLibraryDir };
  assert.equal(integration.refreshIndustryOverviews().projectCount, 2);
  assert.equal(integration.refreshIndustryOverviews().cached, true);
  settings = { ...settings, storageBackend: "feishu" };
  assert.throws(() => integration.refreshIndustryOverviews(), /项目库连接尚未配置/);
});
