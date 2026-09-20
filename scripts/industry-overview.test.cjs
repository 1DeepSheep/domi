const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { refreshIndustryOverviews, relativeLink } = require("../electron/industry-overview.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-overview-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "3.项目库", "AI", "AI数据", "Alpha (AI) #1", "项目主页.md");
  fs.mkdirSync(path.dirname(home), { recursive: true });
  fs.writeFileSync(home, '# Alpha\n\n主营业务：为模型训练提供数据\n关键进展：公司称付费客户达到 12 家，尚未独立核验\n投资亮点：客户复购\n风险：大客户集中\n');
  const projects = [{ id: "p1", name: "Alpha | A", domain: "AI", subdomains: ["AI数据", "Agent"], notes: '业务定位：合成数据服务\n关键进展：公司称年收入 500 万元，未经审计\n投资判断：关注客户复购；风险：客户集中', rating: "A", status: "深度跟踪", financing_history: '| 日期 | 轮次 | 投前估值 | 状态 |\n| --- | --- | --- | --- |\n| 2026-02 | A | 1亿元 | 进行中，公司口径 |', last_updated_at: Date.parse("2026-02-01T20:00:00Z"), document_path: home },
    { id: "p2", name: "Missing", domain: "AI", subdomains: ["AI数据"], notes: "", document_path: path.join(root, "missing.md") },
    { id: "p3", name: "Unknown", domain: "历史待定", subdomains: [] }];
  return { libraryDir: root, projects, documents: [], taxonomy: { AI: ["AI数据", "Agent"], 半导体: ["算力芯片"] } };
}
test("all taxonomy pages share canonical projects, honest evidence and URI-safe relative links", t => {
  const data = fixture(t), result = refreshIndustryOverviews(data);
  assert.equal(result.ok, true); assert.equal(result.entries.length, 6);
  assert.equal(result.projectCount, 3); assert.equal(result.linkedProjectCount, 1); assert.equal(result.unclassifiedProjectCount, 1);
  const page = result.entries.find(entry => entry.subdomain === "AI数据");
  const text = fs.readFileSync(page.path, "utf8");
  assert.match(text, /Alpha &#124; A/); assert.match(text, /主营业务|合成数据服务/);
  assert.match(text, /公司称年收入 500 万元，未经审计/); assert.match(text, /进行中，公司口径/);
  assert.match(text, /投前1亿元/); assert.match(text, /评级 A/); assert.match(text, /客户集中/);
  assert.match(text, /记录更新：2026-02-02/); assert.doesNotMatch(text, /file:\/\/|domi:\/\/|href=/);
  assert.match(text, /Missing（主页待关联）/); assert.doesNotMatch(text, /\[Missing\]/);
  const companyLink = text.match(/\[Alpha[^\]]*\]\(([^)]+)\)/)[1];
  assert.equal(path.resolve(path.dirname(page.path), decodeURIComponent(companyLink)), data.projects[0].document_path);
  assert.match(companyLink, /%23|%28/);
  const other = result.entries.find(entry => entry.subdomain === "Agent");
  assert.match(fs.readFileSync(other.path, "utf8"), /Alpha/);
  assert.match(fs.readFileSync(result.entries.find(entry => entry.subdomain === "算力芯片").path, "utf8"), /暂无归档项目/);
});
test("idempotent refresh preserves human text; edited generated content yields candidate rather than data loss", t => {
  const data = fixture(t), first = refreshIndustryOverviews(data);
  const entry = first.entries.find(item => item.subdomain === "AI数据");
  const original = fs.readFileSync(entry.path, "utf8");
  const edited = original.replace('<!-- domi:industry-overview:v1', '## 人工研究\n\n收入真实性仍需客户访谈。\n\n<!-- domi:industry-overview:v1') + '\n人工补充：保留这段。\n';
  fs.writeFileSync(entry.path, edited);
  const second = refreshIndustryOverviews(data);
  assert.equal(second.updated, 0); assert.equal(second.created, 0); assert.equal(second.ok, true);
  data.projects[0].notes += '\n';
  data.projects[0].rating = 'S';
  refreshIndustryOverviews(data);
  const changed = fs.readFileSync(entry.path, "utf8");
  assert.match(changed, /收入真实性仍需客户访谈/); assert.match(changed, /人工补充：保留这段/); assert.match(changed, /评级 S/);
  const manual = changed.replace('评级 S', '评级 A（人工调整）');
  fs.writeFileSync(entry.path, manual);
  data.projects[0].status = '已投';
  const conflict = refreshIndustryOverviews(data);
  assert.equal(conflict.ok, false); assert.equal(conflict.conflicts.length, 1);
  assert.equal(fs.readFileSync(entry.path, "utf8"), manual);
  assert.match(fs.readFileSync(conflict.conflicts[0].candidatePath, "utf8"), /已投/);
});
test("renamed canonical home and new indexed evidence refresh links and milestones without crawling", t => {
  const data = fixture(t); refreshIndustryOverviews(data);
  const next = path.join(data.libraryDir, "3.项目库", "Renamed", "项目主页.md");
  fs.mkdirSync(path.dirname(next), { recursive: true }); fs.renameSync(data.projects[0].document_path, next);
  data.projects[0].document_path = next; data.projects[0].name = 'Beta'; data.projects[0].notes = '';
  fs.writeFileSync(next, '# Beta\n');
  const evidence = path.join(path.dirname(next), "客户访谈.md");
  fs.writeFileSync(evidence, '## 关键进展\n已完成客户测试，试用尚未转为收入。\n');
  data.documents.push({ owner_type: 'project', owner_id: 'p1', path: evidence, title: '客户访谈' });
  const industry = path.join(data.libraryDir, "1.行业研究", "AI", "AI数据", "研究.md");
  fs.writeFileSync(industry, '# 调研\n\n## 行业现状\n受访客户关注数据可追溯性，样本有限。\n');
  data.documents.push({ owner_type: 'industry', owner_id: 'AI-data', path: industry, title: '数据需求调研' });
  const result = refreshIndustryOverviews(data), entry = result.entries.find(item => item.subdomain === 'AI数据');
  const text = fs.readFileSync(entry.path, 'utf8');
  assert.match(text, /\[Beta\]/); assert.doesNotMatch(text, /Alpha/); assert.match(text, /试用尚未转为收入/);
  assert.match(text, /受访客户关注数据可追溯性，样本有限/); assert.match(text, /数据需求调研/);
});
test("mismatched entity IDs and out-of-root symlinks cannot become company links", t => {
  const data = fixture(t);
  fs.writeFileSync(data.projects[0].document_path, '---\nproject_id: "different-project"\n---\n# Wrong\n');
  const result = refreshIndustryOverviews(data);
  assert.equal(result.linkedProjectCount, 0);
  assert.ok(result.warnings.some(item => item.code === 'project_homepage_missing' && item.projectId === 'p1'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'domi-overview-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const root2 = path.join(data.libraryDir, 'new'); fs.mkdirSync(root2);
  fs.symlinkSync(external, path.join(root2, '1.行业研究'));
  assert.throws(() => refreshIndustryOverviews({ ...data, libraryDir: root2 }), /符号链接/);
  assert.equal(fs.readdirSync(external).length, 0);
});
test("unsafe punctuation is encoded per path segment", () => {
  assert.equal(relativeLink('/tmp/行业速览.md', '/tmp/A (B)#/项目主页.md'), 'A%20%28B%29%23/%E9%A1%B9%E7%9B%AE%E4%B8%BB%E9%A1%B5.md');
});

test("placeholder financing, generic business notes and transcript fragments never become conclusions", t => {
  const data = fixture(t);
  data.projects[0].notes = '公司提供训练数据。';
  data.projects[0].financing_history = '| 日期 | 轮次 | 金额 |\n| --- | --- | --- |\n| 未填写 | — | 待补 |';
  fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  const transcript = path.join(path.dirname(data.projects[0].document_path), 'PLAUD文字稿.md');
  fs.writeFileSync(transcript, '## 关键进展\n未核验口头猜测收入十亿元。\n');
  data.documents.push({ owner_type: 'project', owner_id: 'p1', kind: 'PLAUD文字稿', title: '原始转写', path: transcript, updated_at: Date.now() });
  const result = refreshIndustryOverviews(data), page = result.entries.find(entry => entry.subdomain === 'AI数据');
  const text = fs.readFileSync(page.path, 'utf8');
  assert.match(text, /2 家融资／估值资料待补/); assert.match(text, /投资判断待补/);
  assert.doesNotMatch(text, /内部判断：公司提供|十亿元/);
});
test("business excerpts retain explicit material dates, bold sections and differing source claims without mtime promotion", t => {
  const data = fixture(t); data.projects[0].notes = ''; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  const directory = path.dirname(data.projects[0].document_path);
  const old = path.join(directory, '旧研究.md'), next = path.join(directory, '新纪要.md');
  fs.writeFileSync(old, '# 研究\n资料截至：2025-01-01\n\n**关键进展**\n公司称收入 100 万元。\n\n**投资判断**\n风险：需核验。\n\n1. 市场与行业\n公司认为行业进入数据质量竞争阶段。\n');
  fs.writeFileSync(next, '# 纪要\n会议日期：2026-03-01\n\n1. 关键进展\n公司称收入 200 万元。\n');
  data.documents.push({ owner_type: 'project', owner_id: 'p1', kind: '研究', title: '旧研究', path: old, updated_at: Date.now() }, { owner_type: 'project', owner_id: 'p1', kind: '纪要', title: '新纪要', path: next, updated_at: 1 });
  const result = refreshIndustryOverviews(data), page = result.entries.find(entry => entry.subdomain === 'AI数据');
  const text = fs.readFileSync(page.path, 'utf8');
  assert.doesNotMatch(text, /100 万元/); assert.match(text, /200 万元/);
  assert.match(text, /材料日期 2025-01-01/); assert.match(text, /材料日期 2026-03-01/);
  assert.doesNotMatch(text, /不同材料口径/); assert.match(text, /Alpha &#124; A资料《旧研究》/);
  assert.match(text, /不代表已核验的全行业结论/);
});
test("a legacy document path is never mislabeled as the canonical project homepage", t => {
  const data = fixture(t), original = data.projects[0].document_path;
  const legacy = path.join(path.dirname(original), '公司研究.md'); fs.renameSync(original, legacy);
  data.projects[0].document_path = legacy;
  const result = refreshIndustryOverviews(data);
  assert.equal(result.linkedProjectCount, 0);
  const text = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8');
  assert.match(text, /Alpha &#124; A（主页待关联）/);
});

test("client repository exposes the same repair and refresh contract without changing research dates", t => {
  const { LocalDomiRepository } = require('../electron/local-domi-repository.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domi-client-repair-'));
  const repository = new LocalDomiRepository({ libraryDir: path.join(root, 'library'), databasePath: path.join(root, 'repo.sqlite') });
  t.after(() => { repository.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const source = path.join(repository.libraryDir, '3.项目库', 'AI', 'AI数据', 'Fixture', '研究', '研究.md');
  fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, '# 原始研究\n完整内容不变。\n');
  repository.database.prepare("INSERT INTO projects(id,name,normalized_name,domain,subdomains_json,status,rating,notes,document_path,created_at,updated_at,last_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run('test-project', 'Fixture', 'fixture', 'AI', '["AI数据"]', '已交流', 'A', '业务定位：训练数据', source, 1, 2, 3);
  const repaired = repository.repairProjectHomepage({ recordId: 'test-project', expectedUpdatedAt: 2 });
  assert.equal(repaired.ok, true); assert.equal(repaired.repaired, true);
  assert.equal(path.basename(path.dirname(repaired.documentPath)), 'Fixture');
  assert.equal(repository.database.prepare('SELECT last_updated_at FROM projects WHERE id=?').get('test-project').last_updated_at, 3);
  assert.match(fs.readFileSync(repaired.documentPath, 'utf8'), /保留的历史材料/);
  assert.equal(repository.refreshIndustryOverviews().linkedProjectCount, 1);
});

test("newest-first financing excerpts retain the pending round and separate completed post-money valuation", t => {
  const data = fixture(t);
  data.projects[0].financing_history = '| 日期 | 轮次 | 投前估值 | 状态 |\n| --- | --- | --- | --- |\n| 2026-03 | B | 6亿元 | 进行中，公司口径 |\n| 2025-02 | A | 2亿元 | 已完成 |\n| 2024-01 | Seed | 3000万元 | 已完成 |';
  data.projects[0].latest_valuation_usd_100m = 0.4;
  const result = refreshIndustryOverviews(data), page = result.entries.find(entry => entry.subdomain === 'AI数据');
  const text = fs.readFileSync(page.path, 'utf8');
  assert.match(text, /2026-03 B.*进行中，公司口径/);
  assert.match(text, /2025-02 A.*已完成/);
  assert.doesNotMatch(text, /轮次：Seed/);
  assert.match(text, /余1轮见主页/);
  assert.match(text, /已完成轮次投后0.4亿美元/);
});

test("record updates never become source dates and dated filenames are labeled as document dates", t => {
  const data = fixture(t); data.projects = [data.projects[0]];
  data.projects[0].last_updated_at = Date.parse('2026-09-21');
  data.projects[0].notes = '会议日期：2024-09-01\n**关键进展**：公司自述收入 80 万元，未经审计。';
  fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  const result = refreshIndustryOverviews(data);
  let page = result.entries.find(entry => entry.subdomain === 'AI数据');
  let row = fs.readFileSync(page.path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.match(row, /材料日期 2024-09-01/); assert.match(row, /记录更新：2026-09-21/);
  assert.doesNotMatch(row, /材料日期 2026/);
  assert.match(row.split(' | ')[2], /材料日期待核/, 'financing record date is independent of project update date');
  data.projects[0].notes = '';
  const doc = path.join(path.dirname(data.projects[0].document_path), '20240910-交流纪要.md');
  fs.writeFileSync(doc, '# 客户会议\n关键进展：公司称增加两家客户，未经核验。');
  data.documents.push({ owner_type: 'project', owner_id: 'p1', kind: '纪要', title: '20240910-交流纪要', path: doc, updated_at: Date.now() });
  refreshIndustryOverviews(data);
  row = fs.readFileSync(page.path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.match(row, /文档日期 2024-09-10/); assert.doesNotMatch(row, /材料日期 2026/);
});

test("archive receipts, diligence decisions, requested revenue and founder industry views are not business milestones or investor judgments", t => {
  const data = fixture(t); data.projects = [data.projects[0]];
  fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  const falseMilestones = ['关键进展：研究报告与投资快评已归档。', '商业化进展：可进入有条件尽调；下一步审计收入。', '收入：索取最近12个月收入证明。', '投资意见中提到收入还有待确认。'];
  for (const notes of falseMilestones) {
    data.projects[0].notes = notes;
    const result = refreshIndustryOverviews(data);
    const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
    assert.equal(row.split(' | ')[1], '关键业务进展待补', notes);
  }
  data.projects[0].notes = '## 创始人的核心行业判断\n下一代数据竞争将改变行业。\n### 风险\n创始人认为同行会落后。';
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.match(row.split(' | ')[3], /投资判断待补/);
});

test("one compact source excerpt preserves company forecast qualifiers without inventing cross-source conflicts", t => {
  const data = fixture(t); data.projects = [data.projects[0]];
  fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  data.projects[0].notes = `关键进展：${'公司开发的产品已通过多项测试，'.repeat(18)}该收入数字为公司自述预测，未经核验。`;
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  const progress = row.split(' | ')[1];
  assert.equal(progress.split('<br>')[0], data.projects[0].notes.replace('关键进展：', ''));
  assert.match(progress, /公司自述/); assert.match(progress, /预测/); assert.match(progress, /未经核验/);
  assert.doesNotMatch(progress, /不同材料口径|另有摘录/);
});

test("ascending financing histories and unknown-date pending rounds retain recent amounts and qualifiers", t => {
  const data = fixture(t); data.projects = [data.projects[0]];
  data.projects[0].financing_history = '| 时间 | 轮次 | 金额 | 投资方 | 状态 |\n| --- | --- | --- | --- | --- |\n| 2018 | 天使 | 800万元 | 早期机构 | 已完成 |\n| 2022-03 | A轮 | 7000万元 | 若干机构 | 已完成 |\n| 2026-06 | B轮 | 1.2亿元；另有1.8亿元口径 | 名单尚未确认 | 未交割，投前12亿元待TS |\n| — | C轮（拟募） | 2亿元 | 未定 | 在谈，公司口径 |';
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  const finance = row.split(' | ')[2];
  assert.match(finance, /C轮（拟募）.*2亿元.*在谈，公司口径/);
  assert.match(finance, /2026-06 B轮.*1.2亿元；另有1.8亿元口径.*未交割/);
  assert.doesNotMatch(finance, /2018|800万元|原文较长/);
  assert.ok(finance.replace(/<br>/g, '').length <= 200);
});

test("canonical shareholder amounts summarize the reported total without copying long investor lists", t => {
  const data = fixture(t); data.projects = [data.projects[0]];
  data.projects[0].financing_history = '| 融资时间 | 融资轮次 | 投前估值 | 股东出资情况 | 投后估值 |\n| --- | --- | --- | --- | --- |\n| 2025年9月 | A轮 | 5亿元人民币 | 合计融资8,000万元人民币，其中甲机构3,000万元、乙机构5,000万元 | 5.8亿元人民币 |';
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  const finance = row.split(' | ')[2];
  assert.match(finance, /合计融资8,000万元人民币/); assert.match(finance, /投前5亿元人民币/); assert.match(finance, /投后5.8亿元人民币/);
  assert.doesNotMatch(finance, /甲机构|乙机构|原文较长/);
});

test("short compound commercial headings yield actual claims while diligence questions remain excluded", t => {
  const data = fixture(t); data.projects = [data.projects[0]]; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  for (const heading of ['商业化与客户', '收入、客户与商业化', '客户与销售路径', '客户、收入质量与复购', '商业模式与公司指标']) {
    data.projects[0].notes = `## ${heading}\n公司称已向两家客户交付首批产品，收入仍待客户函证。`;
    const result = refreshIndustryOverviews(data);
    const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
    assert.match(row.split(' | ')[1], /已向两家客户交付首批产品，收入仍待客户函证/);
  }
  data.projects[0].notes = '## 收入、客户与商业化问题\n是否已经确认收入？\n索取客户合同。';
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.equal(row.split(' | ')[1], '关键业务进展待补');
});

test("semicolon-terminated financing totals retain thousands separators without the investor list", t => {
  const data = fixture(t); data.projects = [data.projects[0]];
  data.projects[0].financing_history = '| 融资时间 | 融资轮次 | 股东出资情况 |\n| --- | --- | --- |\n| 2026年3月 | A轮 | 合计融资2,000万美元；投资方甲机构、乙机构 |\n| 2024年8月 | 种子 | 合计融资500万美元;投资方丙机构 |';
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.match(row.split(' | ')[2], /合计融资2,000万美元/); assert.match(row.split(' | ')[2], /合计融资500万美元/);
  assert.doesNotMatch(row.split(' | ')[2], /甲机构|乙机构|丙机构/);
});

test("positioning selects the full business sentence independently of later financing and rating sentences", t => {
  const data = fixture(t); data.projects = [data.projects[0]]; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  data.projects[0].notes = 'Alpha | A 从音频数据起步，提供可追溯的训练数据服务。上一轮融资2亿元。评级A，仍需核验收入。';
  let result = refreshIndustryOverviews(data);
  let row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.match(row.split(' | ')[0], /从音频数据起步，提供可追溯的训练数据服务。/);
  assert.doesNotMatch(row.split(' | ')[0], /上一轮融资|评级A/);
  data.projects[0].notes = '项目定位：是当前最硬的交付证据；公开渠道未核实。';
  result = refreshIndustryOverviews(data);
  row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.match(row.split(' | ')[0], /定位待补/); assert.doesNotMatch(row.split(' | ')[0], /最硬的交付证据/);
});

test("financing headings do not become operating milestones and Markdown backslashes are removed", t => {
  const data = fixture(t); data.projects = [data.projects[0]]; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  data.projects[0].notes = '## 融资\n本轮已经完成融资。\n## 投资判断\n\\\\上一轮股东支持较强，但仍需核验客户收入。';
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.equal(row.split(' | ')[1], '关键业务进展待补');
  assert.match(row.split(' | ')[3], /上一轮股东/); assert.doesNotMatch(row, /\\/);
});

test("short and long milestone excerpts preserve free-trial and no-revenue qualifications", t => {
  const data = fixture(t); data.projects = [data.projects[0]]; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  const claim = '公司已向十家潜在客户交付原型。团队已提供技术支持。这些均为免费试用，尚未产生收入。';
  for (const text of [claim, `公司已向十家潜在客户交付原型。${'团队已提供技术支持与产品说明。'.repeat(16)}这些均为免费试用，尚未产生收入。`]) {
    data.projects[0].notes = `关键进展：${text}`;
    const result = refreshIndustryOverviews(data);
    const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
    const progress = row.split(' | ')[1];
    assert.match(progress, /免费试用/); assert.match(progress, /尚未产生收入/);
    if (text === claim) assert.ok(progress.startsWith(claim));
  }
  data.projects[0].notes = '公司提供数据标注产品。产品目前仅供免费试用，尚未产生收入。融资1亿元。';
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.match(row.split(' | ')[0], /产品目前仅供免费试用，尚未产生收入/);
});

test("milestones and judgments retain whole source paragraphs instead of stitching clauses from separate bullets", t => {
  const data = fixture(t); data.projects = [data.projects[0]]; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  const revenue = '公司称2025年收入达到3200万元，服务12家客户。其中部分合同尚未回款，收入数字未经审计，不能等同于已核验收入。';
  const judgment = '产品已体现客户交付能力，但收入集中于少数客户，现阶段只能维持有条件跟进的判断。';
  data.projects[0].notes = `## 商业化\n\n- 公司早期从工具业务起步。\n- ${revenue}\n- 团队仍需补充审计资料，不能直接确认。\n\n## 投资判断\n\n- ${judgment}\n- 另需关注市场规模假设。`;
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.equal(row.split(' | ')[1].split('<br>')[0], revenue);
  assert.equal(row.split(' | ')[3].split('<br>')[1], judgment);
  assert.doesNotMatch(row.split(' | ')[1], /业务起步|团队仍需/);
});

test("verification-list ancestors exclude even factual-looking checklist bullets", t => {
  const data = fixture(t); data.projects = [data.projects[0]]; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  data.projects[0].notes = '## 下一步尽调与待核验\n### 商业化与客户\n- L1预订、退款、留存与客户结构是否证明真实需求。\n\n## 商业化\n- 公司表示原型仍在内部测试，未开始对外销售。';
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.equal(row.split(' | ')[1].split('<br>')[0], '公司表示原型仍在内部测试，未开始对外销售。');
  assert.doesNotMatch(row, /L1预订|退款|真实需求/);
});

test("oversized paragraphs use a source prompt and positioning does not inherit unrelated negative sentences", t => {
  const data = fixture(t); data.projects = [data.projects[0]]; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  data.projects[0].notes = `Alpha | A 提供面向模型训练的专家数据服务。公开渠道未核实其最新融资主体。\n\n## 关键进展\n${'公司已交付原型但仍在免费测试期。'.repeat(40)}`;
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.match(row.split(' | ')[0], /Alpha &#124; A 提供面向模型训练的专家数据服务。/);
  assert.doesNotMatch(row.split(' | ')[0], /融资主体/);
  assert.equal(row.split(' | ')[1].split('<br>')[0], '原文段落超过450字，请打开项目主页阅读完整原文及限定。');
  assert.doesNotMatch(row.split(' | ')[1], /公司已交付|免费测试/);
});


test("operating excerpts select a self-contained company paragraph instead of peer metrics or unresolved references", t => {
  const data = fixture(t); data.projects = [data.projects[0]]; fs.writeFileSync(data.projects[0].document_path, '# Alpha\n');
  const claim = '公司称近期开始向企业客户交付数据包，目前仍处于免费试用，尚未形成收入。';
  data.projects[0].notes = `## 商业化与客户\n\n行业参照显示，同行Beta收入为8000万元，客户集中度超过60%，不能套用于本公司。\n\n三者可能混用了客户口径，不能据此计算收入和复购率。\n\n${claim}`;
  const result = refreshIndustryOverviews(data);
  const row = fs.readFileSync(result.entries.find(entry => entry.subdomain === 'AI数据').path, 'utf8').split('\n').find(line => line.startsWith('| [Alpha'));
  assert.equal(row.split(' | ')[1].split('<br>')[0], claim);
  assert.doesNotMatch(row.split(' | ')[1], /Beta|三者|8000万元/);
});
