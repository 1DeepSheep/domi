const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { DesktopNotificationService, CACHE_KEY, MAX_NOTIFICATION_IDS } = require("../electron/desktop-notifications.cjs");
const { WorkbenchStateStore } = require("../electron/state-store.cjs");

function fixture(overrides = {}) {
  const records = new Map(), notifications = [], events = [], badges = [], errors = [];
  class FakeNotification extends EventEmitter {
    static supported = true;
    static isSupported() { return FakeNotification.supported; }
    constructor(options) { super(); this.options = options; notifications.push(this); }
    show() { this.shown = true; }
  }
  const stateStore = {
    loadCache: key => records.has(key) ? { value: structuredClone(records.get(key)) } : null,
    saveCache: (key, value) => records.set(key, structuredClone(value))
  };
  const options = { Notification: FakeNotification, stateStore,
    focusWindow: () => events.push("focus"), publishClick: target => events.push(target),
    setBadge: value => badges.push(value), onError: stage => errors.push(stage), ...overrides };
  return { records, notifications, events, badges, errors, FakeNotification, options,
    service: new DesktopNotificationService(options) };
}

test("native notification references survive show, route clicks and release only on close/failure", () => {
  const f = fixture();
  assert.deepEqual(f.service.notify({ title: "合成任务", body: "任务已完成", threadId: "thread-1", notificationId: "task:run-1" }), { ok: true });
  const notification = f.notifications[0];
  assert.equal(f.service.activeNotifications.has(notification), true);
  notification.emit("click");
  assert.deepEqual(f.events, ["focus", { threadId: "thread-1", notificationId: "task:run-1" }]);
  assert.deepEqual(f.service.consumePendingNotification(), { threadId: "thread-1", notificationId: "task:run-1" });
  assert.equal(f.service.consumePendingNotification(), null);
  notification.emit("close");
  assert.equal(f.service.activeNotifications.size, 0);
  assert.equal(f.service.notificationIds.has("task:run-1"), true, "dismissing is not a request to resend or mark a task read");
});

test("completion identity deduplicates across service restarts and evicts only beyond 256 IDs", () => {
  const f = fixture();
  for (let i = 0; i <= MAX_NOTIFICATION_IDS; i++) f.service.notify({ title: "任务", body: "任务已完成", notificationId: `run-${i}` });
  assert.equal(f.service.notificationIds.size, MAX_NOTIFICATION_IDS);
  const resumed = new DesktopNotificationService(f.options);
  assert.equal(resumed.notify({ notificationId: "run-256" }).deduplicated, true);
  assert.equal(f.notifications.length, 257);
  assert.equal(resumed.notify({ notificationId: "run-0" }).deduplicated, undefined);
  assert.equal(f.notifications.length, 258);
  assert.equal(f.records.get(CACHE_KEY).notificationIds.length, MAX_NOTIFICATION_IDS);
  assert.doesNotMatch(JSON.stringify(f.records.get(CACHE_KEY)), /任务已完成/, "cache must not contain task text");
});

test("old industry notifications remain independent and click only focuses the app", () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) assert.equal(f.service.notify({ title: "行业动态", body: "发现新的行业动态", silent: true }).ok, true);
  assert.equal(f.notifications.length, 2);
  assert.equal(f.notifications[0].options.silent, true);
  f.notifications[0].emit("click");
  assert.deepEqual(f.events, ["focus"]);
  assert.equal(f.service.consumePendingNotification(), null);
  assert.equal(f.service.notificationIds.size, 0);
});

test("show failure releases references and identity so a later request may retry", () => {
  const f = fixture();
  f.service.notify({ title: "任务", body: "任务失败", notificationId: "failed-show" });
  f.notifications[0].emit("failed", {}, "OS rejected notification");
  assert.equal(f.service.activeNotifications.size, 0);
  assert.equal(f.service.notificationIds.has("failed-show"), false);
  assert.equal(f.service.notify({ notificationId: "failed-show" }).ok, true);
  assert.equal(f.notifications.length, 2);
  f.FakeNotification.prototype.show = () => { throw new Error("show failed"); };
  assert.equal(f.service.notify({ notificationId: "throw-show" }).ok, false);
  assert.equal(f.service.notificationIds.has("throw-show"), false);
  assert.equal(f.service.activeNotifications.size, 1);
});

test("unsupported OS and storage failures never clear unread state or manufacture notification success", () => {
  const f = fixture();
  f.service.setUnreadTaskCount(3);
  f.FakeNotification.supported = false;
  assert.equal(f.service.notify({ notificationId: "unsupported" }).ok, false);
  assert.equal(f.service.unreadCount, 3);
  assert.equal(f.service.notificationIds.has("unsupported"), false);
  f.FakeNotification.supported = true;
  f.options.stateStore.saveCache = () => { throw new Error("synthetic disk full"); };
  assert.equal(f.service.notify({ notificationId: "disk-full" }).ok, true, "storage trouble must not prevent a useful system notification");
  assert.equal(f.service.notify({ notificationId: "disk-full" }).deduplicated, true);
  assert.equal(f.service.unreadCount, 3);
  assert.ok(f.errors.includes("persist"));
});

test("Dock count is validated, persisted and restored without consulting notification delivery", () => {
  const f = fixture();
  assert.equal(f.service.setUnreadTaskCount(2).ok, true);
  const resumed = new DesktopNotificationService(f.options);
  resumed.restoreBadge();
  assert.deepEqual(f.badges, ["2", "2"]);
  for (const bad of [-1, 1.5, NaN, Infinity, "3", 1_000_001]) assert.equal(resumed.setUnreadTaskCount(bad).ok, false);
  assert.equal(resumed.unreadCount, 2);
  assert.equal(resumed.setUnreadTaskCount(0).ok, true);
  assert.equal(f.badges.at(-1), "");
  assert.equal(f.records.get(CACHE_KEY).unreadCount, 0);
  const unavailable = fixture({ setBadge: () => { throw new Error("OS badge unavailable"); } });
  assert.equal(unavailable.service.setUnreadTaskCount(4).ok, false);
  assert.equal(unavailable.service.unreadCount, 4);
  assert.equal(unavailable.records.get(CACHE_KEY).unreadCount, 4);
});

test("real SQLite saves unread threads, dedupe and pending target through reopen without changing messages", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-notifications-state-"));
  const options = { databasePath: path.join(root, "state.sqlite"), projectsDir: path.join(root, "projects") };
  let store = new WorkbenchStateStore(options);
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const message = { id: "assistant-1", role: "assistant", content: "Private synthetic task result", status: "done" };
  store.save({ threads: [{ id: "thread-1", title: "合成任务", messages: [message], hasUnreadCompletion: true, lastActiveAt: 1 }], activeThreadId: "thread-1" });
  const f = fixture({ stateStore: store });
  f.service.setUnreadTaskCount(1);
  f.service.notify({ title: "合成任务", body: "任务已完成", threadId: "thread-1", notificationId: "completion-1" });
  f.notifications[0].emit("click"); f.notifications[0].emit("close");
  store.close(); store = new WorkbenchStateStore(options);
  const resumed = new DesktopNotificationService({ ...f.options, stateStore: store });
  assert.equal(resumed.notify({ notificationId: "completion-1" }).deduplicated, true);
  assert.deepEqual(resumed.consumePendingNotification(), { threadId: "thread-1", notificationId: "completion-1" });
  assert.equal(resumed.consumePendingNotification(), null);
  resumed.restoreBadge(); assert.equal(f.badges.at(-1), "1");
  const thread = store.load({ threads: [] }).state.threads[0];
  assert.equal(thread.hasUnreadCompletion, true, "notification dismissal must not mark a task read");
  assert.deepEqual(thread.messages, [message]);
  assert.doesNotMatch(store.readCacheStatement.get(CACHE_KEY).value, /Private synthetic/);
});

test("main-process navigation restores a minimized window and defers targets for a loading renderer", () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const start = source.indexOf("function getDesktopNotifications()"), end = source.indexOf("function getDomiPluginManager()", start);
  assert.ok(start >= 0 && end > start);
  const f = fixture(), actions = [];
  let windows = [], loading = true, storeUnavailable = true;
  const win = { isDestroyed: () => false, isMinimized: () => true,
    restore: () => actions.push("restore"), show: () => actions.push("show"), focus: () => actions.push("focus"),
    webContents: { isDestroyed: () => false, isLoadingMainFrame: () => loading, send: (...args) => actions.push(args) } };
  const context = vm.createContext({ desktopNotifications: null, DesktopNotificationService,
    Notification: f.FakeNotification, getStateStore: () => {
      if (storeUnavailable) throw new Error("Synthetic database unavailable");
      return f.options.stateStore;
    },
    nativeImage: { createFromPath: () => undefined }, appIconPath: "/synthetic/icon.png",
    BrowserWindow: { getAllWindows: () => windows }, createWindow: () => { windows = [win]; actions.push("create"); },
    process: { platform: "darwin" }, app: { dock: { setBadge: () => {} } }, appendRuntimeLog: () => {} });
  vm.runInContext(source.slice(start, end), context);
  const service = context.getDesktopNotifications();
  assert.deepEqual(service.restoreBadge(), { ok: true }, "a cache initialization error cannot abort app startup");
  storeUnavailable = false;
  service.notify({ threadId: "thread-1", notificationId: "run-1" });
  f.notifications[0].emit("click");
  assert.deepEqual(actions, ["create", "restore", "show", "focus"]);
  assert.deepEqual(service.consumePendingNotification(), { threadId: "thread-1", notificationId: "run-1" });
  loading = false; f.notifications[0].emit("click");
  assert.deepEqual(actions.at(-1), ["app:notification-clicked", { threadId: "thread-1", notificationId: "run-1" }]);
});

test("preload forwards target objects, exposes consumption/count and unsubscribes its actual IPC listener", async () => {
  const ipc = new EventEmitter(), invocations = [];
  ipc.invoke = async (...args) => { invocations.push(args); return null; };
  let workbench;
  const electron = { contextBridge: { exposeInMainWorld: (_key, api) => { workbench = api; } }, ipcRenderer: ipc, webUtils: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../electron/preload.cjs"), "utf8"), { require: () => electron });
  const clicks = [], unsubscribe = workbench.onNotificationClicked(target => clicks.push(target));
  const target = { threadId: "thread-1", notificationId: "completion-1" };
  ipc.emit("app:notification-clicked", {}, target);
  assert.deepEqual(clicks, [target]);
  unsubscribe(); ipc.emit("app:notification-clicked", {}, target);
  assert.equal(clicks.length, 1);
  await workbench.consumePendingNotification(); await workbench.setUnreadTaskCount(2);
  await workbench.showNotification({ title: "任务", body: "任务已完成", ...target });
  assert.deepEqual(invocations.map(v => v[0]), ["app:consume-pending-notification", "app:set-unread-task-count", "app:notify"]);
});
