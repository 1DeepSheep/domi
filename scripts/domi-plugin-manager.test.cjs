const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DomiPluginManager,
  compareVersions,
  selectPreferredCandidate
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

  const remoteRoot = path.join(temporaryRoot, "remote");
  fs.mkdirSync(path.join(remoteRoot, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(path.join(remoteRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "domi",
    version: "0.2.0+codex.20260727090000"
  }));
  fs.writeFileSync(path.join(remoteRoot, "fixture.txt"), "remote plugin\n");
  const remoteInfo = {
    source: "remote-release",
    root: remoteRoot,
    manifest: {
      name: "domi",
      version: "0.2.0+codex.20260727090000"
    },
    lock: {
      pluginVersion: "0.2.0+codex.20260727090000",
      gitCommit: "remote-commit",
      sha256: "remote-sha",
      publishedAt: "2026-07-27T09:00:00.000Z"
    }
  };
  assert.equal(selectPreferredCandidate([info, remoteInfo]), remoteInfo);

  const transaction = manager.prepareManagedMarketplace(remoteInfo);
  assert.equal(transaction.changed, true);
  const copiedFixture = path.join(path.dirname(copiedManifest), "..", "fixture.txt");
  assert.equal(fs.readFileSync(copiedFixture, "utf8"), "remote plugin\n");
  transaction.rollback();
  assert.equal(fs.readFileSync(copiedFixture, "utf8"), "bundled plugin\n");
  assert.equal(manager.installedInfo().manifest.version, info.manifest.version);

  manager.prepareManagedMarketplace(remoteInfo);
  const recoveredManager = new DomiPluginManager({
    userDataPath: path.join(temporaryRoot, "user-data"),
    bundledPluginRoot: bundledRoot,
    bundledLockPath: lockPath
  });
  assert.equal(fs.readFileSync(copiedFixture, "utf8"), "bundled plugin\n");
  assert.equal(recoveredManager.installedInfo().manifest.version, info.manifest.version);

  const committedTransaction = recoveredManager.prepareManagedMarketplace(remoteInfo);
  committedTransaction.finalize();
  assert.equal(recoveredManager.installedInfo().manifest.version, remoteInfo.manifest.version);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("domi plugin manager tests passed.");
