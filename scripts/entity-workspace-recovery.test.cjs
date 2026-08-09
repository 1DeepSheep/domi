const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveEntityWorkspaceWithRecovery
} = require("../electron/entity-workspace-recovery.cjs");

test("keeps an existing canonical entity directory without rebuilding the index", async () => {
  let reindexCalls = 0;
  const result = await resolveEntityWorkspaceWithRecovery({
    request: { entityType: "project", recordId: "prj-1" },
    resolveWorkspace: () => "/library/project-a",
    validateWorkspace: (candidate) => candidate,
    reindex: async () => {
      reindexCalls += 1;
      return { ok: true };
    }
  });

  assert.deepEqual(result, {
    ok: true,
    recovered: false,
    workspacePath: "/library/project-a"
  });
  assert.equal(reindexCalls, 0);
});

test("rebuilds the index once and re-resolves a renamed entity directory", async () => {
  let canonical = "";
  let reindexCalls = 0;
  const snapshot = { backend: "local", projects: [], people: [] };
  const result = await resolveEntityWorkspaceWithRecovery({
    request: { entityType: "project", recordId: "prj-1" },
    resolveWorkspace: () => canonical,
    validateWorkspace: (candidate) => candidate,
    reindex: async () => {
      reindexCalls += 1;
      canonical = "/library/renamed-project";
      return { ok: true, snapshot };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.recovered, true);
  assert.equal(result.workspacePath, "/library/renamed-project");
  assert.equal(result.reindexResult.snapshot, snapshot);
  assert.equal(reindexCalls, 1);
});

test("fails closed without a fallback when duplicate entity directories conflict", async () => {
  let reindexCalls = 0;
  const result = await resolveEntityWorkspaceWithRecovery({
    request: { entityType: "project", recordId: "prj-1" },
    resolveWorkspace: () => "",
    validateWorkspace: (candidate) => candidate,
    reindex: async () => {
      reindexCalls += 1;
      const error = new Error(
        "DOMI_ENTITY_DIRECTORY_CONFLICT: 当前项目存在多个带相同内部 ID 的本地资料目录。"
      );
      error.code = "DOMI_ENTITY_DIRECTORY_CONFLICT";
      throw error;
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.workspacePath, undefined);
  assert.equal(reindexCalls, 1);
  assert.match(result.error, /多个本地目录/);
  assert.match(result.error, /保留唯一的实体目录/);
});

test("does not retry or return a generic workspace when reindex cannot repair the record", async () => {
  let reindexCalls = 0;
  const result = await resolveEntityWorkspaceWithRecovery({
    request: { entityType: "person", recordId: "person-1" },
    resolveWorkspace: () => "",
    validateWorkspace: (candidate) => candidate,
    reindex: async () => {
      reindexCalls += 1;
      return { ok: true };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.workspacePath, undefined);
  assert.equal(reindexCalls, 1);
  assert.match(result.error, /重新建立索引后仍没有找到唯一且可访问的目录/);
});

test("does not rebuild after the resolver has already reported an identity conflict", async () => {
  let reindexCalls = 0;
  const result = await resolveEntityWorkspaceWithRecovery({
    request: { entityType: "project", recordId: "prj-1" },
    resolveWorkspace: () => {
      throw new Error("DOMI_ENTITY_DIRECTORY_CONFLICT: 存在重复目录。");
    },
    validateWorkspace: (candidate) => candidate,
    reindex: async () => {
      reindexCalls += 1;
      return { ok: true };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.workspacePath, undefined);
  assert.equal(reindexCalls, 0);
  assert.match(result.error, /停止自动关联/);
});
