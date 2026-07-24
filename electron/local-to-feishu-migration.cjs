const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
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

function stripFrontmatter(markdown) {
  const normalized = String(markdown || "").replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) return normalized;
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? normalized.slice(match[0].length) : normalized;
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

function resolveMarkdownAsset(documentPath, rawTarget, libraryRoot) {
  const target = String(rawTarget || "").trim().replace(/^<|>$/g, "");
  if (!target || /^(?:https?:|data:|mailto:|#)/i.test(target)) return null;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // Keep the literal target when it is not URI encoded.
  }
  const withoutAnchor = decoded.split("#")[0].split("?")[0];
  const absolutePath = path.resolve(path.dirname(documentPath), withoutAnchor);
  if (!isPathInside(libraryRoot, absolutePath)) {
    return { missing: true, path: absolutePath, reason: "资料库外部路径" };
  }
  try {
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { missing: true, path: absolutePath, reason: "不是普通文件" };
    }
  } catch {
    return { missing: true, path: absolutePath, reason: "文件不存在" };
  }
  return { missing: false, path: absolutePath };
}

function prepareMarkdownDocument(document, libraryRoot) {
  const stat = fs.statSync(document.path);
  if (stat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`${document.relativePath} 超过 8 MB，无法安全导入飞书在线文档。`);
  }
  const original = fs.readFileSync(document.path, "utf8");
  const assets = [];
  let assetIndex = 0;
  const imagePattern = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let content = stripFrontmatter(original).replace(imagePattern, (fullMatch, altText, target) => {
    const extension = path.extname(String(target || "").replace(/^<|>$/g, "").split(/[?#]/)[0]).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension) || /^(?:https?:|data:)/i.test(target)) return fullMatch;
    const resolved = resolveMarkdownAsset(document.path, target, libraryRoot);
    const caption = String(altText || path.basename(String(target).replace(/^<|>$/g, ""))).trim() || "图片";
    if (!resolved || resolved.missing) return `> 本地图片未迁移：${caption}（${resolved?.reason || "无法解析"}）`;
    assetIndex += 1;
    const marker = `Domi迁移图片${assetIndex}-${crypto.createHash("sha1").update(resolved.path).digest("hex").slice(0, 8)}`;
    assets.push({ path: resolved.path, caption, marker, type: "image" });
    return `> ${marker} · ${caption}`;
  });
  if (!content.trim()) content = `# ${document.title}\n`;
  if (!content.endsWith("\n")) content += "\n";
  const hash = crypto.createHash("sha256").update(original);
  for (const asset of assets) hash.update(fs.readFileSync(asset.path));
  return {
    ...document,
    content,
    assets,
    sourceSha256: hash.digest("hex")
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

  async writeDocumentContent({ prepared, parentToken, spaceId }) {
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
      return { ...document, skipped: true, assetCount: prepared.assets.length };
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
      await this.runLark([
        "docs",
        "+media-insert",
        "--doc",
        document.documentId,
        "--file",
        path.basename(asset.path),
        "--type",
        asset.type,
        "--selection-with-ellipsis",
        asset.marker,
        "--before",
        "--caption",
        asset.caption,
        "--align",
        "center",
        "--format",
        "json"
      ], { cwd: path.dirname(asset.path), timeout: 180000 });
    }
    if (!await this.verifyDocument(document.documentId)) {
      throw new Error(`飞书文档《${prepared.title}》创建后回读失败。`);
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
    return { ...document, skipped: false, assetCount: prepared.assets.length };
  }

  async searchProjectRecords(target, projectName) {
    const response = await this.runLark([
      "api",
      "POST",
      `/open-apis/bitable/v1/apps/${target.projectBaseToken}/tables/${target.projectTableId}/records/search`,
      "--data",
      JSON.stringify({
        filter: {
          conjunction: "and",
          conditions: [{
            field_name: "公司名称",
            operator: "contains",
            value: [projectName]
          }]
        },
        field_names: ["公司名称", "链接"],
        page_size: 20
      }),
      "--format",
      "json"
    ]);
    return responseItems(response).filter((record) =>
      comparableText(textValue(record.fields?.["公司名称"])) === comparableText(projectName)
    );
  }

  async upsertProjectRecord(project, target, documentUrl) {
    const existing = await this.searchProjectRecords(target, project.name);
    if (existing.length > 1) {
      throw new Error(`Watching List 中存在 ${existing.length} 条同名项目“${project.name}”，请先合并重复记录。`);
    }
    const fields = {
      "公司名称": project.name,
      "领域": project.domain,
      "子领域": project.subdomains,
      "进展状态": normalizeStatus(project.status),
      "链接": documentUrl
    };
    if (project.notes) fields.Notes = project.notes;
    if (project.rating) fields["项目评级"] = project.rating;
    if (project.cities?.length) fields["城市"] = project.cities;
    if (project.investors?.length) fields["投资机构"] = project.investors;
    if (!existing.length && project.lastUpdatedAt) fields["最后更新时间"] = project.lastUpdatedAt;
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
    if (verified.length !== 1 || textValue(verified[0].fields?.["链接"]).trim() !== documentUrl) {
      throw new Error(`Watching List 项目“${project.name}”写入后回读验证失败。`);
    }
    return {
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
      assetCount: homepageResult.assetCount
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
        assetCount: result.assetCount
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
    for (const key of ["projectBaseToken", "projectTableId", "wikiSpaceId"]) {
      if (!String(target[key] || "").trim()) throw new Error(`飞书迁移缺少 ${key}。`);
    }
    this.loadFolderMap();
    await this.loadWikiTree(target.wikiSpaceId);
    const projects = this.repository.listMigrationProjects();
    const migrated = [];
    const failed = [];
    for (const project of projects) {
      try {
        migrated.push(await this.migrateProject(project, target));
      } catch (error) {
        failed.push({
          projectId: project.id,
          name: project.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return {
      ok: failed.length === 0,
      projectCount: projects.length,
      migratedProjectCount: migrated.length,
      documentCount: migrated.reduce((total, item) => total + item.documents.length, 0),
      assetCount: migrated.reduce(
        (total, item) => total + item.documents.reduce((sum, document) => sum + document.assetCount, 0),
        0
      ),
      migrated,
      failed,
      error: failed.length
        ? `${failed.length} 个项目迁移失败；资料库仍保持本地模式。${failed.slice(0, 3).map((item) => `${item.name}：${item.error}`).join("；")}`
        : ""
    };
  }
}

module.exports = {
  LocalToFeishuMigration,
  comparableText,
  parseWikiFolderMap,
  prepareMarkdownDocument,
  projectDocuments,
  responseItems
};
