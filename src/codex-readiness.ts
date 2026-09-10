import type { AppSettings, AppSettingsSaveRequest, CodexCheckResult } from "./env";

export function codexConnectionReady(status: CodexCheckResult | null | undefined) {
  return status?.connectionOk ?? status?.ok ?? false;
}

export function codexTaskReady(status: CodexCheckResult | null | undefined, needsPlugin: boolean) {
  return codexConnectionReady(status) && (!needsPlugin || status?.pluginSetup?.ok === true);
}

const CONNECTION_KEYS = ["authMode", "codexPath", "apiBaseUrl", "apiModel", "relayCredentialConfigured"] as const;
export function codexConnectionSettingsChanged(settings: AppSettings | null, request: AppSettingsSaveRequest) {
  return CONNECTION_KEYS.some(key => Object.prototype.hasOwnProperty.call(request, key)
    && request[key] !== settings?.[key]);
}

export type CodexReadinessSnapshot = {
  status: CodexCheckResult | null;
  checking: boolean;
  checkFailed: boolean;
};

export function codexReadinessPresentation(snapshot: CodexReadinessSnapshot, native = true) {
  const { status, checking, checkFailed } = snapshot;
  if (!native) return { tone: "neutral", title: "浏览器预览", detail: "" };
  if (codexConnectionReady(status)) {
    if (status?.pluginSetup?.ok !== true) {
      return { tone: "warning", title: "Codex 已连接", detail: checking ? "正在检查 domi 插件" : "domi 插件待检查" };
    }
    return { tone: "ok", title: "Codex 已就绪", detail: status?.diagnosticWarnings?.length ? "连接正常，有诊断提示" : "" };
  }
  if (checking || (!status && !checkFailed)) return { tone: "neutral", title: "正在检查 Codex", detail: "" };
  // Raw process errors contain paths and often say nothing useful about what
  // failed. Keep them in diagnostics, rather than the sidebar or setup headline.
  const needsLogin = Boolean(status?.requiresOpenaiAuth && status?.account === null);
  return needsLogin
    ? { tone: "bad", title: "Codex 需要登录", detail: "请在连接设置中完成登录" }
    : { tone: "warning", title: "Codex 连接待检查", detail: "上次检测未完成，可重新检查" };
}

type CheckOptions = { readOnly?: boolean; force?: boolean };
type Timer = ReturnType<typeof setTimeout>;

/** Orders probe/save results and bounds automatic recovery without model calls. */
export class CodexReadinessController {
  snapshot: CodexReadinessSnapshot = { status: null, checking: false, checkFailed: false };
  private revision = 0;
  private configurationGeneration = 0;
  private automaticAttempts = 0;
  private timer: Timer | null = null;
  private automaticPending = false;
  private savePending = false;
  private explicitProbeRevision: number | null = null;
  private pendingRuntimeGeneration: number | null = null;
  private disposed = false;
  private readonly check: (options?: CheckOptions) => Promise<CodexCheckResult>;
  private readonly publish: (state: CodexReadinessSnapshot) => void;
  private readonly schedule: (callback: () => void, delay: number) => Timer;
  private readonly cancel: (timer: Timer) => void;

  constructor(options: {
    check: (options?: CheckOptions) => Promise<CodexCheckResult>;
    publish: (state: CodexReadinessSnapshot) => void;
    schedule?: (callback: () => void, delay: number) => Timer;
    cancel?: (timer: Timer) => void;
  }) {
    this.check = options.check;
    this.publish = options.publish;
    // Browser timer functions require their Window receiver. Calling an
    // unbound native timer as this.schedule() gives it the controller instead.
    this.schedule = options.schedule || ((callback, delay) => setTimeout(callback, delay));
    this.cancel = options.cancel || ((timer) => clearTimeout(timer));
  }

  private update(patch: Partial<CodexReadinessSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (!this.disposed) this.publish(this.snapshot);
  }

  private clearAutomatic() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.automaticPending = false;
    this.automaticAttempts = 0;
  }

  invalidate(invalidateConnection = false) {
    this.clearAutomatic();
    this.savePending = false;
    this.explicitProbeRevision = null;
    this.pendingRuntimeGeneration = null;
    const revision = ++this.revision;
    if (invalidateConnection) {
      this.configurationGeneration += 1;
      // Retain identity metadata for an in-flight test's fingerprint, but
      // revoke all readiness until the new runtime is actually checked.
      this.update({ status: this.snapshot.status ? { ...this.snapshot.status, ok: false, connectionOk: false } : null,
        checking: true, checkFailed: false });
    } else this.update({ checking: false });
    return revision;
  }

  beginSave(invalidateConnection: boolean) {
    const revision = this.invalidate(invalidateConnection);
    this.savePending = true;
    return revision;
  }

  isCurrent(revision: number) { return !this.disposed && revision === this.revision; }
  get generation() { return this.configurationGeneration; }

  acceptSaved(revision: number, status?: CodexCheckResult) {
    if (!this.isCurrent(revision)) return false;
    this.savePending = false;
    if (status) this.update({ status, checking: false, checkFailed: false });
    else this.update({ checking: false });
    this.scheduleRecovery();
    return true;
  }

  failSave(revision: number) {
    if (this.isCurrent(revision)) {
      this.savePending = false;
      const needsCheck = !codexConnectionReady(this.snapshot.status);
      this.update({ checking: false, checkFailed: needsCheck });
      // A busy runtime can reject a configuration save after the renderer has
      // revoked the old generation. Verify what remains active without
      // trusting the old green light or waiting for now-obsolete run events.
      if (needsCheck) this.startAutomatic(this.configurationGeneration);
    }
  }

  async refresh(verifiedStatus?: CodexCheckResult, options?: CheckOptions) {
    this.clearAutomatic();
    this.savePending = false;
    const revision = ++this.revision;
    this.explicitProbeRevision = revision;
    this.pendingRuntimeGeneration = null;
    await this.probe(revision, verifiedStatus, options);
    if (this.isCurrent(revision)) {
      this.explicitProbeRevision = null;
      const pendingGeneration = this.pendingRuntimeGeneration;
      this.pendingRuntimeGeneration = null;
      if (pendingGeneration !== null) this.startAutomatic(pendingGeneration);
      else this.scheduleRecovery();
    }
  }

  private async probe(revision: number, verifiedStatus?: CodexCheckResult, options?: CheckOptions) {
    if (this.disposed) return;
    this.update({ checking: true });
    try {
      const status = verifiedStatus || await this.check(options);
      if (this.isCurrent(revision)) this.update({ status, checking: false, checkFailed: false });
    } catch {
      if (this.isCurrent(revision)) this.update({ status: null, checking: false, checkFailed: true });
    }
  }

  observeRuntimeEvent(configurationGeneration: number) {
    if (this.explicitProbeRevision !== null && !this.savePending
      && configurationGeneration === this.configurationGeneration) {
      this.pendingRuntimeGeneration = configurationGeneration;
      return;
    }
    this.startAutomatic(configurationGeneration);
  }

  scheduleRecovery() {
    const { status, checkFailed } = this.snapshot;
    if (status?.requiresOpenaiAuth && status.account === null) return;
    const transient = checkFailed || status?.pluginSetup?.status === "check-failed"
      || (!codexConnectionReady(status) && /timed? ?out|timeout|超时|ECONN|connection (?:closed|reset)|temporar|暂时|Command failed/i.test(status?.error || ""));
    if (transient) this.startAutomatic(this.configurationGeneration);
  }

  private startAutomatic(configurationGeneration: number) {
    if (this.disposed || configurationGeneration !== this.configurationGeneration
      || codexTaskReady(this.snapshot.status, true) || this.timer !== null || this.automaticPending
      || this.savePending || this.explicitProbeRevision !== null || this.automaticAttempts >= 3) return;
    const delay = [0, 2_000, 8_000][this.automaticAttempts];
    const generation = this.configurationGeneration;
    this.timer = this.schedule(() => {
      this.timer = null;
      if (this.disposed || generation !== this.configurationGeneration) return;
      this.automaticAttempts += 1;
      this.automaticPending = true;
      const revision = ++this.revision;
      void this.probe(revision, undefined, { readOnly: true, force: true }).finally(() => {
        if (!this.isCurrent(revision)) return;
        this.automaticPending = false;
        this.scheduleRecovery();
      });
    }, delay);
  }

  dispose() {
    this.disposed = true;
    this.revision += 1;
    this.clearAutomatic();
  }

  activate() { this.disposed = false; }
}
