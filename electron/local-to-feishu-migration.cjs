const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  prepareMarkdownForFeishu,
  verifyFeishuMarkdownImport
} = require("./markdown-feishu-fidelity.cjs");
const { placeFeishuAssetAtMarker } = require("./feishu-markdown-assets.cjs");

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_PROJECT_DOCUMENTS = 500;
const MAX_WIKI_NODES = 5000;

function comparableText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textValue).join("");
  return String(value.text || value.name || value.value || "");
}

function responseData(response) {
  const first = response?.data ?? response ?? {};
  return first?.data ?? first;
}

function responseItems(response) {
  const data = responseData(response);
  if (Array.isArray(data)) return data;
  return data.items || data.nodes || data.records || [];
}

function wikiNodeToken(node) {
  return String(node?.node_token || node?.nodeToken || node?.token || "");
}

function wikiNodeTitle(node) {
  return textValue(node?.title || node?.name).trim();
}

function wikiParentToken(node) {
  return String(node?.parent_node_token || node?.parentNodeToken || "");
}

function wikiDocumentId(node) {
  return String(node?.obj_token || node?.objToken || node?.document_id || node?.documentId || "");
}

function wikiNodeUrl(node) {
  return String(
    node?.url
    || node?.wiki_url
    || node?.wikiUrl
    || node?.node_url
    || node?.nodeUrl
    || node?.document_url
    || node?.documentUrl
    || ""
  );
}

function normalizeStatus(value) {
  return String(value || "待交流").trim() === "找投资窗口"
    ? "深度跟踪"
    : String(value || "待交流").trim();
}

function formatFeishuDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function normalizeEvidenceStatus(value) {
  const raw = String(value || "").trim();
  if (["独立核实", "公司／机构口径", "可观察动作", "二手报道", "传闻／待核验"].includes(raw)) {
    return raw;
  }
  if (/独立|交叉|已核验/.test(raw)) return "独立核实";
  if (/官方|公司|机构/.test(raw)) return "公司／机构口径";
  if (/观察|动作/.test(raw)) return "可观察动作";
  if (/传闻|待核验|未核验/.test(raw)) return "传闻／待核验";
  return "二手报道";
}

function normalizeSuggestedAction(value, worthFollowing) {
  const raw = String(value || "").trim();
  if (["立即关注", "继续跟踪", "进入深研", "加入候选池", "仅归档"].includes(raw)) return raw;
  if (/立即/.test(raw)) return "立即关注";
  if (/深研|研究/.test(raw)) return "进入深研";
  if (/候选/.test(raw)) return "加入候选池";
  if (/归档|忽略/.test(raw)) return "仅归档";
  return worthFollowing ? "继续跟踪" : "仅归档";
}

function importanceLevel(value) {
  const score = Number(value) || 0;
  if (score >= 9) return "P0-立即关注";
  if (score >= 7) return "P1-重点关注";
  if (score >= 5) return "P2-日常跟踪";
  return "P3-仅归档";
}

function fieldName(field) {
  return String(field?.field_name || field?.fieldName || field?.name || "").trim();
}

function fieldOptions(field) {
  const options = field?.property?.options
    || field?.property?.multiple?.options
    || field?.options
    || [];
  return Array.isArray(options)
    ? options.map((option) => String(option?.name || option?.text || option?.value || option || "").trim()).filter(Boolean)
    : [];
}

function basePayload(response) {
  const direct = response?.data ?? response ?? {};
  if (
    direct
    && typeof direct === "object"
    && !Array.isArray(direct)
    && !direct.items
    && !direct.records
    && !direct.fields
    && direct.data
    && typeof direct.data === "object"
    && !Array.isArray(direct.data)
  ) {
    return direct.data;
  }
  return direct;
}

function baseRecordRows(response) {
  const data = basePayload(response);
  const items = data?.items || data?.records;
  if (Array.isArray(items)) return items;
  if (!Array.isArray(data?.fields) || !Array.isArray(data?.data)) return [];
  const names = data.fields.map((field) => fieldName(field) || String(field));
  const ids = data.record_id_list || data.recordIds || [];
  return data.data.map((row, index) => ({
    record_id: String(ids[index] || ""),
    fields: Object.fromEntries(names.map((name, fieldIndex) => [name, row[fieldIndex]]))
  }));
}

function fieldList(response) {
  const data = basePayload(response);
  if (Array.isArray(data)) return data;
  return data?.items || data?.fields || [];
}

function cellScalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return value;
  return value.link
    ?? value.url
    ?? value.text
    ?? value.name
    ?? value.value
    ?? value.id
    ?? "";
}

function cellText(value) {
  if (Array.isArray(value)) return value.map((item) => cellText(item)).join("");
  return String(cellScalar(value) ?? "").trim();
}

function equalCellValue(expected, actual) {
  if (Array.isArray(expected)) {
    const actualItems = Array.isArray(actual) ? actual : actual === null || actual === undefined ? [] : [actual];
    const normalize = (items) => items
      .map((item) => comparableText(cellScalar(item)))
      .filter(Boolean)
      .sort();
    return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actualItems));
  }
  if (typeof expected === "boolean") {
    const scalar = cellScalar(actual);
    return (scalar === true || scalar === 1 || scalar === "true") === expected;
  }
  if (typeof expected === "number") return Math.abs((Number(cellScalar(actual)) || 0) - expected) < 0.0001;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(expected))) {
    if (String(actual).trim() === String(expected)) return true;
    const expectedTimestamp = Date.parse(`${String(expected).replace(" ", "T")}+08:00`);
    const actualTimestamp = Number(cellScalar(actual)) || Date.parse(String(cellScalar(actual)));
    return Number.isFinite(actualTimestamp) && Math.abs(actualTimestamp - expectedTimestamp) < 1000;
  }
  return cellText(actual) === String(expected ?? "").trim();
}

function verifyFieldMap(record, expectedFields) {
  const actualFields = record?.fields || {};
  return Object.entries(expectedFields).every(([name, expected]) =>
    equalCellValue(expected, actualFields[name])
  );
}

function parseWikiFolderMap(markdown) {
  const bySubdomain = new Map();
  let domainHeading = "";
  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      domainHeading = heading[1].trim();
      continue;
    }
    if (!rawLine.trim().startsWith("|")) continue;
    const cells = rawLine
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const [folderTitle, canonicalRaw] = cells;
    if (!folderTitle || /^[-:]+$/.test(folderTitle) || /Wiki 文件夹名|文件夹名/.test(folderTitle)) continue;
    if (!canonicalRaw || /\*\(null/.test(canonicalRaw) || canonicalRaw === "子领域" || canonicalRaw === "领域映射") continue;
    const canonical = canonicalRaw.replace(/\*+/g, "").trim();
    const entries = bySubdomain.get(canonical) || [];
    entries.push({ folderTitle, domainHeading });
    bySubdomain.set(canonical, entries);
  }
  return bySubdomain;
}

function isPathInside(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function scanMarkdownFiles(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  const files = [];
  const pending = [path.resolve(rootPath)];
  while (pending.length && files.length < MAX_PROJECT_DOCUMENTS) {
    const current = pending.pop();
    let children = [];
    try {
      children = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (child.name.startsWith(".")) continue;
      const childPath = path.join(current, child.name);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) pending.push(childPath);
      if (child.isFile() && [".md", ".markdown"].includes(path.extname(child.name).toLowerCase())) {
        files.push(childPath);
      }
      if (files.length >= MAX_PROJECT_DOCUMENTS) break;
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function projectDocuments(project, libraryRoot = "") {
  const rawHomepage = String(project.documentPath || "").trim();
  if (!rawHomepage) return [];
  const homepage = path.resolve(rawHomepage);
  if (libraryRoot && !isPathInside(libraryRoot, homepage)) return [];
  try {
    const stat = fs.lstatSync(homepage);
    if (!stat.isFile() || stat.isSymbolicLink()) return [];
  } catch {
    return [];
  }
  const projectRoot = path.dirname(homepage);
  const files = new Set([homepage]);
  for (const document of project.documents || []) {
    if (document.path && isPathInside(projectRoot, document.path)) files.add(path.resolve(document.path));
  }
  for (const filePath of scanMarkdownFiles(projectRoot)) files.add(filePath);
  const titleCounts = new Map();
  const documents = [...files]
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile())
    .map((filePath) => {
      const registered = (project.documents || []).find((item) =>
        item.path && path.resolve(item.path) === filePath
      );
      const homepageDocument = filePath === homepage;
      const baseTitle = homepageDocument
        ? project.name
        : String(registered?.title || path.basename(filePath, path.extname(filePath))).trim();
      titleCounts.set(baseTitle, (titleCounts.get(baseTitle) || 0) + 1);
      return {
        path: filePath,
        relativePath: path.relative(projectRoot, filePath),
        kind: registered?.kind || (homepageDocument ? "项目主页" : path.basename(path.dirname(filePath))),
        baseTitle,
        homepage: homepageDocument,
        projectRoot
      };
    });
  return documents
    .map((document) => ({
      ...document,
      title: titleCounts.get(document.baseTitle) > 1 && !document.homepage
        ? `${document.kind} · ${document.baseTitle}`
        : document.baseTitle
    }))
    .sort((left, right) => Number(right.homepage) - Number(left.homepage)
      || left.relativePath.localeCompare(right.relativePath, "zh-CN"));
}

function prepareMarkdownDocument(document, libraryRoot) {
  const stat = fs.statSync(document.path);
  if (stat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`${document.relativePath} 超过 8 MB，无法安全导入飞书在线文档。`);
  }
  const original = fs.readFileSync(document.path, "utf8");
  const prepared = prepareMarkdownForFeishu({
    markdown: original,
    sourcePath: document.path,
    libraryRoot,
    title: document.title
  });
  return {
    ...document,
    ...prepared
  };
}

function createdDocument(response) {
  const data = responseData(response);
  const document = data.document || data.doc || data;
  return {
    documentId: String(document.document_id || document.documentId || document.obj_token || ""),
    nodeToken: String(document.node_token || document.nodeToken || ""),
    url: wikiNodeUrl(document) || wikiNodeUrl(data)
  };
}

function nodeFromResponse(response) {
  const data = responseData(response);
  return data.node || data.item || data;
}

class LocalToFeishuMigration {
  constructor({ repository, runLark, pluginRoot, libraryRoot, now = () => Date.now() }) {
    this.repository = repository;
    this.runLark = runLark;
    this.pluginRoot = pluginRoot;
    this.libraryRoot = path.resolve(libraryRoot);
    this.now = now;
    this.nodes = [];
    this.nodeByToken = new Map();
    this.folderMap = new Map();
  }

  preview() {
    const projects = this.repository.listMigrationProjects();
    const people = this.repository.listMigrationPeople();
    const news = this.repository.listMigrationNews();
    const planned = projects.map((project) => ({
      projectId: project.id,
      name: project.name,
      domain: project.domain,
      subdomains: project.subdomains,
      documentCount: projectDocuments(project, this.libraryRoot).length
    }));
    return {
      ok: true,
      projectCount: planned.length,
      peopleCount: people.length,
      newsCount: news.length,
      documentCount: planned.reduce((total, project) => total + project.documentCount, 0),
      projects: planned
    };
  }

  async wikiChildren(spaceId, parentNodeToken = "") {
    const args = [
      "wiki",
      "+node-list",
      "--space-id",
      spaceId,
      "--page-all",
      "--page-limit",
      "0",
      "--format",
      "json"
    ];
    if (parentNodeToken) args.push("--parent-node-token", parentNodeToken);
    return responseItems(await this.runLark(args, { timeout: 120000 }));
  }

  rememberNodes(nodes, fallbackParentToken = "") {
    for (const rawNode of nodes || []) {
      const token = wikiNodeToken(rawNode);
      if (!token || this.nodeByToken.has(token)) continue;
      const node = {
        raw: rawNode,
        token,
        title: wikiNodeTitle(rawNode),
        parentToken: wikiParentToken(rawNode) || fallbackParentToken,
        documentId: wikiDocumentId(rawNode),
        hasChild: rawNode.has_child ?? rawNode.hasChild
      };
      this.nodes.push(node);
      this.nodeByToken.set(token, node);
    }
  }

  async loadWikiTree(spaceId) {
    const roots = await this.wikiChildren(spaceId);
    this.rememberNodes(roots);
    const queue = this.nodes.map((node) => ({ node, depth: 0 }));
    let calls = 0;
    while (queue.length && this.nodes.length < MAX_WIKI_NODES && calls < 500) {
      const { node, depth } = queue.shift();
      if (depth >= 3 || node.hasChild === false) continue;
      const children = await this.wikiChildren(spaceId, node.token);
      calls += 1;
      const before = this.nodes.length;
      this.rememberNodes(children, node.token);
      for (const child of this.nodes.slice(before)) queue.push({ node: child, depth: depth + 1 });
    }
    return this.nodes;
  }

  loadFolderMap() {
    const filePath = path.join(
      this.pluginRoot,
      "skills",
      "investment-mgmt",
      "references",
      "folder_map.md"
    );
    this.folderMap = parseWikiFolderMap(fs.readFileSync(filePath, "utf8"));
  }

  ancestorTitles(node) {
    const titles = [];
    let parentToken = node.parentToken;
    for (let depth = 0; parentToken && depth < 8; depth += 1) {
      const parent = this.nodeByToken.get(parentToken);
      if (!parent) break;
      titles.push(parent.title);
      parentToken = parent.parentToken;
    }
    return titles;
  }

  resolveProjectFolder(project) {
    const primarySubdomain = String(project.subdomains?.[0] || "").trim();
    const mapped = this.folderMap.get(primarySubdomain) || [];
    const candidateTitles = [
      ...mapped.map((entry) => entry.folderTitle),
      primarySubdomain,
      primarySubdomain ? `${primarySubdomain}行业` : "",
      project.domain,
      project.domain ? `${project.domain}行业` : ""
    ].filter(Boolean);
    const normalizedCandidates = new Set(candidateTitles.map(comparableText));
    const candidates = this.nodes.filter((node) => normalizedCandidates.has(comparableText(node.title)));
    if (!candidates.length && primarySubdomain) {
      candidates.push(...this.nodes.filter((node) =>
        comparableText(node.title).includes(comparableText(primarySubdomain))
      ));
    }
    if (!candidates.length) return null;
    const normalizedDomain = comparableText(project.domain);
    return candidates
      .map((node) => ({
        node,
        score: (comparableText(node.title) === comparableText(candidateTitles[0]) ? 100 : 0)
          + (this.ancestorTitles(node).some((title) =>
            comparableText(title).includes(normalizedDomain)
          ) ? 30 : 0)
      }))
      .sort((left, right) => right.score - left.score || left.node.title.localeCompare(right.node.title, "zh-CN"))[0]
      .node;
  }

  childNode(parentToken, title) {
    const comparableTitle = comparableText(title);
    return this.nodes.find((node) =>
      node.parentToken === parentToken && comparableText(node.title) === comparableTitle
    ) || null;
  }

  async resolveCreatedNode(document, spaceId, parentToken, title) {
    if (document.nodeToken) {
      return {
        token: document.nodeToken,
        title,
        parentToken,
        documentId: document.documentId,
        url: document.url
      };
    }
    const response = await this.runLark([
      "wiki",
      "+node-get",
      "--node-token",
      document.documentId,
      "--obj-type",
      "docx",
      "--space-id",
      spaceId,
      "--format",
      "json"
    ]);
    const rawNode = nodeFromResponse(response);
    return {
      token: wikiNodeToken(rawNode),
      title: wikiNodeTitle(rawNode) || title,
      parentToken: wikiParentToken(rawNode) || parentToken,
      documentId: wikiDocumentId(rawNode) || document.documentId,
      url: wikiNodeUrl(rawNode)
    };
  }

  async verifyDocument(documentId) {
    const fetched = await this.runLark([
      "docs",
      "+fetch",
      "--doc",
      documentId,
      "--doc-format",
      "markdown",
      "--format",
      "json"
    ], { timeout: 120000 });
    const document = responseData(fetched).document || responseData(fetched);
    return Boolean(document.document_id || document.documentId || document.content !== undefined);
  }

  async verifyDocumentFidelity(documentId, prepared) {
    const fetched = await this.runLark([
      "docs",
      "+fetch",
      "--doc",
      documentId,
      "--doc-format",
      "markdown",
      "--format",
      "json"
    ], { timeout: 120000 });
    const data = responseData(fetched);
    const document = data.document || data;
    if (!(document.document_id || document.documentId || document.content !== undefined)) {
      return {
        status: "failed",
        textCoverage: 0,
        missingTextSamples: [],
        sourceFeatures: prepared.fidelity?.featureCounts || {},
        targetFeatures: {},
        message: "飞书未返回可识别的目标文档。"
      };
    }
    return verifyFeishuMarkdownImport({
      prepared,
      fetchedMarkdown: typeof document.content === "string" ? document.content : undefined
    });
  }

  async writeDocumentContent({ prepared, parentToken, spaceId }) {
    if (prepared.fidelity?.status === "blocked") {
      const reasons = prepared.fidelity.degradations
        .filter((item) => item.severity === "error")
        .map((item) => item.message)
        .join("；");
      throw new Error(`飞书导入预检未通过：${reasons || "存在无法无损处理的本地资源。"}`);
    }
    const previous = this.repository.getDocumentMigration(prepared.path, spaceId);
    let document = {
      documentId: String(previous?.target_document_id || ""),
      nodeToken: String(previous?.target_node_token || ""),
      url: String(previous?.target_url || "")
    };
    if (
      previous?.status === "complete"
      && previous.source_sha256 === prepared.sourceSha256
      && document.documentId
      && await this.verifyDocument(document.documentId)
    ) {
      return {
        ...document,
        skipped: true,
        assetCount: prepared.assets.length,
        fidelity: prepared.fidelity,
        verification: {
          status: "skipped-unchanged",
          textCoverage: 1,
          missingTextSamples: [],
          sourceFeatures: prepared.fidelity?.featureCounts || {},
          targetFeatures: {},
          message: "源文件及图片哈希未变化，沿用上次已完成的飞书副本。"
        }
      };
    }
    if (!document.documentId) {
      const conflict = this.childNode(parentToken, prepared.title);
      if (conflict) {
        throw new Error(`飞书目标目录已存在同名文档《${prepared.title}》，且它不是由本次迁移创建。`);
      }
    }
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-migration-"));
    try {
      fs.writeFileSync(path.join(temporaryDirectory, "content.md"), prepared.content, "utf8");
      if (document.documentId) {
        await this.runLark([
          "docs",
          "+update",
          "--doc",
          document.documentId,
          "--command",
          "overwrite",
          "--doc-format",
          "markdown",
          "--content",
          "@content.md",
          "--format",
          "json"
        ], { cwd: temporaryDirectory, timeout: 180000 });
      } else {
        const created = await this.runLark([
          "docs",
          "+create",
          "--doc-format",
          "markdown",
          "--title",
          prepared.title,
          "--content",
          "@content.md",
          "--parent-token",
          parentToken,
          "--format",
          "json"
        ], { cwd: temporaryDirectory, timeout: 180000 });
        document = createdDocument(created);
        if (!document.documentId) throw new Error(`飞书创建《${prepared.title}》后没有返回文档 ID。`);
      }
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    const resolvedNode = await this.resolveCreatedNode(document, spaceId, parentToken, prepared.title);
    document.nodeToken = resolvedNode.token;
    document.documentId = resolvedNode.documentId || document.documentId;
    document.url = document.url || resolvedNode.url;
    if (!/^https?:\/\//i.test(document.url)) {
      throw new Error(`飞书创建《${prepared.title}》后没有返回可访问的在线文档链接。`);
    }
    this.repository.saveDocumentMigration({
      sourcePath: prepared.path,
      targetSpaceId: spaceId,
      sourceSha256: prepared.sourceSha256,
      targetDocumentId: document.documentId,
      targetNodeToken: document.nodeToken,
      targetUrl: document.url,
      status: "pending",
      migratedAt: this.now()
    });
    for (const asset of prepared.assets) {
      await placeFeishuAssetAtMarker({
        runLark: this.runLark,
        documentId: document.documentId,
        asset
      });
    }
    const verification = await this.verifyDocumentFidelity(document.documentId, prepared);
    if (verification.status === "failed") {
      const missing = verification.missingTextSamples?.length
        ? `；缺失样例：${verification.missingTextSamples.join("、")}`
        : "";
      throw new Error(`飞书文档《${prepared.title}》导入后验证失败：${verification.message}${missing}`);
    }
    this.repository.saveDocumentMigration({
      sourcePath: prepared.path,
      targetSpaceId: spaceId,
      sourceSha256: prepared.sourceSha256,
      targetDocumentId: document.documentId,
      targetNodeToken: document.nodeToken,
      targetUrl: document.url,
      status: "complete",
      migratedAt: this.now()
    });
    if (document.nodeToken && !this.nodeByToken.has(document.nodeToken)) {
      const node = {
        token: document.nodeToken,
        title: prepared.title,
        parentToken,
        documentId: document.documentId,
        hasChild: false
      };
      this.nodes.push(node);
      this.nodeByToken.set(node.token, node);
    }
    return {
      ...document,
      skipped: false,
      assetCount: prepared.assets.length,
      fidelity: prepared.fidelity,
      verification
    };
  }

  async inspectBase({ baseToken, tableId, label, requiredFields }) {
    const response = await this.runLark([
      "base",
      "+field-list",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--limit",
      "200",
      "--format",
      "json"
    ]);
    const fields = fieldList(response);
    const byName = new Map(fields.map((field) => [fieldName(field), field]).filter(([name]) => name));
    const missing = requiredFields.filter((name) => !byName.has(name));
    if (missing.length) {
      throw new Error(`${label}缺少迁移字段：${missing.join("、")}。`);
    }
    return byName;
  }

  assertOptionValues(fieldMap, field, values, label) {
    const allowed = fieldOptions(fieldMap.get(field));
    if (!allowed.length) return;
    const allowedComparable = new Set(allowed.map(comparableText));
    const invalid = [...new Set((values || []).map(String).map((value) => value.trim()).filter(Boolean))]
      .filter((value) => !allowedComparable.has(comparableText(value)));
    if (invalid.length) {
      throw new Error(`${label}的“${field}”包含目标表未配置的选项：${invalid.join("、")}。`);
    }
  }

  async inspectTargets(target, { projects, people, news }) {
    const projectFields = await this.inspectBase({
      baseToken: target.projectBaseToken,
      tableId: target.projectTableId,
      label: "项目 Watching List",
      requiredFields: ["公司名称", "领域", "子领域", "进展状态", "链接"]
    });
    const peopleFields = await this.inspectBase({
      baseToken: target.peopleBaseToken,
      tableId: target.peopleTableId,
      label: "People 人脉库",
      requiredFields: ["人名"]
    });
    const newsFields = await this.inspectBase({
      baseToken: target.radarBaseToken,
      tableId: target.radarTableId,
      label: "行业动态库",
      requiredFields: [
        "新闻标题", "领域", "信息类型", "信息发布时间", "新闻核心内容", "投资含义",
        "原文链接", "来源名称", "重要性评分", "重要性等级", "可信度", "证据状态",
        "是否值得关注", "建议动作", "事件ID", "扫描批次"
      ]
    });
    this.assertOptionValues(projectFields, "领域", projects.map((project) => project.domain), "本地项目");
    this.assertOptionValues(
      projectFields,
      "子领域",
      projects.flatMap((project) => project.subdomains || []),
      "本地项目"
    );
    this.assertOptionValues(
      projectFields,
      "进展状态",
      projects.map((project) => normalizeStatus(project.status)),
      "本地项目"
    );
    this.assertOptionValues(
      peopleFields,
      "类型",
      people.flatMap((person) => person.types?.slice(0, 1) || []),
      "本地人脉"
    );
    this.assertOptionValues(peopleFields, "进展状态", people.map((person) => person.status), "本地人脉");
    this.assertOptionValues(peopleFields, "评级", people.map((person) => person.rating), "本地人脉");
    this.assertOptionValues(peopleFields, "城市", people.flatMap((person) => person.cities || []), "本地人脉");
    this.assertOptionValues(newsFields, "领域", news.flatMap((event) => event.domains || []), "本地行业动态");
    this.assertOptionValues(newsFields, "子领域", news.flatMap((event) => event.subdomains || []), "本地行业动态");
    this.assertOptionValues(newsFields, "信息类型", news.flatMap((event) => event.types || []), "本地行业动态");
    this.assertOptionValues(
      newsFields,
      "重要性等级",
      news.map((event) => importanceLevel(event.importance)),
      "本地行业动态"
    );
    this.assertOptionValues(
      newsFields,
      "证据状态",
      news.map((event) => normalizeEvidenceStatus(event.evidenceStatus)),
      "本地行业动态"
    );
    this.assertOptionValues(
      newsFields,
      "建议动作",
      news.map((event) => normalizeSuggestedAction(event.action, event.worthFollowing)),
      "本地行业动态"
    );
    this.baseFields = { project: projectFields, people: peopleFields, news: newsFields };
  }

  async searchExactRecords({ baseToken, tableId, keyField, keyValue, fieldNames }) {
    const response = await this.runLark([
      "base",
      "+record-list",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--filter-json",
      JSON.stringify({
        logic: "and",
        conditions: [[keyField, "==", keyValue]]
      }),
      ...fieldNames.flatMap((field) => ["--field-id", field]),
      "--limit",
      "20",
      "--format",
      "json"
    ]);
    return baseRecordRows(response).filter((record) =>
      comparableText(cellText(record.fields?.[keyField])) === comparableText(keyValue)
    );
  }

  async searchProjectRecords(target, projectName) {
    return this.searchExactRecords({
      baseToken: target.projectBaseToken,
      tableId: target.projectTableId,
      keyField: "公司名称",
      keyValue: projectName,
      fieldNames: [...this.baseFields.project.keys()]
        .filter((field) => field !== "最后更新时间")
    });
  }

  existingFieldMap(kind, fields) {
    const schema = this.baseFields?.[kind] || new Map();
    return Object.fromEntries(
      Object.entries(fields).filter(([name, value]) =>
        schema.has(name) && value !== "" && value !== null && value !== undefined
      )
    );
  }

  async upsertProjectRecord(project, target, documentUrl) {
    const existing = await this.searchProjectRecords(target, project.name);
    if (existing.length > 1) {
      throw new Error(`Watching List 中存在 ${existing.length} 条同名项目“${project.name}”，请先合并重复记录。`);
    }
    const fields = this.existingFieldMap("project", {
      "公司名称": project.name,
      "领域": project.domain,
      "子领域": project.subdomains,
      "进展状态": normalizeStatus(project.status),
      "链接": documentUrl,
      "Notes": project.notes,
      "项目评级": project.rating,
      "城市": project.cities?.length ? project.cities : "",
      "投资机构": project.investors?.length ? project.investors : ""
    });
    const args = [
      "base",
      "+record-upsert",
      "--base-token",
      target.projectBaseToken,
      "--table-id",
      target.projectTableId,
      "--json",
      JSON.stringify(fields),
      "--format",
      "json"
    ];
    const recordId = String(existing[0]?.record_id || existing[0]?.recordId || "");
    if (recordId) args.push("--record-id", recordId);
    await this.runLark(args, { timeout: 120000 });
    const verified = await this.searchProjectRecords(target, project.name);
    if (verified.length !== 1 || !verifyFieldMap(verified[0], fields)) {
      throw new Error(`Watching List 项目“${project.name}”写入后回读验证失败。`);
    }
    return {
      recordId: String(verified[0].record_id || verified[0].recordId || ""),
      created: !recordId
    };
  }

  async searchPeopleRecords(target, person) {
    const records = await this.searchExactRecords({
      baseToken: target.peopleBaseToken,
      tableId: target.peopleTableId,
      keyField: "人名",
      keyValue: person.name,
      fieldNames: ["人名", "所属组织&身份", "类型", "进展状态", "评级", "最后联系日期", "城市"]
        .filter((field) => this.baseFields.people.has(field))
    });
    if (!records.length) return [];
    const sameOrganization = records.filter((record) =>
      comparableText(cellText(record.fields?.["所属组织&身份"])) === comparableText(person.organization)
    );
    if (sameOrganization.length === 1) return sameOrganization;
    if (
      records.length === 1
      && (!person.organization || !cellText(records[0].fields?.["所属组织&身份"]))
    ) {
      return records;
    }
    throw new Error(`People 人脉库中存在无法唯一匹配的同名记录“${person.name}”，请先补充或整理所属组织。`);
  }

  personFields(person) {
    return this.existingFieldMap("people", {
      "人名": person.name,
      "类型": person.types?.length ? person.types.slice(0, 1) : "",
      "所属组织&身份": person.organization,
      "进展状态": person.status,
      "评级": person.rating,
      "最后联系日期": formatFeishuDateTime(person.lastContactAt),
      "城市": person.cities?.length ? person.cities : ""
    });
  }

  async migratePerson(person, target) {
    if (!String(person.name || "").trim()) throw new Error("本地人脉缺少姓名。");
    const existing = await this.searchPeopleRecords(target, person);
    const fields = this.personFields(person);
    const args = [
      "base",
      "+record-upsert",
      "--base-token",
      target.peopleBaseToken,
      "--table-id",
      target.peopleTableId,
      "--json",
      JSON.stringify(fields),
      "--format",
      "json"
    ];
    const recordId = String(existing[0]?.record_id || existing[0]?.recordId || "");
    if (recordId) args.push("--record-id", recordId);
    await this.runLark(args, { timeout: 120000 });
    const verified = await this.searchPeopleRecords(target, person);
    if (verified.length !== 1 || !verifyFieldMap(verified[0], fields)) {
      throw new Error(`People 人脉“${person.name}”写入后回读验证失败。`);
    }
    return {
      id: person.id,
      name: person.name,
      recordId: String(verified[0].record_id || verified[0].recordId || ""),
      created: !recordId
    };
  }

  validateNews(event) {
    const missing = [
      ["事件ID", event.eventId],
      ["新闻标题", event.title],
      ["领域", event.domains?.length],
      ["信息类型", event.types?.length],
      ["信息发布时间", event.publishedAt],
      ["新闻核心内容", event.summary],
      ["原文链接", event.url],
      ["来源名称", event.source]
    ].filter(([, value]) => !value).map(([field]) => field);
    if (event.worthFollowing && !String(event.investmentMeaning || "").trim()) missing.push("投资含义");
    if (missing.length) throw new Error(`缺少必填字段：${missing.join("、")}。`);
    if (event.importance < 1 || event.importance > 10) throw new Error("重要性评分必须在 1–10 之间。");
    if (event.confidence < 1 || event.confidence > 10) throw new Error("可信度必须在 1–10 之间。");
  }

  newsFields(event, { creating }) {
    const fields = this.existingFieldMap("news", {
      "新闻标题": event.title,
      "领域": event.domains,
      "子领域": event.subdomains?.length ? event.subdomains : "",
      "信息类型": event.types,
      "信息发布时间": formatFeishuDateTime(event.publishedAt),
      "新闻核心内容": event.summary,
      "投资含义": event.investmentMeaning,
      "原文链接": event.url,
      "来源名称": event.source,
      "涉及公司": event.companies,
      "涉及机构": event.institutions,
      "重要性评分": event.importance,
      "重要性等级": importanceLevel(event.importance),
      "可信度": event.confidence,
      "证据状态": normalizeEvidenceStatus(event.evidenceStatus),
      "是否值得关注": event.worthFollowing,
      "建议动作": normalizeSuggestedAction(event.action, event.worthFollowing),
      "事件ID": event.eventId,
      "扫描批次": creating ? "本地资料库迁移" : ""
    });
    return fields;
  }

  async searchNewsRecords(target, eventId) {
    return this.searchExactRecords({
      baseToken: target.radarBaseToken,
      tableId: target.radarTableId,
      keyField: "事件ID",
      keyValue: eventId,
      fieldNames: [...this.baseFields.news.keys()]
        .filter((field) => !["收录时间", "最后更新时间"].includes(field))
    });
  }

  async migrateNewsEvent(event, target) {
    this.validateNews(event);
    const existing = await this.searchNewsRecords(target, event.eventId);
    if (existing.length > 1) {
      throw new Error(`行业动态库中存在 ${existing.length} 条事件ID为“${event.eventId}”的记录，请先合并重复项。`);
    }
    const fields = this.newsFields(event, { creating: existing.length === 0 });
    const args = [
      "base",
      "+record-upsert",
      "--base-token",
      target.radarBaseToken,
      "--table-id",
      target.radarTableId,
      "--json",
      JSON.stringify(fields),
      "--format",
      "json"
    ];
    const recordId = String(existing[0]?.record_id || existing[0]?.recordId || "");
    if (recordId) args.push("--record-id", recordId);
    await this.runLark(args, { timeout: 120000 });
    const verified = await this.searchNewsRecords(target, event.eventId);
    if (verified.length !== 1 || !verifyFieldMap(verified[0], fields)) {
      throw new Error(`行业动态“${event.title}”写入后回读验证失败。`);
    }
    return {
      eventId: event.eventId,
      title: event.title,
      recordId: String(verified[0].record_id || verified[0].recordId || ""),
      created: !recordId
    };
  }

  async migrateProject(project, target) {
    const targetFolder = this.resolveProjectFolder(project);
    if (!targetFolder) {
      throw new Error(`没有在飞书 Wiki 中找到“${project.domain} / ${project.subdomains?.[0] || "未分类"}”对应文件夹。`);
    }
    const documents = projectDocuments(project, this.libraryRoot);
    if (!documents.length) throw new Error("项目没有可迁移的 Markdown 文档。");
    const homepage = prepareMarkdownDocument(documents[0], this.libraryRoot);
    const homepageResult = await this.writeDocumentContent({
      prepared: homepage,
      parentToken: targetFolder.token,
      spaceId: target.wikiSpaceId
    });
    const childParentToken = homepageResult.nodeToken || targetFolder.token;
    const migratedDocuments = [{
      title: homepage.title,
      path: homepage.path,
      url: homepageResult.url,
      skipped: homepageResult.skipped,
      assetCount: homepageResult.assetCount,
      fidelity: homepageResult.fidelity,
      verification: homepageResult.verification
    }];
    for (const document of documents.slice(1)) {
      const prepared = prepareMarkdownDocument(document, this.libraryRoot);
      const result = await this.writeDocumentContent({
        prepared,
        parentToken: childParentToken,
        spaceId: target.wikiSpaceId
      });
      migratedDocuments.push({
        title: prepared.title,
        path: prepared.path,
        url: result.url,
        skipped: result.skipped,
        assetCount: result.assetCount,
        fidelity: result.fidelity,
        verification: result.verification
      });
    }
    const record = await this.upsertProjectRecord(project, target, homepageResult.url);
    return {
      projectId: project.id,
      name: project.name,
      recordId: record.recordId,
      documentUrl: homepageResult.url,
      documents: migratedDocuments
    };
  }

  async run(target) {
    for (const key of [
      "projectBaseToken", "projectTableId", "peopleBaseToken", "peopleTableId",
      "radarBaseToken", "radarTableId", "wikiSpaceId"
    ]) {
      if (!String(target[key] || "").trim()) throw new Error(`飞书迁移缺少 ${key}。`);
    }
    const projects = this.repository.listMigrationProjects();
    const people = this.repository.listMigrationPeople();
    const news = this.repository.listMigrationNews();
    await this.inspectTargets(target, { projects, people, news });
    if (projects.length) {
      this.loadFolderMap();
      await this.loadWikiTree(target.wikiSpaceId);
    }
    const migratedProjects = [];
    const migratedPeople = [];
    const migratedNews = [];
    const failed = [];
    for (const project of projects) {
      try {
        migratedProjects.push(await this.migrateProject(project, target));
      } catch (error) {
        failed.push({
          kind: "project",
          id: project.id,
          name: project.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    for (const person of people) {
      try {
        migratedPeople.push(await this.migratePerson(person, target));
      } catch (error) {
        failed.push({
          kind: "person",
          id: person.id,
          name: person.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    for (const event of news) {
      try {
        migratedNews.push(await this.migrateNewsEvent(event, target));
      } catch (error) {
        failed.push({
          kind: "news",
          id: event.eventId,
          name: event.title,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return {
      ok: failed.length === 0,
      projectCount: projects.length,
      migratedProjectCount: migratedProjects.length,
      peopleCount: people.length,
      migratedPeopleCount: migratedPeople.length,
      newsCount: news.length,
      migratedNewsCount: migratedNews.length,
      documentCount: migratedProjects.reduce((total, item) => total + item.documents.length, 0),
      assetCount: migratedProjects.reduce(
        (total, item) => total + item.documents.reduce((sum, document) => sum + document.assetCount, 0),
        0
      ),
      fidelityReport: {
        documentCount: migratedProjects.reduce((total, item) => total + item.documents.length, 0),
        verifiedCount: migratedProjects.reduce(
          (total, item) => total + item.documents.filter((document) =>
            ["passed", "skipped-unchanged"].includes(document.verification?.status)
          ).length,
          0
        ),
        warningCount: migratedProjects.reduce(
          (total, item) => total + item.documents.filter((document) =>
            ["warning", "unverified"].includes(document.verification?.status)
            || document.fidelity?.status === "ready-with-warnings"
          ).length,
          0
        ),
        documents: migratedProjects.flatMap((project) => project.documents.map((document) => ({
          projectId: project.projectId,
          projectName: project.name,
          title: document.title,
          path: document.path,
          url: document.url,
          preparation: document.fidelity,
          verification: document.verification
        })))
      },
      migrated: migratedProjects,
      migratedProjects,
      migratedPeople,
      migratedNews,
      failed,
      error: failed.length
        ? `${failed.length} 条本地资料迁移失败；资料库仍保持本地模式。${failed.slice(0, 3).map((item) => `${item.name}：${item.error}`).join("；")}`
        : ""
    };
  }
}

module.exports = {
  LocalToFeishuMigration,
  baseRecordRows,
  comparableText,
  formatFeishuDateTime,
  importanceLevel,
  normalizeEvidenceStatus,
  normalizeSuggestedAction,
  parseWikiFolderMap,
  prepareMarkdownDocument,
  projectDocuments,
  responseItems
};
