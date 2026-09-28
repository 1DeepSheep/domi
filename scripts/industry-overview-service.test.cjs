const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LocalDomiRepository } = require("../electron/local-domi-repository.cjs");
const { IndustryOverviewCache, IndustryOverviewService, loadIndustryOverviews } = require("../electron/industry-overview-service.cjs");

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

test("DomiIntegration honors force and captures the currently configured library for each request", async t => {
  const { DomiIntegration } = require("../electron/domi-integration.cjs");
  const first = fixture(t, "示例甲", 1), second = fixture(t, "示例乙", 2);
  let settings = { storageBackend: "local", localDatabasePath: first.source.localDatabasePath, localRepositoryDir: first.source.localLibraryDir };
  const integration = new DomiIntegration({ stateStore: first.stateStore, configProvider: () => settings,
    plaudOutputDir: path.join(first.root, "plaud-output"), plaudStateDir: path.join(first.root, "plaud-state") });
  t.after(() => integration.closeIndustryOverviews());
  assert.equal((await integration.refreshIndustryOverviews()).projectCount, 1);
  assert.equal((await integration.refreshIndustryOverviews()).cached, true);
  assert.equal((await integration.refreshIndustryOverviews({ force: true })).cached, false);
  settings = { ...settings, localDatabasePath: second.source.localDatabasePath, localRepositoryDir: second.source.localLibraryDir };
  assert.equal((await integration.refreshIndustryOverviews()).projectCount, 2);
  assert.equal((await integration.refreshIndustryOverviews()).cached, true);
  settings = { ...settings, storageBackend: "feishu" };
  assert.throws(() => integration.refreshIndustryOverviews(), /项目库连接尚未配置/);
});

test("indexing generated overview rows does not invalidate the source evidence", t => {
  const data = fixture(t);
  const first = data.cache.read(data.source);
  const target = first.entries[0].path;
  data.repository.database.prepare("INSERT INTO documents (id,owner_type,owner_id,kind,title,path,created_at,updated_at) VALUES ('derived-1','industry','AI','industry-overview','行业速览',?,1,1)").run(target);
  assert.equal(data.cache.read(data.source).cached, true);
  data.repository.database.prepare("UPDATE documents SET updated_at=999 WHERE id='derived-1'").run();
  assert.equal(data.cache.read(data.source).cached, true);
  assert.equal(data.count(), 1);
  fs.appendFileSync(target, "\n人工补充，不修改自动维护区。\n");
  assert.equal(data.cache.read(data.source).cached, false, "Actual human edits still validate output content");
});

function workerFixture(t, data, { delay = 0, body = "", ...options } = {}) {
  const workerPath = path.join(data.root, "test-industry-worker.cjs");
  fs.writeFileSync(workerPath, `const { parentPort, workerData } = require('node:worker_threads');
    ${delay ? `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delay});` : ""}
    ${body || `require(${JSON.stringify(path.resolve(__dirname, "../electron/industry-overview-worker.cjs"))});`}`);
  const service = new IndustryOverviewService({ stateStore: data.stateStore, workerPath, ...options });
  t.after(() => service.close());
  return service;
}

test("persisted snapshot is immediate without source IO, while validation and generation leave the event loop responsive", async t => {
  const data = fixture(t, "示例企业", 280);
  data.cache.read(data.source);
  const service = workerFixture(t, data, { delay: 200 });
  const originalStat = fs.statSync, originalRealpath = fs.realpathSync;
  fs.statSync = fs.realpathSync = () => { throw new Error("Main thread must not inspect source files"); };
  try {
    const first = await service.read(data.source, { cachedOnly: true });
    assert.equal(first.cached, true);
    assert.equal(first.projectCount, 280);
  } finally { fs.statSync = originalStat; fs.realpathSync = originalRealpath; }
  let beats = 0;
  const interval = setInterval(() => { beats += 1; }, 10);
  try {
    assert.equal((await service.read(data.source)).cached, true);
    assert.ok(beats >= 3, `Main event loop remained responsive: ${beats} heartbeats`);
  } finally { clearInterval(interval); }
  const reopened = workerFixture(t, data);
  assert.equal((await reopened.read(data.source, { cachedOnly: true })).projectCount, 280);
});

test("worker refresh reads source database without running migrations or changing project homepages", async t => {
  const data = fixture(t);
  const before = data.repository.database.prepare("SELECT * FROM projects").all();
  const home = fs.readFileSync(data.homes[0], "utf8");
  const service = workerFixture(t, data);
  assert.deepEqual(await service.read(data.source, { cachedOnly: true }), { ok: true, entries: [], cached: false });
  const result = await service.read(data.source);
  assert.equal(result.ok, true);
  assert.equal(result.projectCount, 1);
  assert.deepEqual(data.repository.database.prepare("SELECT * FROM projects").all(), before);
  assert.equal(fs.readFileSync(data.homes[0], "utf8"), home);
  assert.equal((await service.read(data.source)).cached, true);
});

test("application upgrades display the existing snapshot while rebuilding the changed generator cache", async t => {
  const data = fixture(t);
  data.cache.read(data.source);
  const [key, serialized] = [...data.stored.entries()][0];
  data.stored.set(key, JSON.stringify({ ...JSON.parse(serialized), version: "previous-application-generator" }));
  const service = workerFixture(t, data);
  const snapshot = await service.read(data.source, { cachedOnly: true });
  assert.equal(snapshot.cached, true);
  assert.equal(snapshot.projectCount, 1);
  assert.equal((await service.read(data.source)).cached, false, "Stale version is only for initial display, never treated as fresh");
  assert.equal((await service.read(data.source)).cached, true);
});

test("worker requests deduplicate, serialize force escalation, and capture library paths before queuing", async t => {
  const data = fixture(t), other = fixture(t, "示例乙", 2);
  const { Worker } = require("node:worker_threads");
  let workers = 0;
  class CountingWorker extends Worker { constructor(...args) { super(...args); workers += 1; } }
  const service = workerFixture(t, data, { delay: 100, WorkerClass: CountingWorker });
  const source = { ...data.source };
  const first = service.read(source);
  assert.equal(service.read(source), first);
  const forced = service.read(source, { force: true });
  assert.equal(service.read(source, { force: true }), forced);
  source.localDatabasePath = other.source.localDatabasePath;
  source.localLibraryDir = other.source.localLibraryDir;
  assert.equal((await first).projectCount, 1);
  const forceResult = await forced;
  assert.equal(forceResult.projectCount, 1);
  assert.equal(forceResult.cached, false);
  assert.equal(workers, 2);
  assert.equal((await service.read(source)).projectCount, 2);
  assert.equal((await service.read(data.source, { cachedOnly: true })).projectCount, 1);
  assert.equal(workers, 3);
});

test("worker failures retain the last usable snapshot and the next worker recovers", async t => {
  const data = fixture(t);
  data.cache.read(data.source);
  const service = workerFixture(t, data, { body: "throw new Error('synthetic worker crash');" });
  const stored = JSON.stringify([...data.stored.entries()]);
  await assert.rejects(service.read(data.source), /synthetic worker crash/);
  assert.equal(JSON.stringify([...data.stored.entries()]), stored);
  assert.equal((await service.read(data.source, { cachedOnly: true })).projectCount, 1);
  service.workerPath = path.resolve(__dirname, "../electron/industry-overview-worker.cjs");
  assert.equal((await service.read(data.source)).cached, true);
});

test("stopping a worker releases only its own generator lock and cancels queued work", async t => {
  const data = fixture(t);
  const crypto = require("node:crypto");
  const lockPath = path.join(path.dirname(data.source.localDatabasePath), `.domi-industry-${crypto.createHash("sha256").update(data.source.localLibraryDir).digest("hex").slice(0, 16)}.lock`);
  const body = `require('node:fs').writeFileSync(${JSON.stringify(lockPath)}, workerData.lockToken); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);`;
  const service = workerFixture(t, data, { body });
  const pending = service.read(data.source).catch(error => error);
  const queued = service.read(data.source, { force: true }).catch(error => error);
  while (!fs.existsSync(lockPath)) await new Promise(resolve => setTimeout(resolve, 10));
  await service.close();
  assert.ok((await pending) instanceof Error);
  assert.ok((await queued) instanceof Error);
  assert.equal(fs.existsSync(lockPath), false);

  const second = workerFixture(t, data, { body });
  const next = second.read(data.source).catch(error => error);
  while (!fs.existsSync(lockPath)) await new Promise(resolve => setTimeout(resolve, 10));
  const otherOwner = JSON.stringify({ pid: process.pid, token: "another-live-writer" });
  fs.writeFileSync(lockPath, otherOwner);
  await second.close();
  assert.ok((await next) instanceof Error);
  assert.equal(fs.readFileSync(lockPath, "utf8"), otherOwner);
});

test("worker timeout preserves cached content and remains retryable without a stranded live-PID lock", async t => {
  const data = fixture(t);
  data.cache.read(data.source);
  const crypto = require("node:crypto");
  const lockPath = path.join(path.dirname(data.source.localDatabasePath), `.domi-industry-${crypto.createHash("sha256").update(data.source.localLibraryDir).digest("hex").slice(0, 16)}.lock`);
  const service = workerFixture(t, data, { timeoutMs: 250,
    body: `require('node:fs').writeFileSync(${JSON.stringify(lockPath)}, workerData.lockToken); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);` });
  await assert.rejects(service.read(data.source, { force: true }), /后台刷新超时/);
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal((await service.read(data.source, { cachedOnly: true })).projectCount, 1);
  service.workerPath = path.resolve(__dirname, "../electron/industry-overview-worker.cjs");
  service.timeoutMs = 5000;
  assert.equal((await service.read(data.source, { force: true })).ok, true);
});
