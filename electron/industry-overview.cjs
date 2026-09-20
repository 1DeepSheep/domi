// Shared verbatim with the domi plugin. Only indexed evidence is read; no workspace crawl.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PAGE = "行业速览.md";
const START = "<!-- domi:industry-overview:v1";
const END = "<!-- domi:industry-overview:end -->";
const BLOCK = /<!-- domi:industry-overview:v1 sha256=([a-f0-9]{64}) -->\n([\s\S]*?)<!-- domi:industry-overview:end -->/;
const MAX_BYTES = 512 * 1024;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const list = value => { if (Array.isArray(value)) return value; try { return JSON.parse(value || "[]"); } catch { return []; } };
const segment = value => String(value || "").trim().replace(/[\/\\:*?"<>|\x00-\x1f]/g, "／").replace(/^\.+$/, "").slice(0, 160) || "_未分类";
const inside = (root, target) => { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };
const plain = value => String(value || "").replace(/<!--[^]*?-->/g, "").replace(/<[^>]*>/g, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/\\+(?=[^\s\\])/g, "").replace(/\s+/g, " ").trim();
const cell = value => plain(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "&#124;").replace(/[\\[\]]/g, "\\$&");
const short = (value, max = 170) => { const text = plain(value); return text.length > max ? `${text.slice(0, max)}…` : text; };
const relativeLink = (from, to) => path.relative(path.dirname(from), to).split(path.sep).map(part => encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
function date(value) {
  if (value === null || value === undefined || value === "" || value === 0) return "";
  const n = Number(value);
  const parsed = new Date(Number.isFinite(n) ? (n < 1e10 ? n * 1000 : n) : value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed) : "";
}
function body(text) { return String(text || "").replace(/<!-- domi:managed:(?:start|end) -->/g, "").replace(/^\s*---\s*\n[^]*?\n---\s*\n/, "").replace(/```[^]*?```/g, ""); }
function useful(value) {
  const text = plain(value).replace(/^[—–-]+$/, "");
  return text && !/^(?:未填写|未提供|未披露|待补|待核实|待确认|未知|不详|暂无|无数据|建议补充|尚无|N\/?A|null|none)$/i.test(text)
    && !/暂无投资摘要|建议补充项目定位|会议纪要、投资快评、深度研究|在 Finder|打开项目目录|归档回执|storage_receipt|documentVerified|执行回执|归档成功|归档完成|已(?:完成)?归档|已入库|材料已保存|文档已生成/.test(text);
}
const QUALIFIERS = /公司自述|公司称|公司口径|未经审计|未经核验|尚未核验|未核实|待核实|预测|预计|进行中|未完成|尚未完成|口径冲突|数据冲突|存在矛盾|免费|试用|尚未产生|未产生|不代表|不能|不等于|尚未|未实现|没有|不构成|非付费/g;
function compactExcerpt(value, max = 450) {
  const text = plain(value);
  return text.length <= max ? text : "原文段落超过450字，请打开项目主页阅读完整原文及限定。";
}
function exactLabel(value, pattern) {
  const label = plain(value).replace(/^(?:\d+[.、)）]|[一二三四五六七八九十]+[、.])\s*/, "").replace(/[：:]$/, "").trim();
  return label.length <= 24 && new RegExp(`^(?:${pattern.source})$`, pattern.flags.replace(/[gy]/g, "")).test(label);
}
const PROGRESS_TERMS = "商业化|商业化进展|商业进展|商业模式|公司指标|商业闭环|收入质量|收入|营收|经营|执行进展|当前进展|客户|客户任务|客户工作流|销售路径|渠道|价格|产能|定价|订单|复购|需求|交付|已验证交付|数据资产|关键缺口|财务|指标|单位经济";
const PROGRESS_PATTERN = new RegExp(`关键进展|业务进展|近期进展|经营进展|产品进展|客户进展|里程碑|(?:${PROGRESS_TERMS})(?:[、与及和/／&·—-]+(?:${PROGRESS_TERMS})){0,3}(?:情况|进展|现状)?`);
function extract(text, pattern, { kind = "" } = {}) {
  const lines = body(text).split(/\r?\n/);
  const found = [], headingContexts = [];
  let markdownLevel = 0, paragraph = null;
  function flush() {
    if (!paragraph) return;
    const current = paragraph; paragraph = null;
    if (!current.selected || current.blocked) return;
    const clean = plain(current.lines.join(" ").replace(/^\s*[-+*>]\s*/, "").replace(/^\s*\d+[.、)）]\s*/, ""));
    const colon = clean.search(/[：:]/), label = colon >= 0 ? clean.slice(0, colon) : "";
    const value = label && exactLabel(label, pattern) ? clean.slice(colon + 1).trim() : clean;
    if (!useful(value) || /^\|/.test(value) || /^(?:---|domi_|entity_type|project_id|company_name|latest_valuation)/.test(value)) return;
    if (kind === "progress" && (/^(?:下一步|建议|计划|拟|准备|待|需|需要|索取|核实|核验|验证|审计|补充|跟进|可进入|有条件进入|应当|应向|请|是否|如何|能否|行业参照|行业对标|同业|可比公司|竞品|作为对照|相比之下|参照|三者|二者|两者|前者|后者)/.test(value) || /[？?]$/.test(value))) return;
    if (kind === "judgment" && /^(?:创始人|管理层|公司|受访者).{0,10}(?:认为|判断|观点|表示|预计|预测)/.test(value)) return;
    found.push(value);
  }
  for (const raw of lines) {
    const hard = raw.match(/^\s*(#{1,6})\s+(.+)$/);
    const bold = raw.match(/^\s*\*\*([^*]{1,50})\*\*\s*[:：]?\s*$/);
    const numbered = raw.match(/^\s*(?:\d+[.、)）]|[一二三四五六七八九十]+[、.])\s*([^：:]{2,30})\s*$/);
    const soft = bold || (numbered && (exactLabel(numbered[1], pattern) || /尽调|待核|待验证|跟进|缺口|问题清单|行业|创始人/.test(numbered[1])) ? numbered : null);
    if (hard || soft) {
      flush();
      const label = hard ? hard[2] : soft[1];
      const level = hard ? hard[1].length : markdownLevel + 1;
      if (hard) markdownLevel = level;
      while (headingContexts.length && headingContexts.at(-1).level >= level) headingContexts.pop();
      const inherited = headingContexts.at(-1);
      const blocked = Boolean(inherited?.blocked)
        || (kind === "progress" && /尽调|待核(?:实|验)?|待验证|跟进|下一步|问题清单|核验清单|缺口|验证事项/.test(plain(label)))
        || (kind === "judgment" && /创始人|管理层|行业|市场|竞争格局/.test(plain(label)));
      headingContexts.push({ level, blocked, selected: !blocked && (exactLabel(label, pattern) || Boolean(inherited?.selected)) });
      continue;
    }
    if (!raw.trim()) { flush(); continue; }
    const clean = plain(raw.replace(/^\s*[-+*>]\s*/, "").replace(/^\s*\d+[.、)）]\s*/, ""));
    const colon = clean.search(/[：:]/), label = colon >= 0 ? clean.slice(0, colon) : "";
    const explicit = label && exactLabel(label, pattern);
    const fieldLine = colon > 0 && colon <= 24;
    const bullet = /^\s*(?:[-+*]\s+|\d+[.、)）]\s*)/.test(raw);
    if (bullet || explicit || fieldLine) flush();
    const context = headingContexts.at(-1);
    if (!paragraph) paragraph = { lines: [], selected: explicit || Boolean(context?.selected), blocked: Boolean(context?.blocked) };
    paragraph.lines.push(raw);
  }
  flush();
  if (kind === "progress") {
    const score = value => (/营收|收入|ARR|revenue/i.test(value) ? 4 : 0) + (/客户|订单|签约|合同/.test(value) ? 3 : 0) + (/\d|[千万亿].*(?:元|美元)/.test(value) ? 2 : 0);
    found.sort((a, b) => score(b) - score(a));
  }
  // Keep a single complete source paragraph/bullet. Never construct a new sentence by joining
  // claims and negative clauses from different bullets or sections.
  return found[0] || "";
}
function positioningSentence(value, companyName = "", explicit = false) {
  const sentences = plain(body(value)).match(/[^。！？!?]+[。！？!?]?/g) || [];
  const company = plain(companyName).toLocaleLowerCase();
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index].replace(/^\s*[-#>\d、.）)]+\s*/, "").trim();
    if (!useful(sentence) || sentence.length > 450) continue;
    const knownSubject = company && sentence.toLocaleLowerCase().startsWith(company);
    const business = /专注|主营|提供|面向|研发|开发|打造|从事|定位|是一家|是一个|起步|服务商|服务平台|数据平台|模型平台/.test(sentence)
      || (explicit && /服务|软件|平台|系统|工具|数据|模型|芯片|机器人|设备|产品|技术/.test(sentence));
    const suitableSubject = knownSubject || /^(?:公司|该公司|项目|本项目|官网|网站|主要|提供|面向|为.{1,30}提供|从.{1,40}起步)/.test(sentence);
    if (!business || (!explicit && !suitableSubject) || /(?:交付|商业化|收入)证据|最硬的.*证据|^公开渠道/.test(sentence)) continue;
    const qualifiers = [];
    for (const following of sentences.slice(index + 1, index + 3)) {
      if (!/^(?:但|不过|然而|这|该|其|上述|因此|(?:本|该)?(?:产品|服务|平台))/.test(following.trim()) || !(following.match(QUALIFIERS) || []).length) break;
      qualifiers.push(following);
    }
    const complete = [sentence, ...qualifiers].join("");
    // A position is a full business-description sentence, never a financial clause selected by the
    // generic milestone compactor. Preserve adjacent limitations or leave the position unfilled.
    if (complete.length <= 450) return complete;
  }
  return "";
}
function financing(value, budget = 155) {
  const lines = String(value || "").split(/\r?\n/).filter(line => line.trim());
  const table = lines.filter(line => /^\s*\|/.test(line)).map(line => line.split("|").slice(1, -1).map(plain));
  const rows = table.filter(row => row.some(Boolean) && !row.every(item => /^:?-+:?$/.test(item)));
  if (rows.length <= 1) return lines.filter(line => !/^\s*#/.test(line) && useful(line)).join("；");
  const labels = rows[0];
  const field = (row, pattern) => row.filter((item, i) => pattern.test(labels[i] || "") && useful(item)).join("；");
  const validRows = rows.slice(1).filter(row => row.some(item => useful(item))).map((row, index) => {
    const time = field(row, /日期|时间/), round = field(row, /轮次/), status = field(row, /状态|口径/);
    const directAmount = field(row, /^(?:融资)?金额$|融资额|融资规模|募集金额/);
    const shareholderText = field(row, /股东出资|出资情况/);
    const total = shareholderText.match(/(?:合计(?:融资)?|本轮融资|融资总额|融资金额|融资规模|募资)[：:\s]*([^；;。]+?)(?=其中|[；;。]|[，,](?!\d{3})|$)/)?.[0]?.replace(/[，,；;]+$/, "");
    const amount = directAmount || total || (shareholderText && /未披露|未知|不详/.test(shareholderText) ? "金额未披露" : "");
    const pre = field(row, /投前/), post = field(row, /投后/);
    const knownDate = time.match(/((?:19|20)\d{2})(?:[-/.年](\d{1,2}))?(?:[-/.月](\d{1,2}))?/);
    const sortDate = knownDate ? Number(knownDate[1]) * 10000 + Number(knownDate[2] || 0) * 100 + Number(knownDate[3] || 0) : 0;
    const pending = /拟|在谈|进行中|未交割|未完成|计划|目标/.test(`${time} ${round} ${status}`);
    const parts = [[time, round].filter(Boolean).join(" "), amount && (/(?:融资|金额|募资)/.test(amount) ? amount : `融资${amount}`), pre && `投前${pre}`, post && `投后${post}`, status].filter(Boolean);
    return { text: parts.join("，").replace(/[,，；;。]+$/, "") + "。", sortDate, pending, index };
  });
  // Date-bearing legacy tables may be ascending. Unknown-date pending rounds retain source order
  // at the front; remaining explicit dates are compared without inventing dates for blank rows.
  validRows.sort((a, b) => Number(b.pending && !b.sortDate) - Number(a.pending && !a.sortDate) || b.sortDate - a.sortDate || a.index - b.index);
  const chosen = [];
  for (const row of validRows.slice(0, 2)) {
    if (chosen.length && chosen.join("").length + row.text.length > budget - 12) break;
    chosen.push(row.text);
  }
  return chosen.join("") + (validRows.length > chosen.length ? `（余${validRows.length - chosen.length}轮见主页）` : "");
}
function sourceDate(value) {
  const parts = String(value).match(/((?:19|20)\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!parts) return "";
  const [year, month, day] = parts.slice(1).map(Number), parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "";
}
function evidenceDate(text, title = "") {
  const match = String(text || "").match(/^(?:[>#*\s-]*)(?:资料(?:截至|截止|日期)|数据(?:截至|截止|日期)|研究(?:截至|日期)|会议日期|交流日期|访谈日期|as_of|data_date|meeting_date)\s*[*：:]*\s*["']?((?:19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2})/im);
  if (match) return { date: sourceDate(match[1]), dateKind: "材料日期" };
  const datedTitle = String(title).match(/(?:^|[^0-9])((?:19|20)\d{2})[-/.年]?(\d{2})[-/.月]?(\d{2})(?:[^0-9]|$)/);
  return datedTitle ? { date: sourceDate(`${datedTitle[1]}-${datedTitle[2]}-${datedTitle[3]}`), dateKind: "文档日期" } : { date: "", dateKind: "材料日期" };
}
function evidenceCell(items, missing) {
  if (!items.length) return cell(missing);
  const item = items[0];
  const text = item.finance || item.direction ? item.text : compactExcerpt(item.text);
  const source = short(item.label, 22);
  return `${cell(text)}${item.conflict && !/冲突|矛盾|不一致/.test(text) ? "；现有材料已标注口径冲突，见主页。" : ""}<br>来源：${cell(source)}（${item.date ? `${item.dateKind || "材料日期"} ${cell(item.date)}` : "材料日期待核"}）`;
}
const SUMMARY_DOCUMENT = /研究|纪要|访谈|快评|分析|投委|IC.?Memo|总结|review|research|notes|memo/i;
const RAW_DOCUMENT = /文字稿|逐字稿|原始转写|转写稿|精修稿|transcript|原始材料/i;
function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${crypto.randomUUID()}`;
  try { fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" }); fs.renameSync(temporary, filePath); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}
function writeExclusiveVerified(target, content) {
  const temporary = `${target}.tmp-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (fileSha256(temporary) !== hash(content)) throw new Error("项目主页临时文件校验失败。");
    fs.linkSync(temporary, target);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}
function safeTarget(root, filePath) {
  if (!inside(root, filePath)) throw new Error("行业速览路径越过资料库边界。");
  let parent = filePath;
  while (!fs.existsSync(parent)) { const next = path.dirname(parent); if (next === parent) break; parent = next; }
  if (fs.existsSync(parent) && !inside(fs.realpathSync(root), fs.realpathSync(parent))) throw new Error("行业速览路径不能通过符号链接越过资料库边界。");
}
function updatePage(root, filePath, title, generated, result) {
  safeTarget(root, filePath);
  const content = `${generated.trim()}\n`;
  const block = `${START} sha256=${hash(content)} -->\n${content}${END}`;
  const exists = fs.existsSync(filePath);
  const previous = exists ? fs.readFileSync(filePath, "utf8") : "";
  const match = previous.match(BLOCK);
  if ((match && hash(match[2]) !== match[1]) || (previous.includes(START) && !match) || (previous.match(/<!-- domi:industry-overview:v1/g) || []).length > 1) {
    const candidatePath = path.join(path.dirname(filePath), `.行业速览候选-${hash(content).slice(0, 12)}.md`);
    const candidate = `# ${title}\n\n${block}\n`;
    safeTarget(root, candidatePath);
    if (!fs.existsSync(candidatePath)) fs.writeFileSync(candidatePath, candidate, { encoding: "utf8", mode: 0o600, flag: "wx" });
    result.conflicts.push({ path: filePath, candidatePath, reason: "自动维护区已被人工修改，保留原文与更新候选。" });
    return;
  }
  const next = match ? previous.replace(BLOCK, () => block)
    : `${previous.trim() || `# ${title}`}\n\n${block}\n`;
  if (next === previous) { result.unchanged += 1; return; }
  // Detect a concurrent editor before replacing the whole file, including human text outside the block.
  if (exists && fs.readFileSync(filePath, "utf8") !== previous) {
    result.conflicts.push({ path: filePath, reason: "文档正在被其他编辑器修改，已保留当前内容。" }); return;
  }
  writeAtomic(filePath, next);
  result[exists ? "updated" : "created"] += 1;
}
function projectModel(row) {
  return { id: row.id || row.recordId, name: row.name, domain: row.domain || "", domains: list(row.domains),
    subdomains: list(row.subdomains || row.subdomains_json), notes: row.notes || "", summary: row.summary || "",
    status: row.status || "", rating: row.rating || "", financingHistory: row.financingHistory || row.financing_history || "",
    valuation: row.latestValuationUsd100m ?? row.latest_valuation_usd_100m,
    lastUpdatedAt: row.lastUpdatedAt ?? row.last_updated_at,
    documentPath: row.documentPath || row.document_path || "" };
}
function refreshIndustryOverviews({ libraryDir, projects = [], documents = [], taxonomy = {} }) {
  const root = path.resolve(libraryDir);
  const result = { ok: true, entries: [], indexPath: path.join(root, "1.行业研究", PAGE), conflicts: [], warnings: [], created: 0, updated: 0, unchanged: 0, projectCount: 0, linkedProjectCount: 0, unclassifiedProjectCount: 0 };
  const domains = Array.isArray(taxonomy.domains) ? taxonomy.domains : Object.entries(taxonomy).map(([name, subdomains]) => ({ name, subdomains }));
  const unique = new Map();
  for (const row of projects) { const project = projectModel(row); if (project.id && !unique.has(project.id)) unique.set(project.id, project); }
  const all = [...unique.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN"));
  result.projectCount = all.length;
  const readCache = new Map();
  function read(filePath) {
    if (!filePath) return "";
    const absolute = path.resolve(filePath);
    if (readCache.has(absolute)) return readCache.get(absolute);
    let value = "";
    try {
      if (!inside(root, absolute) || !inside(fs.realpathSync(root), fs.realpathSync(absolute)) || !/\.(md|markdown)$/i.test(absolute)) throw new Error("文件不在本地资料库内或不是 Markdown");
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("文件超过速览摘要读取限制");
      value = fs.readFileSync(absolute, "utf8");
    } catch (error) { result.warnings.push({ code: "evidence_unavailable", path: absolute, message: error.message }); }
    readCache.set(absolute, value); return value;
  }
  const docsByProject = new Map();
  for (const doc of documents) if ((doc.ownerType || doc.owner_type) === "project") {
    const id = doc.ownerId || doc.owner_id;
    const rows = docsByProject.get(id) || [];
    if (rows.length < 6 && /\.(md|markdown)$/i.test(doc.path || "") && SUMMARY_DOCUMENT.test(`${doc.kind} ${doc.title} ${doc.path}`) && !RAW_DOCUMENT.test(`${doc.kind} ${doc.title} ${doc.path}`)) rows.push(doc);
    docsByProject.set(id, rows);
  }
  const models = new Map();
  for (const project of all) {
    const home = read(project.documentPath);
    const declaredId = home.match(/^project_id:\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
    const validHome = Boolean(home && path.basename(project.documentPath) === "项目主页.md" && (!declaredId || declaredId === project.id));
    if (!validHome) result.warnings.push({ code: "project_homepage_missing", projectId: project.id, name: project.name, path: project.documentPath, message: "规范项目主页缺失或实体标识不匹配，已显示名称但不生成链接。" });
    else result.linkedProjectCount += 1;
    const evidence = [
      { text: project.notes, label: "项目结构化摘要", ...evidenceDate(project.notes), structured: true },
      { text: project.summary, label: "项目简介", ...evidenceDate(project.summary), structured: true },
      ...(validHome ? [{ text: home, label: "项目主页", ...evidenceDate(home) }] : []),
      ...(docsByProject.get(project.id) || []).map(doc => { const text = read(doc.path); return { text, label: doc.title || path.basename(doc.path), ...evidenceDate(text, doc.title || path.basename(doc.path)), path: doc.path }; })
    ].filter(item => item.text);
    function pick(pattern, kind = "") {
      const values = new Map();
      for (const source of evidence) {
        const effectivePattern = kind === "judgment" && /投资快评|投委|IC.?Memo|投资分析/i.test(source.label) ? new RegExp(`${pattern.source}|关键要点|投资结论|评级结论`) : pattern;
        const text = extract(source.text, effectivePattern, { kind });
        if (text && !values.has(text)) values.set(text, { text, label: source.label, date: source.date, dateKind: source.dateKind, structured: source.structured });
      }
      const candidates = [...values.values()];
      candidates.sort((a, b) => (b.date || "").localeCompare(a.date || "") || Number(Boolean(b.structured)) - Number(Boolean(a.structured)));
      const chosen = candidates[0];
      if (!chosen) return [];
      const conflict = candidates.some(item => /(?:口径|数据|收入|估值).{0,8}(?:冲突|矛盾)|(?:两份|多份|不同)材料.{0,8}(?:不一致|冲突)/.test(item.text));
      return [{ ...chosen, conflict }];
    }
    const direction = pick(/业务定位|一句话|主营业务|公司简介|核心业务|业务方向|项目定位|核心产品|产品定位/)
      .map(item => ({ ...item, text: positioningSentence(item.text, project.name, true), direction: true })).filter(item => item.text);
    if (!direction.length) {
      for (const source of evidence.filter(item => item.structured)) {
        const text = positioningSentence(source.text, project.name);
        if (text) { direction.push({ text, label: source.label, date: source.date, dateKind: source.dateKind, direction: true }); break; }
      }
    }
    const progress = pick(PROGRESS_PATTERN, "progress");
    const judgment = pick(/投资判断|投资意见|内部判断|投资亮点|项目亮点|主要风险|投资风险|亮点|风险|待验证问题|投资逻辑/, "judgment");
    const valuation = project.valuation !== null && project.valuation !== undefined && project.valuation !== "" && Number.isFinite(Number(project.valuation))
      ? `已完成轮次投后${Number(project.valuation)}亿美元（估值日待核）` : "";
    const financingText = financing(project.financingHistory, valuation ? Math.max(85, 155 - valuation.length) : 155);
    const combinedFinance = [financingText, valuation].filter(Boolean).join("；");
    models.set(project.id, { validHome, direction, progress, judgment, evidence,
      financing: combinedFinance ? [{ text: combinedFinance, label: "融资记录", finance: true, ...evidenceDate(project.financingHistory) }] : [] });
  }

  const usedPaths = new Set();
  function addEntry(domain, subdomain, members) {
    const filePath = path.join(root, "1.行业研究", segment(domain), ...(subdomain ? [segment(subdomain)] : []), PAGE);
    if (usedPaths.has(filePath)) { result.warnings.push({ code: "taxonomy_path_collision", domain, subdomain, message: "分类名对应同一路径，未覆盖另一行业。" }); return; }
    usedPaths.add(filePath);
    const title = `${subdomain || domain} 行业速览`;
    const entry = { domain, subdomain: subdomain || "", title, path: filePath, projectCount: members.length };
    result.entries.push(entry);
    const counts = new Map();
    for (const project of members) for (const tag of project.subdomains.length ? project.subdomains : ["子行业待补"]) counts.set(tag, (counts.get(tag) || 0) + 1);
    const distribution = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 7).map(([tag, count]) => `${tag} ${count} 家`).join("、");
    const dates = members.map(project => date(project.lastUpdatedAt)).filter(Boolean).sort();
    const research = documents.filter(doc => {
      if ((doc.ownerType || doc.owner_type) !== "industry") return false;
      const relative = path.relative(path.join(root, "1.行业研究"), path.resolve(doc.path || ""));
      const parts = relative.split(path.sep);
      return parts[0] === segment(domain) && (!subdomain || parts[1] === segment(subdomain)) && path.basename(doc.path || "") !== PAGE && /\.(md|markdown)$/i.test(doc.path || "");
    }).slice(0, 3).map(doc => ({ doc, text: read(doc.path) })).filter(item => item.text);
    const industrySources = research.map(({ doc, text }) => ({ text, label: doc.title || path.basename(doc.path), ...evidenceDate(text, doc.title || path.basename(doc.path)), path: doc.path }));
    // Company materials may contain industry views, but they remain attributed views of that company/source.
    const companySources = members.flatMap(project => models.get(project.id).evidence.map(source => ({ ...source, label: `${project.name}资料《${source.label}》` })));
    function industryTopic(label, pattern, missing) {
      const seen = new Set();
      const excerpts = [];
      for (const source of [...industrySources, ...companySources]) {
        const text = compactExcerpt(extract(source.text, pattern));
        if (!text || seen.has(text)) continue;
        seen.add(text);
        const citation = source.path ? `[${cell(source.label)}](${relativeLink(filePath, source.path)})` : cell(source.label);
        excerpts.push(`${cell(text)}（摘自 ${citation}；${source.date ? `${source.dateKind || "材料日期"} ${cell(source.date)}` : "材料日期待核"}）`);
        if (excerpts.length === 2) break;
      }
      return `**${label}**：${excerpts.length ? excerpts.join("；另有观点：") + "。以上为材料观点摘录，不代表已核验的全行业结论。" : missing}`;
    }
    const withProgress = members.filter(project => models.get(project.id).progress.length).length;
    const missingFinance = members.filter(project => !models.get(project.id).financing.length).length;
    const lines = [
      `## 行业现状与判断`, "",
      `**资料范围**：本库收录 ${members.length} 家项目${distribution ? `，方向分布为 ${cell(distribution)}` : ""}。${dates.length ? `项目记录更新日期截至 ${dates.at(-1)}；各项目日期见下表。` : "尚无明确项目资料日期。"}此覆盖范围不代表全市场份额或排名。`, "",
      industryTopic("行业阶段与竞争", /行业现状|竞争格局|市场与行业|行业判断|市场格局|行业阶段|行业概况/, "尚无可引用的专项行业判断，行业阶段与竞争格局待研究核验。"), "",
      industryTopic("近期变化与驱动", /行业变化|近期变化|行业趋势|关键驱动|市场趋势|发展趋势/, "尚无明确行业变化摘要，不能把资料更新时间当作行业变化。"), "",
      industryTopic("机会、风险与待验证", /行业机会|行业风险|行业展望|行业投资|赛道机会|赛道风险|市场机会|行业关注/, "尚无专项行业机会与风险判断；可先参照下表各项目的已有内部判断，再补跨项目验证。"), "",
      `**资料缺口**：${members.length ? `${withProgress} 家已有可提取的业务进展，${missingFinance} 家融资／估值资料待补。` : "尚无归档项目，不能据此判断行业没有机会；后续项目入库后将自动显示。"}`, "",
      "## 项目对比", "", "| 公司／方向 | 关键进展 | 融资／估值 | 投资判断 | 跟进／资料日期 |", "| --- | --- | --- | --- | --- |"
    ];
    for (const project of members) {
      const model = models.get(project.id);
      const name = model.validHome ? `[${cell(project.name)}](${relativeLink(filePath, project.documentPath)})` : `${cell(project.name)}（主页待关联）`;
      lines.push(`| ${name}<br>${evidenceCell(model.direction, "定位待补")} | ${evidenceCell(model.progress, "关键业务进展待补")} | ${evidenceCell(model.financing, "融资与估值待补")} | ${cell(project.rating ? `评级 ${project.rating}` : "未评级")}<br>${evidenceCell(model.judgment, "投资判断待补")} | ${cell(project.status || "状态待补")}<br>${date(project.lastUpdatedAt) ? `记录更新：${date(project.lastUpdatedAt)}` : "资料日期待补"} |`);
    }
    if (!members.length) lines.push("| 暂无归档项目 | — | — | — | — |");
    lines.push("", "> 表内仅摘录现有资料，不自动生成新评级；未明确注明已核验的业务陈述沿用原材料口径。资料更新日期不等于业务发生日期。完整依据见项目主页。", "");
    updatePage(root, filePath, title, lines.join("\n"), result);
  }
  for (const { name, subdomains = [] } of domains) {
    const members = all.filter(project => project.domain === name || project.domains.includes(name));
    addEntry(name, "", members);
    for (const subdomain of [...new Set(subdomains)]) addEntry(name, subdomain, members.filter(project => project.subdomains.includes(subdomain)));
  }
  const names = new Set(domains.map(item => item.name));
  const unclassified = all.filter(project => !names.has(project.domain));
  result.unclassifiedProjectCount = unclassified.length;
  if (unclassified.length) addEntry("_未分类", "", unclassified);
  for (const project of all) {
    const allowed = new Set(domains.find(item => item.name === project.domain)?.subdomains || []);
    const unknown = project.subdomains.filter(tag => !allowed.has(tag));
    if (unknown.length) result.warnings.push({ code: "classification_pending", projectId: project.id, name: project.name, subdomains: unknown, message: "子行业不在当前词表，项目保留在一级行业页，未自动新增分类。" });
  }
  const index = ["本页按资料库现有行业分类汇总；点击行业阅读整体情况与项目对比，点击公司进入唯一项目主页。", "", `已覆盖 ${domains.length} 个一级行业、${result.entries.filter(entry => entry.subdomain).length} 个子行业；本库 ${all.length} 家项目，${result.linkedProjectCount} 家已有可用主页。`, "", "| 行业 | 项目数 | 子行业 |", "| --- | --- | --- |"];
  for (const entry of result.entries.filter(item => !item.subdomain)) {
    const children = result.entries.filter(item => item.domain === entry.domain && item.subdomain).map(item => `[${cell(item.subdomain)} (${item.projectCount})](${relativeLink(result.indexPath, item.path)})`).join(" · ");
    index.push(`| [${cell(entry.domain)}](${relativeLink(result.indexPath, entry.path)}) | ${entry.projectCount} | ${children || "—"} |`);
  }
  updatePage(root, result.indexPath, "行业速览", index.join("\n"), result);
  result.ok = result.conflicts.length === 0;
  return result;
}
function refreshRepositoryIndustryOverviews(repository, canonicalTaxonomy) {
  // The client and plugin may finish independent writes concurrently. Serialize derived file updates
  // beside the local database, not in the cloud-synced library, and recover only a dead local owner.
  const lockPath = path.join(path.dirname(repository.databasePath), `.domi-industry-${hash(path.resolve(repository.libraryDir)).slice(0, 16)}.lock`);
  const token = JSON.stringify({ pid: process.pid, token: crypto.randomUUID() });
  function acquire() {
    try { fs.writeFileSync(lockPath, token, { encoding: "utf8", flag: "wx", mode: 0o600 }); return true; }
    catch (error) { if (error.code !== "EEXIST") throw error; return false; }
  }
  let locked = acquire();
  if (!locked) {
    try {
      const stale = fs.readFileSync(lockPath, "utf8");
      const owner = JSON.parse(stale);
      if (Number.isInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); }
        catch (error) {
          if (error.code === "ESRCH" && fs.readFileSync(lockPath, "utf8") === stale) { fs.unlinkSync(lockPath); locked = acquire(); }
        }
      }
    } catch {}
  }
  if (!locked) return { ok: false, entries: [], indexPath: path.join(repository.libraryDir, "1.行业研究", PAGE), conflicts: [], warnings: [{ code: "overview_refresh_busy", message: "另一个流程正在更新行业速览；本次资料写入已保存，可稍后刷新。" }], created: 0, updated: 0, unchanged: 0 };
  try { return refreshRepositoryUnlocked(repository, canonicalTaxonomy); }
  finally { try { if (fs.readFileSync(lockPath, "utf8") === token) fs.unlinkSync(lockPath); } catch {} }
}
function refreshRepositoryUnlocked(repository, canonicalTaxonomy) {
  const database = repository.database;
  const taxonomy = Object.fromEntries(Object.entries(canonicalTaxonomy).map(([name, values]) => [name, [...values]]));
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_taxonomy'").get()) {
    for (const row of database.prepare("SELECT parent_domain, name FROM custom_taxonomy ORDER BY parent_domain, name").all()) {
      if (taxonomy[row.parent_domain] && !taxonomy[row.parent_domain].includes(row.name)) taxonomy[row.parent_domain].push(row.name);
    }
  }
  return refreshIndustryOverviews({ libraryDir: repository.libraryDir, taxonomy,
    projects: database.prepare("SELECT * FROM projects ORDER BY name, id").all(),
    documents: database.prepare("SELECT * FROM documents WHERE owner_type IN ('project','industry') ORDER BY updated_at DESC, id").all() });
}
function projectMaterialLinks(repository, projectId, homepagePath, previousHomepagePath = "") {
  const root = path.resolve(repository.libraryDir);
  return repository.database.prepare("SELECT title,kind,path FROM documents WHERE owner_type='project' AND owner_id=? ORDER BY updated_at DESC,id LIMIT 100").all(projectId)
    .map(doc => {
      if (previousHomepagePath && previousHomepagePath !== homepagePath && inside(path.dirname(previousHomepagePath), doc.path)) {
        return { ...doc, path: path.join(path.dirname(homepagePath), path.relative(path.dirname(previousHomepagePath), doc.path)) };
      }
      return doc;
    })
    .filter(doc => {
      const label = `${doc.kind} ${doc.title} ${path.basename(doc.path)}`;
      if (/文字稿|逐字稿|原始转写|转写稿|精修稿|transcript|录音/i.test(label) || !/研究|纪要|快评|访谈|BP|Datapack|IC|投委|deck|商业计划|附件|数据包|分析/i.test(label)) return false;
      try { return doc.path !== homepagePath && inside(root, path.resolve(doc.path)) && inside(fs.realpathSync(root), fs.realpathSync(doc.path)) && fs.statSync(doc.path).isFile(); } catch { return false; }
    }).slice(0, 30).map(doc => `- [${cell(doc.title || path.basename(doc.path))}](${relativeLink(homepagePath, doc.path)})`).join("\n");
}
const MATERIALS_START = "<!-- domi:project-materials:v1";
const MATERIALS_END = "<!-- domi:project-materials:end -->";
const MATERIALS_BLOCK = /<!-- domi:project-materials:v1 sha256=([a-f0-9]{64}) -->\n([\s\S]*?)<!-- domi:project-materials:end -->/;
function refreshProjectMaterials(repository, projectId, homepagePath) {
  safeTarget(path.resolve(repository.libraryDir), path.resolve(homepagePath));
  const previous = fs.readFileSync(homepagePath, "utf8");
  const owner = previous.match(/^project_id:\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
  if (owner !== projectId) return { ok: false, updated: false, warnings: [{ code: "material_homepage_mismatch", message: "项目主页标识不匹配，未更新材料链接。" }] };
  const links = projectMaterialLinks(repository, projectId, homepagePath);
  const match = previous.match(MATERIALS_BLOCK);
  if (!links && !match && !previous.includes(MATERIALS_START)) return { ok: true, updated: false, conflicts: [], warnings: [] };
  const content = `## 项目材料\n\n${links || "暂无已索引的常用材料。"}\n`;
  const block = `${MATERIALS_START} sha256=${hash(content)} -->\n${content}${MATERIALS_END}`;
  const managedStart = previous.indexOf("<!-- domi:managed:start -->");
  const managedEnd = previous.indexOf("<!-- domi:managed:end -->");
  const materialsOffset = previous.indexOf(MATERIALS_START);
  const nested = materialsOffset >= 0 && managedStart >= 0 && materialsOffset > managedStart && materialsOffset < managedEnd;
  const invalid = nested || (match && hash(match[2]) !== match[1]) || (previous.includes(MATERIALS_START) && !match) || (previous.match(/<!-- domi:project-materials:v1/g) || []).length > 1;
  if (invalid) {
    const candidatePath = path.join(path.dirname(homepagePath), `.项目材料候选-${hash(content).slice(0, 12)}.md`);
    safeTarget(path.resolve(repository.libraryDir), candidatePath);
    if (!fs.existsSync(candidatePath)) writeExclusiveVerified(candidatePath, `${block}\n`);
    return { ok: false, updated: false, candidatePath, conflicts: [{ path: homepagePath, candidatePath }], warnings: [{ code: "material_links_conflict", path: homepagePath, candidatePath, message: "材料链接区已被人工修改或嵌入旧维护区，已保留整份主页与更新候选。" }] };
  }
  // This block deliberately lives outside the legacy project managed block. Never regenerate the
  // project summary, user notes, metadata, or the old related-materials section for an attachment write.
  const next = match ? previous.replace(MATERIALS_BLOCK, () => block) : `${previous}${previous.endsWith("\n") ? "\n" : "\n\n"}${block}\n`;
  if (next === previous) return { ok: true, updated: false, conflicts: [], warnings: [] };
  if (fs.readFileSync(homepagePath, "utf8") !== previous) return { ok: false, updated: false, warnings: [{ code: "material_links_busy", message: "主页正在被编辑，本次保留正文，稍后可刷新材料链接。" }] };
  writeAtomic(homepagePath, next);
  return { ok: true, updated: true, conflicts: [], warnings: [] };
}

function fileSha256(filePath) {
  const digest = crypto.createHash("sha256"), buffer = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(filePath, "r");
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return digest.digest("hex");
}
function repairProjectHomepage(repository, request, { fallbackPath, render }) {
  const id = String(request.id || request.recordId || "").trim();
  if (!id) throw new Error("主页修复需要明确的 projectId。");
  const database = repository.database, root = path.resolve(repository.libraryDir);
  let writtenPath = "", writtenHash = "", previousContent = null;
  database.exec("BEGIN IMMEDIATE");
  try {
    const row = database.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row) throw new Error("未找到待修复项目。");
    if (request.expectedUpdatedAt !== undefined && Number(request.expectedUpdatedAt) !== Number(row.updated_at)) throw new Error("项目已变化，请重新读取后修复主页。");
    const original = String(row.document_path || "");
    const sourceExists = original && fs.existsSync(original);
    if (original && !sourceExists) throw new Error("原绑定文档已缺失；先核实材料位置，不自动创建另一主档。");
    if (sourceExists) {
      safeTarget(root, path.resolve(original));
      if (!fs.statSync(original).isFile()) throw new Error("原绑定文档不是普通文件。");
    }
    let target;
    if (original) {
      let directory = path.dirname(original);
      const relativeParts = path.relative(root, directory).split(path.sep);
      const kindIndex = relativeParts.findIndex(part => ["研究", "纪要", "原始材料", "导出"].includes(part));
      if (kindIndex >= 0) directory = path.join(root, ...relativeParts.slice(0, kindIndex));
      target = path.join(directory, "项目主页.md");
    } else target = fallbackPath(row);
    target = path.resolve(target);
    safeTarget(root, target);
    const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (existing) {
      const targetId = existing.match(/^project_id:\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
      if (targetId !== id) throw new Error("目标项目主页已存在但实体标识不匹配，已保留原文。请先人工核实。");
    }
    if (original === target && existing) { database.exec("COMMIT"); return { ok: true, repaired: false, projectId: id, documentPath: target, previousPath: original, preservedSource: null }; }
    const sourceHash = sourceExists ? fileSha256(original) : "";
    const sourceOwner = sourceExists ? database.prepare("SELECT owner_type, owner_id FROM documents WHERE path = ?").get(original) : null;
    if (sourceOwner && (sourceOwner.owner_type !== "project" || sourceOwner.owner_id !== id)) throw new Error("原文档已归属另一个实体，不能自动重新关联。");
    let content = existing || `${render(row, target).trim()}\n`;
    if (sourceExists) {
      const link = relativeLink(target, original);
      if (!content.includes(`](${link})`)) content += `\n## 保留的历史材料\n\n- [${cell(path.basename(original))}](${link})\n`;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!existing) {
      writeExclusiveVerified(target, content);
      previousContent = null;
    } else if (content !== existing) {
      if (fs.readFileSync(target, "utf8") !== existing) throw new Error("项目主页正在被修改，已停止修复。");
      previousContent = existing; writeAtomic(target, content);
    }
    if (!existing || content !== existing) { writtenPath = target; writtenHash = hash(content); }
    if (sourceExists && fileSha256(original) !== sourceHash) throw new Error("原文档在修复期间发生变化，已停止并保留材料。");
    const now = Math.max(Date.now(), Number(row.updated_at || 0) + 1);
    if (sourceExists && !sourceOwner) {
      const sourceName = path.basename(original);
      const kind = RAW_DOCUMENT.test(original) ? "原始文字稿" : /纪要|访谈/.test(original) ? "纪要" : /快评/.test(original) ? "投资快评" : "研究";
      database.prepare("INSERT INTO documents (id,owner_type,owner_id,kind,title,path,created_at,updated_at) VALUES (?, 'project', ?, ?, ?, ?, ?, ?)")
        .run(`doc_${hash(`project:${id}:${original}`).slice(0, 16)}`, id, kind, sourceName, original, now, now);
    }
    const hasRevision = database.prepare("PRAGMA table_info(projects)").all().some(column => column.name === "revision");
    const updated = database.prepare(`UPDATE projects SET document_path = ?, updated_at = ?${hasRevision ? ", revision = revision + 1" : ""} WHERE id = ? AND document_path = ? AND updated_at = ?`)
      .run(target, now, id, row.document_path, row.updated_at);
    if (Number(updated.changes) !== 1) throw new Error("项目已并发更新，未应用主页修复。");
    database.exec("COMMIT");
    return { ok: true, repaired: true, projectId: id, documentPath: target, previousPath: original, storageUpdatedAt: now,
      preservedSource: sourceExists ? { path: original, sha256: sourceHash, verified: true } : null };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    if (writtenPath) {
      try { if (fileSha256(writtenPath) === writtenHash) { if (previousContent === null) fs.unlinkSync(writtenPath); else writeAtomic(writtenPath, previousContent); } } catch {}
    }
    throw error;
  }
}

module.exports = { refreshIndustryOverviews, refreshRepositoryIndustryOverviews, repairProjectHomepage, projectMaterialLinks, refreshProjectMaterials, relativeLink };
