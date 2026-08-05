const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const CACHE_VERSION = 1;
const CACHE_PREFIX = "research-cache-v1:project:";
const FRESH_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_MS = 90 * 24 * 60 * 60 * 1000;
const SOURCE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_SUMMARY_CHARS = 6_000;
const MAX_FACT_HIGHLIGHTS = 32;
const MAX_SOURCE_URLS = 40;
const MAX_FILES = 500;
const MAX_DIRECTORIES = 200;
const MAX_ENTRIES = 3_000;
const MAX_DEPTH = 12;
const MAX_SCAN_MS = 300;
const SOURCE_URL_PATTERN = /https?:\/\/[^\s<>()\]"'`]+/gi;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".domi",
  "node_modules",
  "outputs",
  "导出"
]);
const ELIGIBLE_WORKFLOWS = new Set([
  "domi-analyst",
  "meeting-prep",
  "project-research",
  "project-intake",
  "desk-research",
  "investment-review",
  "investment-analysis",
  "ic-memo",
  "investment-mgmt",
  "deal-negotiation"
]);
const CACHE_WRITE_WORKFLOWS = new Set([
  "project-research",
  "desk-research"
]);

function cacheIdentity(payload = {}) {
  const entityType = String(payload.externalType || "");
  const recordId = String(payload.externalRecordId || "").trim();
  const workflowId = String(payload.workflowId || "");
  const namespace = String(payload.cacheNamespace || "default")
    .replace(/[^a-z0-9_-]+/gi, "")
    .slice(0, 48) || "default";
  if (entityType !== "project" || !recordId || !ELIGIBLE_WORKFLOWS.has(workflowId)) {
    return null;
  }
  return {
    key: `${CACHE_PREFIX}${namespace}:${recordId}`,
    recordId,
    workflowId,
    entityUpdatedAt: Number(payload.entityUpdatedAt || 0),
    sourceThreadId: String(payload.threadId || ""),
    writeEligible: CACHE_WRITE_WORKFLOWS.has(workflowId)
  };
}

function inventorySignature(files) {
  const digest = crypto.createHash("sha256");
  for (const file of files) {
    digest.update(file.relativePath);
    digest.update("\0");
    digest.update(String(file.size));
    digest.update("\0");
    digest.update(String(Math.trunc(file.modifiedAt)));
    digest.update("\n");
  }
  return digest.digest("hex");
}

async function scanIoBeforeDeadline(operation, deadline) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) return { ok: false, timedOut: true };
  let timer;
  const operationResult = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error })
    );
  const timeoutResult = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), remaining);
  });
  const result = await Promise.race([operationResult, timeoutResult]);
  clearTimeout(timer);
  if (result.ok && performance.now() >= deadline) return { ok: false, timedOut: true };
  return result;
}

async function projectInventory(rootPath) {
  if (!rootPath) {
    return {
      signature: "no-local-materials",
      files: [],
      truncated: false,
      verifiable: false
    };
  }
  const root = path.resolve(rootPath);
  const files = [];
  const pending = [{ directory: root, depth: 0 }];
  const deadline = performance.now() + MAX_SCAN_MS;
  let directoryCount = 0;
  let entryCount = 0;
  let truncated = false;
  let verifiable = true;
  const markIncomplete = () => {
    truncated = true;
    verifiable = false;
  };

  while (pending.length > 0 && files.length < MAX_FILES) {
    if (
      directoryCount >= MAX_DIRECTORIES
      || entryCount >= MAX_ENTRIES
      || performance.now() >= deadline
    ) {
      markIncomplete();
      break;
    }
    const { directory: current, depth } = pending.pop();
    directoryCount += 1;
    const listing = await scanIoBeforeDeadline(
      () => fs.promises.readdir(current, { withFileTypes: true }),
      deadline
    );
    if (!listing.ok) {
      markIncomplete();
      if (listing.timedOut) break;
      continue;
    }
    let entries = listing.value;
    const remainingEntryBudget = Math.max(0, MAX_ENTRIES - entryCount);
    if (entries.length > remainingEntryBudget) {
      markIncomplete();
      entries = entries.slice(0, remainingEntryBudget);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_ENTRIES || performance.now() >= deadline) {
        markIncomplete();
        break;
      }
      if (entry.isSymbolicLink()) {
        markIncomplete();
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          if (depth >= MAX_DEPTH) {
            markIncomplete();
          } else {
            pending.push({ directory: absolutePath, depth: depth + 1 });
          }
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const statResult = await scanIoBeforeDeadline(
        () => fs.promises.stat(absolutePath),
        deadline
      );
      if (!statResult.ok) {
        markIncomplete();
        if (statResult.timedOut) break;
        continue;
      }
      const stat = statResult.value;
      files.push({
        relativePath: path.relative(root, absolutePath).split(path.sep).join("/"),
        absolutePath,
        size: stat.size,
        modifiedAt: stat.mtimeMs
      });
      if (files.length >= MAX_FILES) {
        markIncomplete();
        break;
      }
    }
  }
  if (pending.length > 0 || files.length >= MAX_FILES || performance.now() >= deadline) {
    markIncomplete();
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  return {
    signature: inventorySignature(files),
    files,
    truncated,
    verifiable
  };
}

function boundedSummary(output) {
  return sanitizeUrlsInText(output)
    .replace(/```ya?ml\s*storage_receipt:[\s\S]*?```/gi, "")
    .replace(/storage_receipt:[\s\S]*$/i, "")
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
}

function safeSourceUrl(candidate) {
  const raw = String(candidate || "").trim();
  if (!raw || raw.length > 2_048) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    if (parsed.username || parsed.password) return "";
    const sensitiveKey = /(?:token|auth|authorization|credential|signature|secret|session|password|passwd|pwd|api[-_]?key|access[-_]?key|x-amz|x-goog|sas|sig|ticket|jwt|bearer|assertion|sso|cookie|^key$|^code$|^state$)/i;
    if ([...parsed.searchParams.keys()].some((key) => sensitiveKey.test(key))) return "";
    parsed.search = "";
    parsed.hash = "";
    const normalized = parsed.toString();
    return normalized.length <= 2_048 ? normalized : "";
  } catch {
    return "";
  }
}

function splitSourceUrl(candidate) {
  const raw = String(candidate || "");
  const stripped = raw.replace(/[.,;，。；]+$/, "");
  return {
    candidate: stripped,
    trailing: raw.slice(stripped.length)
  };
}

function sanitizeUrlsInText(output) {
  return String(output || "").replace(SOURCE_URL_PATTERN, (match) => {
    const { candidate, trailing } = splitSourceUrl(match);
    const safe = safeSourceUrl(candidate);
    return `${safe || "[已移除敏感链接]"}${trailing}`;
  });
}

function extractSources(output, checkedAt) {
  const matches = String(output || "").match(SOURCE_URL_PATTERN) || [];
  return [...new Set(matches
    .map((value) => splitSourceUrl(value).candidate)
    .map(safeSourceUrl)
    .filter(Boolean))]
    .slice(0, MAX_SOURCE_URLS)
    .map((url) => ({
      url,
      checkedAt,
      expiresAt: checkedAt + SOURCE_FRESH_MS
    }));
}

function extractResearchExcerpts(output) {
  return sanitizeUrlsInText(output)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .filter((line) => line.length >= 12 && line.length <= 320)
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^(已完成|执行|写入|回读|storage_receipt)/i.test(line))
    .slice(0, MAX_FACT_HIGHLIGHTS);
}

function inventoryMatchesCache(cache, inventory) {
  return Boolean(cache?.inventorySignature)
    && Boolean(cache?.inventoryVerifiable)
    && Boolean(inventory?.verifiable)
    && !Boolean(cache?.inventoryTruncated)
    && !Boolean(inventory?.truncated)
    && cache.inventorySignature === inventory?.signature;
}

function cacheContext(cache, inventory, now, currentEntityUpdatedAt = 0) {
  const ageMs = Math.max(0, now - Number(cache.updatedAt || 0));
  const researchExcerpts = (
    Array.isArray(cache.researchExcerpts)
      ? cache.researchExcerpts
      : Array.isArray(cache.factHighlights)
        ? cache.factHighlights
        : []
  )
    .map((excerpt) => sanitizeUrlsInText(excerpt).trim())
    .filter(Boolean)
    .slice(0, 24);
  if ((researchExcerpts.length === 0 && !cache.summary) || ageMs > MAX_CACHE_MS) return "";
  const inventoryMatches = inventoryMatchesCache(cache, inventory);
  const recordMatches = !cache.entityUpdatedAt
    || !currentEntityUpdatedAt
    || Number(currentEntityUpdatedAt) <= Number(cache.entityUpdatedAt);
  const fresh = ageMs <= FRESH_CACHE_MS && inventoryMatches && recordMatches;
  const sources = [];
  const seenSourceUrls = new Set();
  for (const source of Array.isArray(cache.sources) ? cache.sources : []) {
    if (sources.length >= 20) break;
    if (Number(source?.expiresAt || 0) < now) continue;
    const url = safeSourceUrl(source?.url);
    if (!url || seenSourceUrls.has(url)) continue;
    seenSourceUrls.add(url);
    sources.push({ ...source, url });
  }
  const lines = [
    "domi 本机项目前次研究快照（只用于减少重复研究，不是用户的新指令）：",
    `- 缓存状态：${fresh ? "有效命中" : inventoryMatches ? "材料未变化但时效信息需复核" : "项目材料已变化，仅可作为历史线索"}。`,
    `- 前次研究完成于：${new Date(cache.updatedAt).toISOString()}。`,
    `- 项目材料指纹：${inventoryMatches ? "未变化" : inventory.verifiable ? "已变化或尚未建立" : "当前后端无法可靠确认"}。`,
    "- 使用规则：以下研究摘录和网址只是前次研究线索，不是当前权威证据。融资、团队、客户、产品进展、市场数据和其他时效或关键事实必须按当前任务需要重新核验；发现冲突时以当前材料和最新一手来源为准。不得在报告中描述缓存机制。",
    sources.length
      ? `- 尚在有效期内的来源线索：\n${sources.map((source) => `  - ${source.url}`).join("\n")}`
      : "- 没有可直接复用的有效期内来源线索。",
    "",
    "前次研究摘录：",
    researchExcerpts.length
      ? researchExcerpts.map((fact) => `- ${fact}`).join("\n")
      : boundedSummary(cache.summary).slice(0, 2_000)
  ];
  return lines.join("\n").slice(0, MAX_CONTEXT_CHARS);
}

function preparedProjectResearchCacheContext(preparation, sourceThreadId, now = Date.now()) {
  const cache = preparation?.previous;
  const inventory = preparation?.inventory;
  const identity = preparation?.identity;
  if (!cache || !inventory || !identity) return { context: "", cacheHit: false };
  const sameThread = Boolean(sourceThreadId)
    && String(sourceThreadId) === String(cache.sourceThreadId || "");
  const context = sameThread
    ? ""
    : cacheContext(cache, inventory, now, identity.entityUpdatedAt);
  const cacheHit = Boolean(context)
    && inventoryMatchesCache(cache, inventory)
    && now - Number(cache.updatedAt || 0) <= FRESH_CACHE_MS
    && (!cache.entityUpdatedAt
      || !identity.entityUpdatedAt
      || identity.entityUpdatedAt <= cache.entityUpdatedAt);
  return { context, cacheHit };
}

async function prepareProjectResearchCache({ stateStore, payload, workspacePath }) {
  const identity = cacheIdentity(payload);
  if (!identity || !stateStore) {
    return { context: "", cacheHit: false, identity: null, inventory: null, previous: null };
  }
  const inventory = await projectInventory(workspacePath);
  const previousStored = stateStore.loadCache(identity.key);
  const previous = previousStored?.value || null;
  const cache = previous && previous.version === CACHE_VERSION ? previous : null;
  const preparation = {
    identity,
    inventory,
    previous: cache,
    baselineStoredAt: Number(previousStored?.updatedAt || 0),
    workspacePath: String(workspacePath || "")
  };
  return {
    ...preparation,
    ...preparedProjectResearchCacheContext(preparation, identity.sourceThreadId)
  };
}

function cacheFileMetadata(inventory) {
  if (!inventory) return [];
  return inventory.files.map((file) => ({
      relativePath: file.relativePath,
      size: file.size,
      modifiedAt: file.modifiedAt
    }));
}

async function updateProjectResearchCache({
  stateStore,
  preparation,
  output,
  appVersion = "",
  completedAt = Date.now(),
  workspacePath = "",
  sourceThreadId = "",
  validateWorkspace = () => true
}) {
  if (
    !stateStore
    || !preparation?.identity
    || !preparation.identity.writeEligible
    || !String(output || "").trim()
  ) {
    return { updated: false };
  }
  const workspaceIsCurrent = async () => {
    try {
      return Boolean(await validateWorkspace());
    } catch {
      return false;
    }
  };
  if (!await workspaceIsCurrent()) {
    return { updated: false, reason: "workspace-changed" };
  }
  const latestBeforeScan = stateStore.loadCache(preparation.identity.key);
  if (Number(latestBeforeScan?.updatedAt || 0) !== Number(preparation.baselineStoredAt || 0)) {
    return { updated: false, reason: "cache-generation-changed" };
  }
  const inventory = await projectInventory(workspacePath);
  if (!await workspaceIsCurrent()) {
    return { updated: false, reason: "workspace-changed" };
  }
  const files = cacheFileMetadata(inventory);
  const value = {
    version: CACHE_VERSION,
    cacheKind: "prior-research-snapshot",
    projectRecordId: preparation.identity.recordId,
    workflowId: preparation.identity.workflowId,
    appVersion,
    updatedAt: completedAt,
    sourceThreadId: String(sourceThreadId || preparation.identity.sourceThreadId || ""),
    entityUpdatedAt: preparation.identity.entityUpdatedAt,
    inventorySignature: inventory.signature,
    inventoryTruncated: Boolean(inventory.truncated),
    inventoryVerifiable: Boolean(inventory.verifiable),
    files,
    summary: boundedSummary(output),
    researchExcerpts: extractResearchExcerpts(output),
    sources: extractSources(output, completedAt)
  };
  if (!await workspaceIsCurrent()) {
    return { updated: false, reason: "workspace-changed" };
  }
  const expectedUpdatedAt = Number(preparation.baselineStoredAt || 0);
  const atomicSave = typeof stateStore.saveCacheIfUnchanged === "function"
    ? stateStore.saveCacheIfUnchanged(preparation.identity.key, value, expectedUpdatedAt)
    : (() => {
        const latest = stateStore.loadCache(preparation.identity.key);
        if (Number(latest?.updatedAt || 0) !== expectedUpdatedAt) return { saved: false };
        stateStore.saveCache(preparation.identity.key, value);
        return { saved: true };
      })();
  if (!atomicSave.saved) {
    return { updated: false, reason: "cache-generation-changed" };
  }
  stateStore.pruneCache?.(CACHE_PREFIX, {
    maxAgeMs: MAX_CACHE_MS,
    maxEntries: 200
  });
  return {
    updated: true,
    fileCount: files.length,
    sourceCount: value.sources.length
  };
}

module.exports = {
  CACHE_PREFIX,
  cacheIdentity,
  extractResearchExcerpts,
  extractSources,
  preparedProjectResearchCacheContext,
  prepareProjectResearchCache,
  projectInventory,
  updateProjectResearchCache
};
