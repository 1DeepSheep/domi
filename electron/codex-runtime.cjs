const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const RUNTIME_STATE_VERSION = 1;
const RUNTIME_TARGETS = Object.freeze({
  arm64: Object.freeze({
    target: "aarch64-apple-darwin",
    assetName: "codex-package-aarch64-apple-darwin.tar.gz"
  }),
  x64: Object.freeze({
    target: "x86_64-apple-darwin",
    assetName: "codex-package-x86_64-apple-darwin.tar.gz"
  })
});

function expectedTargetForArch(arch = process.arch) {
  const normalized = String(arch || "").trim();
  const expected = RUNTIME_TARGETS[normalized];
  if (!expected) {
    throw new Error(`domi 不支持当前 Codex Runtime 架构：${normalized || "unknown"}。`);
  }
  return expected;
}

const EXPECTED_TARGET = expectedTargetForArch().target;

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const input = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(input, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(input);
  }
  return hash.digest("hex");
}

function validateManifest(manifest, {
  minimumSize = 50 * 1024 * 1024,
  arch = process.arch
} = {}) {
  const expected = expectedTargetForArch(arch);
  if (
    manifest?.schemaVersion !== 1
    || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(String(manifest.version || ""))
    || manifest.target !== expected.target
    || manifest.assetName !== expected.assetName
    || !/^[a-f0-9]{64}$/.test(String(manifest.sha256 || ""))
    || !Number.isSafeInteger(manifest.size)
    || manifest.size < minimumSize
    || manifest.size > 300 * 1024 * 1024
  ) {
    throw new Error("内置 Codex Runtime 清单无效，请重新安装 domi。");
  }
  return manifest;
}

function readManifest(manifestPath, options) {
  return validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")), options);
}

function assertSafeArchiveList(content) {
  const entries = String(content || "").split(/\r?\n/).filter(Boolean);
  if (!entries.length) throw new Error("内置 Codex Runtime 压缩包为空。");
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    if (
      normalized.startsWith("/")
      || normalized.includes("\0")
      || segments.includes("..")
    ) {
      throw new Error("内置 Codex Runtime 压缩包包含不安全路径。");
    }
  }
}

function atomicSymlink(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true, mode: 0o700 });
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporaryLink = `${linkPath}.domi-${process.pid}-${Date.now()}`;
  fs.rmSync(temporaryLink, { force: true });
  fs.symlinkSync(target, temporaryLink);
  try {
    fs.renameSync(temporaryLink, linkPath);
  } catch (error) {
    if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) {
      fs.rmSync(temporaryLink, { force: true });
      return false;
    }
    fs.rmSync(linkPath, { force: true });
    fs.renameSync(temporaryLink, linkPath);
  }
  return true;
}

function resolveLink(linkPath) {
  try {
    if (!fs.lstatSync(linkPath).isSymbolicLink()) return "";
    return path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
  } catch {
    return "";
  }
}

class CodexRuntimeManager {
  constructor({
    homeDir = os.homedir(),
    archivePath,
    manifestPath,
    exec = execFileAsync,
    minimumArchiveSize = 50 * 1024 * 1024,
    arch = process.arch
  } = {}) {
    this.homeDir = homeDir;
    this.archivePath = archivePath;
    this.manifestPath = manifestPath;
    this.exec = exec;
    this.minimumArchiveSize = minimumArchiveSize;
    this.arch = arch;
    this.expectedRuntime = expectedTargetForArch(arch);
  }

  packageRoot() {
    return path.join(this.homeDir, ".codex", "packages", "standalone");
  }

  currentLink() {
    return path.join(this.packageRoot(), "current");
  }

  releasesRoot() {
    return path.join(this.packageRoot(), "releases");
  }

  statePath() {
    return path.join(this.packageRoot(), "domi-runtime-state.json");
  }

  bundledManifest() {
    return readManifest(this.manifestPath, {
      minimumSize: this.minimumArchiveSize,
      arch: this.arch
    });
  }

  targetMatchesCurrentArch(targetPath) {
    const resolved = String(targetPath || "").trim();
    return Boolean(resolved)
      && path.basename(resolved).endsWith(`-${this.expectedRuntime.target}`);
  }

  readState() {
    try {
      const state = JSON.parse(fs.readFileSync(this.statePath(), "utf8"));
      return state?.schemaVersion === RUNTIME_STATE_VERSION ? state : {};
    } catch {
      return {};
    }
  }

  writeState(patch = {}) {
    const state = {
      schemaVersion: RUNTIME_STATE_VERSION,
      ...this.readState(),
      ...patch,
      updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(this.packageRoot(), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.statePath()}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, this.statePath());
    return state;
  }

  async binaryVersion(binaryPath) {
    const { stdout } = await this.exec(binaryPath, ["--version"], {
      env: { ...process.env, HOME: this.homeDir },
      timeout: 15_000,
      maxBuffer: 1024 * 1024
    });
    return String(stdout || "").trim();
  }

  async snapshot() {
    const currentTarget = resolveLink(this.currentLink());
    const binaryPath = currentTarget ? path.join(currentTarget, "bin", "codex") : "";
    const architectureMismatch = Boolean(
      currentTarget && !this.targetMatchesCurrentArch(currentTarget)
    );
    let version = "";
    let ok = false;
    if (!architectureMismatch) {
      try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
        version = await this.binaryVersion(binaryPath);
        ok = Boolean(version);
      } catch {
        // A missing managed runtime is a valid pre-install state.
      }
    }
    const state = this.readState();
    const rollbackTarget = String(state.previousTarget || "");
    const rollbackAvailable = Boolean(
      rollbackTarget
      && rollbackTarget !== currentTarget
      && this.targetMatchesCurrentArch(rollbackTarget)
      && fs.existsSync(path.join(rollbackTarget, "bin", "codex"))
    );
    let bundledVersion = "";
    try {
      bundledVersion = this.bundledManifest().version;
    } catch {
      // Development builds may not have prepared the bundled runtime yet.
    }
    return {
      ok,
      managed: Boolean(currentTarget),
      path: binaryPath,
      version,
      bundledVersion,
      currentTarget,
      architectureMismatch,
      rollbackAvailable,
      rollbackVersion: String(state.previousVersion || ""),
      error: ok
        ? ""
        : architectureMismatch
          ? `已安装的 Codex Runtime 架构与当前 Mac 不匹配，需要安装 ${this.arch} 版本。`
          : "尚未安装 domi 管理的 Codex Runtime。"
    };
  }

  async installBundled() {
    const manifest = this.bundledManifest();
    const stat = fs.statSync(this.archivePath);
    if (stat.size !== manifest.size || sha256File(this.archivePath) !== manifest.sha256) {
      throw new Error("内置 Codex Runtime 完整性校验失败，请重新下载安装 domi。");
    }

    fs.mkdirSync(this.releasesRoot(), { recursive: true, mode: 0o700 });
    const releaseName = `${manifest.version}-${manifest.target}`;
    const releasePath = path.join(this.releasesRoot(), releaseName);
    const releaseBinary = path.join(releasePath, "bin", "codex");
    const previousTarget = resolveLink(this.currentLink());
    let previousVersion = "";
    if (previousTarget && fs.existsSync(path.join(previousTarget, "bin", "codex"))) {
      try {
        previousVersion = await this.binaryVersion(path.join(previousTarget, "bin", "codex"));
      } catch {
        // Preserve the target even if the old binary cannot report its version.
      }
    }

    if (!fs.existsSync(releaseBinary)) {
      const stagingRoot = fs.mkdtempSync(path.join(this.releasesRoot(), ".domi-install-"));
      try {
        const { stdout: archiveList } = await this.exec("/usr/bin/tar", ["-tzf", this.archivePath], {
          timeout: 30_000,
          maxBuffer: 16 * 1024 * 1024
        });
        assertSafeArchiveList(archiveList);
        await this.exec("/usr/bin/tar", ["-xzf", this.archivePath, "-C", stagingRoot], {
          timeout: 5 * 60_000,
          maxBuffer: 4 * 1024 * 1024
        });
        const candidates = [
          stagingRoot,
          ...fs.readdirSync(stagingRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(stagingRoot, entry.name))
        ];
        const packagePath = candidates.find((candidate) =>
          fs.existsSync(path.join(candidate, "bin", "codex"))
        );
        if (!packagePath) {
          throw new Error("内置 Codex Runtime 缺少可执行文件。");
        }
        fs.chmodSync(path.join(packagePath, "bin", "codex"), 0o755);
        const hostBinary = path.join(packagePath, "bin", "codex-code-mode-host");
        if (fs.existsSync(hostBinary)) fs.chmodSync(hostBinary, 0o755);
        const reportedVersion = await this.binaryVersion(path.join(packagePath, "bin", "codex"));
        if (!reportedVersion.includes(manifest.version)) {
          throw new Error("内置 Codex Runtime 版本校验失败。");
        }
        fs.rmSync(releasePath, { recursive: true, force: true });
        fs.renameSync(packagePath, releasePath);
      } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      }
    }

    const version = await this.binaryVersion(releaseBinary);
    atomicSymlink(releasePath, this.currentLink());
    const visibleBin = path.join(this.homeDir, ".local", "bin");
    atomicSymlink(path.join(this.currentLink(), "bin", "codex"), path.join(visibleBin, "codex"));
    const hostBinary = path.join(releasePath, "bin", "codex-code-mode-host");
    if (fs.existsSync(hostBinary)) {
      atomicSymlink(
        path.join(this.currentLink(), "bin", "codex-code-mode-host"),
        path.join(visibleBin, "codex-code-mode-host")
      );
    }
    this.writeState({
      bundledVersion: manifest.version,
      currentTarget: releasePath,
      currentVersion: version,
      previousTarget: previousTarget && previousTarget !== releasePath ? previousTarget : "",
      previousVersion: previousTarget && previousTarget !== releasePath ? previousVersion : "",
      installedAt: new Date().toISOString()
    });
    return { ok: true, path: releaseBinary, version, installedNow: true };
  }

  captureCurrent() {
    return {
      target: resolveLink(this.currentLink()),
      state: this.readState()
    };
  }

  restoreCaptured(previous) {
    const target = String(previous?.target || "");
    if (
      !target
      || !this.targetMatchesCurrentArch(target)
      || !fs.existsSync(path.join(target, "bin", "codex"))
    ) return false;
    atomicSymlink(target, this.currentLink());
    return true;
  }

  async recordExternalUpdate(previous) {
    const currentTarget = resolveLink(this.currentLink());
    if (!currentTarget) throw new Error("Codex 更新完成，但没有找到新的运行时。");
    const binaryPath = path.join(currentTarget, "bin", "codex");
    const version = await this.binaryVersion(binaryPath);
    const previousTarget = String(previous?.target || "");
    let previousVersion = "";
    if (previousTarget && fs.existsSync(path.join(previousTarget, "bin", "codex"))) {
      try {
        previousVersion = await this.binaryVersion(path.join(previousTarget, "bin", "codex"));
      } catch {
        // The path is still retained for manual rollback diagnostics.
      }
    }
    this.writeState({
      currentTarget,
      currentVersion: version,
      previousTarget: previousTarget !== currentTarget ? previousTarget : "",
      previousVersion: previousTarget !== currentTarget ? previousVersion : "",
      updatedAt: new Date().toISOString()
    });
    return this.snapshot();
  }

  async rollback() {
    const state = this.readState();
    const previousTarget = String(state.previousTarget || "");
    const previousBinary = path.join(previousTarget, "bin", "codex");
    if (
      !previousTarget
      || !this.targetMatchesCurrentArch(previousTarget)
      || !fs.existsSync(previousBinary)
    ) {
      throw new Error("没有可恢复的 Codex Runtime 版本。");
    }
    const currentTarget = resolveLink(this.currentLink());
    const currentVersion = currentTarget && fs.existsSync(path.join(currentTarget, "bin", "codex"))
      ? await this.binaryVersion(path.join(currentTarget, "bin", "codex")).catch(() => "")
      : "";
    const version = await this.binaryVersion(previousBinary);
    atomicSymlink(previousTarget, this.currentLink());
    this.writeState({
      currentTarget: previousTarget,
      currentVersion: version,
      previousTarget: currentTarget,
      previousVersion: currentVersion,
      rolledBackAt: new Date().toISOString()
    });
    return this.snapshot();
  }
}

module.exports = {
  CodexRuntimeManager,
  EXPECTED_TARGET,
  RUNTIME_TARGETS,
  RUNTIME_STATE_VERSION,
  assertSafeArchiveList,
  atomicSymlink,
  expectedTargetForArch,
  readManifest,
  resolveLink,
  sha256File,
  validateManifest
};
