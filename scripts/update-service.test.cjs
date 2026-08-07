const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const test = require("node:test");

const UPDATE_SERVICE_PATH = require.resolve("../electron/update-service.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createFakeUpdater() {
  const updater = new EventEmitter();
  const values = {};
  const calls = {
    check: 0,
    download: 0,
    downloadTokens: [],
    feed: [],
    install: [],
    order: []
  };

  for (const property of ["allowPrerelease", "allowDowngrade", "autoInstallOnAppQuit"]) {
    Object.defineProperty(updater, property, {
      configurable: true,
      enumerable: true,
      get() {
        return values[property];
      },
      set(value) {
        values[property] = value;
        calls.order.push([property, value]);
      }
    });
  }
  Object.defineProperty(updater, "channel", {
    configurable: true,
    enumerable: true,
    get() {
      return values.channel;
    },
    set(value) {
      values.channel = value;
      // electron-updater's channel setter enables downgrade internally. The
      // service must explicitly turn it off after assigning the channel.
      values.allowDowngrade = true;
      calls.order.push(["channel", value]);
    }
  });

  updater.checkImplementation = async () => undefined;
  updater.downloadImplementation = async () => undefined;
  updater.setFeedURL = (feed) => {
    calls.feed.push(feed);
    calls.order.push(["feed", feed]);
  };
  updater.checkForUpdates = (...args) => {
    calls.check += 1;
    return updater.checkImplementation(...args);
  };
  updater.downloadUpdate = (...args) => {
    calls.download += 1;
    calls.downloadTokens.push(args[0]);
    return updater.downloadImplementation(...args);
  };
  updater.quitAndInstall = (...args) => {
    calls.install.push(args);
  };

  return { calls, updater, values };
}

function createFakeBrowserWindow() {
  const sent = [];
  const destroyedSent = [];
  const liveWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (...args) => sent.push(args)
    }
  };
  const destroyedWindow = {
    isDestroyed: () => true,
    webContents: {
      send: (...args) => destroyedSent.push(args)
    }
  };
  return {
    BrowserWindow: {
      getAllWindows: () => [liveWindow, destroyedWindow]
    },
    destroyedSent,
    sent
  };
}

function loadUpdateService({ updater, BrowserWindow }) {
  delete require.cache[UPDATE_SERVICE_PATH];
  const originalLoad = Module._load;
  Module._load = function loadWithUpdateFakes(request, parent, isMain) {
    if (request === "electron") return { BrowserWindow };
    if (request === "electron-updater") return { autoUpdater: updater };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(UPDATE_SERVICE_PATH).UpdateService;
  } finally {
    Module._load = originalLoad;
    delete require.cache[UPDATE_SERVICE_PATH];
  }
}

function createHarness({
  packaged = true,
  channel = "stable",
  checkTimeoutMs = 60_000,
  downloadTimeoutMs = 30 * 60_000
} = {}) {
  const fakeUpdater = createFakeUpdater();
  const fakeWindows = createFakeBrowserWindow();
  const UpdateService = loadUpdateService({
    updater: fakeUpdater.updater,
    BrowserWindow: fakeWindows.BrowserWindow
  });
  let selectedChannel = channel;
  const immediateQueue = [];
  const app = {
    isPackaged: packaged,
    getVersion: () => "9.8.7"
  };
  const service = new UpdateService({
    app,
    channelProvider: () => selectedChannel,
    checkTimeoutMs,
    downloadTimeoutMs,
    setImmediateFn: (callback) => {
      immediateQueue.push(callback);
      return callback;
    }
  });
  return {
    ...fakeUpdater,
    ...fakeWindows,
    app,
    service,
    runImmediates() {
      while (immediateQueue.length > 0) immediateQueue.shift()();
    },
    setChannel(value) {
      selectedChannel = value;
    }
  };
}

function startListeners(harness, { running = false } = {}) {
  harness.service.start();
  harness.service.stop();
  harness.service.running = running;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function makeAvailable(harness, version = "9.9.0") {
  harness.updater.checkImplementation = async () => {
    harness.updater.emit("checking-for-update");
    const info = {
      version,
      releaseDate: "2026-08-06T00:00:00.000Z"
    };
    harness.updater.emit("update-available", info);
    return { isUpdateAvailable: true, updateInfo: info };
  };
  return harness.service.check();
}

test("channel configuration is ordered and never permits downgrade", () => {
  const stable = createHarness({ channel: "stable" });
  stable.service.start();
  stable.service.stop();

  assert.deepEqual(
    stable.calls.order.filter(([name]) => ["channel", "allowPrerelease", "allowDowngrade"].includes(name)),
    [
      ["channel", "latest"],
      ["allowPrerelease", false],
      ["allowDowngrade", false]
    ]
  );
  assert.equal(stable.values.allowDowngrade, false);
  assert.equal(stable.values.autoInstallOnAppQuit, false);

  stable.calls.order.length = 0;
  stable.service.configureChannel("beta");
  assert.deepEqual(
    stable.calls.order.filter(([name]) => ["channel", "allowPrerelease", "allowDowngrade"].includes(name)),
    [
      ["channel", "beta"],
      ["allowPrerelease", true],
      ["allowDowngrade", false]
    ]
  );
  assert.equal(stable.values.allowDowngrade, false);
  assert.equal(stable.service.snapshot().channel, "beta");
});

test("check is single-flight and all callers wait for the active visible check", async () => {
  const harness = createHarness();
  startListeners(harness);
  const activeCheck = deferred();
  harness.updater.checkImplementation = () => {
    harness.updater.emit("checking-for-update");
    return activeCheck.promise;
  };

  const first = harness.service.check();
  const second = harness.service.check();
  let secondSettled = false;
  void second.then(() => {
    secondSettled = true;
  });
  await flushMicrotasks();

  assert.equal(harness.calls.check, 1);
  assert.equal(secondSettled, false);

  harness.updater.emit("update-not-available");
  activeCheck.resolve({ isUpdateAvailable: false, updateInfo: { version: "9.8.7" } });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.state, "up-to-date");
  assert.equal(secondResult.state, "up-to-date");
});

test("timed-out check keeps the underlying request single-flight and ignores its late events", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const harness = createHarness({ checkTimeoutMs: 50 });
  startListeners(harness, { running: true });
  const oldCheck = deferred();
  harness.updater.checkImplementation = () => {
    harness.updater.emit("checking-for-update");
    return oldCheck.promise;
  };

  const timedOut = harness.service.check();
  await flushMicrotasks();
  t.mock.timers.tick(51);
  const timeoutResult = await timedOut;
  assert.equal(timeoutResult.state, "error");

  const queuedRetry = await harness.service.check();
  assert.equal(queuedRetry.state, "error");
  assert.equal(harness.calls.check, 1);

  harness.updater.emit("update-available", { version: "99.0.0" });
  assert.equal(harness.service.snapshot().state, "error");
  assert.equal(harness.service.snapshot().availableVersion, "");

  harness.updater.checkImplementation = async () => ({
    isUpdateAvailable: false,
    updateInfo: { version: "9.8.7" }
  });
  oldCheck.resolve({ isUpdateAvailable: true, updateInfo: { version: "99.0.0" } });
  await flushMicrotasks();
  harness.runImmediates();
  await flushMicrotasks();

  assert.equal(harness.calls.check, 2);
  assert.equal(harness.service.snapshot().state, "up-to-date");
  assert.equal(harness.service.snapshot().availableVersion, "");
});

test("check resolves to a terminal fallback when the updater emits no event", async () => {
  const available = createHarness();
  available.updater.checkImplementation = async () => ({
    isUpdateAvailable: true,
    updateInfo: {
      version: "9.9.0",
      releaseDate: "2026-08-06T00:00:00.000Z"
    }
  });
  const availableResult = await available.service.check();
  assert.equal(availableResult.state, "available");
  assert.equal(availableResult.availableVersion, "9.9.0");

  const current = createHarness();
  current.updater.checkImplementation = async () => ({
    isUpdateAvailable: false,
    updateInfo: { version: "9.8.7" }
  });
  const currentResult = await current.service.check();
  assert.equal(currentResult.state, "up-to-date");
  assert.equal(currentResult.error, "");

  const missing = createHarness();
  missing.updater.checkImplementation = async () => null;
  const missingResult = await missing.service.check();
  assert.equal(missingResult.state, "error");
  assert.ok(missingResult.error);
});

test("download is single-flight and enables install-on-quit only for the accepted download", async () => {
  const harness = createHarness();
  startListeners(harness);
  await makeAvailable(harness);
  const activeDownload = deferred();
  harness.updater.downloadImplementation = () => activeDownload.promise;

  const first = harness.service.download();
  const second = harness.service.download();
  let secondSettled = false;
  void second.then(() => {
    secondSettled = true;
  });
  await flushMicrotasks();

  assert.equal(harness.calls.download, 1);
  assert.equal(secondSettled, false);
  assert.equal(harness.values.autoInstallOnAppQuit, false);

  harness.updater.emit("update-downloaded", { version: "9.9.0" });
  activeDownload.resolve(["/tmp/domi-update.zip"]);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.state, "downloaded");
  assert.equal(secondResult.state, "downloaded");
  assert.equal(harness.values.autoInstallOnAppQuit, true);
});

test("download timeout cancels the token, blocks overlap, and ignores late download events", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const harness = createHarness({ downloadTimeoutMs: 50 });
  startListeners(harness, { running: true });
  await makeAvailable(harness);
  const oldDownload = deferred();
  harness.updater.downloadImplementation = () => oldDownload.promise;

  const timedOut = harness.service.download();
  await flushMicrotasks();
  t.mock.timers.tick(51);
  const timeoutResult = await timedOut;
  assert.equal(timeoutResult.state, "error");
  assert.equal(harness.calls.downloadTokens[0].cancelled, true);
  assert.equal(harness.values.autoInstallOnAppQuit, false);

  await harness.service.check();
  assert.equal(harness.calls.check, 1);
  harness.updater.emit("download-progress", { percent: 90, total: 100, transferred: 90 });
  harness.updater.emit("update-downloaded", { version: "9.9.0" });
  assert.equal(harness.service.snapshot().state, "error");

  harness.updater.checkImplementation = async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: "9.9.1" }
  });
  oldDownload.reject(new Error("cancelled"));
  await flushMicrotasks();
  harness.runImmediates();
  await flushMicrotasks();
  assert.equal(harness.calls.check, 2);
  assert.equal(harness.service.snapshot().state, "available");
  assert.equal(harness.service.snapshot().availableVersion, "9.9.1");
});

test("download resolves to downloaded when the updater emits no terminal event", async () => {
  const harness = createHarness();
  await makeAvailable(harness);
  harness.updater.downloadImplementation = async () => ["/tmp/domi-update.zip"];

  const result = await harness.service.download();
  assert.equal(result.state, "downloaded");
  assert.equal(result.availableVersion, "9.9.0");
  assert.equal(result.percent, 100);
  assert.equal(result.error, "");
  assert.equal(harness.values.autoInstallOnAppQuit, true);
});

test("channel switch during a check ignores stale events and rechecks the new channel", async () => {
  const harness = createHarness({ channel: "stable" });
  startListeners(harness, { running: true });
  const stableCheck = deferred();
  harness.updater.checkImplementation = () => {
    harness.updater.emit("checking-for-update");
    return stableCheck.promise;
  };
  const oldVisibleCheck = harness.service.check();
  await flushMicrotasks();
  assert.equal(harness.calls.check, 1);

  harness.setChannel("beta");
  harness.service.configureChannel("beta");
  assert.equal(harness.service.snapshot().state, "idle");
  assert.equal(harness.service.snapshot().channel, "beta");
  assert.equal(harness.values.autoInstallOnAppQuit, false);

  harness.updater.emit("update-available", { version: "99.0.0" });
  assert.equal(harness.service.snapshot().state, "idle");

  harness.updater.checkImplementation = async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: "10.0.0-beta.1" }
  });
  stableCheck.resolve({ isUpdateAvailable: true, updateInfo: { version: "99.0.0" } });
  await oldVisibleCheck;
  harness.runImmediates();
  await flushMicrotasks();

  assert.equal(harness.calls.check, 2);
  assert.equal(harness.service.snapshot().channel, "beta");
  assert.equal(harness.service.snapshot().state, "available");
  assert.equal(harness.service.snapshot().availableVersion, "10.0.0-beta.1");
});

test("channel switch cancels an old download and cannot install its late package", async () => {
  const harness = createHarness({ channel: "stable" });
  startListeners(harness, { running: true });
  await makeAvailable(harness, "9.9.0");
  const stableDownload = deferred();
  harness.updater.downloadImplementation = () => stableDownload.promise;
  const oldVisibleDownload = harness.service.download();
  await flushMicrotasks();

  harness.setChannel("beta");
  harness.service.configureChannel("beta");
  assert.equal(harness.calls.downloadTokens[0].cancelled, true);
  assert.equal(harness.values.autoInstallOnAppQuit, false);
  assert.equal(harness.service.install().ok, false);

  harness.updater.emit("update-downloaded", { version: "9.9.0" });
  assert.equal(harness.service.snapshot().state, "idle");
  assert.equal(harness.values.autoInstallOnAppQuit, false);

  harness.updater.checkImplementation = async () => ({
    isUpdateAvailable: false,
    updateInfo: { version: "9.8.7" }
  });
  stableDownload.reject(new Error("cancelled"));
  await oldVisibleDownload;
  harness.runImmediates();
  await flushMicrotasks();
  assert.equal(harness.service.snapshot().state, "up-to-date");
  assert.equal(harness.calls.install.length, 0);
});

test("updater errors are operation-scoped, clear stale status, and redact secrets", async () => {
  const harness = createHarness();
  startListeners(harness);
  harness.sent.length = 0;
  const activeCheck = deferred();
  harness.updater.checkImplementation = () => {
    harness.updater.emit("checking-for-update");
    return activeCheck.promise;
  };
  const check = harness.service.check();
  await flushMicrotasks();

  harness.updater.emit(
    "error",
    new Error("failed https://example.test/update?token=secret Bearer abc.def")
  );
  assert.equal(harness.service.snapshot().state, "error");
  assert.doesNotMatch(harness.service.snapshot().error, /secret|abc\.def/);
  activeCheck.resolve(undefined);
  await check;

  harness.updater.emit("update-available", { version: "100.0.0" });
  assert.equal(harness.service.snapshot().state, "error");
  assert.ok(harness.sent.length >= 2);
  assert.ok(harness.sent.every(([channel]) => channel === "update:status"));
  assert.equal(harness.destroyedSent.length, 0);
});

test("returning to an active app checks only when the previous result is stale", async () => {
  const harness = createHarness();
  startListeners(harness, { running: true });
  harness.updater.checkImplementation = async () => ({
    isUpdateAvailable: false,
    updateInfo: { version: "9.8.7" }
  });

  harness.service.lastCheckCompletedAt = Date.now();
  await harness.service.checkIfStale(5 * 60_000);
  assert.equal(harness.calls.check, 0);

  harness.service.lastCheckCompletedAt = Date.now() - 5 * 60_000 - 1;
  await harness.service.checkIfStale(5 * 60_000);
  assert.equal(harness.calls.check, 1);
  assert.equal(harness.service.snapshot().state, "up-to-date");
});

test("development builds keep every updater operation disabled", async () => {
  const harness = createHarness({ packaged: false, channel: "beta" });
  harness.service.start();
  harness.service.configureChannel("stable");
  const checkResult = await harness.service.check();
  const downloadResult = await harness.service.download();
  const installResult = harness.service.install();

  assert.equal(checkResult.state, "disabled");
  assert.equal(downloadResult.state, "disabled");
  assert.equal(installResult.ok, false);
  assert.equal(harness.calls.check, 0);
  assert.equal(harness.calls.download, 0);
  assert.equal(harness.calls.feed.length, 0);
  assert.equal(harness.calls.install.length, 0);
  assert.equal(harness.calls.order.length, 0);
});

test("install requires a current downloaded candidate and rechecks the gate at execution time", async () => {
  const valid = createHarness();
  await makeAvailable(valid);
  valid.updater.downloadImplementation = async () => ["/tmp/domi-update.zip"];
  await valid.service.download();
  assert.equal(valid.service.install().ok, true);
  valid.runImmediates();
  assert.deepEqual(valid.calls.install, [[false, true]]);

  const switched = createHarness({ channel: "stable" });
  await makeAvailable(switched);
  switched.updater.downloadImplementation = async () => ["/tmp/domi-update.zip"];
  await switched.service.download();
  assert.equal(switched.service.install().ok, true);
  switched.service.configureChannel("beta");
  switched.runImmediates();
  assert.equal(switched.calls.install.length, 0);
  assert.equal(switched.values.autoInstallOnAppQuit, false);
});
