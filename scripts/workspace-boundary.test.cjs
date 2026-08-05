const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  isEntityWorkspace,
  projectResearchCacheScope,
  validCodexWorkspace
} = require("../electron/workspace-boundary.cjs");

test("entity workspaces reject library roots and symlink escapes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-workspace-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = path.join(root, "domi工作区");
  const projectRoot = path.join(library, "3.项目库");
  const personRoot = path.join(library, "4.人脉库");
  const projectA = path.join(projectRoot, "AI", "Agent", "项目A");
  const outside = path.join(root, "private-outside");
  const runtime = path.join(root, "runtime");
  const projectsDir = path.join(runtime, "projects");
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(personRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  const escape = path.join(projectRoot, "escape");
  fs.symlinkSync(outside, escape, "dir");
  const settings = { storageBackend: "local", localRepositoryDir: library };

  assert.equal(validCodexWorkspace({
    candidate: projectA,
    demoWorkspace: runtime,
    projectsDir,
    settings
  }), fs.realpathSync(projectA));
  assert.equal(validCodexWorkspace({
    candidate: projectRoot,
    demoWorkspace: runtime,
    projectsDir,
    settings
  }), null);
  assert.equal(validCodexWorkspace({
    candidate: escape,
    demoWorkspace: runtime,
    projectsDir,
    settings
  }), null);
  assert.equal(isEntityWorkspace({ workspacePath: projectA, settings }), true);
  assert.equal(isEntityWorkspace({ workspacePath: escape, settings }), false);
});

test("project cache scope requires the record's exact canonical directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-project-cache-scope-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = path.join(root, "domi工作区");
  const projectA = path.join(library, "3.项目库", "AI", "Agent", "项目A");
  const projectB = path.join(library, "3.项目库", "AI", "Agent", "项目B");
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  fs.mkdirSync(path.join(library, "4.人脉库"), { recursive: true });
  const settings = { storageBackend: "local", localRepositoryDir: library };
  const payload = {
    externalType: "project",
    externalRecordId: "project-a"
  };
  const resolveEntityWorkspace = ({ recordId }) => recordId === "project-a" ? projectA : "";

  const exact = projectResearchCacheScope({
    payload,
    workspacePath: projectA,
    settings,
    resolveEntityWorkspace
  });
  assert.equal(exact.allowed, true);
  assert.equal(exact.workspacePath, fs.realpathSync(projectA));

  const crossed = projectResearchCacheScope({
    payload,
    workspacePath: projectB,
    settings,
    resolveEntityWorkspace
  });
  assert.deepEqual(crossed, { allowed: false, workspacePath: "" });

  const projectAlias = path.join(library, "3.项目库", "AI", "Agent", "项目别名");
  fs.symlinkSync(projectB, projectAlias, "dir");
  const redirected = projectResearchCacheScope({
    payload,
    workspacePath: projectB,
    settings,
    resolveEntityWorkspace: () => projectAlias
  });
  assert.deepEqual(redirected, { allowed: false, workspacePath: "" });
});

test("configured root aliases are allowed while symlinks below the root are rejected", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-workspace-root-alias-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const physicalLibrary = path.join(root, "physical-library");
  const aliasLibrary = path.join(root, "selected-library");
  const projectA = path.join(physicalLibrary, "3.项目库", "AI", "项目A");
  const projectB = path.join(physicalLibrary, "3.项目库", "AI", "项目B");
  const projectAlias = path.join(physicalLibrary, "3.项目库", "AI", "跳转项目");
  const runtime = path.join(root, "runtime");
  const projectsDir = path.join(runtime, "projects");
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  fs.mkdirSync(path.join(physicalLibrary, "4.人脉库"), { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.symlinkSync(physicalLibrary, aliasLibrary, "dir");
  fs.symlinkSync(projectB, projectAlias, "dir");
  const settings = { storageBackend: "local", localRepositoryDir: aliasLibrary };

  assert.equal(validCodexWorkspace({
    candidate: path.join(aliasLibrary, "3.项目库", "AI", "项目A"),
    demoWorkspace: runtime,
    projectsDir,
    settings
  }), fs.realpathSync(projectA));
  assert.equal(validCodexWorkspace({
    candidate: fs.realpathSync(projectA),
    demoWorkspace: runtime,
    projectsDir,
    settings
  }), fs.realpathSync(projectA));
  assert.equal(validCodexWorkspace({
    candidate: path.join(aliasLibrary, "3.项目库", "AI", "跳转项目"),
    demoWorkspace: runtime,
    projectsDir,
    settings
  }), null);
});

test("a project-library root symlink cannot escape the selected repository", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-workspace-root-escape-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = path.join(root, "domi工作区");
  const outsideProjectRoot = path.join(root, "outside-projects");
  const escapedProject = path.join(outsideProjectRoot, "AI", "项目A");
  const runtime = path.join(root, "runtime");
  const projectsDir = path.join(runtime, "projects");
  fs.mkdirSync(escapedProject, { recursive: true });
  fs.mkdirSync(path.join(library, "4.人脉库"), { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.symlinkSync(outsideProjectRoot, path.join(library, "3.项目库"), "dir");
  const settings = { storageBackend: "local", localRepositoryDir: library };

  assert.equal(validCodexWorkspace({
    candidate: path.join(library, "3.项目库", "AI", "项目A"),
    demoWorkspace: runtime,
    projectsDir,
    settings
  }), null);
});
