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
const DEFAULT_REMOTE_STARTUP_BUDGET_MS = 1_500;
const DEFAULT_CODEX_PLUGIN_COMMAND_TIMEOUT_MS = 20_000;

function codexCheckFailureDetails(error, stage) {
  const message = String(error?.message || "").split(/\r?\n/)[0]
    .replace(/Command failed:.*$/i, "子进程执行失败")
    .replace(/(?:\/Users\/|\/private\/|\/var\/|\/Applications\/)\S+/g, "[本机路径]")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/((?:token|api[_-]?key|authorization|password)\s*[=:]\s*)\S+/gi, "$1[已隐藏]")
    .slice(0, 240);
  return {
    stage: String(error?.domiCheckStage || stage || "unknown"),
    exitCode: Number.isInteger(error?.code) ? error.code : null,
    code: typeof error?.code === "string" ? error.code : "",
    signal: typeof error?.signal === "string" ? error.signal : "",
    killed: error?.killed === true,
    errorClass: String(error?.name || "Error").slice(0, 40),
    message,
    timeout: error?.code === "ETIMEDOUT" || (error?.killed === true
      && ["SIGTERM", "SIGKILL"].includes(error?.signal))
  };
}

function pluginCheckFailure(error) {
  const diagnostic = codexCheckFailureDetails(error, "plugin/check");
  return {
    ok: false,
    updated: false,
    status: "check-failed",
    reason: diagnostic.timeout ? "plugin-check-timeout" : "plugin-check-failed",
    diagnostic,
    error: diagnostic.timeout
      ? "domi 插件状态检查超时，请稍后重试。"
      : "domi 插件状态暂未确认，请稍后重试。"
  };
}

async function checkRemoteWithinBudget(updater, budgetMs = DEFAULT_REMOTE_STARTUP_BUDGET_MS) {
  const timeoutMs = Math.max(0, Number(budgetMs) || 0);
  const checkPromise = Promise.resolve().then(() => updater.check());
  if (!timeoutMs) return checkPromise;
  const timedOut = Symbol("remote-plugin-check-timeout");
  let timer;
  const result = await Promise.race([
    checkPromise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(timedOut), timeoutMs);
    })
  ]);
  if (timer) clearTimeout(timer);
  if (result !== timedOut) return result;

  // The signed update continues into its atomic cache, but Codex readiness no
  // longer waits on GitHub or a slow proxy. A later check installs that cached
  // candidate before starting a new App Server.
  void checkPromise.catch(() => undefined);
  let candidate = null;
  try {
    candidate = updater.cachedCandidate?.() || null;
  } catch {
    candidate = null;
  }
  return {
    ok: true,
    checked: false,
    candidate,
    reason: "background-refresh"
  };
}

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

class DomiPluginActivationGate {
  constructor({ isBusy, installedInfo, ensure, onActivated }) {
    this.isBusy = isBusy;
    this.installedInfo = installedInfo;
    this.ensure = ensure;
    this.onActivated = onActivated;
    this.pending = null;
    this.readers = 0;
  }

  ensureWhenIdle(request) {
    if (this.pending) return this.pending;
    if (request?.enabled === false) {
      return Promise.resolve({ ok: true, updated: false, skipped: true, reason: "development" });
    }
    if (this.readers > 0 || this.isBusy()) {
      const current = this.installedInfo();
      return Promise.resolve({
        ok: Boolean(current),
        updated: false,
        deferred: true,
        status: current ? "deferred" : "missing",
        reason: "active-tasks",
        version: current?.manifest?.version || "",
        error: current ? "" : "当前仍有任务正在准备或执行，尚未安装 domi 插件；请等待任务结束后重新检查连接。"
      });
    }
    // Claim the slot synchronously before ensure() can yield. A task that
    // arrives afterwards waits below, and cannot use the client being reset.
    this.pending = Promise.resolve()
      .then(() => this.ensure(request))
      .then(async (result) => {
        if (result.updated) await this.onActivated();
        return result;
      })
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  async waitForActivation() {
    const activation = this.pending;
    if (!activation) return;
    const result = await activation;
    if (result?.ok === false) {
      throw new Error(result.error || "domi 插件激活未完成，请重新检查连接后重试。");
    }
  }

  async withStableClient(operation, { allowFailedActivation = false } = {}) {
    // Claim the read lease before yielding. If activation already owns the
    // slot, wait for it; otherwise new activations defer until this read ends.
    this.readers += 1;
    try {
      if (allowFailedActivation) {
        // A diagnostic reader waits for rollback/reset to drain, then checks
        // the actual installed state even when activation itself failed.
        await this.waitForActivation().catch(() => undefined);
      } else {
        await this.waitForActivation();
      }
      return await operation();
    } finally {
      this.readers -= 1;
    }
  }
}

class DomiPluginManager {
  constructor({
    userDataPath,
    bundledPluginRoot,
    bundledLockPath,
    clientVersion = "0.0.0",
    remoteUpdater = null,
    remoteUpdateEnabled = true,
    remoteStartupBudgetMs = DEFAULT_REMOTE_STARTUP_BUDGET_MS,
    codexCommandTimeoutMs = DEFAULT_CODEX_PLUGIN_COMMAND_TIMEOUT_MS,
    recoverTransactions = true
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
    this.remoteStartupBudgetMs = Math.max(0, Number(remoteStartupBudgetMs) || 0);
    this.codexCommandTimeoutMs = Math.max(
      1_000,
      Number(codexCommandTimeoutMs) || DEFAULT_CODEX_PLUGIN_COMMAND_TIMEOUT_MS
    );
    this.remoteUpdater = remoteUpdater || new DomiPluginUpdater({
      marketplaceRoot: this.marketplaceRoot,
      clientVersion
    });
    if (recoverTransactions) this.recoverInterruptedTransaction();
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
    let stdout;
    try {
      ({ stdout } = await execFileAsync(binary, args, {
        env,
        timeout: this.codexCommandTimeoutMs,
        maxBuffer: 16 * 1024 * 1024
      }));
    } catch (error) {
      // Store only the command category, never the executable/user path, for
      // structured diagnostics. The caller supplies a concise UI message.
      error.domiCheckStage = args.slice(0, args[1] === "marketplace" ? 3 : 2).join("/");
      throw error;
    }
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
      .catch(pluginCheckFailure)
      .then((result) => {
        this.lastResult = result;
        return result;
      })
      .finally(() => {
        this.ensurePromise = null;
      });
    return this.ensurePromise;
  }

  async checkInstalled({ binary, env, enabled = true }) {
    if (!enabled) return { ok: true, updated: false, skipped: true, status: "ready", reason: "development" };
    try {
      // This path must remain read-only: no remote update, marketplace writes,
      // installation, removal, transaction recovery or app-server reset.
      if (fs.existsSync(this.transactionStatePath)) return {
        ok: false, updated: false, status: "check-failed", reason: "activation-incomplete",
        error: "domi 插件安装尚未完成，请在任务结束后检查插件安装。"
      };
      const listing = await this.runCodex(binary, ["plugin", "list", "--json"], env);
      if (!Array.isArray(listing?.installed)) {
        return pluginCheckFailure({ domiCheckStage: "plugin/list", code: "INVALID_PLUGIN_LIST" });
      }
      const bundledVersion = this.bundledInfo()?.manifest?.version || "";
      const currentVersion = this.installedInfo()?.manifest?.version || bundledVersion;
      const requiredVersion = compareVersions(currentVersion, bundledVersion) > 0 ? currentVersion : bundledVersion;
      const installed = listing.installed.filter((item) => item.name === "domi"
        && item.enabled === true
        && typeof item.pluginId === "string" && /^domi@[^\s]+$/.test(item.pluginId)
        && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/.test(String(item.version || "")))
        .sort((left, right) => compareVersions(right.version, left.version)
          || Number(right.pluginId === PLUGIN_ID) - Number(left.pluginId === PLUGIN_ID))[0];
      if (!installed) return {
        ok: false, updated: false, status: "missing", reason: "plugin-missing",
        error: "尚未找到已启用的 domi 插件，请在任务结束后检查插件安装。"
      };
      if (requiredVersion && compareVersions(installed.version, requiredVersion) < 0) return {
        ok: false, updated: false, status: "missing", reason: "plugin-outdated",
        pluginId: installed.pluginId, version: installed.version, bundledVersion,
        error: "domi 插件版本需要更新，请在任务结束后检查插件安装。"
      };
      if (installed.pluginId !== PLUGIN_ID
        && compareVersions(installed.version, requiredVersion || "0") <= 0) return {
        ok: false, updated: false, status: "missing", reason: "plugin-unmanaged",
        error: "尚未确认当前 domi 插件已启用，请在任务结束后检查插件安装。"
      };
      return {
        ok: true, updated: false, status: "ready", reason: "installed-verified",
        pluginId: installed.pluginId, version: installed.version, bundledVersion
      };
    } catch (error) {
      return pluginCheckFailure(error);
    }
  }

  async #ensure({ binary, env }) {
    this.recoverInterruptedTransaction();
    const bundledInfo = this.bundledInfo();
    if (!bundledInfo) return {
      ok: false, skipped: true, status: "missing", reason: "plugin-bundle-missing",
      error: "安装包未包含 domi 插件。"
    };
    const installedInfo = this.installedInfo();
    const remoteResult = this.remoteUpdateEnabled
      ? await checkRemoteWithinBudget(this.remoteUpdater, this.remoteStartupBudgetMs)
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
  DEFAULT_CODEX_PLUGIN_COMMAND_TIMEOUT_MS,
  DEFAULT_REMOTE_STARTUP_BUDGET_MS,
  DomiPluginManager,
  DomiPluginActivationGate,
  MARKETPLACE_NAME,
  PLUGIN_ID,
  checkRemoteWithinBudget,
  compareVersions,
  selectPreferredCandidate,
  codexCheckFailureDetails,
  pluginCheckFailure
};
