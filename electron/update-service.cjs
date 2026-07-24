const { BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;

function normalizedChannel(value) {
  return value === "beta" ? "beta" : "stable";
}

function safeError(error) {
  return String(error?.message || error || "检查更新失败。")
    .replace(/([?&](?:token|key|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
}

class UpdateService {
  constructor({ app, channelProvider }) {
    this.app = app;
    this.channelProvider = channelProvider;
    this.started = false;
    this.startupTimer = null;
    this.interval = null;
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
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("update:status", this.snapshot());
    }
    return this.snapshot();
  }

  configureChannel(value) {
    const channel = normalizedChannel(value);
    this.status.channel = channel;
    if (this.app.isPackaged) {
      autoUpdater.allowPrerelease = channel === "beta";
      autoUpdater.allowDowngrade = channel === "stable";
      autoUpdater.channel = channel === "beta" ? "beta" : "latest";
    }
    return this.publish({ channel });
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (!this.app.isPackaged) return;

    autoUpdater.logger = null;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    this.configureChannel(this.channelProvider());

    autoUpdater.on("checking-for-update", () => {
      this.publish({ state: "checking", error: "" });
    });
    autoUpdater.on("update-available", (info) => {
      this.publish({
        state: "available",
        availableVersion: info.version || "",
        releaseDate: info.releaseDate || "",
        percent: 0,
        transferred: 0,
        total: 0,
        error: ""
      });
    });
    autoUpdater.on("update-not-available", () => {
      this.publish({
        state: "up-to-date",
        availableVersion: "",
        percent: 0,
        transferred: 0,
        total: 0,
        error: ""
      });
    });
    autoUpdater.on("download-progress", (progress) => {
      this.publish({
        state: "downloading",
        percent: Number(progress.percent || 0),
        transferred: Number(progress.transferred || 0),
        total: Number(progress.total || 0),
        error: ""
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.publish({
        state: "downloaded",
        availableVersion: info.version || this.status.availableVersion,
        percent: 100,
        error: ""
      });
    });
    autoUpdater.on("error", (error) => {
      this.publish({ state: "error", error: safeError(error) });
    });

    this.startupTimer = setTimeout(() => void this.check(), STARTUP_DELAY_MS);
    this.startupTimer.unref?.();
    this.interval = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.interval.unref?.();
  }

  stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.interval) clearInterval(this.interval);
    this.startupTimer = null;
    this.interval = null;
  }

  async check() {
    if (!this.app.isPackaged) return this.snapshot();
    if (new Set(["checking", "downloading", "downloaded"]).has(this.status.state)) {
      return this.snapshot();
    }
    this.configureChannel(this.channelProvider());
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      return this.publish({ state: "error", error: safeError(error) });
    }
    return this.snapshot();
  }

  async download() {
    if (!this.app.isPackaged) return this.snapshot();
    if (this.status.state !== "available") return this.snapshot();
    this.publish({ state: "downloading", percent: 0, error: "" });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      return this.publish({ state: "error", error: safeError(error) });
    }
    return this.snapshot();
  }

  install() {
    if (!this.app.isPackaged || this.status.state !== "downloaded") {
      return { ok: false, status: this.snapshot(), error: "更新尚未下载完成。" };
    }
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true, status: this.snapshot() };
  }
}

module.exports = { UpdateService };
