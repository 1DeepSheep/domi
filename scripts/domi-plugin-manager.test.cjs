const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DomiPluginManager,
  compareVersions
} = require("../electron/domi-plugin-manager.cjs");

assert(compareVersions("0.1.7+codex.20260716121308", "0.1.7+codex.20260716093024") > 0);
assert(compareVersions("0.2.0", "0.1.99") > 0);
assert.equal(compareVersions("0.1.7", "0.1.7"), 0);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-manager-unit-"));
try {
  const bundledRoot = path.join(temporaryRoot, "bundled");
  const lockPath = path.join(temporaryRoot, "domi-plugin-lock.json");
  fs.mkdirSync(path.join(bundledRoot, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(bundledRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "domi",
    version: "0.1.7+codex.20260716121308"
  }));
  fs.writeFileSync(path.join(bundledRoot, "fixture.txt"), "bundled plugin\n");
  fs.writeFileSync(lockPath, JSON.stringify({
    pluginVersion: "0.1.7+codex.20260716121308",
    gitCommit: "fixture-commit",
    sha256: "fixture-sha"
  }));

  const manager = new DomiPluginManager({
    userDataPath: path.join(temporaryRoot, "user-data"),
    bundledPluginRoot: bundledRoot,
    bundledLockPath: lockPath
  });
  const info = manager.bundledInfo();
  assert.equal(info.manifest.name, "domi");
  assert.equal(manager.writeManagedMarketplace(info), true);
  assert.equal(manager.writeManagedMarketplace(info), false);

  const copiedManifest = path.join(
    temporaryRoot,
    "user-data",
    "runtime",
    "domi-marketplace",
    "plugins",
    "domi",
    ".codex-plugin",
    "plugin.json"
  );
  assert.equal(JSON.parse(fs.readFileSync(copiedManifest, "utf8")).name, "domi");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("Domi plugin manager tests passed.");
