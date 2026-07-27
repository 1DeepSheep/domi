const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const {
  DomiPluginUpdater,
  compareVersions
} = require("./domi-plugin-updater.cjs");

const execFileAsync = promisify(execFile);
const MARKETPLACE_NAME = "domi-managed";
const PLUGIN_ID = `domi@${MARKETPLACE_NAME}`;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonSafe(filePath) {
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function canonicalPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function candidateTimestamp(info) {
  const value = info?.lock?.publishedAt || info?.lock?.preparedAt || "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sourcePriority(info) {
  if (info?.source === "remote-release") return 3;
  if (info?.source === "installed") return 2;
  return 1;
}

function selectPreferredCandidate(candidates) {
  return candidates.filter(Boolean).sort((left, right) => {
    const versionComparison = compareVersions(right.manifest.version, left.manifest.version);
    if (versionComparison) return versionComparison;
    const timestampComparison = candidateTimestamp(right) - candidateTimestamp(left);
    if (timestampComparison) return timestampComparison;
    return sourcePriority(right) - sourcePriority(left);
  })[0] || null;
}

class DomiPluginManager {
  constructor({
    userDataPath,
    bundledPluginRoot,
    bundledLockPath,
    clientVersion = "0.0.0",
    remoteUpdater = null,
    remoteUpdateEnabled = true
  }) {
    this.userDataPath = userDataPath;
    this.bundledPluginRoot = bundledPluginRoot;
    this.bundledLockPath = bundledLockPath;
    this.marketplaceRoot = path.join(userDataPath, "runtime", "domi-marketplace");
    this.transactionStatePath = path.join(
      this.marketplaceRoot,
      "domi-plugin-transaction.json"
    );
    this.remoteUpdateEnabled = remoteUpdateEnabled;
    this.remoteUpdater = remoteUpdater || new DomiPluginUpdater({
      marketplaceRoot: this.marketplaceRoot,
      clientVersion
    });
    this.recoverInterruptedTransaction();
    this.ensurePromise = null;
    this.lastResult = null;
  }

  recoverInterruptedTransaction() {
    const state = readJsonSafe(this.transactionStatePath);
    if (!state) return false;
    const pluginRoot = path.join(this.marketplaceRoot, "plugins", "domi");
    const previousPluginRoot = path.join(this.marketplaceRoot, "plugins", ".domi-previous");
    const installedLockPath = path.join(this.marketplaceRoot, "domi-plugin-lock.json");

    if (state.hadPreviousPlugin && fs.existsSync(previousPluginRoot)) {
      fs.rmSync(pluginRoot, { recursive: true, force: true });
      fs.renameSync(previousPluginRoot, pluginRoot);
    } else if (!state.hadPreviousPlugin) {
      fs.rmSync(pluginRoot, { recursive: true, force: true });
    }
    if (state.previousLockBase64) {
      fs.writeFileSync(
        installedLockPath,
        Buffer.from(state.previousLockBase64, "base64")
      );
    } else {
      fs.rmSync(installedLockPath, { force: true });
    }
    fs.rmSync(this.transactionStatePath, { force: true });
    return true;
  }

  bundledInfo() {
    const manifestPath = path.join(this.bundledPluginRoot, ".codex-plugin", "plugin.json");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(this.bundledLockPath)) return null;
    const manifest = readJson(manifestPath);
    const lock = readJson(this.bundledLockPath);
    if (manifest.name !== "domi" || manifest.version !== lock.pluginVersion) {
      throw new Error("内置 domi 插件清单与版本锁不一致。");
    }
    return {
      source: "bundled",
      root: this.bundledPluginRoot,
      manifest,
      lock
    };
  }

  installedInfo() {
    const root = path.join(this.marketplaceRoot, "plugins", "domi");
    const manifest = readJsonSafe(path.join(root, ".codex-plugin", "plugin.json"));
    const lock = readJsonSafe(path.join(this.marketplaceRoot, "domi-plugin-lock.json"));
    if (!manifest || !lock || manifest.name !== "domi" || manifest.version !== lock.pluginVersion) {
      return null;
    }
    return { source: "installed", root, manifest, lock };
  }

  async runCodex(binary, args, env) {
    const { stdout } = await execFileAsync(binary, args, {
      env,
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024
    });
    if (!stdout.trim()) return {};
    try {
      return JSON.parse(stdout);
    } catch {
      return { output: stdout.trim() };
    }
  }

  writeMarketplaceDefinition() {
    const marketplacePath = path.join(this.marketplaceRoot, ".agents", "plugins", "marketplace.json");
    fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
    fs.writeFileSync(marketplacePath, `${JSON.stringify({
      name: MARKETPLACE_NAME,
      interface: { displayName: "domi Managed" },
      plugins: [{
        name: "domi",
        source: { source: "local", path: "./plugins/domi" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity"
      }]
    }, null, 2)}\n`, "utf8");
  }

  prepareManagedMarketplace(info) {
    const pluginRoot = path.join(this.marketplaceRoot, "plugins", "domi");
    const installedLockPath = path.join(this.marketplaceRoot, "domi-plugin-lock.json");
    const previousPluginRoot = path.join(this.marketplaceRoot, "plugins", ".domi-previous");
    const installedLock = readJsonSafe(installedLockPath);
    const sourceChanged = !installedLock
      || installedLock.pluginVersion !== info.lock.pluginVersion
      || installedLock.gitCommit !== info.lock.gitCommit
      || installedLock.sha256 !== info.lock.sha256;

    this.writeMarketplaceDefinition();
    if (!sourceChanged) {
      return {
        changed: false,
        rollback() {},
        finalize() {}
      };
    }

    const nextPluginRoot = path.join(
      this.marketplaceRoot,
      "plugins",
      `.domi-next-${process.pid}-${Date.now()}`
    );
    const previousLockBytes = fs.existsSync(installedLockPath)
      ? fs.readFileSync(installedLockPath)
      : null;
    const hadPreviousPlugin = fs.existsSync(pluginRoot);
    fs.mkdirSync(path.dirname(pluginRoot), { recursive: true });
    fs.rmSync(nextPluginRoot, { recursive: true, force: true });
    fs.cpSync(info.root, nextPluginRoot, { recursive: true });
    const copiedManifest = readJsonSafe(path.join(nextPluginRoot, ".codex-plugin", "plugin.json"));
    if (copiedManifest?.name !== "domi" || copiedManifest.version !== info.lock.pluginVersion) {
      fs.rmSync(nextPluginRoot, { recursive: true, force: true });
      throw new Error("待安装的 domi 插件与版本锁不一致。");
    }

    writeJsonAtomic(this.transactionStatePath, {
      schemaVersion: 1,
      hadPreviousPlugin,
      previousLockBase64: previousLockBytes?.toString("base64") || "",
      nextLock: info.lock
    });
    fs.rmSync(previousPluginRoot, { recursive: true, force: true });
    if (fs.existsSync(pluginRoot)) fs.renameSync(pluginRoot, previousPluginRoot);
    try {
      fs.renameSync(nextPluginRoot, pluginRoot);
      writeJsonAtomic(installedLockPath, info.lock);
    } catch (error) {
      this.recoverInterruptedTransaction();
      fs.rmSync(nextPluginRoot, { recursive: true, force: true });
      throw error;
    }

    let active = true;
    return {
      changed: true,
      rollback: () => {
        if (!active) return;
        this.recoverInterruptedTransaction();
        active = false;
      },
      finalize: () => {
        fs.rmSync(this.transactionStatePath, { force: true });
        active = false;
      }
    };
  }

  writeManagedMarketplace(info) {
    const transaction = this.prepareManagedMarketplace(info);
    transaction.finalize();
    return transaction.changed;
  }

  async ensure({ binary, env, enabled = true }) {
    if (!enabled) return { ok: true, skipped: true, reason: "development" };
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this.#ensure({ binary, env })
      .then((result) => {
        this.lastResult = result;
        return result;
      })
      .finally(() => {
        this.ensurePromise = null;
      });
    return this.ensurePromise;
  }

  async #ensure({ binary, env }) {
    const bundledInfo = this.bundledInfo();
    if (!bundledInfo) return { ok: false, skipped: true, error: "安装包未包含 domi 插件。" };
    const installedInfo = this.installedInfo();
    const remoteResult = this.remoteUpdateEnabled
      ? await this.remoteUpdater.check()
      : { ok: true, checked: false, candidate: null, reason: "disabled" };
    const info = selectPreferredCandidate([
      bundledInfo,
      installedInfo,
      remoteResult.candidate
    ]);
    this.writeMarketplaceDefinition();
    const marketplaceList = await this.runCodex(binary, ["plugin", "marketplace", "list", "--json"], env);
    const configured = (marketplaceList.marketplaces || []).find((item) => item.name === MARKETPLACE_NAME);
    if (configured && canonicalPath(configured.root) !== canonicalPath(this.marketplaceRoot)) {
      throw new Error(`Codex 中已存在同名 Marketplace，但路径不是 domi 管理目录：${configured.root}`);
    }
    if (!configured) {
      await this.runCodex(binary, ["plugin", "marketplace", "add", this.marketplaceRoot, "--json"], env);
    }

    const before = await this.runCodex(binary, ["plugin", "list", "--json"], env);
    const installedDomi = (before.installed || []).filter((item) => item.name === "domi" && item.enabled);
    const newestExisting = installedDomi
      .slice()
      .sort((left, right) => compareVersions(right.version, left.version))[0];
    const managedExisting = installedDomi.find((item) => item.pluginId === PLUGIN_ID);
    const newestComparison = newestExisting
      ? compareVersions(newestExisting.version, info.manifest.version)
      : -1;
    const managedIsCurrent = managedExisting
      && compareVersions(managedExisting.version, info.manifest.version) === 0;

    // A genuinely newer user-installed plugin wins. At the same version, the
    // newest signed/bundled/installed candidate is authoritative.
    if (newestExisting && newestComparison > 0) {
      return {
        ok: true,
        updated: false,
        pluginId: newestExisting.pluginId,
        version: newestExisting.version,
        bundledVersion: bundledInfo.manifest.version,
        gitCommit: info.lock.gitCommit,
        remoteUpdate: remoteResult
      };
    }

    const transaction = this.prepareManagedMarketplace(info);
    if (managedIsCurrent && !transaction.changed) {
      return {
        ok: true,
        updated: false,
        pluginId: managedExisting.pluginId,
        version: managedExisting.version,
        bundledVersion: bundledInfo.manifest.version,
        gitCommit: info.lock.gitCommit,
        source: info.source,
        remoteUpdate: remoteResult
      };
    }

    try {
      if (managedExisting) {
        await this.runCodex(binary, ["plugin", "remove", PLUGIN_ID], env);
      }
      await this.runCodex(binary, ["plugin", "add", PLUGIN_ID, "--json"], env);
      for (const plugin of installedDomi) {
        if (plugin.pluginId !== PLUGIN_ID && compareVersions(plugin.version, info.manifest.version) <= 0) {
          await this.runCodex(binary, ["plugin", "remove", plugin.pluginId], env);
        }
      }
      transaction.finalize();
    } catch (error) {
      transaction.rollback();
      if (managedExisting) {
        try {
          await this.runCodex(binary, ["plugin", "add", PLUGIN_ID, "--json"], env);
        } catch {
          // Preserve the original error; the restored files remain available
          // for the next startup recovery attempt.
        }
      }
      throw error;
    }
    return {
      ok: true,
      updated: true,
      pluginId: PLUGIN_ID,
      version: info.manifest.version,
      bundledVersion: bundledInfo.manifest.version,
      gitCommit: info.lock.gitCommit,
      source: info.source,
      remoteUpdate: remoteResult
    };
  }
}

module.exports = {
  DomiPluginManager,
  MARKETPLACE_NAME,
  PLUGIN_ID,
  compareVersions,
  selectPreferredCandidate
};
