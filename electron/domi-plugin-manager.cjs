const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const MARKETPLACE_NAME = "domi-managed";
const PLUGIN_ID = `domi@${MARKETPLACE_NAME}`;

function numericVersionParts(version) {
  return String(version || "0").match(/\d+/g)?.map(Number) || [0];
}

function compareVersions(left, right) {
  const a = numericVersionParts(left);
  const b = numericVersionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function canonicalPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

class DomiPluginManager {
  constructor({ userDataPath, bundledPluginRoot, bundledLockPath }) {
    this.userDataPath = userDataPath;
    this.bundledPluginRoot = bundledPluginRoot;
    this.bundledLockPath = bundledLockPath;
    this.marketplaceRoot = path.join(userDataPath, "runtime", "domi-marketplace");
    this.ensurePromise = null;
    this.lastResult = null;
  }

  bundledInfo() {
    const manifestPath = path.join(this.bundledPluginRoot, ".codex-plugin", "plugin.json");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(this.bundledLockPath)) return null;
    const manifest = readJson(manifestPath);
    const lock = readJson(this.bundledLockPath);
    if (manifest.name !== "domi" || manifest.version !== lock.pluginVersion) {
      throw new Error("内置 Domi 插件清单与版本锁不一致。");
    }
    return { manifest, lock };
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

  writeManagedMarketplace(info) {
    const pluginRoot = path.join(this.marketplaceRoot, "plugins", "domi");
    const installedLockPath = path.join(this.marketplaceRoot, "domi-plugin-lock.json");
    const installedLock = fs.existsSync(installedLockPath) ? readJson(installedLockPath) : null;
    const sourceChanged = !installedLock
      || installedLock.pluginVersion !== info.lock.pluginVersion
      || installedLock.gitCommit !== info.lock.gitCommit
      || installedLock.sha256 !== info.lock.sha256;

    if (sourceChanged) {
      fs.rmSync(pluginRoot, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(pluginRoot), { recursive: true });
      fs.cpSync(this.bundledPluginRoot, pluginRoot, { recursive: true });
      fs.writeFileSync(installedLockPath, `${JSON.stringify(info.lock, null, 2)}\n`, "utf8");
    }

    const marketplacePath = path.join(this.marketplaceRoot, ".agents", "plugins", "marketplace.json");
    fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
    fs.writeFileSync(marketplacePath, `${JSON.stringify({
      name: MARKETPLACE_NAME,
      interface: { displayName: "Domi Managed" },
      plugins: [{
        name: "domi",
        source: { source: "local", path: "./plugins/domi" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity"
      }]
    }, null, 2)}\n`, "utf8");
    return sourceChanged;
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
    const info = this.bundledInfo();
    if (!info) return { ok: false, skipped: true, error: "安装包未包含 Domi 插件。" };
    const sourceChanged = this.writeManagedMarketplace(info);
    const marketplaceList = await this.runCodex(binary, ["plugin", "marketplace", "list", "--json"], env);
    const configured = (marketplaceList.marketplaces || []).find((item) => item.name === MARKETPLACE_NAME);
    if (configured && canonicalPath(configured.root) !== canonicalPath(this.marketplaceRoot)) {
      throw new Error(`Codex 中已存在同名 Marketplace，但路径不是豆米管理目录：${configured.root}`);
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
    // bundled commit is authoritative so a stale or differently sourced copy
    // cannot survive a client update.
    if (newestExisting && (newestComparison > 0 || (managedIsCurrent && !sourceChanged))) {
      return {
        ok: true,
        updated: false,
        pluginId: newestExisting.pluginId,
        version: newestExisting.version,
        bundledVersion: info.manifest.version,
        gitCommit: info.lock.gitCommit
      };
    }

    if (managedExisting) {
      await this.runCodex(binary, ["plugin", "remove", PLUGIN_ID], env);
    }
    await this.runCodex(binary, ["plugin", "add", PLUGIN_ID, "--json"], env);
    for (const plugin of installedDomi) {
      if (plugin.pluginId !== PLUGIN_ID && compareVersions(plugin.version, info.manifest.version) <= 0) {
        await this.runCodex(binary, ["plugin", "remove", plugin.pluginId], env);
      }
    }
    return {
      ok: true,
      updated: true,
      pluginId: PLUGIN_ID,
      version: info.manifest.version,
      bundledVersion: info.manifest.version,
      gitCommit: info.lock.gitCommit
    };
  }
}

module.exports = {
  DomiPluginManager,
  MARKETPLACE_NAME,
  PLUGIN_ID,
  compareVersions
};
