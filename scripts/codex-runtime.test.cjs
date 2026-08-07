const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CodexRuntimeManager,
  assertSafeArchiveList,
  atomicSymlink,
  expectedTargetForArch,
  resolveLink
} = require("../electron/codex-runtime.cjs");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeExecutable(filePath, version) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `#!/bin/sh\nprintf 'codex-cli ${version}\\n'\n`, { mode: 0o755 });
}

async function run() {
  assert.deepEqual(expectedTargetForArch("arm64"), {
    target: "aarch64-apple-darwin",
    assetName: "codex-package-aarch64-apple-darwin.tar.gz"
  });
  assert.deepEqual(expectedTargetForArch("x64"), {
    target: "x86_64-apple-darwin",
    assetName: "codex-package-x86_64-apple-darwin.tar.gz"
  });
  assert.throws(() => expectedTargetForArch("ia32"), /不支持当前 Codex Runtime 架构/);

  assert.doesNotThrow(() => assertSafeArchiveList("bin/\nbin/codex\n"));
  assert.throws(
    () => assertSafeArchiveList("../outside"),
    /不安全路径/
  );

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-runtime-test-"));
  const homeDir = path.join(temporaryRoot, "home");
  const packageSource = path.join(temporaryRoot, "package");
  const archivePath = path.join(temporaryRoot, "codex-package.tar.gz");
  const manifestPath = path.join(temporaryRoot, "manifest.json");
  try {
    writeExecutable(path.join(packageSource, "bin", "codex"), "0.145.0");
    writeExecutable(path.join(packageSource, "bin", "codex-code-mode-host"), "0.145.0");
    execFileSync("/usr/bin/tar", ["-czf", archivePath, "-C", packageSource, "."]);
    const archiveSize = fs.statSync(archivePath).size;
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      version: "0.145.0",
      tag: "rust-v0.145.0",
      target: "aarch64-apple-darwin",
      assetName: "codex-package-aarch64-apple-darwin.tar.gz",
      assetUrl: "https://github.com/openai/codex/releases/download/rust-v0.145.0/codex-package-aarch64-apple-darwin.tar.gz",
      sha256: sha256(archivePath),
      size: archiveSize
    })}\n`);

    const runtime = new CodexRuntimeManager({
      homeDir,
      archivePath,
      manifestPath,
      minimumArchiveSize: 1,
      arch: "arm64"
    });
    const installed = await runtime.installBundled();
    assert.equal(installed.ok, true);
    assert.match(installed.version, /0\.145\.0/);
    assert.equal(
      resolveLink(path.join(homeDir, ".codex", "packages", "standalone", "current")),
      path.join(homeDir, ".codex", "packages", "standalone", "releases", "0.145.0-aarch64-apple-darwin")
    );
    assert.equal(
      resolveLink(path.join(homeDir, ".local", "bin", "codex")),
      path.join(homeDir, ".codex", "packages", "standalone", "current", "bin", "codex")
    );

    const previous = runtime.captureCurrent();
    const newerTarget = path.join(runtime.releasesRoot(), "0.146.0-aarch64-apple-darwin");
    writeExecutable(path.join(newerTarget, "bin", "codex"), "0.146.0");
    atomicSymlink(newerTarget, runtime.currentLink());
    const updated = await runtime.recordExternalUpdate(previous);
    assert.match(updated.version, /0\.146\.0/);
    assert.equal(updated.rollbackAvailable, true);

    const rolledBack = await runtime.rollback();
    assert.match(rolledBack.version, /0\.145\.0/);
    assert.equal(rolledBack.rollbackAvailable, true);

    const x64ManifestPath = path.join(temporaryRoot, "manifest-x64.json");
    fs.writeFileSync(x64ManifestPath, `${JSON.stringify({
      schemaVersion: 1,
      version: "0.145.0",
      tag: "rust-v0.145.0",
      target: "x86_64-apple-darwin",
      assetName: "codex-package-x86_64-apple-darwin.tar.gz",
      assetUrl: "https://github.com/openai/codex/releases/download/rust-v0.145.0/codex-package-x86_64-apple-darwin.tar.gz",
      sha256: sha256(archivePath),
      size: archiveSize
    })}\n`);
    const x64Runtime = new CodexRuntimeManager({
      homeDir,
      archivePath,
      manifestPath: x64ManifestPath,
      minimumArchiveSize: 1,
      arch: "x64"
    });
    const mismatched = await x64Runtime.snapshot();
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.architectureMismatch, true);
    assert.match(mismatched.error, /架构与当前 Mac 不匹配/);

    const x64Installed = await x64Runtime.installBundled();
    assert.equal(x64Installed.ok, true);
    assert.equal(
      resolveLink(x64Runtime.currentLink()),
      path.join(x64Runtime.releasesRoot(), "0.145.0-x86_64-apple-darwin")
    );
    const x64Snapshot = await x64Runtime.snapshot();
    assert.equal(x64Snapshot.ok, true);
    assert.equal(x64Snapshot.architectureMismatch, false);
    assert.equal(x64Snapshot.rollbackAvailable, false);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log("Codex runtime tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
