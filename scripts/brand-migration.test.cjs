const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  legacyProductName,
  migrateBrandDirectory,
  prepareApplicationBrandPaths
} = require("../electron/brand-migration.cjs");

test("brand migration moves existing user data and workspace to domi paths", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-brand-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appData = path.join(root, "Application Support");
  const documents = path.join(root, "Documents");
  const legacyName = legacyProductName();
  const legacyUserData = path.join(appData, legacyName);
  const legacyWorkspace = path.join(documents, legacyName);
  fs.mkdirSync(legacyUserData, { recursive: true });
  fs.mkdirSync(legacyWorkspace, { recursive: true });
  fs.writeFileSync(path.join(legacyUserData, "domi.sqlite3"), "history");
  fs.writeFileSync(path.join(legacyWorkspace, "task.md"), "task");

  const calls = [];
  const fakeApp = {
    isPackaged: true,
    getPath: (name) => name === "appData" ? appData : documents,
    setName: (name) => calls.push(["name", name]),
    setPath: (name, value) => calls.push([name, value])
  };
  const result = prepareApplicationBrandPaths(fakeApp);

  assert.equal(result.appName, "domi");
  assert.equal(result.userDataPath, path.join(appData, "domi"));
  assert.equal(result.pluginRuntimePath, path.join(appData, "domi"));
  assert.equal(result.workspacePath, path.join(documents, "domi"));
  assert.equal(fs.readFileSync(path.join(result.userDataPath, "domi.sqlite3"), "utf8"), "history");
  assert.equal(fs.readFileSync(path.join(result.workspacePath, "task.md"), "utf8"), "task");
  assert.deepEqual(calls, [
    ["name", "domi"],
    ["userData", path.join(appData, "domi")]
  ]);
});

test("brand migration keeps the legacy path when a move cannot be completed", () => {
  const source = "/legacy";
  const destination = "/domi";
  const result = migrateBrandDirectory(source, destination, {
    existsSync: (candidate) => candidate === source,
    mkdirSync: () => {},
    renameSync: () => {
      throw new Error("read only");
    },
    cpSync: () => {
      throw new Error("read only");
    }
  });
  assert.equal(result.path, source);
  assert.match(result.error, /read only/);
});

test("development uses isolated user data without copying production state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-brand-dev-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appData = path.join(root, "Application Support");
  const documents = path.join(root, "Documents");
  const productionUserData = path.join(appData, "domi");
  fs.mkdirSync(productionUserData, { recursive: true });
  fs.writeFileSync(path.join(productionUserData, "domi.sqlite3"), "production");

  const calls = [];
  const fakeApp = {
    isPackaged: false,
    getPath: (name) => name === "appData" ? appData : documents,
    setName: (name) => calls.push(["name", name]),
    setPath: (name, value) => calls.push([name, value])
  };
  const result = prepareApplicationBrandPaths(fakeApp);

  assert.equal(result.development, true);
  assert.equal(result.userDataPath, path.join(appData, "domi-dev"));
  assert.equal(result.productionUserDataPath, path.join(appData, "domi"));
  assert.equal(result.pluginRuntimePath, path.join(appData, "domi"));
  assert.equal(
    result.workspacePath,
    path.join(appData, "domi-dev", "runtime-workspace")
  );
  assert.equal(fs.existsSync(path.join(result.userDataPath, "domi.sqlite3")), false);
  assert.equal(fs.existsSync(path.join(documents, "domi开发工作区")), false);
  assert.equal(fs.readFileSync(path.join(productionUserData, "domi.sqlite3"), "utf8"), "production");
  assert.deepEqual(calls, [
    ["name", "domi"],
    ["userData", path.join(appData, "domi-dev")]
  ]);
});

test("development moves its visible runtime workspace into Application Support", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-brand-dev-workspace-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appData = path.join(root, "Application Support");
  const documents = path.join(root, "Documents");
  const visibleWorkspace = path.join(documents, "domi开发工作区");
  fs.mkdirSync(visibleWorkspace, { recursive: true });
  fs.writeFileSync(path.join(visibleWorkspace, "existing-output.md"), "keep");

  const fakeApp = {
    isPackaged: false,
    getPath: (name) => name === "appData" ? appData : documents,
    setName: () => {},
    setPath: () => {}
  };
  const result = prepareApplicationBrandPaths(fakeApp);
  const hiddenWorkspace = path.join(appData, "domi-dev", "runtime-workspace");

  assert.equal(result.workspacePath, hiddenWorkspace);
  assert.equal(result.workspaceMigration.migrated, true);
  assert.equal(fs.existsSync(visibleWorkspace), false);
  assert.equal(
    fs.readFileSync(path.join(hiddenWorkspace, "existing-output.md"), "utf8"),
    "keep"
  );
});

test("brand migration merges missing files without overwriting current data", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-brand-merge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "legacy");
  const destination = path.join(root, "domi");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(source, "legacy.md"), "legacy");
  fs.writeFileSync(path.join(source, "shared.md"), "old");
  fs.writeFileSync(path.join(destination, "shared.md"), "current");

  const result = migrateBrandDirectory(source, destination);

  assert.equal(result.path, destination);
  assert.equal(fs.readFileSync(path.join(destination, "legacy.md"), "utf8"), "legacy");
  assert.equal(fs.readFileSync(path.join(destination, "shared.md"), "utf8"), "current");
});
