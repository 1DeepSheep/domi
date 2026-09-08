const CACHE_KEY = "desktop-notifications-v1";
const MAX_NOTIFICATION_IDS = 256;
const MAX_UNREAD_TASK_COUNT = 1_000_000;

function boundedString(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function notificationTarget(value) {
  const threadId = boundedString(value?.threadId, 256);
  if (!threadId) return null;
  const notificationId = boundedString(value?.notificationId, 256);
  return { threadId, ...(notificationId ? { notificationId } : {}) };
}

function unreadTaskCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UNREAD_TASK_COUNT ? value : null;
}

class DesktopNotificationService {
  constructor({ Notification, stateStore, iconProvider = () => undefined,
    focusWindow = () => {}, publishClick = () => {}, setBadge = () => {}, onError = () => {} }) {
    this.Notification = Notification;
    this.stateStore = stateStore;
    this.iconProvider = iconProvider;
    this.focusWindow = focusWindow;
    this.publishClick = publishClick;
    this.setBadge = setBadge;
    this.onError = onError;
    this.activeNotifications = new Set();
    this.notificationIds = new Set();
    this.pendingTarget = null;
    this.unreadCount = 0;
    try {
      const saved = stateStore?.loadCache(CACHE_KEY)?.value;
      if (saved?.schema === "domi.desktop-notifications.v1") {
        const ids = Array.isArray(saved.notificationIds) ? saved.notificationIds : [];
        this.notificationIds = new Set(ids.map(value => boundedString(value, 256)).filter(Boolean).slice(-MAX_NOTIFICATION_IDS));
        this.pendingTarget = notificationTarget(saved.pendingTarget);
        this.unreadCount = unreadTaskCount(saved.unreadCount) ?? 0;
      }
    } catch (error) { this.reportError("load", error); }
  }

  reportError(stage, error) {
    // Do not persist notification body text in diagnostics or the dedupe cache.
    try { this.onError(stage, error); } catch {}
  }

  persist() {
    try {
      this.stateStore?.saveCache(CACHE_KEY, {
        schema: "domi.desktop-notifications.v1",
        notificationIds: [...this.notificationIds],
        pendingTarget: this.pendingTarget,
        unreadCount: this.unreadCount
      });
      return true;
    } catch (error) { this.reportError("persist", error); return false; }
  }

  restoreBadge() {
    try { this.setBadge(this.unreadCount > 0 ? String(this.unreadCount) : ""); return { ok: true }; }
    catch (error) { this.reportError("badge", error); return { ok: false, error: "无法更新应用未读数量。" }; }
  }

  setUnreadTaskCount(value) {
    const count = unreadTaskCount(value);
    if (count === null) return { ok: false, error: "未读任务数量必须为有效的非负整数。" };
    const changed = this.unreadCount !== count;
    this.unreadCount = count;
    const persisted = !changed || this.persist();
    const result = this.restoreBadge();
    return persisted ? result : { ok: false, error: "未读任务数量暂时无法保存。" };
  }

  consumePendingNotification() {
    if (!this.pendingTarget) return null;
    const target = { ...this.pendingTarget };
    this.pendingTarget = null;
    this.persist();
    return target;
  }

  notify(request = {}) {
    const notificationId = boundedString(request.notificationId, 256);
    if (notificationId && this.notificationIds.has(notificationId)) return { ok: true, deduplicated: true };
    let notification;
    try {
      if (!this.Notification?.isSupported()) return { ok: false, error: "当前系统不支持桌面通知。" };
      notification = new this.Notification({
        title: boundedString(request.title, 120) || "domi 行业动态",
        body: boundedString(request.body, 500) || "发现新的重要行业动态",
        silent: Boolean(request.silent),
        icon: this.iconProvider()
      });
    } catch (error) { this.reportError("create", error); return { ok: false, error: "无法创建系统通知。" }; }
    const target = notificationTarget(request);
    let failed = false;
    this.activeNotifications.add(notification);
    const release = () => this.activeNotifications.delete(notification);
    notification.once("close", release);
    notification.once("failed", (_event, error) => {
      failed = true;
      release();
      if (notificationId) { this.notificationIds.delete(notificationId); this.persist(); }
      this.reportError("show", error || new Error("System notification failed"));
    });
    notification.on("click", () => {
      // Record before focusing: a new/reloading renderer consumes this after
      // its thread list is ready. A live renderer consumes it on the event.
      if (target) { this.pendingTarget = { ...target }; this.persist(); }
      try { this.focusWindow(); } catch (error) { this.reportError("focus", error); }
      if (target) {
        try { this.publishClick({ ...target }); } catch (error) { this.reportError("navigate", error); }
      }
    });
    if (notificationId) {
      this.notificationIds.add(notificationId);
      while (this.notificationIds.size > MAX_NOTIFICATION_IDS) this.notificationIds.delete(this.notificationIds.values().next().value);
      this.persist();
    }
    try { notification.show(); }
    catch (error) {
      failed = true;
      release();
      if (notificationId) { this.notificationIds.delete(notificationId); this.persist(); }
      this.reportError("show", error);
    }
    return failed ? { ok: false, error: "系统未能显示通知。" } : { ok: true };
  }
}

module.exports = { DesktopNotificationService, CACHE_KEY, MAX_NOTIFICATION_IDS, notificationTarget, unreadTaskCount };
