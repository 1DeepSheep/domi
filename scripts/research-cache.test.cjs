const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  CACHE_PREFIX,
  preparedProjectResearchCacheContext,
  prepareProjectResearchCache,
  projectInventory,
  updateProjectResearchCache
} = require("../electron/research-cache.cjs");

function memoryStateStore() {
  const values = new Map();
  const updatedAts = new Map();
  let clock = Date.now();
  return {
    values,
    loadCache(key) {
      return values.has(key) ? { value: values.get(key), updatedAt: updatedAts.get(key) } : null;
    },
    saveCache(key, value) {
      clock += 1;
      values.set(key, value);
      updatedAts.set(key, clock);
      return { value, updatedAt: clock };
    },
    saveCacheIfUnchanged(key, value, expectedUpdatedAt = 0) {
      const currentUpdatedAt = Number(updatedAts.get(key) || 0);
      if (currentUpdatedAt !== Number(expectedUpdatedAt || 0)) {
        return { saved: false, currentUpdatedAt };
      }
      const saved = this.saveCache(key, value);
      return { saved: true, ...saved };
    },
    pruneCache() {
      return { deleted: 0, retained: values.size };
    }
  };
}

test("project research cache reuses unchanged local evidence and invalidates changed material", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-research-cache-"));
  const projectRoot = path.join(root, "3.项目库", "AI", "Agent", "示例项目");
  const researchDir = path.join(projectRoot, "研究");
  fs.mkdirSync(researchDir, { recursive: true });
  const sourcePath = path.join(projectRoot, "项目主页.md");
  fs.writeFileSync(sourcePath, "# 示例项目\n\n产品信息。", "utf8");
  fs.writeFileSync(path.join(researchDir, "历史研究.md"), "已有研究。", "utf8");
  fs.mkdirSync(path.join(projectRoot, "导出"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "导出", "不参与指纹.md"), "导出内容", "utf8");

  const stateStore = memoryStateStore();
  const payload = {
    workflowId: "desk-research",
    externalType: "project",
    externalRecordId: "project-example",
    entityUpdatedAt: 100,
    cacheNamespace: "local-test",
    threadId: "thread-one"
  };

  try {
    const cold = await prepareProjectResearchCache({ stateStore, payload, workspacePath: projectRoot });
    assert.equal(cold.cacheHit, false);
    assert.equal(cold.context, "");
    assert.equal(cold.inventory.files.some((file) => file.relativePath.startsWith("导出/")), false);

    fs.writeFileSync(path.join(researchDir, "本轮研究.md"), "本轮正式研究成果。", "utf8");

    const update = await updateProjectResearchCache({
      stateStore,
      preparation: cold,
      output: [
        "核心判断：产品具备明确客户价值。",
        "- 团队具备相关经验。",
        "来源：https://example.com/company"
      ].join("\n"),
      appVersion: "0.6.17",
      completedAt: Date.now(),
      workspacePath: projectRoot,
      sourceThreadId: "thread-one"
    });
    assert.equal(update.updated, true);
    assert.equal(update.fileCount, 3);
    assert.equal(update.sourceCount, 1);

    const stored = stateStore.values.get(`${CACHE_PREFIX}local-test:project-example`);
    assert.equal(stored.version, 1);
    assert.equal(stored.cacheKind, "prior-research-snapshot");
    assert.equal(stored.sourceThreadId, "thread-one");
    assert.equal(stored.files.every((file) => !path.isAbsolute(file.relativePath)), true);
    assert.equal(stored.files.some((file) => "sha256" in file), false);

    const warm = await prepareProjectResearchCache({
      stateStore,
      payload: { ...payload, threadId: "thread-two" },
      workspacePath: projectRoot
    });
    assert.equal(warm.cacheHit, true);
    assert.match(warm.context, /缓存状态：有效命中/);
    assert.match(warm.context, /https:\/\/example\.com\/company/);
    assert.equal(warm.context.includes(projectRoot), false);

    const sameThread = await prepareProjectResearchCache({
      stateStore,
      payload,
      workspacePath: projectRoot
    });
    assert.equal(sameThread.cacheHit, false);
    assert.equal(sameThread.context, "");

    const resumedAsNewThread = preparedProjectResearchCacheContext(sameThread, "thread-recovered");
    assert.equal(resumedAsNewThread.cacheHit, true);
    assert.match(resumedAsNewThread.context, /缓存状态：有效命中/);

    await new Promise((resolve) => setTimeout(resolve, 5));
    fs.appendFileSync(sourcePath, "\n新增进展。", "utf8");
    const changed = await prepareProjectResearchCache({
      stateStore,
      payload: { ...payload, threadId: "thread-three" },
      workspacePath: projectRoot
    });
    assert.equal(changed.cacheHit, false);
    assert.match(changed.context, /项目材料已变化/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("truncated inventories never produce a cache hit", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-research-cache-large-"));
  try {
    for (let index = 0; index < 501; index += 1) {
      fs.writeFileSync(path.join(root, `${String(index).padStart(3, "0")}.md`), `${index}`, "utf8");
    }
    const inventory = await projectInventory(root);
    assert.equal(inventory.truncated, true);
    assert.equal(inventory.files.length, 500);
    const stateStore = memoryStateStore();
    stateStore.saveCache(`${CACHE_PREFIX}local-test:project-large`, {
      version: 1,
      updatedAt: Date.now(),
      entityUpdatedAt: 1,
      inventorySignature: inventory.signature,
      inventoryTruncated: true,
      summary: "此前研究摘要。",
      factHighlights: ["此前研究得到一条长度足够的事实摘录。"],
      sources: []
    });
    const prepared = await prepareProjectResearchCache({
      stateStore,
      payload: {
        workflowId: "desk-research",
        externalType: "project",
        externalRecordId: "project-large",
        entityUpdatedAt: 1,
        cacheNamespace: "local-test",
        threadId: "thread-new"
      },
      workspacePath: root
    });
    assert.equal(prepared.cacheHit, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project inventory stops on oversized directory trees", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-research-cache-directories-"));
  try {
    for (let index = 0; index < 220; index += 1) {
      fs.mkdirSync(path.join(root, `directory-${String(index).padStart(3, "0")}`));
    }
    const inventory = await projectInventory(root);
    assert.equal(inventory.truncated, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project inventory enforces a real I/O deadline", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-research-cache-deadline-"));
  const originalReaddir = fs.promises.readdir;
  let watchdog;
  try {
    fs.promises.readdir = async (target, options) => {
      if (path.resolve(target) === path.resolve(root)) return new Promise(() => {});
      return originalReaddir.call(fs.promises, target, options);
    };
    const startedAt = Date.now();
    const inventory = await Promise.race([
      projectInventory(root),
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error("project inventory missed its deadline")), 1_500);
      })
    ]);
    const elapsedMs = Date.now() - startedAt;
    assert.equal(inventory.truncated, true);
    assert.equal(inventory.verifiable, false);
    assert.ok(elapsedMs < 800, `inventory took ${elapsedMs}ms`);
  } finally {
    clearTimeout(watchdog);
    fs.promises.readdir = originalReaddir;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project inventory marks read failures and symbolic links unverifiable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-research-cache-incomplete-"));
  const unreadableRoot = path.join(root, "unreadable");
  const statFailureRoot = path.join(root, "stat-failure");
  const linkedRoot = path.join(root, "linked");
  const outsideRoot = path.join(root, "outside");
  fs.mkdirSync(unreadableRoot);
  fs.mkdirSync(statFailureRoot);
  fs.mkdirSync(linkedRoot);
  fs.mkdirSync(outsideRoot);
  const failedFile = path.join(statFailureRoot, "material.md");
  fs.writeFileSync(failedFile, "material", "utf8");
  fs.symlinkSync(outsideRoot, path.join(linkedRoot, "external-materials"), "dir");
  const originalReaddir = fs.promises.readdir;
  const originalStat = fs.promises.stat;
  try {
    fs.promises.readdir = async (target, options) => {
      if (path.resolve(target) === path.resolve(unreadableRoot)) {
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      }
      return originalReaddir.call(fs.promises, target, options);
    };
    const unreadable = await projectInventory(unreadableRoot);
    assert.equal(unreadable.truncated, true);
    assert.equal(unreadable.verifiable, false);
    fs.promises.readdir = originalReaddir;

    fs.promises.stat = async (target) => {
      if (path.resolve(target) === path.resolve(failedFile)) {
        throw Object.assign(new Error("cloud placeholder unavailable"), { code: "EIO" });
      }
      return originalStat.call(fs.promises, target);
    };
    const statFailure = await projectInventory(statFailureRoot);
    assert.equal(statFailure.truncated, true);
    assert.equal(statFailure.verifiable, false);
    fs.promises.stat = originalStat;

    const linked = await projectInventory(linkedRoot);
    assert.equal(linked.truncated, true);
    assert.equal(linked.verifiable, false);
  } finally {
    fs.promises.readdir = originalReaddir;
    fs.promises.stat = originalStat;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("read-only workflows cannot overwrite the project research snapshot", async () => {
  const stateStore = memoryStateStore();
  const preparation = await prepareProjectResearchCache({
    stateStore,
    payload: {
      workflowId: "investment-review",
      externalType: "project",
      externalRecordId: "project-example",
      cacheNamespace: "local-test"
    },
    workspacePath: ""
  });
  const result = await updateProjectResearchCache({
    stateStore,
    preparation,
    output: "这是一次投资判断，不应覆盖研究快照。"
  });
  assert.equal(result.updated, false);
  assert.equal(stateStore.values.size, 0);
});

test("an older completed task cannot overwrite a newer research snapshot", async () => {
  const stateStore = memoryStateStore();
  const completedAt = Date.now();
  const preparation = await prepareProjectResearchCache({
    stateStore,
    payload: {
      workflowId: "desk-research",
      externalType: "project",
      externalRecordId: "project-example",
      cacheNamespace: "local-test"
    },
    workspacePath: ""
  });
  stateStore.saveCache(preparation.identity.key, {
    version: 1,
    updatedAt: completedAt + 1_000,
    summary: "更新的研究结果"
  });
  const result = await updateProjectResearchCache({
    stateStore,
    preparation,
    output: "更早开始但更晚返回的旧任务结果。",
    completedAt
  });
  assert.equal(result.updated, false);
  assert.equal(result.reason, "cache-generation-changed");
});

test("a project directory replacement cancels the pending cache write", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-research-cache-replaced-"));
  const stateStore = memoryStateStore();
  try {
    fs.writeFileSync(path.join(root, "项目主页.md"), "# 原项目", "utf8");
    const preparation = await prepareProjectResearchCache({
      stateStore,
      payload: {
        workflowId: "desk-research",
        externalType: "project",
        externalRecordId: "project-example",
        cacheNamespace: "local-test"
      },
      workspacePath: root
    });
    let validationCount = 0;
    const result = await updateProjectResearchCache({
      stateStore,
      preparation,
      output: "不应写入已经被替换的项目目录。",
      workspacePath: root,
      validateWorkspace: () => {
        validationCount += 1;
        return validationCount < 2;
      }
    });
    assert.equal(result.updated, false);
    assert.equal(result.reason, "workspace-changed");
    assert.equal(stateStore.values.size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent cache updates cannot let a stale completion overwrite the winner", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-research-cache-concurrent-"));
  const stateStore = memoryStateStore();
  try {
    fs.writeFileSync(path.join(root, "项目主页.md"), "# 项目", "utf8");
    const payload = {
      workflowId: "desk-research",
      externalType: "project",
      externalRecordId: "project-example",
      cacheNamespace: "local-test"
    };
    const [olderPreparation, newerPreparation] = await Promise.all([
      prepareProjectResearchCache({ stateStore, payload, workspacePath: root }),
      prepareProjectResearchCache({ stateStore, payload, workspacePath: root })
    ]);
    let oldValidationCount = 0;
    const older = updateProjectResearchCache({
      stateStore,
      preparation: olderPreparation,
      output: "OLDER RESULT SHOULD NOT WIN",
      workspacePath: root,
      validateWorkspace: async () => {
        oldValidationCount += 1;
        if (oldValidationCount >= 3) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return true;
      }
    });
    const newer = updateProjectResearchCache({
      stateStore,
      preparation: newerPreparation,
      output: "NEWER RESULT WINS",
      workspacePath: root
    });
    const [olderResult, newerResult] = await Promise.all([older, newer]);
    assert.equal(newerResult.updated, true);
    assert.equal(olderResult.updated, false);
    assert.equal(olderResult.reason, "cache-generation-changed");
    const stored = stateStore.values.get(olderPreparation.identity.key);
    assert.match(stored.summary, /NEWER RESULT WINS/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cached text and source leads remove queries, fragments, and credentials", async () => {
  const stateStore = memoryStateStore();
  const preparation = await prepareProjectResearchCache({
    stateStore,
    payload: {
      workflowId: "desk-research",
      externalType: "project",
      externalRecordId: "project-example",
      cacheNamespace: "local-test"
    },
    workspacePath: ""
  });
  await updateProjectResearchCache({
    stateStore,
    preparation,
    output: [
      "公开来源：https://example.com/report?id=1#private-fragment",
      "含凭据：https://user:password@example.com/private",
      "签名链接：https://files.example.com/a.pdf?X-Amz-Signature=secret",
      "密码参数：https://example.com/private?password=hunter2",
      "API Key：https://maps.googleapis.com/maps/api/geocode/json?key=AIza-secret",
      "OAuth code：https://example.com/callback?code=oauth-secret"
    ].join("\n")
  });
  const stored = stateStore.values.get(preparation.identity.key);
  assert.deepEqual(stored.sources.map((source) => source.url), ["https://example.com/report"]);
  const serialized = JSON.stringify(stored);
  assert.doesNotMatch(serialized, /password|hunter2|AIza|oauth-secret|private-fragment|X-Amz/i);
  assert.doesNotMatch(serialized, /\?id=1/);
});

test("legacy cache URLs are sanitized again before prompt injection", async () => {
  const stateStore = memoryStateStore();
  const key = `${CACHE_PREFIX}local-test:project-legacy`;
  const now = Date.now();
  stateStore.saveCache(key, {
    version: 1,
    updatedAt: now,
    sourceThreadId: "thread-old",
    summary: "旧摘要：https://example.com/report?id=9#private",
    factHighlights: [
      "旧摘录：https://example.com/company?password=secret",
      "公开摘录：https://example.com/public?page=2#section"
    ],
    sources: [
      { url: "https://example.com/source?id=1#section", expiresAt: now + 10_000 },
      { url: "https://example.com/private?code=oauth-secret", expiresAt: now + 10_000 }
    ]
  });
  const prepared = await prepareProjectResearchCache({
    stateStore,
    payload: {
      workflowId: "desk-research",
      externalType: "project",
      externalRecordId: "project-legacy",
      cacheNamespace: "local-test",
      threadId: "thread-new"
    },
    workspacePath: ""
  });
  assert.match(prepared.context, /https:\/\/example\.com\/public/);
  assert.match(prepared.context, /https:\/\/example\.com\/source/);
  assert.doesNotMatch(prepared.context, /password|secret|oauth|\?|#/i);
});

test("research cache ignores non-project and non-research workflows", async () => {
  const stateStore = memoryStateStore();
  const result = await prepareProjectResearchCache({
    stateStore,
    payload: {
      workflowId: "schedule",
      externalType: "project",
      externalRecordId: "project-example"
    },
    workspacePath: ""
  });
  assert.equal(result.identity, null);
  assert.equal(result.context, "");
});
