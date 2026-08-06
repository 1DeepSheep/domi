const { BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const { CancellationToken } = require("builder-util-runtime");

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;
const CHECK_TIMEOUT_MS = 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const PUBLIC_UPDATE_FEED = Object.freeze({
  provider: "github",
  owner: "1DeepSheep",
  repo: "domi"
});

function normalizedChannel(value) {
  return value === "beta" ? "beta" : "stable";
}

function safeError(error) {
  return String(error?.message || error || "检查更新失败。")
    .replace(/([?&](?:token|key|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
}

class UpdateService {
  constructor({
    app,
    channelProvider,
    updater = autoUpdater,
    browserWindow = BrowserWindow,
    cancellationTokenFactory = () => new CancellationToken(),
    checkTimeoutMs = CHECK_TIMEOUT_MS,
    downloadTimeoutMs = DOWNLOAD_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setImmediateFn = setImmediate
  }) {
    this.app = app;
    this.channelProvider = channelProvider;
    this.updater = updater;
    this.browserWindow = browserWindow;
    this.cancellationTokenFactory = cancellationTokenFactory;
    this.checkTimeoutMs = checkTimeoutMs;
    this.downloadTimeoutMs = downloadTimeoutMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.setImmediateFn = setImmediateFn;
    this.started = false;
    this.running = false;
    this.startupTimer = null;
    this.interval = null;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.activeCheck = null;
    this.activeDownload = null;
    this.configuredChannel = null;
    this.channelEpoch = 0;
    this.candidate = null;
    this.downloadedCandidate = null;
    this.pendingCheck = false;
    this.pendingCheckScheduled = false;
    this.status = {
      state: app.isPackaged ? "idle" : "disabled",
      supported: app.isPackaged,
      currentVersion: app.getVersion(),
      availableVersion: "",
      channel: normalizedChannel(channelProvider()),
      percent: 0,
      transferred: 0,
      total: 0,
      releaseDate: "",
      error: app.isPackaged ? "" : "开发版不执行安装更新。正式安装版会自动检测。"
    };
  }

  snapshot() {
    return { ...this.status };
  }

  publish(patch = {}) {
    this.status = { ...this.status, ...patch };
    for (const win of this.browserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("update:status", this.snapshot());
    }
    return this.snapshot();
  }

  isCurrentOperation(operation) {
    return Boolean(
      operation
      && !operation.stale
      && !operation.timedOut
      && operation.channel === this.status.channel
      && operation.epoch === this.channelEpoch
    );
  }

  isCurrentCandidate(candidate = this.candidate) {
    return Boolean(
      candidate
      && candidate.channel === this.status.channel
      && candidate.epoch === this.channelEpoch
    );
  }

  disableAutoInstall() {
    if (this.app.isPackaged) this.updater.autoInstallOnAppQuit = false;
  }

  invalidateCandidate() {
    this.candidate = null;
    this.downloadedCandidate = null;
    this.disableAutoInstall();
  }

  requestRecheck() {
    this.pendingCheck = true;
    if (
      !this.running
      || this.pendingCheckScheduled
      || this.activeCheck
      || this.activeDownload
      || this.checkPromise
      || this.downloadPromise
    ) {
      return;
    }
    this.pendingCheckScheduled = true;
    this.setImmediateFn(() => {
      this.pendingCheckScheduled = false;
      if (
        !this.running
        || !this.pendingCheck
        || this.activeCheck
        || this.activeDownload
        || this.checkPromise
        || this.downloadPromise
      ) {
        return;
      }
      this.pendingCheck = false;
      void this.check();
    });
  }

  configureChannel(value) {
    const channel = normalizedChannel(value);
    const previousChannel = this.configuredChannel;
    const changed = previousChannel !== null && previousChannel !== channel;
    this.configuredChannel = channel;
    this.status.channel = channel;
    if (this.app.isPackaged) {
      // electron-updater's channel setter implicitly enables downgrades. Set it
      // first, then restore the safer policy explicitly for both channels.
      this.updater.channel = channel === "beta" ? "beta" : "latest";
      this.updater.allowPrerelease = channel === "beta";
      this.updater.allowDowngrade = false;
    }

    if (!changed) return this.publish({ channel });

    this.channelEpoch += 1;
    if (this.activeCheck) this.activeCheck.stale = true;
    if (this.activeDownload) {
      this.activeDownload.stale = true;
      this.activeDownload.cancellationToken.cancel();
    }
    this.invalidateCandidate();
    const snapshot = this.publish({
      state: "idle",
      channel,
      availableVersion: "",
      releaseDate: "",
      percent: 0,
      transferred: 0,
      total: 0,
      error: ""
    });
    if (this.running) this.requestRecheck();
    return snapshot;
  }

  configureFeed() {
    if (!this.app.isPackaged) return;
    this.updater.setFeedURL(PUBLIC_UPDATE_FEED);
  }

  async withTimeout(operation, timeoutMs, message) {
    let timer = null;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = this.setTimeoutFn(() => reject(new Error(message)), timeoutMs);
          timer?.unref?.();
        })
      ]);
    } finally {
      if (timer !== null) this.clearTimeoutFn(timer);
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.running = true;
    if (!this.app.isPackaged) return;

    this.updater.logger = null;
    this.updater.autoDownload = false;
    // Only enable install-on-quit after this service has observed a download
    // for the currently selected channel and epoch. This prevents a package
    // retained by electron-updater from a previous channel being installed.
    this.updater.autoInstallOnAppQuit = false;
    this.updater.autoRunAppAfterInstall = true;
    this.configureFeed();
    this.configureChannel(this.channelProvider());

    this.updater.on("checking-for-update", () => {
      if (!this.isCurrentOperation(this.activeCheck)) return;
      this.publish({
        state: "checking",
        availableVersion: "",
        releaseDate: "",
        percent: 0,
        transferred: 0,
        total: 0,
        error: ""
      });
    });
    this.updater.on("update-available", (info) => {
      const operation = this.activeCheck;
      if (!this.isCurrentOperation(operation)) return;
      this.candidate = {
        channel: operation.channel,
        epoch: operation.epoch,
        version: info.version || "",
        releaseDate: info.releaseDate || ""
      };
      this.downloadedCandidate = null;
      this.disableAutoInstall();
      this.publish({
        state: "available",
        availableVersion: this.candidate.version,
        releaseDate: this.candidate.releaseDate,
        percent: 0,
        transferred: 0,
        total: 0,
        error: ""
      });
    });
    this.updater.on("update-not-available", () => {
      if (!this.isCurrentOperation(this.activeCheck)) return;
      this.invalidateCandidate();
      this.publish({
        state: "up-to-date",
        availableVersion: "",
        releaseDate: "",
        percent: 0,
        transferred: 0,
        total: 0,
        error: ""
      });
    });
    this.updater.on("download-progress", (progress) => {
      if (!this.isCurrentOperation(this.activeDownload)) return;
      this.publish({
        state: "downloading",
        percent: Number(progress.percent || 0),
        transferred: Number(progress.transferred || 0),
        total: Number(progress.total || 0),
        error: ""
      });
    });
    this.updater.on("update-downloaded", (info) => {
      this.acceptDownloadedUpdate(this.activeDownload, info);
    });
    this.updater.on("error", (error) => {
      const operation = this.activeDownload || this.activeCheck;
      if (!this.isCurrentOperation(operation)) return;
      this.publish({
        state: "error",
        availableVersion: operation === this.activeDownload ? this.status.availableVersion : "",
        releaseDate: operation === this.activeDownload ? this.status.releaseDate : "",
        percent: 0,
        transferred: 0,
        total: 0,
        error: safeError(error)
      });
    });

    this.startupTimer = this.setTimeoutFn(() => void this.check(), STARTUP_DELAY_MS);
    this.startupTimer.unref?.();
    this.interval = this.setIntervalFn(() => void this.check(), CHECK_INTERVAL_MS);
    this.interval.unref?.();
  }

  stop() {
    if (this.startupTimer !== null) this.clearTimeoutFn(this.startupTimer);
    if (this.interval !== null) this.clearIntervalFn(this.interval);
    this.startupTimer = null;
    this.interval = null;
    this.running = false;
    this.pendingCheck = false;
  }

  acceptCheckResult(operation, result) {
    if (!this.isCurrentOperation(operation)) return this.snapshot();
    // The updater normally emits a terminal event before resolving its check
    // promise. Do not replace that event-derived state when an adapter resolves
    // without echoing the result object.
    if (["available", "up-to-date", "error"].includes(this.status.state)) {
      return this.snapshot();
    }
    const info = result?.updateInfo || result?.versionInfo || {};
    if (result?.isUpdateAvailable) {
      this.candidate = {
        channel: operation.channel,
        epoch: operation.epoch,
        version: info.version || "",
        releaseDate: info.releaseDate || ""
      };
      this.downloadedCandidate = null;
      this.disableAutoInstall();
      return this.publish({
        state: "available",
        availableVersion: this.candidate.version,
        releaseDate: this.candidate.releaseDate,
        percent: 0,
        transferred: 0,
        total: 0,
        error: ""
      });
    }
    if (result) {
      this.invalidateCandidate();
      return this.publish({
        state: "up-to-date",
        availableVersion: "",
        releaseDate: "",
        percent: 0,
        transferred: 0,
        total: 0,
        error: ""
      });
    }
    this.invalidateCandidate();
    return this.publish({
      state: "error",
      availableVersion: "",
      releaseDate: "",
      percent: 0,
      transferred: 0,
      total: 0,
      error: "更新服务未返回检查结果，请重试。"
    });
  }

  acceptOperationError(operation, error, preserveCandidate = false) {
    if (!this.isCurrentOperation(operation)) return this.snapshot();
    if (!preserveCandidate) this.invalidateCandidate();
    return this.publish({
      state: "error",
      availableVersion: preserveCandidate ? this.status.availableVersion : "",
      releaseDate: preserveCandidate ? this.status.releaseDate : "",
      percent: 0,
      transferred: 0,
      total: 0,
      error: safeError(error)
    });
  }

  async check() {
    if (!this.app.isPackaged) return this.snapshot();
    if (this.checkPromise) return this.checkPromise;
    if (this.activeCheck || this.activeDownload || this.downloadPromise) {
      this.pendingCheck = true;
      return this.snapshot();
    }
    if (this.status.state === "downloaded" && this.isCurrentCandidate(this.downloadedCandidate)) {
      return this.snapshot();
    }

    this.configureFeed();
    this.configureChannel(this.channelProvider());
    this.pendingCheck = false;
    this.invalidateCandidate();
    this.publish({
      state: "checking",
      availableVersion: "",
      releaseDate: "",
      percent: 0,
      transferred: 0,
      total: 0,
      error: ""
    });

    const operation = {
      channel: this.status.channel,
      epoch: this.channelEpoch,
      stale: false,
      timedOut: false
    };
    this.activeCheck = operation;
    const underlying = Promise.resolve().then(() => this.updater.checkForUpdates());
    const settled = underlying.then(
      (result) => this.acceptCheckResult(operation, result),
      (error) => this.acceptOperationError(operation, error)
    ).finally(() => {
      if (this.activeCheck === operation) this.activeCheck = null;
      if (this.pendingCheck) this.requestRecheck();
    });
    operation.settled = settled;

    const visibleOperation = this.withTimeout(
      settled,
      this.checkTimeoutMs,
      "检查更新超时，请检查网络后重试。"
    ).catch((error) => {
      if (this.activeCheck === operation && this.isCurrentOperation(operation)) {
        operation.timedOut = true;
        this.invalidateCandidate();
        return this.publish({
          state: "error",
          availableVersion: "",
          releaseDate: "",
          percent: 0,
          transferred: 0,
          total: 0,
          error: safeError(error)
        });
      }
      return this.snapshot();
    });
    const inFlight = visibleOperation.finally(() => {
      if (this.checkPromise === inFlight) this.checkPromise = null;
      if (this.pendingCheck) this.requestRecheck();
    });
    this.checkPromise = inFlight;
    return inFlight;
  }

  acceptDownloadedUpdate(operation, info = {}) {
    if (!this.isCurrentOperation(operation)) return this.snapshot();
    if (!this.isCurrentCandidate(operation.candidate)) return this.snapshot();
    const version = info.version || operation.candidate.version || "";
    this.downloadedCandidate = { ...operation.candidate, version };
    this.updater.autoInstallOnAppQuit = true;
    return this.publish({
      state: "downloaded",
      availableVersion: version,
      percent: 100,
      transferred: this.status.total || this.status.transferred,
      error: ""
    });
  }

  async download() {
    if (!this.app.isPackaged) return this.snapshot();
    if (this.downloadPromise) return this.downloadPromise;
    if (this.activeDownload || this.activeCheck) return this.snapshot();
    if (this.status.state !== "available" || !this.isCurrentCandidate()) {
      return this.snapshot();
    }

    const cancellationToken = this.cancellationTokenFactory();
    const operation = {
      channel: this.status.channel,
      epoch: this.channelEpoch,
      candidate: { ...this.candidate },
      cancellationToken,
      stale: false,
      timedOut: false
    };
    this.activeDownload = operation;
    this.disableAutoInstall();
    this.publish({ state: "downloading", percent: 0, error: "" });

    const underlying = Promise.resolve().then(() => this.updater.downloadUpdate(cancellationToken));
    const settled = underlying.then(
      () => this.acceptDownloadedUpdate(operation),
      (error) => this.acceptOperationError(operation, error, true)
    ).finally(() => {
      cancellationToken.dispose?.();
      if (this.activeDownload === operation) this.activeDownload = null;
      if (this.pendingCheck) this.requestRecheck();
    });
    operation.settled = settled;

    const visibleOperation = this.withTimeout(
      settled,
      this.downloadTimeoutMs,
      "更新下载超时，请检查网络后重新检查更新。"
    ).catch((error) => {
      if (this.activeDownload === operation && this.isCurrentOperation(operation)) {
        operation.timedOut = true;
        cancellationToken.cancel();
        this.invalidateCandidate();
        return this.publish({
          state: "error",
          availableVersion: "",
          releaseDate: "",
          percent: 0,
          transferred: 0,
          total: 0,
          error: safeError(error)
        });
      }
      return this.snapshot();
    });
    const inFlight = visibleOperation.finally(() => {
      if (this.downloadPromise === inFlight) this.downloadPromise = null;
      if (this.pendingCheck) this.requestRecheck();
    });
    this.downloadPromise = inFlight;
    return inFlight;
  }

  install() {
    const candidate = this.downloadedCandidate;
    if (
      !this.app.isPackaged
      || this.status.state !== "downloaded"
      || !this.isCurrentCandidate(candidate)
    ) {
      return { ok: false, status: this.snapshot(), error: "更新尚未下载完成。" };
    }
    this.setImmediateFn(() => {
      if (
        this.status.state === "downloaded"
        && this.downloadedCandidate === candidate
        && this.isCurrentCandidate(candidate)
      ) {
        this.updater.quitAndInstall(false, true);
      }
    });
    return { ok: true, status: this.snapshot() };
  }
}

module.exports = { UpdateService };
