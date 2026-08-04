const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");
const { ensureDocumentLibraryStructure } = require("./document-library.cjs");
const CANONICAL_PROJECT_TAXONOMY = require("../shared/investment-taxonomy.json");

const LOCAL_REPOSITORY_SCHEMA = 5;
const PROJECTS_DIRECTORY = "3.项目库";
const PEOPLE_DIRECTORY = "4.人脉库";
const NEWS_DIRECTORY = "2.行业动态";
const PROJECT_PAGE_NAME = "项目主页.md";
const PERSON_PAGE_NAME = "人物主页.md";
const PROJECT_STRUCTURE_DIRECTORIES = new Set(["原始材料", "研究", "纪要", "导出"]);
const PREVIEW_DOCUMENT_EXTENSIONS = new Set([".md", ".markdown", ".pdf"]);
const PERSON_INTERACTION_NAME_PATTERN = /(?:交流|纪要|会议|访谈|沟通|会面|电话|路演|聊天)/i;
const PERSON_PROFILE_NAME_PATTERN = /(?:人物主页|人物资料|人物画像|公开资料|背景研究|背景调查|背调)/i;
const PERSON_RESEARCH_NAME_PATTERN = /(?:研究|调研|人物画像|背景|背调|资料|分析|profile)/i;
const MANAGED_BLOCK_PATTERN = /<!-- domi:managed:start -->[\s\S]*?<!-- domi:managed:end -->/;
const PROJECT_STATUSES = new Set(["待交流", "已交流", "深度跟踪", "已投", "Miss", "放弃"]);
const PROJECT_RATINGS = new Set(["", "S", "A", "B", "C"]);
const TRACKED_INVESTORS = new Set([
  "红杉",
  "高瓴",
  "IDG",
  "锦秋",
  "Monolith/励思资本",
  "五源",
  "蓝驰",
  "经纬"
]);
const LEGACY_BULK_IMPORT_MIN = 20;
const LEGACY_BULK_INTAKE_MIGRATION_KEY = "legacy_bulk_intake_v1";
const CLASSIFICATION_REVIEW_STATUSES = new Set(["pending", "deferred", "confirmed"]);
const CANONICAL_PROJECT_DOMAINS = new Set(Object.keys(CANONICAL_PROJECT_TAXONOMY));
const CLASSIFICATION_KEYWORD_RULES = [
  { domain: "AI", subdomain: "AI视频", keywords: ["视频生成", "视频模型", "数字人", "文生视频"] },
  { domain: "AI", subdomain: "AI社交", keywords: ["ai社交", "社交产品", "社交网络", "陌生人社交"] },
  { domain: "AI", subdomain: "Agent", keywords: ["agent", "智能体", "自主执行", "工作流自动化"] },
  { domain: "AI", subdomain: "AI基础设施", keywords: ["ai基础设施", "推理平台", "训练平台", "算力集群"] },
  { domain: "AI", subdomain: "AI制药", keywords: ["ai制药", "药物发现", "蛋白质", "分子生成"] },
  { domain: "AI", subdomain: "AI数据", keywords: ["数据标注", "合成数据", "训练数据", "数据闭环"] },
  { domain: "半导体", subdomain: "EDA&IP", keywords: ["eda", "芯片设计自动化", "ip授权", "芯片ip"] },
  { domain: "半导体", subdomain: "算力芯片", keywords: ["算力芯片", "gpu", "npu", "ai芯片", "加速卡"] },
  { domain: "半导体", subdomain: "通信芯片", keywords: ["通信芯片", "基带", "射频芯片", "光通信芯片"] },
  { domain: "半导体", subdomain: "光电芯片", keywords: ["光电芯片", "硅光", "光模块", "光子芯片"] },
  { domain: "半导体", subdomain: "模拟芯片", keywords: ["模拟芯片", "电源管理", "adc", "dac"] },
  { domain: "半导体", subdomain: "半导体设备", keywords: ["半导体设备", "刻蚀机", "薄膜沉积", "清洗设备"] },
  { domain: "半导体", subdomain: "半导体材料", keywords: ["半导体材料", "光刻胶", "抛光液", "电子特气"] },
  { domain: "智能出行", subdomain: "自动驾驶", keywords: ["自动驾驶", "辅助驾驶", "智驾", "adas"] },
  { domain: "具身智能&机器人", subdomain: "工业机器人", keywords: ["工业机器人", "机械臂", "机器人本体"] },
  { domain: "前沿科技", subdomain: "卫星互联网", keywords: ["卫星互联网", "卫星通信", "星座"] },
  { domain: "前沿科技", subdomain: "商业航天", keywords: ["商业航天", "火箭", "卫星制造"] },
  { domain: "消费科技", subdomain: "可穿戴", keywords: ["可穿戴", "智能眼镜", "智能手表"] }
];

function resolveHomePath(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
}

function parseList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  }
  if (value === null || value === undefined || value === "") return [];
  return [...new Set(
    String(value)
      .split(/[，,、]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•._\-—–（）()【】[\]{}，,。.!！?？/&／]+/g, "");
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function toEpochMs(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listDirectories(directoryPath) {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  } catch {
    return [];
  }
}

function fileCreatedAt(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    return Math.round(
      Number(stat.birthtimeMs) > 0
        ? stat.birthtimeMs
        : Number(stat.ctimeMs) > 0
          ? stat.ctimeMs
          : stat.mtimeMs
    );
  } catch {
    return Date.now();
  }
}

function parseFrontmatterValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    if (raw === "null") return null;
    if (raw === "true") return true;
    if (raw === "false") return false;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw.replace(/^['"]|['"]$/g, "");
  }
}

function readManagedFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/(?:^|\r?\n)---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return {};
    const result = {};
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
      result[key] = parseFrontmatterValue(line.slice(separator + 1));
    }
    return result;
  } catch {
    return {};
  }
}

function firstMarkdownFile(directoryPath) {
  try {
    const entry = fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((item) =>
        item.isFile()
        && !item.name.startsWith(".")
        && /\.(?:md|markdown)$/i.test(item.name)
      )
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))[0];
    return entry ? path.join(directoryPath, entry.name) : "";
  } catch {
    return "";
  }
}

function scanPersonDocuments(personPath) {
  const root = path.resolve(String(personPath || ""));
  if (!root || !fs.existsSync(root)) return [];
  const candidates = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length && candidates.length < 80) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const targetPath = path.join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < 2) {
        pending.push({ directory: targetPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !PREVIEW_DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      const relativePath = path.relative(root, targetPath);
      if (entry.name === PERSON_PAGE_NAME) continue;
      const parentSegments = relativePath.split(path.sep).slice(0, -1);
      const inMinutesDirectory = parentSegments.includes("纪要");
      const inResearchDirectory = parentSegments.includes("研究");
      const kind = inMinutesDirectory || PERSON_INTERACTION_NAME_PATTERN.test(entry.name)
        ? "交流纪要"
        : inResearchDirectory
          || PERSON_PROFILE_NAME_PATTERN.test(entry.name)
          || PERSON_RESEARCH_NAME_PATTERN.test(entry.name)
          ? "人物研究"
          : "相关资料";
      let updatedAt = 0;
      try {
        updatedAt = Math.round(fs.statSync(targetPath).mtimeMs);
      } catch {
        // Keep cloud placeholders visible even when stat is temporarily unavailable.
      }
      candidates.push({
        title: path.basename(entry.name, path.extname(entry.name)),
        relativePath,
        kind,
        updatedAt
      });
      if (candidates.length >= 80) break;
    }
  }
  return candidates
    .sort((left, right) => right.updatedAt - left.updatedAt
      || left.relativePath.localeCompare(right.relativePath, "zh-CN"))
    .slice(0, 50);
}

function looksLikeProjectDirectory(name, hasCanonicalPage) {
  const value = String(name || "").trim();
  if (!value) return false;
  if (PROJECT_STRUCTURE_DIRECTORIES.has(value)) return false;
  if (hasCanonicalPage) return true;
  return !/(?:行业|产业|赛道|专题|市场)研究/.test(value);
}

function previewDocumentScore(filePath, canonicalPath) {
  const normalizedPath = String(filePath || "").normalize("NFKC").toLocaleLowerCase("zh-CN");
  const fileName = path.basename(normalizedPath);
  let score = 100;
  if (/(?:投委会|ic[\s_-]*memo|investment[\s_-]*memo)/i.test(normalizedPath)) score += 1_000;
  else if (/(?:深度研究|研究报告|桌面研究|投资分析)/.test(normalizedPath)) score += 900;
  else if (/(?:交流纪要|会议纪要|访谈纪要|纪要)/.test(normalizedPath)) score += 800;
  else if (/(?:商业计划|pitch[\s_-]*deck|(^|[/_-])bp(?:[._/-]|$))/i.test(normalizedPath)) score += 700;
  else if (path.resolve(filePath) === path.resolve(canonicalPath || "")) score += 500;
  else if (/\.(?:md|markdown)$/i.test(fileName)) score += 300;
  else if (/\.pdf$/i.test(fileName)) score += 250;
  try {
    const stat = fs.statSync(filePath);
    score += Math.min(Math.log2(Math.max(stat.size, 1)) * 4, 80);
    score += Math.min(Math.max(stat.mtimeMs, 0) / 1e12, 4);
  } catch {
    // Cloud placeholders can still be selected by their file name.
  }
  return score;
}

function bestPreviewDocument(directoryPath, canonicalPath = "") {
  const root = path.resolve(String(directoryPath || ""));
  if (!root || !fs.existsSync(root)) {
    return canonicalPath && fs.existsSync(canonicalPath) ? canonicalPath : "";
  }
  const candidates = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length && candidates.length < 400) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const targetPath = path.join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < 4) {
        pending.push({ directory: targetPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !PREVIEW_DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      candidates.push(targetPath);
      if (candidates.length >= 400) break;
    }
  }
  if (!candidates.length) {
    return canonicalPath && fs.existsSync(canonicalPath) ? canonicalPath : "";
  }
  return candidates.sort((left, right) =>
    previewDocumentScore(right, canonicalPath) - previewDocumentScore(left, canonicalPath)
      || left.localeCompare(right, "zh-CN")
  )[0];
}

function scanWorkspaceEntities(libraryDir) {
  const projects = [];
  const people = [];
  const projectRoot = path.join(libraryDir, PROJECTS_DIRECTORY);
  const peopleRoot = path.join(libraryDir, PEOPLE_DIRECTORY);
  const indexedProjectPaths = new Set();

  function addProject(projectPath, domainName, subdomainName, fallbackName) {
    const resolvedProjectPath = path.resolve(projectPath);
    if (indexedProjectPaths.has(resolvedProjectPath)) return;
    const canonicalPath = path.join(resolvedProjectPath, PROJECT_PAGE_NAME);
    const hasCanonicalPage = fs.existsSync(canonicalPath);
    const metadata = readManagedFrontmatter(canonicalPath);
    if (metadata.entity_type && metadata.entity_type !== "project") return;
    const name = String(metadata.company_name || fallbackName || "").trim();
    if (!looksLikeProjectDirectory(name, hasCanonicalPage)) return;
    const normalized = normalizedName(name);
    if (!normalized) return;
    const metadataSubdomains = stringList(metadata.subdomains);
    const documentPath = hasCanonicalPage
      ? canonicalPath
      : firstMarkdownFile(resolvedProjectPath);
    indexedProjectPaths.add(resolvedProjectPath);
    projects.push({
      id: String(metadata.project_id || stableId("prj", normalized)),
      name,
      normalizedName: normalized,
      domain: String(metadata.domain || domainName || "").trim(),
      subdomains: metadataSubdomains.length
        ? metadataSubdomains
        : subdomainName
          ? [subdomainName]
          : [],
      status: String(metadata.status || "待交流").trim(),
      rating: String(metadata.rating || "").trim(),
      lastUpdatedAt: toEpochMs(metadata.last_updated_at, null),
      documentPath,
      createdAt: fileCreatedAt(resolvedProjectPath)
    });
  }

  for (const domainEntry of listDirectories(projectRoot)) {
    const domainPath = path.join(projectRoot, domainEntry.name);
    for (const subdomainEntry of listDirectories(domainPath)) {
      const subdomainPath = path.join(domainPath, subdomainEntry.name);
      const directProject = fs.existsSync(path.join(subdomainPath, PROJECT_PAGE_NAME))
        || (domainEntry.name === "_未分类" && subdomainEntry.name !== "_未分类")
        || (Boolean(firstMarkdownFile(subdomainPath)) && listDirectories(subdomainPath).length === 0);
      if (directProject) {
        addProject(subdomainPath, domainEntry.name, "", subdomainEntry.name);
        continue;
      }
      for (const projectEntry of listDirectories(subdomainPath)) {
        addProject(
          path.join(subdomainPath, projectEntry.name),
          domainEntry.name,
          subdomainEntry.name,
          projectEntry.name
        );
      }
    }
  }

  for (const personEntry of listDirectories(peopleRoot)) {
    const personPath = path.join(peopleRoot, personEntry.name);
    const canonicalPath = path.join(personPath, PERSON_PAGE_NAME);
    const metadata = readManagedFrontmatter(canonicalPath);
    if (metadata.entity_type && metadata.entity_type !== "person") continue;
    const name = String(metadata.name || personEntry.name || "").trim();
    const normalized = normalizedName(name);
    if (!normalized) continue;
    people.push({
      id: String(metadata.person_id || stableId("per", normalized)),
      name,
      normalizedName: normalized,
      types: stringList(metadata.types),
      organization: String(metadata.organization || "").trim(),
      status: String(metadata.status || "").trim(),
      rating: String(metadata.rating || "").trim(),
      documentPath: fs.existsSync(canonicalPath)
        ? canonicalPath
        : firstMarkdownFile(personPath),
      interactionDocuments: scanPersonDocuments(personPath),
      createdAt: fileCreatedAt(personPath)
    });
  }

  return { projects, people };
}

function workspaceEntitiesSignature(discovered) {
  const projects = [...(discovered?.projects || [])]
    .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName, "zh-CN"))
    .map((project) => [
      project.id,
      project.name,
      project.normalizedName,
      project.domain,
      ...(project.subdomains || []),
      project.status,
      project.rating,
      project.documentPath
    ]);
  const people = [...(discovered?.people || [])]
    .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName, "zh-CN"))
    .map((person) => [
      person.id,
      person.name,
      person.normalizedName,
      ...(person.types || []),
      person.organization,
      person.status,
      person.rating,
      person.documentPath,
      ...(person.interactionDocuments || []).flatMap((document) => [
        document.relativePath,
        document.updatedAt
      ])
    ]);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ projects, people }))
    .digest("hex");
}

function localDocumentUrl(value) {
  const documentPath = String(value || "").trim();
  return documentPath && path.isAbsolute(documentPath) ? pathToFileURL(documentPath).href : "";
}

function safePathSegment(value, fallback = "_未分类") {
  const normalized = String(value || "").trim()
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "／")
    .replace(/^\.+$/, "")
    .slice(0, 160);
  return normalized || fallback;
}

function normalizedTaxonomyLabel(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/[\/\\]/g, "／")
    .replace(/[\u0000-\u001f:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

function canonicalSubdomainParent(value) {
  const normalized = normalizedName(value);
  for (const [domain, subdomains] of Object.entries(CANONICAL_PROJECT_TAXONOMY)) {
    if (subdomains.some((subdomain) => normalizedName(subdomain) === normalized)) return domain;
  }
  return "";
}

function classificationMaterialRole(relativePath, previewText = "") {
  const value = `${relativePath} ${previewText.slice(0, 2_000)}`.normalize("NFKC");
  if (/(?:对标|竞品|可比公司|类似公司|同类公司|benchmark|comparable)/i.test(value)) {
    return "comparable";
  }
  if (/(?:行业研究|产业研究|赛道研究|市场研究|行业资料|产业链|market\s+research)/i.test(value)) {
    return "industry";
  }
  return "project";
}

function markdownPreview(filePath, maxBytes = 48 * 1024) {
  if (!/\.(?:md|markdown|txt)$/i.test(filePath)) return "";
  try {
    const descriptor = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const bytes = fs.readSync(descriptor, buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytes).toString("utf8");
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return "";
  }
}

function classificationEvidenceSnippet(content) {
  return String(content || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^---[\s\S]*?---/m, " ")
    .replace(/[#>*_`|\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function scanProjectClassificationEvidence(directoryPath, canonicalPath = "") {
  const root = path.resolve(String(directoryPath || ""));
  if (!root || !fs.existsSync(root)) return [];
  const items = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length && items.length < 160) {
    const current = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const targetPath = path.join(current.directory, entry.name);
      if (entry.isDirectory() && current.depth < 4) {
        pending.push({ directory: targetPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !PREVIEW_DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      const relativePath = path.relative(root, targetPath);
      const preview = markdownPreview(targetPath);
      let updatedAt = 0;
      try { updatedAt = Math.round(fs.statSync(targetPath).mtimeMs); } catch {}
      items.push({
        title: path.basename(entry.name, path.extname(entry.name)),
        resource: localDocumentUrl(targetPath),
        relativePath,
        role: classificationMaterialRole(relativePath, preview),
        snippet: classificationEvidenceSnippet(preview),
        updatedAt,
        canonical: canonicalPath ? path.resolve(targetPath) === path.resolve(canonicalPath) : false,
        classifierText: preview.slice(0, 16_000)
      });
      if (items.length >= 160) break;
    }
  }
  return items
    .sort((left, right) => {
      const roleRank = { project: 3, comparable: 2, industry: 1 };
      return (roleRank[right.role] || 0) - (roleRank[left.role] || 0)
        || Number(right.canonical) - Number(left.canonical)
        || right.updatedAt - left.updatedAt
        || left.relativePath.localeCompare(right.relativePath, "zh-CN");
    })
    .slice(0, 24);
}

function suggestProjectClassification(project, evidence) {
  const projectEvidence = evidence.filter((item) => item.role === "project");
  const source = [
    project.name,
    project.notes,
    ...projectEvidence.flatMap((item) => [item.title, item.relativePath, item.classifierText])
  ].join("\n").normalize("NFKC").toLocaleLowerCase("zh-CN");
  const restrictedDomain = CANONICAL_PROJECT_DOMAINS.has(project.domain) ? project.domain : "";
  const ranked = CLASSIFICATION_KEYWORD_RULES
    .filter((rule) => !restrictedDomain || rule.domain === restrictedDomain)
    .map((rule) => {
      const matches = rule.keywords.filter((keyword) =>
        source.includes(keyword.normalize("NFKC").toLocaleLowerCase("zh-CN"))
      );
      return { ...rule, matches, score: matches.length };
    })
    .filter((rule) => rule.score > 0)
    .sort((left, right) => right.score - left.score
      || left.domain.localeCompare(right.domain, "zh-CN")
      || left.subdomain.localeCompare(right.subdomain, "zh-CN"));
  const best = ranked[0];
  if (!best) {
    return {
      domain: restrictedDomain,
      subdomains: [],
      confidence: 0,
      reason: projectEvidence.length
        ? "项目自身材料中没有命中现有正式子领域，请人工选择或新建正式子领域。"
        : "尚未找到可用于判断的项目自身材料，请补充材料后再分类。"
    };
  }
  const runnerUp = ranked[1]?.score || 0;
  const confidence = Math.min(0.96, 0.55 + best.score * 0.12 + (best.score - runnerUp) * 0.08);
  return {
    domain: best.domain,
    subdomains: [best.subdomain],
    confidence: Math.round(confidence * 100) / 100,
    reason: `项目自身材料命中：${best.matches.slice(0, 4).join("、")}。可比公司与行业材料仅作参考，不会当作项目事实。`
  };
}

function assertWithin(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("资料库路径超出允许范围。");
  }
}

function replaceManagedBlock(existingContent, managedBlock) {
  const existing = String(existingContent || "");
  if (MANAGED_BLOCK_PATTERN.test(existing)) {
    return existing.replace(MANAGED_BLOCK_PATTERN, managedBlock);
  }
  return existing.trim()
    ? `${managedBlock}\n\n${existing.trimStart()}`
    : `${managedBlock}\n`;
}

function atomicWriteText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function renderProjectManagedBlock(project) {
  const latestValuation = project.latestValuationUsd100m === null
    ? "未填写"
    : `${project.latestValuationUsd100m} 亿美元`;
  const financingHistory = project.financingHistory || "未填写";
  const updatedAt = project.lastUpdatedAt
    ? new Date(project.lastUpdatedAt).toISOString()
    : "";
  return `<!-- domi:managed:start -->
---
domi_schema: ${LOCAL_REPOSITORY_SCHEMA}
entity_type: "project"
project_id: ${JSON.stringify(project.recordId)}
company_name: ${JSON.stringify(project.name)}
domain: ${JSON.stringify(project.domain)}
subdomains: ${JSON.stringify(project.subdomains)}
status: ${JSON.stringify(project.status)}
rating: ${JSON.stringify(project.rating)}
cities: ${JSON.stringify(project.cities)}
investors: ${JSON.stringify(project.investors)}
latest_valuation_usd_100m: ${project.latestValuationUsd100m === null ? "null" : project.latestValuationUsd100m}
last_updated_at: ${JSON.stringify(updatedAt)}
---

# ${project.name}

## 项目状态

- 领域：${project.domain || "未分类"}
- 子领域：${project.subdomains.join("、") || "未分类"}
- 进展：${project.status || "待交流"}
- 评级：${project.rating || "未评级"}
- 城市：${project.cities.join("、") || "未填写"}
- 投资机构：${project.investors.join("、") || "未填写"}
- 最新估值：${latestValuation}

## 历史融资

${financingHistory}

## 结构化摘要

${project.notes || "未填写"}
<!-- domi:managed:end -->`;
}

function renderPersonManagedBlock(person) {
  return `<!-- domi:managed:start -->
---
domi_schema: ${LOCAL_REPOSITORY_SCHEMA}
entity_type: "person"
person_id: ${JSON.stringify(person.recordId)}
name: ${JSON.stringify(person.name)}
organization: ${JSON.stringify(person.organization)}
types: ${JSON.stringify(person.types)}
status: ${JSON.stringify(person.status)}
rating: ${JSON.stringify(person.rating)}
cities: ${JSON.stringify(person.cities)}
last_contact_at: ${JSON.stringify(person.lastContact ? new Date(person.lastContact).toISOString() : "")}
---

# ${person.name}

- 组织与身份：${person.organization || "未填写"}
- 类型：${person.types.join("、") || "未填写"}
- 进展：${person.status || "未填写"}
- 评级：${person.rating || "未评级"}
- 城市：${person.cities.join("、") || "未填写"}
- 最后联系：${person.lastContact ? new Date(person.lastContact).toISOString().slice(0, 10) : "未填写"}
<!-- domi:managed:end -->`;
}

function renderNewsManagedBlock(item) {
  return `<!-- domi:managed:start -->
---
domi_schema: ${LOCAL_REPOSITORY_SCHEMA}
entity_type: "news_event"
event_id: ${JSON.stringify(item.recordId)}
title: ${JSON.stringify(item.title)}
domains: ${JSON.stringify(item.domains)}
subdomains: ${JSON.stringify(item.subdomains)}
types: ${JSON.stringify(item.types)}
published_at: ${JSON.stringify(new Date(item.publishedAt).toISOString())}
importance: ${item.importance}
confidence: ${item.confidence}
source_url: ${JSON.stringify(item.url)}
source: ${JSON.stringify(item.source)}
companies: ${JSON.stringify(item.companies)}
institutions: ${JSON.stringify(item.institutions)}
evidence_status: ${JSON.stringify(item.evidenceStatus)}
worth_following: ${item.worthFollowing ? "true" : "false"}
---

# ${item.title}

## 核心事实

${item.summary || "未填写"}

## 投资含义

${item.investmentMeaning || "未填写"}

## 建议动作

${item.action || "未填写"}
<!-- domi:managed:end -->`;
}

function normalizedProjectStatus(value) {
  const status = String(value || "").trim();
  const normalized = status === "找投资窗口" ? "深度跟踪" : status || "待交流";
  if (!PROJECT_STATUSES.has(normalized)) {
    throw new Error("项目进展状态不在允许范围内。");
  }
  return normalized;
}

function normalizedRating(value) {
  const rating = String(value || "").trim().toUpperCase();
  if (!PROJECT_RATINGS.has(rating)) throw new Error("评级只允许 S、A、B、C 或留空。");
  return rating;
}

function projectRow(row) {
  return {
    recordId: row.id,
    name: row.name,
    domain: row.domain,
    subdomains: parseList(row.subdomains_json),
    status: row.status,
    rating: row.rating,
    notes: row.notes,
    cities: parseList(row.cities_json),
    investors: parseList(row.investors_json),
    financingHistory: row.financing_history || "",
    latestValuationUsd100m: row.latest_valuation_usd_100m === null
      ? null
      : Number(row.latest_valuation_usd_100m),
    createdAt: row.created_at || null,
    lastFollowup: row.last_updated_at || null,
    updatedAt: row.updated_at || 0,
    link: localDocumentUrl(row.document_path)
  };
}

function personRow(row, persistedDocuments = []) {
  const personDirectory = row.document_path ? path.dirname(row.document_path) : "";
  const indexedDocuments = parseJsonArray(row.interaction_documents_json)
    .map((document) => {
      const relativePath = String(document?.relativePath || "").trim();
      if (!relativePath || !personDirectory) return null;
      const targetPath = path.resolve(personDirectory, relativePath);
      if (targetPath !== personDirectory && !targetPath.startsWith(`${personDirectory}${path.sep}`)) {
        return null;
      }
      return {
        title: String(document?.title || path.basename(relativePath, path.extname(relativePath))),
        link: localDocumentUrl(targetPath),
        kind: String(document?.kind || "相关资料"),
        updatedAt: Number(document?.updatedAt) || 0
      };
    })
    .filter(Boolean);
  const documents = [
    ...persistedDocuments.map((document) => {
      const targetPath = personDirectory && document?.path ? path.resolve(document.path) : "";
      if (
        !targetPath
        || (targetPath !== personDirectory && !targetPath.startsWith(`${personDirectory}${path.sep}`))
      ) return null;
      return {
        title: String(document?.title || path.basename(targetPath, path.extname(targetPath))),
        link: localDocumentUrl(targetPath),
        kind: String(document?.kind || "相关资料"),
        updatedAt: Number(document?.updated_at) || 0
      };
    }).filter(Boolean),
    ...indexedDocuments
  ]
    .filter((document) => document.link)
    .filter((document, index, all) =>
      all.findIndex((candidate) => candidate.link === document.link) === index
    )
    .sort((left, right) => right.updatedAt - left.updatedAt
      || left.link.localeCompare(right.link, "zh-CN"))
    .slice(0, 50);
  const interactionDocuments = documents.filter((document) =>
    PERSON_INTERACTION_NAME_PATTERN.test(`${document.kind} ${document.title}`)
  );
  return {
    recordId: row.id,
    name: row.name,
    types: parseList(row.types_json),
    organization: row.organization,
    status: row.status,
    rating: row.rating,
    createdAt: row.created_at || null,
    lastContact: row.last_contact_at || null,
    cities: parseList(row.cities_json),
    updatedAt: row.updated_at || 0,
    link: localDocumentUrl(row.document_path),
    documents,
    interactionDocuments
  };
}

function newsRow(row) {
  return {
    recordId: row.event_id,
    title: row.title,
    domains: parseList(row.domains_json),
    subdomains: parseList(row.subdomains_json),
    types: parseList(row.types_json),
    publishedAt: row.published_at,
    summary: row.summary,
    investmentMeaning: row.investment_meaning,
    url: row.url,
    source: row.source,
    companies: row.companies,
    institutions: row.institutions,
    importance: Number(row.importance) || 0,
    confidence: Number(row.confidence) || 0,
    evidenceStatus: row.evidence_status,
    action: row.action,
    worthFollowing: Boolean(row.worth_following),
    updatedAt: row.updated_at || 0
  };
}

class LocalDomiRepository {
  constructor({ databasePath, libraryDir }) {
    this.databasePath = path.resolve(resolveHomePath(databasePath));
    this.libraryDir = path.resolve(resolveHomePath(libraryDir));
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    ensureDocumentLibraryStructure(this.libraryDir);
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS repository_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL DEFAULT '',
        subdomains_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT '待交流',
        rating TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        cities_json TEXT NOT NULL DEFAULT '[]',
        investors_json TEXT NOT NULL DEFAULT '[]',
        financing_history TEXT NOT NULL DEFAULT '',
        latest_valuation_usd_100m REAL,
        last_updated_at INTEGER,
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_updated
        ON projects(updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        types_json TEXT NOT NULL DEFAULT '[]',
        organization TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        rating TEXT NOT NULL DEFAULT '',
        last_contact_at INTEGER,
        cities_json TEXT NOT NULL DEFAULT '[]',
        interaction_documents_json TEXT NOT NULL DEFAULT '[]',
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_people_updated
        ON people(updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS news_events (
        event_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domains_json TEXT NOT NULL DEFAULT '[]',
        subdomains_json TEXT NOT NULL DEFAULT '[]',
        types_json TEXT NOT NULL DEFAULT '[]',
        published_at INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        investment_meaning TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        companies TEXT NOT NULL DEFAULT '',
        institutions TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        evidence_status TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        worth_following INTEGER NOT NULL DEFAULT 1,
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_news_events_published
        ON news_events(published_at DESC, event_id);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_owner
        ON documents(owner_type, owner_id, kind);
      CREATE TABLE IF NOT EXISTS repository_tombstones (
        entity_type TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        record_id TEXT NOT NULL DEFAULT '',
        source_path TEXT NOT NULL DEFAULT '',
        deleted_at INTEGER NOT NULL,
        PRIMARY KEY (entity_type, entity_key)
      );
      CREATE INDEX IF NOT EXISTS idx_repository_tombstones_source
        ON repository_tombstones(entity_type, source_path);
      CREATE TABLE IF NOT EXISTS custom_taxonomy (
        id TEXT PRIMARY KEY,
        parent_domain TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_custom_taxonomy_parent
        ON custom_taxonomy(parent_domain, name);
      CREATE TABLE IF NOT EXISTS classification_reviews (
        project_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        suggested_domain TEXT NOT NULL DEFAULT '',
        suggested_subdomains_json TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        previous_domain TEXT NOT NULL DEFAULT '',
        previous_subdomains_json TEXT NOT NULL DEFAULT '[]',
        deferred_at INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_classification_reviews_status
        ON classification_reviews(status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS document_migrations (
        source_path TEXT NOT NULL,
        target_space_id TEXT NOT NULL,
        source_sha256 TEXT NOT NULL DEFAULT '',
        target_document_id TEXT NOT NULL DEFAULT '',
        target_node_token TEXT NOT NULL DEFAULT '',
        target_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT NOT NULL DEFAULT '',
        migrated_at INTEGER NOT NULL,
        PRIMARY KEY (source_path, target_space_id)
      );
      INSERT INTO repository_meta (key, value, updated_at)
        VALUES ('schema_version', '${LOCAL_REPOSITORY_SCHEMA}', unixepoch('now') * 1000)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        WHERE repository_meta.value <> excluded.value;
    `);
    const projectColumns = new Set(
      this.database.prepare("PRAGMA table_info(projects)").all().map((column) => column.name)
    );
    if (!projectColumns.has("financing_history")) {
      this.database.exec("ALTER TABLE projects ADD COLUMN financing_history TEXT NOT NULL DEFAULT ''");
    }
    if (!projectColumns.has("latest_valuation_usd_100m")) {
      this.database.exec("ALTER TABLE projects ADD COLUMN latest_valuation_usd_100m REAL");
    }
    const peopleColumns = new Set(
      this.database.prepare("PRAGMA table_info(people)").all().map((column) => column.name)
    );
    if (!peopleColumns.has("interaction_documents_json")) {
      this.database.exec(
        "ALTER TABLE people ADD COLUMN interaction_documents_json TEXT NOT NULL DEFAULT '[]'"
      );
    }
    this.reconcileLegacyBulkIntakeTimestamps();
  }

  close() {
    this.database.close();
  }

  health() {
    const schema = this.database.prepare(
      "SELECT value FROM repository_meta WHERE key = 'schema_version'"
    ).get();
    return {
      ok: Number(schema?.value || 0) === LOCAL_REPOSITORY_SCHEMA,
      backend: "local",
      databasePath: this.databasePath,
      localLibraryDir: this.libraryDir,
      schemaVersion: Number(schema?.value || 0)
    };
  }

  cleanupStructuralGhostProjects() {
    const normalizedNames = [...PROJECT_STRUCTURE_DIRECTORIES].map(normalizedName);
    const placeholders = normalizedNames.map(() => "?").join(", ");
    if (!placeholders) return 0;
    const rows = this.database.prepare(`
      SELECT id, name, normalized_name, document_path
      FROM projects
      WHERE normalized_name IN (${placeholders})
        AND TRIM(notes) = ''
        AND TRIM(document_path) = ''
        AND TRIM(financing_history) = ''
        AND latest_valuation_usd_100m IS NULL
        AND cities_json = '[]'
        AND investors_json = '[]'
    `).all(...normalizedNames);
    if (!rows.length) return 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const deleteDocuments = this.database.prepare(
        "DELETE FROM documents WHERE owner_type = 'project' AND owner_id = ?"
      );
      const deleteProject = this.database.prepare("DELETE FROM projects WHERE id = ?");
      for (const row of rows) {
        deleteDocuments.run(row.id);
        deleteProject.run(row.id);
      }
      this.database.exec("COMMIT");
      return rows.length;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  reconcileLegacyBulkIntakeTimestamps() {
    const migrated = this.database.prepare(
      "SELECT 1 FROM repository_meta WHERE key = ?"
    ).get(LEGACY_BULK_INTAKE_MIGRATION_KEY);
    if (migrated) return { projects: 0, people: 0, unchanged: true };

    const now = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const projects = this.database.prepare(`
        UPDATE projects
        SET created_at = 0
        WHERE created_at > 0
          AND updated_at IN (
            SELECT updated_at
            FROM projects
            WHERE created_at > 0
            GROUP BY updated_at
            HAVING COUNT(*) >= ?
          )
      `).run(LEGACY_BULK_IMPORT_MIN);
      const people = this.database.prepare(`
        UPDATE people
        SET created_at = 0
        WHERE created_at > 0
          AND updated_at IN (
            SELECT updated_at
            FROM people
            WHERE created_at > 0
            GROUP BY updated_at
            HAVING COUNT(*) >= ?
          )
      `).run(LEGACY_BULK_IMPORT_MIN);
      const result = {
        projects: Number(projects.changes) || 0,
        people: Number(people.changes) || 0
      };
      this.database.prepare(`
        INSERT INTO repository_meta (key, value, updated_at)
        VALUES (?, ?, ?)
      `).run(
        LEGACY_BULK_INTAKE_MIGRATION_KEY,
        JSON.stringify(result),
        now
      );
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  reindexWorkspace() {
    const removedStructuralGhosts = this.cleanupStructuralGhostProjects();
    const discovered = scanWorkspaceEntities(this.libraryDir);
    const signature = workspaceEntitiesSignature(discovered);
    const previousSignature = this.database.prepare(
      "SELECT value FROM repository_meta WHERE key = 'workspace_index_signature'"
    ).get()?.value;
    if (previousSignature === signature) {
      const cached = this.database.prepare(
        "SELECT value, updated_at FROM repository_meta WHERE key = 'workspace_index'"
      ).get();
      let result;
      try {
        result = JSON.parse(cached?.value || "{}");
      } catch {
        result = {};
      }
      return {
        projects: {
          ...(result.projects || {}),
          discovered: discovered.projects.length,
          created: 0,
          linked: 0,
          ...(removedStructuralGhosts ? { removedStructuralGhosts } : {})
        },
        people: {
          ...(result.people || {}),
          discovered: discovered.people.length,
          created: 0,
          linked: 0
        },
        unchanged: true,
        indexedAt: Number(cached?.updated_at) || 0
      };
    }
    const result = {
      projects: {
        discovered: discovered.projects.length,
        created: 0,
        linked: 0,
        ...(removedStructuralGhosts ? { removedStructuralGhosts } : {})
      },
      people: { discovered: discovered.people.length, created: 0, linked: 0 },
      unchanged: false
    };
    const findProject = this.database.prepare(
      `SELECT id, domain, subdomains_json, status, rating, last_updated_at, document_path
       FROM projects WHERE normalized_name = ?`
    );
    const insertProject = this.database.prepare(`
      INSERT INTO projects (
        id, name, normalized_name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, financing_history, latest_valuation_usd_100m,
        last_updated_at, document_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '[]', '[]', '', NULL, ?, ?, ?, ?)
    `);
    const enrichProject = this.database.prepare(`
      UPDATE projects SET
        domain = CASE WHEN domain = '' THEN ? ELSE domain END,
        subdomains_json = CASE WHEN subdomains_json = '[]' THEN ? ELSE subdomains_json END,
        status = CASE WHEN status = '' THEN ? ELSE status END,
        rating = CASE WHEN rating = '' THEN ? ELSE rating END,
        last_updated_at = COALESCE(last_updated_at, ?),
        document_path = CASE WHEN document_path = '' THEN ? ELSE document_path END
      WHERE normalized_name = ?
    `);
    const findPerson = this.database.prepare(
      `SELECT id, types_json, organization, status, rating, interaction_documents_json, document_path
       FROM people WHERE normalized_name = ?`
    );
    const insertPerson = this.database.prepare(`
      INSERT INTO people (
        id, name, normalized_name, types_json, organization, status, rating,
        last_contact_at, cities_json, interaction_documents_json, document_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?, ?)
    `);
    const enrichPerson = this.database.prepare(`
      UPDATE people SET
        types_json = CASE WHEN types_json = '[]' THEN ? ELSE types_json END,
        organization = CASE WHEN organization = '' THEN ? ELSE organization END,
        status = CASE WHEN status = '' THEN ? ELSE status END,
        rating = CASE WHEN rating = '' THEN ? ELSE rating END,
        interaction_documents_json = ?,
        document_path = CASE WHEN document_path = '' THEN ? ELSE document_path END
      WHERE normalized_name = ?
    `);
    const findTombstone = this.database.prepare(`
      SELECT 1
      FROM repository_tombstones
      WHERE entity_type = ?
        AND (entity_key = ? OR (source_path <> '' AND source_path = ?))
      LIMIT 1
    `);
    const now = Date.now();
    const bulkBaseline = !previousSignature
      && discovered.projects.length + discovered.people.length >= LEGACY_BULK_IMPORT_MIN;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const project of discovered.projects) {
        if (findTombstone.get(
          "project",
          project.normalizedName,
          String(project.documentPath || "")
        )) continue;
        const existing = findProject.get(project.normalizedName);
        if (existing) {
          const shouldLink = !existing.document_path && project.documentPath;
          const shouldEnrich = (
            (!existing.domain && project.domain)
            || (existing.subdomains_json === "[]" && project.subdomains.length > 0)
            || (!existing.status && project.status)
            || (!existing.rating && project.rating)
            || (!existing.last_updated_at && project.lastUpdatedAt)
            || shouldLink
          );
          if (shouldEnrich) {
            enrichProject.run(
              project.domain,
              JSON.stringify(project.subdomains),
              project.status,
              project.rating,
              project.lastUpdatedAt,
              project.documentPath,
              project.normalizedName
            );
          }
          if (shouldLink) result.projects.linked += 1;
          continue;
        }
        insertProject.run(
          project.id,
          project.name,
          project.normalizedName,
          project.domain,
          JSON.stringify(project.subdomains),
          project.status,
          project.rating,
          project.lastUpdatedAt,
          project.documentPath,
          bulkBaseline ? 0 : project.createdAt,
          now
        );
        result.projects.created += 1;
      }

      for (const person of discovered.people) {
        if (findTombstone.get(
          "person",
          person.normalizedName,
          String(person.documentPath || "")
        )) continue;
        const existing = findPerson.get(person.normalizedName);
        if (existing) {
          const shouldLink = !existing.document_path && person.documentPath;
          const interactionDocumentsJson = JSON.stringify(person.interactionDocuments || []);
          const shouldEnrich = (
            (existing.types_json === "[]" && person.types.length > 0)
            || (!existing.organization && person.organization)
            || (!existing.status && person.status)
            || (!existing.rating && person.rating)
            || existing.interaction_documents_json !== interactionDocumentsJson
            || shouldLink
          );
          if (shouldEnrich) {
            enrichPerson.run(
              JSON.stringify(person.types),
              person.organization,
              person.status,
              person.rating,
              interactionDocumentsJson,
              person.documentPath,
              person.normalizedName
            );
          }
          if (shouldLink) result.people.linked += 1;
          continue;
        }
        insertPerson.run(
          person.id,
          person.name,
          person.normalizedName,
          JSON.stringify(person.types),
          person.organization,
          person.status,
          person.rating,
          JSON.stringify(person.interactionDocuments || []),
          person.documentPath,
          bulkBaseline ? 0 : person.createdAt,
          now
        );
        result.people.created += 1;
      }

      this.database.prepare(`
        INSERT INTO repository_meta (key, value, updated_at)
        VALUES ('workspace_index', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(JSON.stringify(result), now);
      this.database.prepare(`
        INSERT INTO repository_meta (key, value, updated_at)
        VALUES ('workspace_index_signature', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(signature, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return result;
  }

  listProjects() {
    return this.database.prepare(`
      SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, financing_history, latest_valuation_usd_100m,
        last_updated_at, document_path, created_at, updated_at
      FROM projects
      ORDER BY updated_at DESC, name
    `).all().map(projectRow);
  }

  listPeople() {
    const documentsByOwner = new Map();
    for (const document of this.database.prepare(`
      SELECT owner_id, kind, title, path, updated_at
      FROM documents
      WHERE owner_type = 'person'
      ORDER BY updated_at DESC, path ASC
    `).all()) {
      const documents = documentsByOwner.get(document.owner_id) || [];
      documents.push(document);
      documentsByOwner.set(document.owner_id, documents);
    }
    return this.database.prepare(`
      SELECT id, name, types_json, organization, status, rating,
        last_contact_at, cities_json, interaction_documents_json, document_path, created_at, updated_at
      FROM people
      ORDER BY updated_at DESC, name
    `).all().map((row) => personRow(row, documentsByOwner.get(row.id) || []));
  }

  listNews({ rangeStart, rangeEnd, limit = 500 }) {
    return this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action,
        worth_following, updated_at
      FROM news_events
      WHERE published_at >= ? AND published_at < ? AND worth_following = 1
      ORDER BY published_at DESC, importance DESC, event_id
      LIMIT ?
    `).all(rangeStart, rangeEnd, limit).map(newsRow);
  }

  listAllNews(limit = 2_000) {
    const safeLimit = Math.min(Math.max(Number(limit) || 2_000, 1), 10_000);
    return this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action,
        worth_following, updated_at
      FROM news_events
      ORDER BY published_at DESC, importance DESC, event_id
      LIMIT ?
    `).all(safeLimit).map(newsRow);
  }

  recordDirectory(entityType, recordId) {
    const id = String(recordId || "").trim();
    if (!id) return "";
    if (entityType === "person") {
      const row = this.database.prepare(
        `SELECT id, name, types_json, organization, status, rating,
          last_contact_at, cities_json, interaction_documents_json, document_path, created_at, updated_at
         FROM people WHERE id = ?`
      ).get(id);
      if (!row) return "";
      const person = personRow(row);
      const peopleRoot = path.join(this.libraryDir, PEOPLE_DIRECTORY);
      const directory = row.document_path
        ? path.dirname(row.document_path)
        : this.personDirectory(person);
      assertWithin(peopleRoot, directory);
      return fs.existsSync(directory) ? directory : "";
    }
    const row = this.database.prepare(
      `SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, financing_history, latest_valuation_usd_100m,
        last_updated_at, document_path, created_at, updated_at
       FROM projects WHERE id = ?`
    ).get(id);
    if (!row) return "";
    const project = projectRow(row);
    const projectRoot = path.join(this.libraryDir, PROJECTS_DIRECTORY);
    const directory = row.document_path
      ? path.dirname(row.document_path)
      : this.projectDirectory(project);
    assertWithin(projectRoot, directory);
    return fs.existsSync(directory) ? directory : "";
  }

  resolvePreviewDocument(entityType, recordId) {
    const type = String(entityType || "").trim();
    const id = String(recordId || "").trim();
    if (!id || !["project", "person"].includes(type)) {
      throw new Error("无法识别要预览的资料库记录。");
    }
    const table = type === "project" ? "projects" : "people";
    const row = this.database.prepare(
      `SELECT id, name, document_path FROM ${table} WHERE id = ?`
    ).get(id);
    if (!row) throw new Error("找不到要预览的资料库记录。");
    const canonicalPath = String(row.document_path || "").trim();
    const directory = this.recordDirectory(type, id)
      || (canonicalPath ? path.dirname(canonicalPath) : "");
    if (!directory) throw new Error("该记录尚未关联本地资料目录。");
    const root = path.join(
      this.libraryDir,
      type === "project" ? PROJECTS_DIRECTORY : PEOPLE_DIRECTORY
    );
    assertWithin(root, directory);
    const previewPath = bestPreviewDocument(directory, canonicalPath);
    if (!previewPath) {
      throw new Error("该资料目录中还没有可在 domi 内预览的 Markdown 或 PDF 文档。");
    }
    assertWithin(directory, previewPath);
    return {
      ok: true,
      entityType: type,
      recordId: id,
      title: path.basename(previewPath),
      resource: localDocumentUrl(previewPath)
    };
  }

  deleteDatabaseRecord(request = {}) {
    const entityType = String(request.entityType || "").trim();
    const recordId = String(request.recordId || "").trim();
    if (!recordId || !["project", "person", "news"].includes(entityType)) {
      throw new Error("无法识别要移出的资料库记录。");
    }
    const definition = entityType === "project"
      ? { table: "projects", idColumn: "id", nameColumn: "name", keyColumn: "normalized_name" }
      : entityType === "person"
        ? { table: "people", idColumn: "id", nameColumn: "name", keyColumn: "normalized_name" }
        : { table: "news_events", idColumn: "event_id", nameColumn: "title", keyColumn: "event_id" };
    const row = this.database.prepare(
      `SELECT ${definition.idColumn} AS id, ${definition.nameColumn} AS title,
        ${definition.keyColumn} AS entity_key, document_path, updated_at
       FROM ${definition.table}
       WHERE ${definition.idColumn} = ?`
    ).get(recordId);
    if (!row) throw new Error("找不到要移出的资料库记录。");
    const expectedUpdatedAt = Number(request.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== Number(row.updated_at)) {
      throw new Error("记录已被其他流程更新，请刷新后再删除。");
    }
    const now = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO repository_tombstones (
          entity_type, entity_key, record_id, source_path, deleted_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_key) DO UPDATE SET
          record_id = excluded.record_id,
          source_path = excluded.source_path,
          deleted_at = excluded.deleted_at
      `).run(
        entityType,
        String(row.entity_key || recordId),
        recordId,
        String(row.document_path || ""),
        now
      );
      this.database.prepare(
        "DELETE FROM documents WHERE owner_id = ? AND owner_type IN (?, ?)"
      ).run(recordId, entityType, entityType === "news" ? "news_event" : entityType);
      const deleted = this.database.prepare(
        `DELETE FROM ${definition.table}
         WHERE ${definition.idColumn} = ? AND updated_at = ?`
      ).run(recordId, expectedUpdatedAt);
      if (Number(deleted.changes) !== 1) {
        throw new Error("记录已被其他流程更新，请刷新后再删除。");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      ok: true,
      entityType,
      recordId,
      title: String(row.title || ""),
      filesPreserved: true,
      sourcePath: String(row.document_path || ""),
      deletedAt: now
    };
  }

  listTaxonomy() {
    const customSubdomains = this.database.prepare(`
      SELECT id, parent_domain, name, source, created_at, updated_at
      FROM custom_taxonomy
      ORDER BY parent_domain ASC, name ASC
    `).all().map((row) => ({
      id: row.id,
      parentDomain: row.parent_domain,
      name: row.name,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    const domains = Object.entries(CANONICAL_PROJECT_TAXONOMY).map(([name, subdomains]) => ({
      name,
      subdomains: [
        ...subdomains,
        ...customSubdomains
          .filter((item) => item.parentDomain === name)
          .map((item) => item.name)
      ].filter((item, index, all) =>
        all.findIndex((candidate) => normalizedName(candidate) === normalizedName(item)) === index
      )
    }));
    return { domains, customSubdomains };
  }

  projectNeedsClassificationReview(project, taxonomy) {
    const domain = String(project.domain || "").trim();
    const subdomains = stringList(project.subdomains);
    if (!domain || ["_未分类", "未分类"].includes(domain)) return true;
    if (subdomains.some((item) => ["_未分类", "未分类"].includes(item))) return true;
    const domainEntry = taxonomy.domains.find((item) => item.name === domain);
    return Boolean(domainEntry?.subdomains?.length) && subdomains.length === 0;
  }

  listClassificationReviews() {
    const taxonomy = this.listTaxonomy();
    const persisted = new Map(this.database.prepare(`
      SELECT project_id, status, suggested_domain, suggested_subdomains_json,
        confidence, reason, previous_domain, previous_subdomains_json,
        deferred_at, updated_at
      FROM classification_reviews
    `).all().map((row) => [row.project_id, row]));
    const reviews = [];
    for (const project of this.listProjects()) {
      const review = persisted.get(project.recordId);
      const needsReview = this.projectNeedsClassificationReview(project, taxonomy);
      if (!needsReview) {
        if (review && review.status !== "confirmed") {
          this.database.prepare(`
            UPDATE classification_reviews
            SET status = 'confirmed', updated_at = ?
            WHERE project_id = ?
          `).run(Date.now(), project.recordId);
        }
        continue;
      }
      const directory = this.recordDirectory("project", project.recordId);
      const canonicalPath = project.link && project.link.startsWith("file:")
        ? decodeURIComponent(new URL(project.link).pathname)
        : "";
      const evidence = scanProjectClassificationEvidence(directory, canonicalPath);
      const suggestion = suggestProjectClassification(project, evidence);
      const now = Date.now();
      const status = CLASSIFICATION_REVIEW_STATUSES.has(review?.status)
        ? review.status
        : "pending";
      const suggestionChanged = !review
        || review.suggested_domain !== suggestion.domain
        || review.suggested_subdomains_json !== JSON.stringify(suggestion.subdomains)
        || Number(review.confidence) !== suggestion.confidence
        || review.reason !== suggestion.reason;
      if (!review || (status === "pending" && suggestionChanged)) {
        this.database.prepare(`
          INSERT INTO classification_reviews (
            project_id, status, suggested_domain, suggested_subdomains_json,
            confidence, reason, previous_domain, previous_subdomains_json,
            deferred_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, '', '[]', NULL, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            status = excluded.status,
            suggested_domain = excluded.suggested_domain,
            suggested_subdomains_json = excluded.suggested_subdomains_json,
            confidence = excluded.confidence,
            reason = excluded.reason,
            updated_at = excluded.updated_at
        `).run(
          project.recordId,
          status,
          suggestion.domain,
          JSON.stringify(suggestion.subdomains),
          suggestion.confidence,
          suggestion.reason,
          now
        );
      }
      reviews.push({
        project,
        status,
        suggestedDomain: suggestion.domain,
        suggestedSubdomains: suggestion.subdomains,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
        deferredAt: Number(review?.deferred_at) || null,
        updatedAt: Number(review?.updated_at) || now,
        evidence: evidence.map(({ classifierText: _classifierText, ...item }) => item)
      });
    }
    return reviews.sort((left, right) => {
      const statusRank = { pending: 2, deferred: 1, confirmed: 0 };
      return (statusRank[right.status] || 0) - (statusRank[left.status] || 0)
        || right.confidence - left.confidence
        || left.project.name.localeCompare(right.project.name, "zh-CN");
    });
  }

  deferClassificationReview(request = {}) {
    const projectId = String(request.recordId || "").trim();
    if (!projectId || !this.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) {
      throw new Error("找不到要暂缓的分类项目。");
    }
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO classification_reviews (
        project_id, status, suggested_domain, suggested_subdomains_json,
        confidence, reason, previous_domain, previous_subdomains_json,
        deferred_at, updated_at
      ) VALUES (?, 'deferred', '', '[]', 0, '', '', '[]', ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        status = 'deferred', deferred_at = excluded.deferred_at, updated_at = excluded.updated_at
    `).run(projectId, now, now);
    return { ok: true, action: "defer", recordId: projectId, updatedAt: now };
  }

  applyProjectClassification(request = {}) {
    const projectId = String(request.recordId || "").trim();
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
    if (!row) throw new Error("找不到要分类的项目。");
    const current = projectRow(row);
    const action = String(request.action || "apply").trim();
    if (action === "defer") return this.deferClassificationReview(request);

    let domain = String(request.domain || "").trim();
    let subdomains = stringList(request.subdomains);
    let customSubdomain = null;
    if (action === "undo") {
      const review = this.database.prepare(`
        SELECT previous_domain, previous_subdomains_json
        FROM classification_reviews WHERE project_id = ?
      `).get(projectId);
      if (!review) throw new Error("没有可以撤销的分类操作。");
      domain = String(review.previous_domain || "").trim() || "_未分类";
      subdomains = parseList(review.previous_subdomains_json);
    } else {
      if (!CANONICAL_PROJECT_DOMAINS.has(domain)) {
        throw new Error("一级领域必须从现有正式领域中选择。");
      }
      const requestedCustomName = normalizedTaxonomyLabel(request.createSubdomainName);
      if (requestedCustomName) {
        const parentDomain = String(request.createSubdomainParentDomain || domain).trim();
        if (parentDomain !== domain || !CANONICAL_PROJECT_DOMAINS.has(parentDomain)) {
          throw new Error("新子领域必须归属于当前选择的正式一级领域。");
        }
        if (["_未分类", "未分类"].includes(requestedCustomName)) {
          throw new Error("新子领域不能使用系统保留名称。");
        }
        const canonicalParent = canonicalSubdomainParent(requestedCustomName);
        if (canonicalParent && canonicalParent !== domain) {
          throw new Error(`“${requestedCustomName}”已经是“${canonicalParent}”下的正式子领域。`);
        }
        const existingCustom = this.database.prepare(`
          SELECT parent_domain, name FROM custom_taxonomy WHERE normalized_name = ?
        `).get(normalizedName(requestedCustomName));
        if (existingCustom && existingCustom.parent_domain !== domain) {
          throw new Error(`“${existingCustom.name}”已经归属于“${existingCustom.parent_domain}”。`);
        }
        customSubdomain = existingCustom ? null : { name: requestedCustomName, parentDomain: domain };
        if (!subdomains.some((item) => normalizedName(item) === normalizedName(requestedCustomName))) {
          subdomains = [requestedCustomName, ...subdomains];
        }
      }

      const taxonomy = this.listTaxonomy();
      const allowed = new Set(
        (taxonomy.domains.find((item) => item.name === domain)?.subdomains || [])
          .map(normalizedName)
      );
      if (customSubdomain) allowed.add(normalizedName(customSubdomain.name));
      const invalid = subdomains.find((item) => !allowed.has(normalizedName(item)));
      if (invalid) throw new Error(`子领域“${invalid}”不属于一级领域“${domain}”。`);
      if (allowed.size > 0 && subdomains.length === 0) {
        throw new Error("请选择一个子领域，或输入名称创建新的正式子领域。");
      }
    }

    const record = this.updateProject({
      recordId: current.recordId,
      expectedUpdatedAt: Number(request.expectedUpdatedAt),
      name: current.name,
      domain,
      subdomains,
      status: current.status,
      rating: current.rating,
      notes: current.notes || "",
      cities: current.cities || [],
      investors: current.investors || [],
      financingHistory: current.financingHistory || "",
      latestValuationUsd100m: current.latestValuationUsd100m ?? null,
      customSubdomain,
      classificationReview: {
        status: action === "undo" ? "pending" : "confirmed",
        previousDomain: action === "undo" ? "" : current.domain,
        previousSubdomains: action === "undo" ? [] : current.subdomains,
        preservePrevious: action === "undo"
      }
    });
    return {
      ok: true,
      action,
      record,
      taxonomy: this.listTaxonomy(),
      updatedAt: record.updatedAt
    };
  }

  projectDirectory(project) {
    const root = path.join(this.libraryDir, PROJECTS_DIRECTORY);
    const domain = safePathSegment(project.domain);
    const mainSubdomain = project.subdomains[0]
      ? safePathSegment(project.subdomains[0])
      : "";
    const projectName = safePathSegment(project.name, "未命名项目");
    const directory = !mainSubdomain || mainSubdomain === "_未分类"
      ? path.join(root, domain, projectName)
      : path.join(root, domain, mainSubdomain, projectName);
    assertWithin(root, directory);
    return directory;
  }

  personDirectory(person) {
    const root = path.join(this.libraryDir, PEOPLE_DIRECTORY);
    const directory = path.join(root, safePathSegment(person.name, "未命名人物"));
    assertWithin(root, directory);
    return directory;
  }

  newsDocumentPath(item) {
    const root = path.join(this.libraryDir, NEWS_DIRECTORY);
    const published = new Date(item.publishedAt);
    if (!Number.isFinite(published.getTime())) throw new Error("行业信息发布时间无效。");
    const year = String(published.getUTCFullYear()).padStart(4, "0");
    const month = String(published.getUTCMonth() + 1).padStart(2, "0");
    const filePath = path.join(root, year, month, `${safePathSegment(item.recordId, "event")}.md`);
    assertWithin(root, filePath);
    return filePath;
  }

  updateProject(request = {}) {
    const id = String(request.recordId || "").trim();
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row) throw new Error("找不到要修改的项目记录。");
    const expectedUpdatedAt = Number(request.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== Number(row.updated_at)) {
      throw new Error("项目已被其他流程更新，请刷新后再保存。");
    }

    const name = String(request.name || "").trim();
    if (!name) throw new Error("公司名称不能为空。");
    const domain = String(request.domain || "").trim() || "_未分类";
    const subdomains = stringList(request.subdomains);
    const status = normalizedProjectStatus(request.status);
    const rating = normalizedRating(request.rating);
    const investors = stringList(request.investors);
    const invalidInvestor = investors.find((item) => !TRACKED_INVESTORS.has(item));
    if (invalidInvestor) throw new Error(`投资机构“${invalidInvestor}”不在当前关注名单中。`);
    const valuationInput = request.latestValuationUsd100m;
    const latestValuationUsd100m = valuationInput === null
      || valuationInput === undefined
      || valuationInput === ""
      ? null
      : Number(valuationInput);
    if (
      latestValuationUsd100m !== null
      && (!Number.isFinite(latestValuationUsd100m) || latestValuationUsd100m < 0)
    ) {
      throw new Error("最新估值必须是非负数字，单位为亿美元。");
    }
    const now = Date.now();
    const customSubdomain = request.customSubdomain && request.customSubdomain.name
      ? {
          name: normalizedTaxonomyLabel(request.customSubdomain.name),
          parentDomain: String(request.customSubdomain.parentDomain || domain).trim()
        }
      : null;
    const classificationReview = request.classificationReview || null;
    const project = {
      recordId: id,
      name,
      domain,
      subdomains,
      status,
      rating,
      notes: String(request.notes || "").trim(),
      cities: stringList(request.cities),
      investors,
      financingHistory: String(request.financingHistory || "").trim(),
      latestValuationUsd100m,
      lastUpdatedAt: now
    };
    const targetDirectory = this.projectDirectory(project);
    const currentDocumentPath = String(row.document_path || "").trim();
    const currentDirectory = currentDocumentPath ? path.dirname(currentDocumentPath) : "";
    const projectRoot = path.join(this.libraryDir, PROJECTS_DIRECTORY);
    if (currentDirectory) assertWithin(projectRoot, currentDirectory);
    if (
      currentDirectory
      && targetDirectory !== currentDirectory
      && targetDirectory.startsWith(`${currentDirectory}${path.sep}`)
    ) {
      throw new Error("新的项目目录不能位于原项目目录内部。");
    }
    if (
      currentDirectory
      && targetDirectory !== currentDirectory
      && fs.existsSync(targetDirectory)
    ) {
      throw new Error("目标项目目录已存在，请先处理同名目录。");
    }

    let movedDirectory = false;
    let createdDirectory = false;
    let canonicalPath = path.join(targetDirectory, PROJECT_PAGE_NAME);
    let previousPageExists = false;
    let previousPageContent = "";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (customSubdomain) {
        this.database.prepare(`
          INSERT INTO custom_taxonomy (
            id, parent_domain, name, normalized_name, source, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'user', ?, ?)
          ON CONFLICT(normalized_name) DO UPDATE SET
            updated_at = excluded.updated_at
          WHERE custom_taxonomy.parent_domain = excluded.parent_domain
        `).run(
          stableId("tax", `${customSubdomain.parentDomain}:${normalizedName(customSubdomain.name)}`),
          customSubdomain.parentDomain,
          customSubdomain.name,
          normalizedName(customSubdomain.name),
          now,
          now
        );
      }
      if (currentDirectory && targetDirectory !== currentDirectory && fs.existsSync(currentDirectory)) {
        fs.mkdirSync(path.dirname(targetDirectory), { recursive: true });
        fs.renameSync(currentDirectory, targetDirectory);
        movedDirectory = true;
      } else if (!fs.existsSync(targetDirectory)) {
        fs.mkdirSync(targetDirectory, { recursive: true });
        createdDirectory = true;
      }
      canonicalPath = path.join(targetDirectory, PROJECT_PAGE_NAME);
      previousPageExists = fs.existsSync(canonicalPath);
      previousPageContent = previousPageExists ? fs.readFileSync(canonicalPath, "utf8") : "";
      atomicWriteText(
        canonicalPath,
        replaceManagedBlock(previousPageContent, renderProjectManagedBlock(project))
      );
      const updateResult = this.database.prepare(`
        UPDATE projects SET
          name = ?, normalized_name = ?, domain = ?, subdomains_json = ?,
          status = ?, rating = ?, notes = ?, cities_json = ?, investors_json = ?,
          financing_history = ?, latest_valuation_usd_100m = ?,
          last_updated_at = ?, document_path = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).run(
        project.name,
        normalizedName(project.name),
        project.domain,
        JSON.stringify(project.subdomains),
        project.status,
        project.rating,
        project.notes,
        JSON.stringify(project.cities),
        JSON.stringify(project.investors),
        project.financingHistory,
        project.latestValuationUsd100m,
        now,
        canonicalPath,
        now,
        id,
        expectedUpdatedAt
      );
      if (Number(updateResult.changes) !== 1) {
        throw new Error("项目已被其他流程更新，请刷新后再保存。");
      }
      if (classificationReview) {
        const reviewStatus = CLASSIFICATION_REVIEW_STATUSES.has(classificationReview.status)
          ? classificationReview.status
          : "confirmed";
        const existingReview = this.database.prepare(`
          SELECT previous_domain, previous_subdomains_json
          FROM classification_reviews WHERE project_id = ?
        `).get(id);
        const previousDomain = classificationReview.preservePrevious
          ? String(existingReview?.previous_domain || "")
          : String(classificationReview.previousDomain || "");
        const previousSubdomains = classificationReview.preservePrevious
          ? parseList(existingReview?.previous_subdomains_json)
          : stringList(classificationReview.previousSubdomains);
        this.database.prepare(`
          INSERT INTO classification_reviews (
            project_id, status, suggested_domain, suggested_subdomains_json,
            confidence, reason, previous_domain, previous_subdomains_json,
            deferred_at, updated_at
          ) VALUES (?, ?, '', '[]', 0, '', ?, ?, NULL, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            status = excluded.status,
            previous_domain = excluded.previous_domain,
            previous_subdomains_json = excluded.previous_subdomains_json,
            deferred_at = NULL,
            updated_at = excluded.updated_at
        `).run(
          id,
          reviewStatus,
          previousDomain,
          JSON.stringify(previousSubdomains),
          now
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      try {
        if (previousPageExists) atomicWriteText(canonicalPath, previousPageContent);
        else fs.rmSync(canonicalPath, { force: true });
        if (movedDirectory && fs.existsSync(targetDirectory)) {
          fs.mkdirSync(path.dirname(currentDirectory), { recursive: true });
          fs.renameSync(targetDirectory, currentDirectory);
        } else if (createdDirectory) {
          fs.rmdirSync(targetDirectory);
        }
      } catch {}
      throw error;
    }
    return projectRow(this.database.prepare(`
      SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, financing_history, latest_valuation_usd_100m,
        last_updated_at, document_path, created_at, updated_at
      FROM projects WHERE id = ?
    `).get(id));
  }

  updatePerson(request = {}) {
    const id = String(request.recordId || "").trim();
    const row = this.database.prepare("SELECT * FROM people WHERE id = ?").get(id);
    if (!row) throw new Error("找不到要修改的人脉记录。");
    const expectedUpdatedAt = Number(request.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== Number(row.updated_at)) {
      throw new Error("人脉记录已被其他流程更新，请刷新后再保存。");
    }
    const name = String(request.name || "").trim();
    if (!name) throw new Error("人名不能为空。");
    const lastContact = request.lastContact === null
      || request.lastContact === undefined
      || request.lastContact === ""
      ? null
      : toEpochMs(request.lastContact, NaN);
    if (lastContact !== null && !Number.isFinite(lastContact)) {
      throw new Error("最后联系日期格式不正确。");
    }
    const now = Date.now();
    const person = {
      recordId: id,
      name,
      types: stringList(request.types),
      organization: String(request.organization || "").trim(),
      status: String(request.status || "").trim(),
      rating: normalizedRating(request.rating),
      lastContact,
      cities: stringList(request.cities)
    };
    const targetDirectory = this.personDirectory(person);
    const currentDocumentPath = String(row.document_path || "").trim();
    const currentDirectory = currentDocumentPath ? path.dirname(currentDocumentPath) : "";
    const peopleRoot = path.join(this.libraryDir, PEOPLE_DIRECTORY);
    if (currentDirectory) assertWithin(peopleRoot, currentDirectory);
    if (
      currentDirectory
      && targetDirectory !== currentDirectory
      && fs.existsSync(targetDirectory)
    ) {
      throw new Error("目标人脉目录已存在，请先处理同名目录。");
    }

    let movedDirectory = false;
    let createdDirectory = false;
    let canonicalPath = path.join(targetDirectory, PERSON_PAGE_NAME);
    let previousPageExists = false;
    let previousPageContent = "";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (currentDirectory && targetDirectory !== currentDirectory && fs.existsSync(currentDirectory)) {
        fs.mkdirSync(path.dirname(targetDirectory), { recursive: true });
        fs.renameSync(currentDirectory, targetDirectory);
        movedDirectory = true;
      } else if (!fs.existsSync(targetDirectory)) {
        fs.mkdirSync(targetDirectory, { recursive: true });
        createdDirectory = true;
      }
      canonicalPath = path.join(targetDirectory, PERSON_PAGE_NAME);
      previousPageExists = fs.existsSync(canonicalPath);
      previousPageContent = previousPageExists ? fs.readFileSync(canonicalPath, "utf8") : "";
      atomicWriteText(
        canonicalPath,
        replaceManagedBlock(previousPageContent, renderPersonManagedBlock(person))
      );
      const interactionDocumentsJson = JSON.stringify(
        scanPersonDocuments(targetDirectory)
      );
      const updateResult = this.database.prepare(`
        UPDATE people SET
          name = ?, normalized_name = ?, types_json = ?, organization = ?,
          status = ?, rating = ?, last_contact_at = ?, cities_json = ?,
          interaction_documents_json = ?, document_path = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).run(
        person.name,
        normalizedName(person.name),
        JSON.stringify(person.types),
        person.organization,
        person.status,
        person.rating,
        person.lastContact,
        JSON.stringify(person.cities),
        interactionDocumentsJson,
        canonicalPath,
        now,
        id,
        expectedUpdatedAt
      );
      if (Number(updateResult.changes) !== 1) {
        throw new Error("人脉记录已被其他流程更新，请刷新后再保存。");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      try {
        if (previousPageExists) atomicWriteText(canonicalPath, previousPageContent);
        else fs.rmSync(canonicalPath, { force: true });
        if (movedDirectory && fs.existsSync(targetDirectory)) {
          fs.mkdirSync(path.dirname(currentDirectory), { recursive: true });
          fs.renameSync(targetDirectory, currentDirectory);
        } else if (createdDirectory) {
          fs.rmdirSync(targetDirectory);
        }
      } catch {}
      throw error;
    }
    const updatedRow = this.database.prepare(`
      SELECT id, name, types_json, organization, status, rating,
        last_contact_at, cities_json, interaction_documents_json, document_path, created_at, updated_at
      FROM people WHERE id = ?
    `).get(id);
    const documents = this.database.prepare(`
      SELECT kind, title, path, updated_at
      FROM documents
      WHERE owner_type = 'person' AND owner_id = ?
      ORDER BY updated_at DESC, path ASC
    `).all(id);
    return personRow(updatedRow, documents);
  }

  updateNews(request = {}) {
    const id = String(request.recordId || "").trim();
    const row = this.database.prepare("SELECT * FROM news_events WHERE event_id = ?").get(id);
    if (!row) throw new Error("找不到要修改的行业信息。");
    const expectedUpdatedAt = Number(request.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== Number(row.updated_at)) {
      throw new Error("行业信息已被其他流程更新，请刷新后再保存。");
    }
    const title = String(request.title || "").trim();
    if (!title) throw new Error("行业信息标题不能为空。");
    const publishedAt = toEpochMs(request.publishedAt, NaN);
    if (!Number.isFinite(publishedAt)) throw new Error("行业信息发布时间格式不正确。");
    const importance = Math.min(Math.max(Number(request.importance) || 0, 0), 10);
    const confidence = Math.min(Math.max(Number(request.confidence) || 0, 0), 10);
    const now = Date.now();
    const item = {
      recordId: id,
      title,
      domains: stringList(request.domains),
      subdomains: stringList(request.subdomains),
      types: stringList(request.types),
      publishedAt,
      summary: String(request.summary || "").trim(),
      investmentMeaning: String(request.investmentMeaning || "").trim(),
      url: String(request.url || "").trim(),
      source: String(request.source || "").trim(),
      companies: String(request.companies || "").trim(),
      institutions: String(request.institutions || "").trim(),
      importance,
      confidence,
      evidenceStatus: String(request.evidenceStatus || "").trim(),
      action: String(request.action || "").trim(),
      worthFollowing: request.worthFollowing !== false
    };
    if (item.url && !/^https?:\/\//i.test(item.url)) {
      throw new Error("来源链接必须使用 HTTP 或 HTTPS。");
    }
    const targetPath = this.newsDocumentPath(item);
    const currentPath = String(row.document_path || "").trim();
    const newsRoot = path.join(this.libraryDir, NEWS_DIRECTORY);
    if (currentPath) assertWithin(newsRoot, currentPath);
    if (currentPath && currentPath !== targetPath && fs.existsSync(targetPath)) {
      throw new Error("目标行业信息文档已存在。");
    }

    let movedDocument = false;
    let previousPageExists = false;
    let previousPageContent = "";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (currentPath && currentPath !== targetPath && fs.existsSync(currentPath)) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.renameSync(currentPath, targetPath);
        movedDocument = true;
      }
      previousPageExists = fs.existsSync(targetPath);
      previousPageContent = previousPageExists ? fs.readFileSync(targetPath, "utf8") : "";
      atomicWriteText(
        targetPath,
        replaceManagedBlock(previousPageContent, renderNewsManagedBlock(item))
      );
      const updateResult = this.database.prepare(`
        UPDATE news_events SET
          title = ?, domains_json = ?, subdomains_json = ?, types_json = ?,
          published_at = ?, summary = ?, investment_meaning = ?, url = ?,
          source = ?, companies = ?, institutions = ?, importance = ?,
          confidence = ?, evidence_status = ?, action = ?, worth_following = ?,
          document_path = ?, updated_at = ?
        WHERE event_id = ? AND updated_at = ?
      `).run(
        item.title,
        JSON.stringify(item.domains),
        JSON.stringify(item.subdomains),
        JSON.stringify(item.types),
        item.publishedAt,
        item.summary,
        item.investmentMeaning,
        item.url,
        item.source,
        item.companies,
        item.institutions,
        item.importance,
        item.confidence,
        item.evidenceStatus,
        item.action,
        item.worthFollowing ? 1 : 0,
        targetPath,
        now,
        id,
        expectedUpdatedAt
      );
      if (Number(updateResult.changes) !== 1) {
        throw new Error("行业信息已被其他流程更新，请刷新后再保存。");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      try {
        if (previousPageExists) atomicWriteText(targetPath, previousPageContent);
        else fs.rmSync(targetPath, { force: true });
        if (movedDocument && fs.existsSync(targetPath)) {
          fs.mkdirSync(path.dirname(currentPath), { recursive: true });
          fs.renameSync(targetPath, currentPath);
        }
      } catch {}
      throw error;
    }
    return newsRow(this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action,
        worth_following, updated_at
      FROM news_events WHERE event_id = ?
    `).get(id));
  }

  listMigrationProjects() {
    const documentRows = this.database.prepare(`
      SELECT owner_id, kind, title, path
      FROM documents
      WHERE owner_type = 'project'
      ORDER BY updated_at ASC, path ASC
    `).all();
    const documentsByProject = new Map();
    for (const row of documentRows) {
      const documents = documentsByProject.get(row.owner_id) || [];
      documents.push({
        kind: row.kind,
        title: row.title,
        path: row.path
      });
      documentsByProject.set(row.owner_id, documents);
    }
    return this.database.prepare(`
      SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, last_updated_at, document_path
      FROM projects
      ORDER BY updated_at ASC, name ASC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      subdomains: parseList(row.subdomains_json),
      status: row.status,
      rating: row.rating,
      notes: row.notes,
      cities: parseList(row.cities_json),
      investors: parseList(row.investors_json),
      lastUpdatedAt: row.last_updated_at || null,
      documentPath: row.document_path,
      documents: documentsByProject.get(row.id) || []
    }));
  }

  listMigrationPeople() {
    return this.database.prepare(`
      SELECT id, name, types_json, organization, status, rating,
        last_contact_at, cities_json, interaction_documents_json, document_path, created_at, updated_at
      FROM people
      ORDER BY updated_at ASC, name ASC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      types: parseList(row.types_json),
      organization: row.organization,
      status: row.status,
      rating: row.rating,
      lastContactAt: row.last_contact_at || null,
      cities: parseList(row.cities_json),
      documentPath: row.document_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  listMigrationNews() {
    return this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action,
        worth_following, document_path, created_at, updated_at
      FROM news_events
      ORDER BY published_at ASC, event_id ASC
    `).all().map((row) => ({
      eventId: row.event_id,
      title: row.title,
      domains: parseList(row.domains_json),
      subdomains: parseList(row.subdomains_json),
      types: parseList(row.types_json),
      publishedAt: row.published_at,
      summary: row.summary,
      investmentMeaning: row.investment_meaning,
      url: row.url,
      source: row.source,
      companies: row.companies,
      institutions: row.institutions,
      importance: Number(row.importance) || 0,
      confidence: Number(row.confidence) || 0,
      evidenceStatus: row.evidence_status,
      action: row.action,
      worthFollowing: Boolean(row.worth_following),
      documentPath: row.document_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  getDocumentMigration(sourcePath, targetSpaceId) {
    return this.database.prepare(`
      SELECT source_path, target_space_id, source_sha256, target_document_id,
        target_node_token, target_url, status, error, migrated_at
      FROM document_migrations
      WHERE source_path = ? AND target_space_id = ?
    `).get(path.resolve(sourcePath), String(targetSpaceId || ""));
  }

  saveDocumentMigration(record) {
    const sourcePath = path.resolve(record.sourcePath);
    const targetSpaceId = String(record.targetSpaceId || "");
    const migratedAt = Number(record.migratedAt) || Date.now();
    this.database.prepare(`
      INSERT INTO document_migrations (
        source_path, target_space_id, source_sha256, target_document_id,
        target_node_token, target_url, status, error, migrated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_path, target_space_id) DO UPDATE SET
        source_sha256 = excluded.source_sha256,
        target_document_id = excluded.target_document_id,
        target_node_token = excluded.target_node_token,
        target_url = excluded.target_url,
        status = excluded.status,
        error = excluded.error,
        migrated_at = excluded.migrated_at
    `).run(
      sourcePath,
      targetSpaceId,
      String(record.sourceSha256 || ""),
      String(record.targetDocumentId || ""),
      String(record.targetNodeToken || ""),
      String(record.targetUrl || ""),
      String(record.status || "pending"),
      String(record.error || ""),
      migratedAt
    );
    return this.getDocumentMigration(sourcePath, targetSpaceId);
  }
}

module.exports = {
  LOCAL_REPOSITORY_SCHEMA,
  LocalDomiRepository,
  normalizedName,
  scanWorkspaceEntities,
  workspaceEntitiesSignature,
  resolveHomePath
};
