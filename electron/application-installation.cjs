const fs = require("node:fs");
const path = require("node:path");

const INSTALLATION_MARKER = "application-installation-prompt-v1.json";
const startupAttempts = new WeakMap();

function continuing(status) {
  return { continueStartup: true, status };
}

/**
 * Call after app.whenReady(), while holding the single-instance lock, before
 * creating windows or starting background work. isSafeToInstall must confirm
 * that no task, pending write or other instance can be interrupted.
 *
 * A successful native move quits and relaunches Electron itself. The caller
 * must return immediately when continueStartup is false; it must not add a
 * second quit/relaunch or start services in the old process.
 */
function maybeInstallApplication(options) {
  const app = options?.app;
  if (!app || typeof app !== "object") return Promise.resolve(continuing("unavailable"));
  if (startupAttempts.has(app)) return startupAttempts.get(app);
  const attempt = runInstallationGuide(options);
  startupAttempts.set(app, attempt);
  return attempt;
}

async function runInstallationGuide({
  app,
  dialog,
  platform = process.platform,
  isSafeToInstall,
  fileSystem = fs,
  onEvent = () => {}
}) {
  const report = (status, error) => {
    try {
      onEvent(status, error ? { code: String(error.code || "unknown") } : {});
    } catch { /* Diagnostics must not prevent normal startup. */ }
  };
  const safeToInstall = () => {
    try { return typeof isSafeToInstall === "function" && isSafeToInstall() === true; }
    catch (error) { report("safety-check-failed", error); return false; }
  };
  const inform = async (message, detail) => {
    try {
      await dialog.showMessageBox({
        type: "info", title: "安装 domi", message, detail,
        buttons: ["继续使用"], defaultId: 0, cancelId: 0, noLink: true
      });
    } catch (error) { report("notice-failed", error); }
  };

  if (platform !== "darwin" || app.isPackaged !== true) return continuing("not-applicable");
  if (typeof app.isInApplicationsFolder !== "function"
    || typeof app.moveToApplicationsFolder !== "function"
    || typeof dialog?.showMessageBox !== "function") return continuing("unavailable");
  try {
    if (app.isInApplicationsFolder()) return continuing("already-installed");
  } catch (error) {
    report("location-check-failed", error);
    return continuing("location-check-failed");
  }
  if (!safeToInstall()) return continuing("unsafe-to-install");

  // Claim once, across releases and process restarts, before showing a dialog.
  // An unreadable/corrupt existing marker also suppresses the prompt. If the
  // marker cannot be saved, skip the guide rather than nagging on every launch.
  try {
    const userDataPath = app.getPath("userData");
    if (!path.isAbsolute(userDataPath)) return continuing("marker-unavailable");
    fileSystem.mkdirSync(userDataPath, { recursive: true });
    fileSystem.writeFileSync(path.join(userDataPath, INSTALLATION_MARKER),
      `${JSON.stringify({ schemaVersion: 1, prompted: true })}\n`,
      { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") return continuing("already-prompted");
    report("marker-unavailable", error);
    return continuing("marker-unavailable");
  }

  let choice;
  try {
    choice = await dialog.showMessageBox({
      type: "question",
      title: "安装 domi",
      message: "将 domi 安装到“应用程序”？",
      detail: "安装后会重新打开 domi，方便以后启动和更新。macOS 可能会请求安装权限。你也可以继续使用，稍后在访达中将 domi 拖入“应用程序”；这条引导只显示一次。",
      buttons: ["安装并打开", "继续使用"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
  } catch (error) {
    report("prompt-failed", error);
    return continuing("prompt-failed");
  }
  if (choice?.response !== 0) return continuing("declined");
  // The user may leave the dialog open. Recheck immediately before a move.
  if (!safeToInstall()) return continuing("unsafe-to-install");

  let conflict = "";
  try {
    const moved = app.moveToApplicationsFolder({
      conflictHandler(type) {
        conflict = type === "existsAndRunning" ? "existsAndRunning" : "exists";
        // Electron's default can trash an existing installation or quit this
        // process in favor of another one. Never opt into either behavior.
        return false;
      }
    });
    if (moved) {
      report("moving");
      return { continueStartup: false, status: "moving" };
    }
    if (conflict) {
      await inform(
        conflict === "existsAndRunning" ? "已安装的 domi 正在运行。" : "“应用程序”中已有 domi。",
        "本次没有替换已有应用。请从“应用程序”打开 domi，需要升级时使用应用内的软件更新。你也可以继续使用当前副本。"
      );
      return continuing(conflict === "existsAndRunning" ? "existing-app-running" : "existing-app");
    }
    // Native authorization cancellation is a normal false return, not a
    // failure requiring another dialog or an automatic retry.
    return continuing("move-canceled");
  } catch (error) {
    report("move-failed", error);
    await inform("暂时无法安装到“应用程序”。",
      "你可以继续使用当前副本，稍后在访达中将 domi 拖入“应用程序”，并按 macOS 提示确认权限。应用不会自动重试安装。");
    return continuing("move-failed");
  }
}

module.exports = { INSTALLATION_MARKER, maybeInstallApplication };
