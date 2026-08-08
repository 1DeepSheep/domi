import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  KeyRound,
  LoaderCircle,
  LogIn,
  Mic,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { workbench } from "./bridge";
import {
  AppSettings,
  AppSettingsSaveRequest,
  AppSettingsSaveResult,
  ChatGPTLoginResult,
  CodexCheckResult,
  CodexRuntimeStatus,
  DiagnosticCheck,
  DiagnosticReport,
  FeishuSetupAuthStartResult,
  FeishuSetupStatus,
  UpdateStatus
} from "./env";

type SetupCenterProps = {
  initialTab?: "connection" | "data" | "plaud" | "updates" | "diagnostics";
  settings: AppSettings;
  codexStatus: CodexCheckResult | null;
  required: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (request: AppSettingsSaveRequest) => Promise<AppSettingsSaveResult>;
  onLogin: () => Promise<ChatGPTLoginResult>;
  onRefresh: () => Promise<void>;
};

function domiWorkspacePath(selectedDirectory: string) {
  const normalized = selectedDirectory.trim().replace(/[\\/]+$/, "");
  if (!normalized) return "";
  const name = normalized.split(/[\\/]/).filter(Boolean).pop();
  return name === "domi工作区" ? normalized : `${normalized}/domi工作区`;
}

function outlookProfileEmail(output: string) {
  const candidate = String(output || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(candidate);
    const email = String(parsed?.email || "").trim();
    return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : "";
  } catch {
    return "";
  }
}

function outlookVerificationTime(timestamp: number) {
  if (!timestamp) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  } catch {
    return "";
  }
}

function plaudStatusLabel(status: string) {
  return {
    auth_required: "需要重新登录",
    authorization_pending: "正在自动续期",
    access_denied: "PLAUD 暂时拒绝访问",
    verification_pending: "正在自动恢复登录",
    profile_locked: "专用浏览器被占用",
    browser_unavailable: "浏览器连接不可用",
    runtime_unavailable: "内置音频组件不完整",
    network_error: "网络不可用",
    rate_limited: "PLAUD 暂时限流",
    service_unavailable: "PLAUD 服务暂时不可用",
    service_changed: "PLAUD 服务可能已更新",
    unknown: "需要继续诊断"
  }[status] || "";
}

type FeishuAssistPhase = "connection" | "configuration" | "authorization";

const FEISHU_ASSIST_PHASE_LABELS: Record<FeishuAssistPhase, string> = {
  connection: "连接检查",
  configuration: "首次应用配置",
  authorization: "账号授权"
};

function sanitizedFeishuAssistError(value: unknown) {
  const input = String(value || "飞书连接尚未完成").trim().slice(0, 1600);
  const normalized = input
    .replace(/https?:\/\/\S+/gi, "[链接已隐藏]")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[账号已隐藏]")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[本机用户]")
    .replace(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4})+\b/gi, "[验证码已隐藏]")
    .replace(
      /\b(?:app|base|table|wiki|space|node|device|user|access|refresh)[_\s-]*(?:token|id|code)\b\s*[:=]?\s*[A-Za-z0-9_-]*/gi,
      "[标识已隐藏]"
    )
    .replace(/\b(?:bas|tbl|wik|doc|dox|nod)[A-Za-z0-9_-]{6,}\b/gi, "[标识已隐藏]")
    .replace(/\s+/g, " ")
    .trim();

  if (/network|timeout|timed out|socket|econn|网络|超时/i.test(normalized)) {
    return "网络或飞书服务暂时不可用。";
  }
  if (/admin|approval|policy|管理员|企业策略|批准|审批/i.test(normalized)) {
    return "当前企业策略需要管理员批准，必须由用户联系管理员完成。";
  }
  if (/auth|login|unauthor|forbidden|401|403|授权|登录/i.test(normalized)) {
    return "账号授权尚未完成、已失效，或当前企业需要额外批准。";
  }
  if (/ambiguous|duplicate|同名|多个/i.test(normalized)) {
    return "发现多个同名资源，需要用户确认要保留或使用哪一个。";
  }
  if (/schema|field|option|字段|选项|结构/i.test(normalized)) {
    return "现有飞书资料库结构与 domi 预期不一致，需要先确认兼容处理方式。";
  }
  if (/runtime|cli|component|binary|组件|运行时|程序/i.test(normalized)) {
    return "domi 内置连接组件暂时不可用或不完整。";
  }
  if (/config|initialize|setup|配置|初始化/i.test(normalized)) {
    return "首次应用配置尚未完成，或配置状态未能通过检查。";
  }
  return "连接流程返回了未识别的错误，需要重新检查当前步骤。";
}

export default function SetupCenter({
  initialTab = "connection",
  settings,
  codexStatus,
  required,
  onClose,
  onDirtyChange,
  onSave,
  onLogin,
  onRefresh
}: SetupCenterProps) {
  const [tab, setTab] = useState<"connection" | "data" | "plaud" | "updates" | "diagnostics">(initialTab);
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState("");
  const autoInstallAttemptedRef = useRef(false);
  const [relayBusy, setRelayBusy] = useState(false);
  const [connectionTestBusy, setConnectionTestBusy] = useState(false);
  const [connectionVerified, setConnectionVerified] = useState(false);
  const [relayApiKey, setRelayApiKey] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [plaudCheck, setPlaudCheck] = useState<DiagnosticCheck | null>(null);
  const [plaudChecking, setPlaudChecking] = useState(false);
  const [plaudCheckedAt, setPlaudCheckedAt] = useState(0);
  const [plaudStatus, setPlaudStatus] = useState("");
  const [plaudAssistBusy, setPlaudAssistBusy] = useState(false);
  const [plaudAssistMessage, setPlaudAssistMessage] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [codexRuntime, setCodexRuntime] = useState<CodexRuntimeStatus | null>(null);
  const [codexRuntimeBusy, setCodexRuntimeBusy] = useState(false);
  const [outlookProfileBusy, setOutlookProfileBusy] = useState(false);
  const [feishuStatus, setFeishuStatus] = useState<FeishuSetupStatus | null>(null);
  const [feishuStatusBusy, setFeishuStatusBusy] = useState(false);
  const [feishuAuth, setFeishuAuth] = useState<FeishuSetupAuthStartResult | null>(null);
  const [feishuAuthBusy, setFeishuAuthBusy] = useState(false);
  const [feishuAssistBusy, setFeishuAssistBusy] = useState(false);
  const [feishuAssistMessage, setFeishuAssistMessage] = useState("");
  const [feishuAssistIssue, setFeishuAssistIssue] = useState<{
    phase: FeishuAssistPhase;
    error: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(settings)
    || Boolean(relayApiKey.trim());

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    onDirtyChangeRef.current?.(hasUnsavedChanges);
  }, [hasUnsavedChanges]);
  useEffect(() => () => onDirtyChangeRef.current?.(false), []);


  async function refreshFeishuStatus(force = false) {
    setFeishuStatusBusy(true);
    try {
      const status = await workbench.getFeishuSetupStatus({ force });
      setFeishuStatus(status);
      if (!status.connected && status.error) {
        setFeishuAssistIssue((current) => current && current.phase !== "connection"
          ? current
          : { phase: "connection", error: status.error || "飞书连接尚未完成" });
      } else if (status.connected) {
        setFeishuAssistIssue(null);
      }
      return status;
    } catch (statusError) {
      const statusMessage = statusError instanceof Error ? statusError.message : String(statusError);
      const status: FeishuSetupStatus = {
        ok: false,
        connected: false,
        configured: false,
        cliAvailable: false,
        userName: "",
        error: statusMessage
      };
      setFeishuStatus(status);
      setFeishuAssistIssue({ phase: "connection", error: statusMessage });
      return status;
    } finally {
      setFeishuStatusBusy(false);
    }
  }

  useEffect(() => {
    if (tab !== "data") return;
    void refreshFeishuStatus(false);
  }, [tab]);

  async function startFeishuAuth() {
    setFeishuAuthBusy(true);
    setFeishuAssistMessage("");
    setError("");
    setNotice("");
    try {
      const result = await workbench.startFeishuSetupAuth();
      if (!result.ok) {
        const resultError = result.error || "无法启动飞书授权，请重试。";
        setFeishuAssistIssue({
          phase: feishuAuth?.flow === "authorization" ? "authorization" : "configuration",
          error: resultError
        });
        setError(resultError);
        return;
      }
      setFeishuAuth(result);
      setFeishuAssistIssue(null);
      if (result.flow === "configuration") {
        setNotice(result.verificationOpened
          ? "已在浏览器打开首次飞书应用配置页；完成后回到 domi，点击“应用已配置，继续”。"
          : "请先在浏览器完成首次飞书应用配置，再回到 domi 继续授权。");
      } else {
        setNotice(result.verificationOpened
          ? "已在浏览器打开飞书授权页；完成授权后回到 domi 继续。"
          : "请在浏览器完成飞书授权后回到 domi 继续。");
      }
    } catch (authError) {
      const authMessage = authError instanceof Error ? authError.message : String(authError);
      setFeishuAssistIssue({
        phase: feishuAuth?.flow === "authorization" ? "authorization" : "configuration",
        error: authMessage
      });
      setError(authMessage);
    } finally {
      setFeishuAuthBusy(false);
    }
  }

  async function completeFeishuAuth() {
    const deviceCode = String(feishuAuth?.deviceCode || "").trim();
    if (!deviceCode) {
      await startFeishuAuth();
      return;
    }
    setFeishuAuthBusy(true);
    setError("");
    setNotice("正在确认飞书授权…");
    try {
      const status = await workbench.completeFeishuSetupAuth({ deviceCode });
      setFeishuStatus(status);
      if (!status.ok || !status.connected) {
        const statusError = status.error || "飞书授权尚未完成，请在浏览器完成后重试。";
        setNotice("");
        setFeishuAssistIssue({ phase: "authorization", error: statusError });
        setError(statusError);
        return;
      }
      setFeishuAuth(null);
      setFeishuAssistIssue(null);
      setFeishuAssistMessage("");
      setNotice(`飞书已连接${status.userName ? ` · ${status.userName}` : ""}。本地资料库不会因此迁移或改变。`);
    } catch (authError) {
      const authMessage = authError instanceof Error ? authError.message : String(authError);
      setNotice("");
      setFeishuAssistIssue({ phase: "authorization", error: authMessage });
      setError(authMessage);
    } finally {
      setFeishuAuthBusy(false);
    }
  }

  async function assistFeishuConnection() {
    if (!codexStatus?.ok) {
      setError("Codex 尚未就绪，请先完成 Codex 连接。");
      return;
    }

    const phase: FeishuAssistPhase = feishuAssistIssue?.phase
      || (feishuAuth?.flow === "configuration"
        ? "configuration"
          : feishuAuth?.flow === "authorization"
            ? "authorization"
            : "connection");
    const safeError = sanitizedFeishuAssistError(
      feishuAssistIssue?.error
      || feishuStatus?.error
      || "飞书连接尚未完成"
    );

    setFeishuAssistBusy(true);
    setFeishuAssistMessage("");
    setError("");
    setNotice("");
    try {
      const result = await workbench.runCodex({
        runId: `connection-guidance-${Date.now()}`,
        prompt: [
          "你是 domi 的连接引导助手。只根据下面两项脱敏信息，向普通用户解释当前问题和下一步：",
          `当前阶段：${FEISHU_ASSIST_PHASE_LABELS[phase]}`,
          `脱敏错误：${safeError}`,
          "",
          "严格限制：",
          "1. 只做诊断说明和操作引导；不得调用任何工具、终端、浏览器、网络或本地文件。",
          "2. 不得启动或代替用户完成应用初始化、登录、验证码、账号授权、企业管理员批准或资源写入。",
          "3. 不得要求或猜测 App ID、App Secret、Base Token、Table ID、Wiki Space ID、设备码、验证码、用户名或任何凭据。",
          "4. 如果涉及企业策略或管理员批准，明确告诉用户需要联系管理员；如果存在多个同名资源，只能让用户选择，不能替用户决定。",
          "5. 不得建议切换资料库模式、迁移资料，或清除已有配置。",
          "6. 优先引导用户继续使用当前页面已有按钮；不要让用户输入命令。",
          "",
          "最终用不超过三条简短中文说明：发生了什么、现在点哪里、什么情况必须由用户或管理员完成。"
        ].join("\n"),
        // 该字符串和 workflow 都刻意不包含外部数据关键词。助手只解释已脱敏状态，
        // 不应触发外部访问授权的系统模态框。
        requestText: "诊断当前连接引导",
        ephemeral: true,
        background: false,
        allowUserInput: false,
        privateOutput: true,
        webSearch: false,
        workflowId: "connection-guidance",
        workspacePath: codexStatus.workspacePath
      });
      if (!result.ok) {
        setError(result.error || "Codex 暂时无法给出连接建议，请重试。");
        return;
      }
      setFeishuAssistMessage(
        String(result.output || "请按当前页面提示继续连接；登录、验证码和管理员批准必须由你本人完成。")
          .trim()
          .slice(0, 2400)
      );
    } catch (assistError) {
      setError(assistError instanceof Error ? assistError.message : String(assistError));
    } finally {
      const refreshed = await refreshFeishuStatus(true);
      if (refreshed.connected) {
        setFeishuAssistIssue(null);
      }
      setFeishuAssistBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let receivedLiveUpdateStatus = false;
    const unsubscribe = workbench.onUpdateStatus((status) => {
      if (cancelled) return;
      receivedLiveUpdateStatus = true;
      setUpdateStatus(status);
    });
    workbench.getUpdateStatus().then((status) => {
      if (!cancelled && !receivedLiveUpdateStatus) setUpdateStatus(status);
    }).catch((statusError) => {
      if (!cancelled) {
        setError(statusError instanceof Error
          ? statusError.message
          : `无法读取软件更新状态：${String(statusError)}`);
      }
    });
    workbench.getCodexRuntimeStatus().then((status) => {
      if (!cancelled) setCodexRuntime(status);
    }).catch((runtimeError) => {
      if (!cancelled) {
        setError(runtimeError instanceof Error
          ? runtimeError.message
          : `无法读取 Codex Runtime 状态：${String(runtimeError)}`);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function save(complete: boolean) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await onSave({
        ...draft,
        storageBackend: "local",
        storageMigration: "none",
        onboardingComplete: complete || settings.onboardingComplete
      });
      if (!result.ok) {
        setError(result.error || "保存设置失败。");
        return false;
      }
      setNotice(result.warning || (result.codex?.ok
          ? "连接已保存并验证。"
          : "设置已保存；本地资料库继续作为唯一主资料库。"));
      if (complete) onClose();
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function requestClose() {
    if (saving) return;
    if (
      hasUnsavedChanges
      && !window.confirm("设置尚未保存。关闭后会丢失本次修改，确定要关闭吗？")
    ) {
      return;
    }
    onClose();
  }

  async function saveConnection(continueToData: boolean) {
    if (!codexStatus?.path) {
      setError("请先安装 Codex CLI。");
      return;
    }
    if (!selectedConnectionReady) {
      setError(draft.authMode === "relay"
        ? "请先安全保存中转站配置并完成测试；无需登录 ChatGPT。"
        : "请先完成 ChatGPT 登录并测试连接。");
      return;
    }
    if (required && !connectionVerified) {
      const verified = await testConnection();
      if (!verified) return;
    }
    if (await save(false) && continueToData) setTab("data");
  }

  async function saveDataAndContinue() {
    if (await save(false)) setTab("plaud");
  }

  async function checkOutlookProfile() {
    if (!codexStatus?.ok) {
      setError("Codex 尚未就绪，无法读取 Outlook 当前登录账号。");
      return;
    }
    setOutlookProfileBusy(true);
    setError("");
    setNotice("正在通过 Outlook Calendar 只读检测当前发送账号…");
    try {
      const result = await workbench.runCodex({
        runId: `outlook-profile-${Date.now()}`,
        prompt: [
          "DOMI_OUTLOOK_PROFILE_CHECK_V1",
          "使用已安装 domi 插件中的 $schedule，只执行 Outlook 发送账号检测。",
          "必须调用 Outlook Calendar 连接器的 get_profile；不得读取日程、不得创建或修改任何事件。",
          "最终只输出单行 JSON，不要 Markdown、解释或脱敏：{\"email\":\"当前登录账号的完整邮箱\"}。",
          "该结果由 domi 作为私密输出接收，只保存到本机 Application Support，不写入任务产物或日志。"
        ].join("\n"),
        requestText: "检测 Outlook 发送账号",
        ephemeral: true,
        background: true,
        privateOutput: true,
        workflowId: "schedule",
        workspacePath: codexStatus.workspacePath
      });
      if (!result.ok) {
        setNotice("");
        setError(result.error || "Outlook 当前登录账号检测失败。");
        return;
      }
      const email = outlookProfileEmail(result.output || "");
      if (!email) {
        setNotice("");
        setError("Outlook 未返回可识别的登录邮箱，请确认已连接自己的 Outlook Calendar 账号后重试。");
        return;
      }
      const verifiedAt = Date.now();
      const saved = await onSave({
        outlookCalendarEmail: email,
        outlookCalendarEmailVerifiedAt: verifiedAt
      });
      if (!saved.ok) {
        setNotice("");
        setError(saved.error || "已读取 Outlook 账号，但无法保存本机显示状态。");
        return;
      }
      setDraft((current) => ({
        ...current,
        outlookCalendarEmail: email,
        outlookCalendarEmailVerifiedAt: verifiedAt
      }));
      setNotice("已验证 Outlook 当前发送账号；实际发送前还会再次核对当前登录身份。");
    } catch (profileError) {
      setNotice("");
      setError(profileError instanceof Error ? profileError.message : String(profileError));
    } finally {
      setOutlookProfileBusy(false);
    }
  }

  async function checkPlaudConnection() {
    setPlaudChecking(true);
    setError("");
    setNotice("");
    try {
      const browser = draft.plaudBrowser === "tabbit" ? "tabbit" : "chrome";
      const saved = await onSave({ plaudConnectionMode: "enabled", plaudBrowser: browser });
      if (!saved.ok) {
        setError(saved.error || "无法保存 PLAUD 设置。");
        return;
      }
      const result = await workbench.checkPlaudConnection({ browser });
      setPlaudCheckedAt(result.checkedAt || Date.now());
      setPlaudStatus(result.status || (result.connected ? "connected" : "unknown"));
      const browserLabel = result.browserLabel || (browser === "tabbit" ? "Tabbit" : "Google Chrome");
      const check = {
        id: "plaud",
        label: "PLAUD 录音转写",
        ok: Boolean(result.ok && result.connected),
        detail: result.ok && result.connected
          ? `已通过 ${browserLabel} 只读验证当前 PLAUD 账号`
          : result.error || `未检测到 ${browserLabel} 中的 PLAUD 登录`
      };
      setPlaudCheck(check);
      if (!check?.ok) {
        setError(check.detail);
      } else {
        setNotice(`${check.detail}，domi 可以读取该账号的录音队列。`);
      }
    } catch (diagnosticError) {
      setError(diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError));
    } finally {
      setPlaudChecking(false);
    }
  }

  async function loginPlaud() {
    setPlaudChecking(true);
    setError("");
    setNotice("");
    try {
      const browser = draft.plaudBrowser === "tabbit" ? "tabbit" : "chrome";
      const saved = await onSave({ plaudConnectionMode: "enabled", plaudBrowser: browser });
      if (!saved.ok) {
        setError(saved.error || "无法保存 PLAUD 设置。");
        return;
      }
      const result = await workbench.loginPlaud({ browser });
      setPlaudCheckedAt(result.checkedAt || Date.now());
      setPlaudStatus(result.status || (result.connected ? "connected" : "unknown"));
      const browserLabel = result.browserLabel || (browser === "tabbit" ? "Tabbit" : "Google Chrome");
      const check = {
        id: "plaud",
        label: "PLAUD 录音转写",
        ok: Boolean(result.ok && result.connected),
        detail: result.ok && result.connected
          ? `已通过 ${browserLabel} 登录并只读验证当前 PLAUD 账号`
          : result.error || `${browserLabel} 中的 PLAUD 登录未完成`
      };
      setPlaudCheck(check);
      if (check.ok) {
        setPlaudAssistMessage("");
        setNotice(`${check.detail}。`);
      }
      else setError(check.detail);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setPlaudChecking(false);
    }
  }

  async function disconnectPlaud() {
    setPlaudChecking(true);
    setError("");
    setNotice("");
    try {
      const browser = draft.plaudBrowser === "tabbit" ? "tabbit" : "chrome";
      const result = await workbench.disconnectPlaud({ browser });
      if (!result.ok) {
        setError(result.error || "PLAUD 本地登录清理失败。");
        return;
      }
      const saved = await onSave({ plaudConnectionMode: "disabled", plaudBrowser: browser });
      if (!saved.ok) {
        setError(saved.error || "PLAUD 已断开，但无法保存关闭状态。");
        return;
      }
      setDraft((current) => ({ ...current, plaudConnectionMode: "disabled" }));
      setPlaudCheck(null);
      setPlaudCheckedAt(0);
      setPlaudStatus("");
      setPlaudAssistMessage("");
      setNotice("已断开 PLAUD，并删除 domi 专用浏览器登录数据。");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError));
    } finally {
      setPlaudChecking(false);
    }
  }

  async function assistPlaudConnection() {
    if (!codexStatus?.ok) {
      setError("Codex 尚未就绪，请先完成 Codex 连接。");
      return;
    }
    const browser = draft.plaudBrowser === "tabbit" ? "tabbit" : "chrome";
    const browserLabel = browser === "tabbit" ? "Tabbit" : "Google Chrome";
    const currentError = error || plaudCheck?.detail || "PLAUD 连接未完成";
    setPlaudAssistBusy(true);
    setPlaudAssistMessage("");
    setError("");
    setNotice(`Codex 正在检查 ${browserLabel}、PLAUD 专用 Profile 和内置音频运行时…`);
    try {
      const result = await workbench.runCodex({
        runId: `plaud-assist-${Date.now()}`,
        prompt: [
          "请协助当前用户完成 domi 的 PLAUD 连接。",
          `用户选择的浏览器：${browser}（${browserLabel}）。`,
          `当前脱敏错误：${currentError}`,
          "",
          "必须采用已安装 domi 插件中的 $plaud skill，并遵守其隐私与授权规则：",
          `1. 先运行 doctor ${browser}，检查 domi 内置 ffmpeg/ffprobe、Playwright 和所选浏览器。`,
          "2. 可以执行安全、可逆且仅作用于 domi 本地配置或 domi 专用 PLAUD Profile 的修复。",
          `3. 运行 connection ${browser} 自动恢复并复检；本连接助手禁止运行 login ${browser}，也不得打开任何可见浏览器窗口。即使明确返回 PLAUD_AUTH_REQUIRED，也只报告“请用户主动点击登录并验证”。HTTP 401/403、页面加载、网络超时或未及时捕获授权请求不得自行触发登录。`,
          `4. 完成后运行 connection ${browser} 做只读验证。`,
          "5. 不得读取、复制或改动用户日常 Chrome/Tabbit Profile；不得输出 Cookie、鉴权头、账号标识或预签名 URL。",
          "6. 不得提交或推送 Git，不得把本地配置写入仓库；安装第三方浏览器等系统级操作必须先让用户明确确认。",
          "7. 如果仍需用户处理验证码、账号登录、网络代理或浏览器安装，请用简短步骤说明。",
          "",
          "最终只报告：已完成的检查/修复、当前连接状态、仍需用户做的动作。"
        ].join("\n"),
        requestText: "诊断并协助完成 PLAUD 连接",
        ephemeral: true,
        background: false,
        workflowId: "plaud-connection-assist",
        workspacePath: codexStatus.workspacePath
      });
      if (!result.ok) {
        setError(result.error || "Codex 未能完成 PLAUD 连接诊断。");
        return;
      }
      const message = String(result.output || "Codex 已完成检查。").trim().slice(0, 4000);
      setPlaudAssistMessage(message);
      const checked = await workbench.checkPlaudConnection({ browser });
      const connected = Boolean(checked.ok && checked.connected);
      const detail = connected
        ? `已通过 ${checked.browserLabel || browserLabel} 只读验证当前 PLAUD 账号`
        : checked.error || `${browserLabel} 中的 PLAUD 登录仍未完成`;
      setPlaudCheck({
        id: "plaud",
        label: "PLAUD 录音转写",
        ok: connected,
        detail
      });
      if (connected) {
        setNotice(`${detail}。`);
        setError("");
      } else {
        setNotice("");
        setError(detail);
      }
    } catch (assistError) {
      setError(assistError instanceof Error ? assistError.message : String(assistError));
    } finally {
      setPlaudAssistBusy(false);
    }
  }

  async function startLogin() {
    setLoginBusy(true);
    setError("");
    setNotice("");
    setConnectionVerified(false);
    setDraft((current) => ({
      ...current,
      authMode: "chatgpt",
      apiBaseUrl: "",
      apiModel: "",
      relayCredentialConfigured: false
    }));
    const saved = await onSave({ ...draft, authMode: "chatgpt" });
    if (!saved.ok) {
      setError(saved.error || "无法切换到 ChatGPT 登录模式。");
      setLoginBusy(false);
      return;
    }
    const result = await onLogin();
    setLoginBusy(false);
    if (!result.ok) {
      setError(result.error || "无法打开 ChatGPT 登录页面。");
      return;
    }
    setNotice("登录页面已在浏览器打开。完成登录后回到 domi 重新检测。");
  }

  async function installCodex(automatic = false) {
    setInstallBusy(true);
    setInstallError("");
    setError("");
    setNotice("");
    try {
      const result = await workbench.installCodex();
      if (!result.ok) {
        setInstallError(result.error || "Codex CLI 安装失败。");
        return;
      }
      setDraft((current) => ({ ...current, codexPath: result.path }));
      await onSave({ codexPath: result.path });
      await onRefresh();
      if (!automatic) {
        setNotice(result.installedNow
          ? `Codex CLI 已安装并验证：${result.version}`
          : `已检测到可用的 Codex CLI：${result.version}`);
      }
    } catch (installFailure) {
      setInstallError(installFailure instanceof Error ? installFailure.message : String(installFailure));
    } finally {
      setInstallBusy(false);
    }
  }

  async function configureRelay() {
    setRelayBusy(true);
    setError("");
    setNotice("");
    setConnectionVerified(false);
    try {
      const result = await workbench.configureCodexRelay({
        baseUrl: draft.apiBaseUrl,
        model: draft.apiModel,
        apiKey: relayApiKey || undefined,
        keepExistingKey: !relayApiKey && draft.relayCredentialConfigured
      });
      if (!result.ok) {
        setError(result.error || "中转站配置或测试失败。");
        return;
      }
      const nextDraft = {
        ...draft,
        authMode: "relay" as const,
        apiBaseUrl: result.codex?.apiBaseUrl || draft.apiBaseUrl,
        apiModel: result.codex?.configuredModel || draft.apiModel,
        relayCredentialConfigured: true
      };
      setDraft(nextDraft);
      setRelayApiKey("");
      await onSave({
        authMode: "relay",
        apiBaseUrl: nextDraft.apiBaseUrl,
        apiModel: nextDraft.apiModel,
        relayCredentialConfigured: true,
        codexPath: result.codex?.path || nextDraft.codexPath
      });
      await onRefresh();
      setConnectionVerified(true);
      setNotice(result.verification?.detail || "中转站模型响应与工具调用均已通过。");
    } catch (relayError) {
      setError(relayError instanceof Error ? relayError.message : String(relayError));
    } finally {
      setRelayBusy(false);
    }
  }

  async function testConnection(): Promise<boolean> {
    setConnectionTestBusy(true);
    setError("");
    setNotice("");
    setConnectionVerified(false);
    try {
      const result = await workbench.testCodexConnection();
      if (!result.ok) {
        setError(result.error || "Codex 完整连接测试失败。");
        return false;
      }
      await onRefresh();
      setConnectionVerified(true);
      setNotice(result.verification?.detail || "模型响应与 Shell 工具调用均已通过。");
      return true;
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
      return false;
    } finally {
      setConnectionTestBusy(false);
    }
  }

  async function chooseLocalLibraryDirectory() {
    setError("");
    const targetField = "localRepositoryDir";
    const result = await workbench.selectDirectory(draft[targetField]);
    if (!result.ok) {
      setError(result.error || "无法选择本地资料库目录。");
      return;
    }
    if (result.canceled || !result.path) return;
    const selectedPath = result.path.trim().replace(/[\\/]+$/, "");
    const preservesExistingLocalRoot = targetField === "localRepositoryDir"
      && settings.onboardingComplete
      && selectedPath === draft.localRepositoryDir.trim().replace(/[\\/]+$/, "");
    const nextPath = targetField === "localRepositoryDir" && !preservesExistingLocalRoot
      ? domiWorkspacePath(selectedPath)
      : selectedPath;
    setDraft((current) => ({ ...current, [targetField]: nextPath }));
    setNotice(targetField === "localRepositoryDir"
      ? "已选择上级目录；domi 将在其中创建“domi工作区”，保存后生效。"
      : "已选择本地资料库目录，保存后生效。");
  }

  async function diagnose() {
    setDiagnosing(true);
    setError("");
    try {
      setReport(await workbench.runDiagnostics());
    } catch (diagnosticError) {
      setError(diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError));
    } finally {
      setDiagnosing(false);
    }
  }

  async function exportReport() {
    if (!report) return;
    const result = await workbench.exportDiagnostics(report);
    if (!result.ok) setError(result.error || "无法导出诊断报告。");
  }

  async function saveUpdateSettings() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await onSave({ updateChannel: draft.updateChannel });
      if (!result.ok) {
        setError(result.error || "保存更新设置失败。");
        return;
      }
      setNotice(draft.updateChannel === "beta" ? "已切换到测试版通道。" : "已切换到稳定版通道。");
      await checkUpdates();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function checkUpdates() {
    setUpdateBusy(true);
    setError("");
    try {
      setUpdateStatus(await workbench.checkForUpdates());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function downloadAvailableUpdate() {
    setUpdateBusy(true);
    setError("");
    try {
      setUpdateStatus(await workbench.downloadUpdate());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installDownloadedUpdate() {
    setUpdateBusy(true);
    setError("");
    try {
      const result = await workbench.installUpdate();
      if (!result.ok) {
        setError(result.error || "暂时无法安装更新。");
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function updateRuntime() {
    setCodexRuntimeBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await workbench.updateCodexRuntime();
      if (!result.ok) {
        setError(result.error || "Codex Runtime 更新失败，当前版本保持不变。");
        return;
      }
      setCodexRuntime(result.runtime || result);
      await onRefresh();
      setNotice(`Codex Runtime 已更新：${result.version || "当前版本已生效"}。`);
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : String(runtimeError));
    } finally {
      setCodexRuntimeBusy(false);
    }
  }

  async function rollbackRuntime() {
    setCodexRuntimeBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await workbench.rollbackCodexRuntime();
      if (!result.ok) {
        setError(result.error || "没有可恢复的 Codex Runtime。");
        return;
      }
      setCodexRuntime(result);
      await onRefresh();
      setNotice(`已恢复 Codex Runtime：${result.version || "上一版本"}。`);
    } catch (runtimeError) {
      setError(runtimeError instanceof Error ? runtimeError.message : String(runtimeError));
    } finally {
      setCodexRuntimeBusy(false);
    }
  }

  const downloadedUpdateLabel = updateStatus?.installing
    ? "正在安装，domi 将自动重启"
    : updateStatus?.error
      ? "更新重启未完成，可重试"
      : updateStatus?.restartPending && Number(updateStatus.busyTaskCount || 0) > 0
        ? "更新已下载，任务完成后自动重启"
        : "更新已下载，正在安全保存并重启";
  const updateStateLabel = updateStatus
    ? {
        disabled: "开发版不执行安装更新",
        idle: "等待检查",
        checking: "正在检查更新",
        available: `发现 ${updateStatus.availableVersion || "新版本"}`,
        "up-to-date": "当前已是最新版本",
        downloading: `正在下载 ${Math.round(updateStatus.percent)}%`,
        downloaded: downloadedUpdateLabel,
        error: "更新检查失败"
      }[updateStatus.state]
    : "正在读取版本信息";
  const codexInstalled = Boolean(codexStatus?.path);
  const relayDraftMatchesRuntime = draft.authMode !== "relay" || Boolean(
    draft.relayCredentialConfigured
    && draft.apiBaseUrl.trim() === codexStatus?.apiBaseUrl
    && draft.apiModel.trim() === codexStatus?.configuredModel
  );
  const selectedConnectionReady = Boolean(
    codexStatus?.ok
    && codexStatus.authMode === draft.authMode
    && relayDraftMatchesRuntime
  );
  const connectionDetail = selectedConnectionReady
    ? draft.authMode === "relay"
      ? [codexStatus?.configuredModel, codexStatus?.apiBaseUrl, codexStatus?.version].filter(Boolean).join(" · ")
      : [codexStatus?.account?.email, codexStatus?.account?.planType, codexStatus?.version].filter(Boolean).join(" · ")
    : codexStatus?.error || (draft.authMode === "relay"
      ? "请填写中转站信息并保存测试"
      : "请登录 ChatGPT 后重新测试");
  const installStepState = codexInstalled
    ? "ok"
    : installError
      ? "error"
      : installBusy || required
        ? "working"
        : "warning";

  useEffect(() => {
    if (
      !required
      || tab !== "connection"
      || codexStatus === null
      || codexInstalled
      || autoInstallAttemptedRef.current
    ) {
      return;
    }
    autoInstallAttemptedRef.current = true;
    void installCodex(true);
  }, [required, tab, codexStatus, codexInstalled]);

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-label="domi 设置">
      <div className="setup-window">
        <aside className="setup-nav">
          <div className="setup-brand">
            <img src="./domi-icon.png" alt="" />
            <div><strong>domi</strong><span>{required ? "首次启动配置" : "设置"}</span></div>
          </div>
          <nav>
            <button className={tab === "connection" ? "active" : ""} onClick={() => setTab("connection")}>
              <Settings2 size={16} />Codex 连接
            </button>
            <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>
              <Database size={16} />资料连接
            </button>
            <button className={tab === "plaud" ? "active" : ""} onClick={() => setTab("plaud")}>
              <Mic size={16} />录音转写
            </button>
            <button className={tab === "updates" ? "active" : ""} onClick={() => setTab("updates")}>
              <Download size={16} />软件更新
            </button>
            <button className={tab === "diagnostics" ? "active" : ""} onClick={() => setTab("diagnostics")}>
              <ShieldCheck size={16} />系统诊断
            </button>
          </nav>
          <div className="setup-security-note">
            <ShieldCheck size={15} />
            <span>ChatGPT 登录由 Codex 管理；中转站密钥只保存在 macOS 钥匙串。</span>
          </div>
        </aside>

        <section className={`setup-content ${tab === "connection" ? "connection-tab" : ""}`}>
          <header className="setup-header">
            <div>
              <span>{required ? "开始使用 domi" : "偏好设置"}</span>
              <h2>{tab === "connection"
                ? "选择 Codex 连接方式"
                : tab === "data"
                  ? "配置 domi 资料库"
                  : tab === "plaud"
                    ? "连接 PLAUD"
                  : tab === "updates"
                    ? "软件更新"
                    : "系统诊断"}</h2>
              <p>{tab === "connection"
                ? "domi 会自动准备 Codex CLI；你只需选择 ChatGPT 账号或 Responses 中转站。"
                : tab === "data"
                  ? "domi 默认使用本地 SQLite + Markdown；飞书可选连接，作为外部参考资料库和发布平台。配置仅保存在这台 Mac。"
                : tab === "plaud"
                  ? "PLAUD 仅用于把录音转成文字稿。现在不用可以直接跳过，domi 不会连接或读取录音。"
                : tab === "updates"
                  ? "检查签名版本并更新程序本体；历史、工作区和本机配置会继续保留。"
                  : "检查 Codex、Keychain、本地数据库、工作区和 domi 插件。"}</p>
            </div>
            {!required && (
              <button className="setup-close" type="button" onClick={requestClose} title="关闭设置"><X size={18} /></button>
            )}
          </header>

          {tab === "connection" ? (
            <div className="setup-form connection-form">
              <div className={`codex-install-step ${installStepState}`}>
                <i>{codexInstalled
                  ? <CheckCircle2 size={18} />
                  : installError
                    ? <CircleAlert size={18} />
                    : installBusy || required
                      ? <LoaderCircle className="spinning" size={18} />
                      : <Terminal size={18} />}</i>
                <span>
                  <strong>{codexInstalled
                    ? "Codex CLI 已准备好"
                    : installError
                      ? "Codex CLI 自动安装未完成"
                      : "正在自动准备 Codex CLI"}</strong>
                  <small>{codexInstalled
                    ? `${codexStatus?.version || "版本已检测"} · ${codexStatus?.path}`
                    : installError
                      ? installError
                      : "正在校验并安装 domi 内置的 Codex Runtime，无需打开终端或连接 GitHub。"}</small>
                </span>
                {codexInstalled ? (
                  <b className="codex-install-badge">已完成</b>
                ) : installError || !required ? (
                  <button type="button" onClick={() => void installCodex(false)} disabled={installBusy}>
                    {installBusy ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}
                    {installBusy ? "正在重试…" : "重新安装"}
                  </button>
                ) : (
                  <b className="codex-install-badge">自动进行</b>
                )}
              </div>

              <div className="codex-mode-options" role="radiogroup" aria-label="Codex 连接方式（二选一）">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.authMode === "chatgpt"}
                  className={draft.authMode === "chatgpt" ? "selected" : ""}
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      authMode: "chatgpt",
                      apiBaseUrl: "",
                      apiModel: "",
                      relayCredentialConfigured: false
                    }));
                    setConnectionVerified(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  <LogIn size={18} />
                  <span>
                    <strong>ChatGPT 账号</strong>
                    <small>选择后只需完成 Codex 官方登录与连接测试。</small>
                  </span>
                  <i>{draft.authMode === "chatgpt" ? <CheckCircle2 size={17} /> : null}</i>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.authMode === "relay"}
                  className={draft.authMode === "relay" ? "selected" : ""}
                  onClick={() => {
                    setDraft((current) => ({ ...current, authMode: "relay" }));
                    setConnectionVerified(false);
                    setError("");
                    setNotice("");
                  }}
                >
                  <KeyRound size={18} />
                  <span>
                    <strong>Responses 中转站</strong>
                    <small>选择后只需保存中转站并通过测试，不要求登录 ChatGPT。</small>
                  </span>
                  <i>{draft.authMode === "relay" ? <CheckCircle2 size={17} /> : null}</i>
                </button>
              </div>

              {draft.authMode === "relay" && (
                <div className="relay-settings">
                  <label>
                    <span>中转站地址</span>
                    <input
                      value={draft.apiBaseUrl}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, apiBaseUrl: event.target.value }));
                        setConnectionVerified(false);
                      }}
                      placeholder="https://relay.example.com/v1"
                      spellCheck={false}
                    />
                    <small>必须支持 OpenAI Responses API；普通 Chat Completions 接口不能提供完整 Codex 能力。</small>
                  </label>
                  <div>
                    <label>
                      <span>模型名称</span>
                      <input
                        value={draft.apiModel}
                        onChange={(event) => {
                          setDraft((current) => ({ ...current, apiModel: event.target.value }));
                          setConnectionVerified(false);
                        }}
                        placeholder="中转站支持的模型 ID"
                        spellCheck={false}
                      />
                    </label>
                    <label>
                      <span>API Key</span>
                      <input
                        type="password"
                        value={relayApiKey}
                        onChange={(event) => {
                          setRelayApiKey(event.target.value);
                          setConnectionVerified(false);
                        }}
                        placeholder={draft.relayCredentialConfigured ? "已保存在 macOS 钥匙串，留空则沿用" : "仅保存到 macOS 钥匙串"}
                        autoComplete="new-password"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                  <button className="relay-configure-button" type="button" onClick={configureRelay} disabled={relayBusy || !codexInstalled}>
                    {relayBusy ? <LoaderCircle className="spinning" size={15} /> : <ShieldCheck size={15} />}
                    {relayBusy ? "正在配置并测试…" : "安全保存并测试"}
                  </button>
                </div>
              )}

              <div className={`connection-panel ${selectedConnectionReady ? "ok" : "warning"}`}>
                <div className="connection-status">
                  <i className="connection-status-icon">
                    {selectedConnectionReady ? <BadgeCheck size={20} /> : <CircleAlert size={20} />}
                  </i>
                  <div>
                    <small>{draft.authMode === "relay" ? "Responses 中转站" : "ChatGPT / Codex"}</small>
                    <strong>{selectedConnectionReady
                      ? draft.authMode === "relay" ? "中转站配置已就绪" : "ChatGPT 身份已就绪"
                      : "尚未检测到可用连接"}</strong>
                    <span>{connectionDetail}</span>
                  </div>
                  <b className="connection-status-badge">
                    {connectionVerified
                      ? "已实测"
                      : selectedConnectionReady
                        ? required ? "下一步自动测试" : "待实测"
                        : "待连接"}
                  </b>
                </div>
                <div className="setup-inline-actions">
                  {draft.authMode === "chatgpt" && (
                    <button type="button" onClick={startLogin} disabled={loginBusy || !codexInstalled}>
                      {loginBusy ? <LoaderCircle className="spinning" size={16} /> : <LogIn size={16} />}
                      {selectedConnectionReady ? "切换 ChatGPT 账号" : "登录 ChatGPT"}
                      <ExternalLink size={13} />
                    </button>
                  )}
                  <button type="button" onClick={testConnection} disabled={connectionTestBusy || !codexInstalled || (draft.authMode === "relay" && !draft.relayCredentialConfigured)}>
                    {connectionTestBusy ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}
                    {connectionTestBusy ? "正在调用模型与工具…" : "测试完整连接"}
                  </button>
                </div>
              </div>

              <details className="advanced-settings">
                <summary><HardDrive size={15} />高级设置</summary>
                <button
                  className={`permission-setting ${draft.externalAccessMode === "always" ? "enabled" : ""}`}
                  type="button"
                  role="switch"
                  aria-checked={draft.externalAccessMode === "always"}
                  onClick={() => setDraft((current) => ({
                    ...current,
                    externalAccessMode: current.externalAccessMode === "always" ? "ask" : "always"
                  }))}
                >
                  <ShieldCheck size={17} />
                  <span>
                    <strong>始终允许外部数据访问</strong>
                    <small>允许 Codex 直接读取飞书、Wiki 和所选本地资料库，不再逐次询问。</small>
                  </span>
                  <i aria-hidden="true"><b /></i>
                </button>
                <label>
                  <span>自定义 Codex 路径</span>
                  <input
                    value={draft.codexPath}
                    onChange={(event) => setDraft((current) => ({ ...current, codexPath: event.target.value }))}
                    placeholder="自动检测，通常无需填写"
                    spellCheck={false}
                  />
                </label>
              </details>

              {(error || notice) && <div className={`setup-feedback ${error ? "error" : "success"}`}>{error || notice}</div>}
            </div>
          ) : tab === "data" ? (
            <div className="setup-form data-connection-form">
              <div className="storage-backend-options local-only" aria-label="本地主资料库">
                <div className="selected">
                  <HardDrive size={19} />
                  <span>
                    <strong>{settings.storageBackend === "feishu"
                      ? "本地资料库 · 目标架构"
                      : "本地资料库 · 默认基础"}</strong>
                    <small>{settings.storageBackend === "feishu"
                      ? "旧版飞书主库尚未导入；下方只是准备本地工作区，不代表已经完成迁移或切换。"
                      : "SQLite 管理结构化数据，Markdown 保存文档和图片；项目、人脉、行业动态均以本机内容为准。"}</small>
                  </span>
                  <i><CheckCircle2 size={17} /></i>
                </div>
              </div>
              {settings.storageBackend === "feishu" ? (
                <div className="setup-feedback success legacy-feishu-compatibility" role="status">
                  <strong>旧版飞书主库仍按原模式运行</strong>
                  <span>为避免现有项目和人脉突然消失，domi 不会静默切到空的本地库。当前读写与文档连接可继续使用；待你明确完成“安全导入本地”并逐项核验后，才会切换主资料库，且不会删除飞书内容。</span>
                </div>
              ) : null}
              <section className={`feishu-connection-card ${feishuStatus?.connected ? "connected" : ""}`}>
                <span className="feishu-connection-icon">
                  {feishuStatus?.connected ? <BadgeCheck size={21} /> : <Cloud size={21} />}
                </span>
                <span className="feishu-connection-copy">
                  <strong>{feishuStatusBusy && !feishuStatus
                    ? "正在检查飞书连接"
                    : feishuStatus?.connected
                      ? `飞书已连接${feishuStatus.userName ? ` · ${feishuStatus.userName}` : ""}`
                      : "连接飞书（可选）"}</strong>
                  <small>{feishuStatus?.connected
                    ? settings.storageBackend === "feishu"
                      ? "旧版飞书主库继续按原模式安全运行；完整飞书权限和既有资料连接都会保留，本地安全导入完成后才接管管理。"
                      : "可按你的指令访问飞书资料、联系人和消息，或创建、编辑、发布文档；本地资料库始终是管理基础。"
                    : feishuStatus?.error && !feishuStatusBusy
                      ? feishuStatus.error
                      : "连接后保留此前完整的飞书业务能力；不会自动创建或接管 Base，也不会改变、迁移本地资料。"}</small>
                  <small className="feishu-permission-scope">授权范围：多维表格、知识库、云文档、云盘、消息与通讯录；仅在你的明确指令或已启用工作流需要时使用。</small>
                </span>
                <span className="feishu-connection-actions">
                  {feishuStatus?.connected ? (
                    <button type="button" onClick={() => void refreshFeishuStatus(true)} disabled={feishuStatusBusy}>
                      {feishuStatusBusy ? <LoaderCircle className="spinning" size={14} /> : <RefreshCw size={14} />}
                      检查连接
                    </button>
                  ) : feishuAuth?.flow === "configuration" ? (
                    <button type="button" onClick={startFeishuAuth} disabled={feishuAuthBusy}>
                      {feishuAuthBusy ? <LoaderCircle className="spinning" size={14} /> : <CheckCircle2 size={14} />}
                      应用已配置，继续
                    </button>
                  ) : feishuAuth?.deviceCode ? (
                    <button type="button" onClick={completeFeishuAuth} disabled={feishuAuthBusy}>
                      {feishuAuthBusy ? <LoaderCircle className="spinning" size={14} /> : <CheckCircle2 size={14} />}
                      我已完成授权
                    </button>
                  ) : (
                    <button type="button" onClick={startFeishuAuth} disabled={feishuAuthBusy || feishuStatusBusy}>
                      {feishuAuthBusy ? <LoaderCircle className="spinning" size={14} /> : <LogIn size={14} />}
                      连接飞书
                    </button>
                  )}
                  {codexStatus?.ok
                    && (Boolean(feishuAssistIssue) || Boolean(feishuStatus && !feishuStatus.connected)) ? (
                    <button
                      type="button"
                      onClick={assistFeishuConnection}
                      disabled={feishuAssistBusy || feishuAuthBusy}
                    >
                      {feishuAssistBusy
                        ? <LoaderCircle className="spinning" size={14} />
                        : <Sparkles size={14} />}
                      {feishuAssistBusy ? "Codex 正在判断" : "让 Codex 帮我"}
                    </button>
                  ) : null}
                </span>
                {feishuAuth?.verificationUrl ? (
                  <span className="feishu-auth-progress">
                    <ExternalLink size={15} />
                    <span>
                      <strong>{feishuAuth.flow === "configuration"
                        ? "第 1 步：初始化飞书应用"
                        : "第 2 步：授权飞书账号"}</strong>
                      <small>{feishuAuth.flow === "configuration"
                        ? "应用凭据只会保存在 macOS 钥匙串；完成后回到这里继续账号授权。"
                        : `${feishuAuth.userCode ? `验证码：${feishuAuth.userCode} · ` : ""}授权完成后回到这里继续。`}</small>
                    </span>
                    <button type="button" onClick={startFeishuAuth} disabled={feishuAuthBusy}>重新打开</button>
                  </span>
                ) : null}
                {feishuAssistBusy || feishuAssistMessage ? (
                  <span className="feishu-assist-result" aria-live="polite">
                    <strong>{feishuAssistBusy ? "Codex 正在分析当前步骤" : "Codex 连接建议"}</strong>
                    <small>{feishuAssistBusy
                      ? "只会读取脱敏后的阶段和错误，不会打开浏览器或代替你登录、授权。"
                      : feishuAssistMessage}</small>
                  </span>
                ) : null}
              </section>
              <div className="data-privacy-note">
                <ShieldCheck size={19} />
                <span>
                  <strong>{settings.storageBackend === "feishu" ? "兼容期不会丢失旧资料" : "本地是唯一主资料库"}</strong>
                  <small>{settings.storageBackend === "feishu"
                    ? "当前旧飞书主库继续按原模式运行；不会自动切换、导入、覆盖或删除。新用户和完成安全导入后的用户均以本地为准。"
                    : "飞书是可选的外部参考资料库和发布平台。未经你的明确指令，domi 不会把本地记录发布到飞书，也不会用飞书内容覆盖本地数据。"}</small>
                </span>
              </div>
              <div className="local-storage-panel">
                  <div className="local-storage-summary">
                    <Database size={20} />
                    <span>
                      <strong>一套资料库，三种内容自动对应</strong>
                      <small>项目、人脉和行业事件写入 SQLite；项目主页与纪要写成 Markdown；BP、录音和附件保留原文件。</small>
                    </span>
                  </div>
                  <label className="local-library-setting">
                    <span>domi 工作区</span>
                    <div className="directory-picker">
                      <input
                        value={draft.localRepositoryDir}
                        onChange={(event) => setDraft((current) => ({ ...current, localRepositoryDir: event.target.value }))}
                        placeholder="请选择工作区的上级目录"
                        spellCheck={false}
                      />
                      <button type="button" onClick={chooseLocalLibraryDirectory} title="选择本地资料库目录" aria-label="选择本地资料库目录">
                        <FolderOpen size={16} />
                      </button>
                    </div>
                    <small>选择上级目录后，domi 会先创建“domi工作区”，在根目录生成“0.待办事项.md”，再建立行业研究、行业动态、项目库和人脉库；已有文件不会被删除或覆盖。</small>
                  </label>
                  <div className="local-database-location">
                    <span>SQLite 数据库</span>
                    <code>{draft.localDatabasePath || "保存设置后自动创建"}</code>
                    <small>数据库保存在 Application Support，不放入同步盘，Markdown 和附件仍可选择 iCloud、OneDrive 或普通文件夹。</small>
                  </div>
                </div>
              <section className="task-calendar-settings">
                <div className="task-calendar-settings-heading">
                  <CalendarDays size={20} />
                  <span>
                    <strong>待办事项与日历</strong>
                    {required ? <em>可稍后设置</em> : null}
                    <small>{required
                      ? "这部分不影响完成资料库配置；可以先跳过，之后再连接 Outlook 和添加常用参会人。"
                      : "domi 使用工作区根目录的“0.待办事项.md”；日程邀请由当前 Outlook 账号的默认日历发出。"}</small>
                  </span>
                </div>
                <div className={`outlook-account-card ${draft.outlookCalendarEmailVerifiedAt ? "verified" : ""}`}>
                  <span className="outlook-account-icon">
                    {draft.outlookCalendarEmailVerifiedAt
                      ? <BadgeCheck size={19} />
                      : <CalendarDays size={19} />}
                  </span>
                  <span className="outlook-account-copy">
                    <strong>发送账号</strong>
                    <b>{draft.outlookCalendarEmail || "尚未检测当前 Outlook 登录账号"}</b>
                    <small>{draft.outlookCalendarEmailVerifiedAt
                      ? `上次通过 Outlook Calendar 验证：${outlookVerificationTime(draft.outlookCalendarEmailVerifiedAt)}。该账号将作为日程组织者发送邀请。`
                      : draft.outlookCalendarEmail
                        ? "这是旧版保存的账号提示，尚未与 Outlook 当前登录身份核对。"
                        : "连接 Outlook 后点击检测；domi 不使用 SMTP，也不会自行选择其他邮箱。"}</small>
                  </span>
                  <button
                    type="button"
                    onClick={checkOutlookProfile}
                    disabled={outlookProfileBusy || !codexStatus?.ok}
                  >
                    {outlookProfileBusy
                      ? <LoaderCircle className="spinning" size={14} />
                      : <RefreshCw size={14} />}
                    {outlookProfileBusy
                      ? "检测中"
                      : draft.outlookCalendarEmailVerifiedAt
                        ? "重新检测"
                        : "检测账号"}
                  </button>
                </div>
                <div className="task-calendar-settings-grid">
                  <section className="calendar-timezone-setting">
                    <label>
                      <span>默认时区</span>
                      <input
                        value={draft.outlookCalendarTimezone}
                        onChange={(event) => setDraft((current) => ({ ...current, outlookCalendarTimezone: event.target.value }))}
                        placeholder="Asia/Shanghai"
                        spellCheck={false}
                      />
                      <small>使用 IANA 时区名称；跨城市日程仍以当次明确输入为准。</small>
                    </label>
                  </section>
                  <section className="calendar-recipient-setting">
                    <label>
                      <span>常用参会人（可多个）</span>
                      <textarea
                        rows={3}
                        value={draft.outlookCalendarRecipients}
                        onChange={(event) => setDraft((current) => ({
                          ...current,
                          outlookCalendarRecipients: event.target.value
                        }))}
                        placeholder={"张三 <zhangsan@example.com>\n李四 <lisi@example.com>"}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <small>使用逗号、分号或换行分隔。约日程时由用户选择一个或多个，不会默认全部发送。</small>
                    </label>
                  </section>
                </div>
              </section>
              {(error || notice) && <div className={`setup-feedback ${error ? "error" : "success"}`}>{error || notice}</div>}
            </div>
          ) : tab === "plaud" ? (
            <div className="setup-form plaud-connection-form">
              <div className="plaud-mode-options" role="radiogroup" aria-label="PLAUD 使用方式">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.plaudConnectionMode === "enabled"}
                  className={draft.plaudConnectionMode === "enabled" ? "selected" : ""}
                  onClick={() => {
                    setDraft((current) => ({ ...current, plaudConnectionMode: "enabled" }));
                    setPlaudCheck(null);
                    setPlaudAssistMessage("");
                    setError("");
                    setNotice("");
                  }}
                >
                  <Mic size={20} />
                  <span>
                    <strong>连接 PLAUD</strong>
                    <small>读取 PLAUD 最近录音，并可生成文字稿、纪要和入库结果。</small>
                  </span>
                  <i>{draft.plaudConnectionMode === "enabled" ? <CheckCircle2 size={17} /> : null}</i>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.plaudConnectionMode === "disabled"}
                  className={draft.plaudConnectionMode === "disabled" ? "selected" : ""}
                  onClick={() => {
                    setDraft((current) => ({ ...current, plaudConnectionMode: "disabled" }));
                    setPlaudCheck(null);
                    setPlaudAssistMessage("");
                    setError("");
                    setNotice("已选择暂时不用；之后可在设置的“录音转写”中重新开启。");
                  }}
                >
                  <ShieldCheck size={20} />
                  <span>
                    <strong>暂时不用</strong>
                    <small>不检测 PLAUD、不读取录音队列，也不会显示授权或连接错误。</small>
                  </span>
                  <i>{draft.plaudConnectionMode === "disabled" ? <CheckCircle2 size={17} /> : null}</i>
                </button>
              </div>

              {draft.plaudConnectionMode === "enabled" ? (
                <div className={`plaud-setup-panel ${plaudCheck?.ok ? "ok" : ""}`}>
                  <div className="plaud-browser-options" role="radiogroup" aria-label="PLAUD 登录浏览器">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.plaudBrowser === "chrome"}
                      className={draft.plaudBrowser === "chrome" ? "selected" : ""}
                      onClick={() => {
                        setDraft((current) => ({ ...current, plaudBrowser: "chrome" }));
                        setPlaudCheck(null);
                        setPlaudAssistMessage("");
                        setError("");
                        setNotice("");
                      }}
                    >
                      <strong>Google Chrome</strong>
                      <small>使用 domi 专用 Chrome Profile</small>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={draft.plaudBrowser === "tabbit"}
                      className={draft.plaudBrowser === "tabbit" ? "selected" : ""}
                      onClick={() => {
                        setDraft((current) => ({ ...current, plaudBrowser: "tabbit" }));
                        setPlaudCheck(null);
                        setPlaudAssistMessage("");
                        setError("");
                        setNotice("");
                      }}
                    >
                      <strong>Tabbit</strong>
                      <small>使用 domi 专用 Tabbit Profile</small>
                    </button>
                  </div>
                  <div className="plaud-setup-copy">
                    <span className="plaud-setup-icon">
                      {plaudCheck?.ok ? <BadgeCheck size={21} /> : <Mic size={21} />}
                    </span>
                    <div>
                      <strong>{plaudCheck?.ok
                        ? "PLAUD 已连接"
                        : `使用 ${draft.plaudBrowser === "tabbit" ? "Tabbit" : "Chrome"} 登录 PLAUD`}</strong>
                      <small>{plaudCheck?.detail
                        || "domi 会打开独立的本地浏览器 Profile；请登录你自己的 PLAUD 账号，不读取日常浏览器 Profile。"}</small>
                      {plaudCheckedAt ? (
                        <small>
                          最近检测：{outlookVerificationTime(plaudCheckedAt)}
                          {plaudStatus && plaudStatus !== "connected"
                            ? ` · ${plaudStatusLabel(plaudStatus)}`
                            : ""}
                        </small>
                      ) : null}
                    </div>
                  </div>
                  <ol>
                    <li>domi 已内置离线音频转换组件，新用户不需要安装 Homebrew 或 ffmpeg。</li>
                    <li>点击“登录并验证”，在打开的专用窗口中登录自己的 PLAUD 账号。</li>
                    <li>domi 会发起一次只读远端请求，确认该账号确实可以读取录音。</li>
                    <li>登录数据只保存在本机 domi Application Support；不会读取或复制 Chrome/Tabbit 的日常 Profile。</li>
                  </ol>
                  <div className="setup-inline-actions">
                    <button type="button" onClick={loginPlaud} disabled={plaudChecking}>
                      {plaudChecking ? <LoaderCircle className="spinning" size={15} /> : <ExternalLink size={15} />}
                      登录并验证
                    </button>
                    <button type="button" onClick={checkPlaudConnection} disabled={plaudChecking}>
                      {plaudChecking ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}
                      重新检测
                    </button>
                    <button type="button" onClick={disconnectPlaud} disabled={plaudChecking}>
                      <ShieldCheck size={15} />断开并清除登录
                    </button>
                    {(error || (plaudCheck && !plaudCheck.ok)) && codexStatus?.ok ? (
                      <button
                        type="button"
                        onClick={assistPlaudConnection}
                        disabled={plaudChecking || plaudAssistBusy}
                      >
                        {plaudAssistBusy
                          ? <LoaderCircle className="spinning" size={15} />
                          : <Sparkles size={15} />}
                        {plaudAssistBusy ? "Codex 正在处理" : "让 Codex 帮我解决"}
                      </button>
                    ) : null}
                  </div>
                  {plaudAssistMessage ? (
                    <div className="plaud-assist-result">
                      <strong>Codex 连接助手</strong>
                      <p>{plaudAssistMessage}</p>
                    </div>
                  ) : null}
                </div>
              ) : draft.plaudConnectionMode === "disabled" ? (
                <div className="plaud-skip-note">
                  <ShieldCheck size={19} />
                  <span>
                    <strong>PLAUD 保持关闭</strong>
                    <small>本地资料库、飞书资料库、行业动态和其他 domi 能力仍可正常使用。</small>
                  </span>
                </div>
              ) : (
                <div className="plaud-choice-note">
                  请选择“连接 PLAUD”或“暂时不用”后继续。
                </div>
              )}
              {(error || notice) && <div className={`setup-feedback ${error ? "error" : "success"}`}>{error || notice}</div>}
            </div>
          ) : tab === "updates" ? (
            <div className="update-view">
              <div className={`update-summary ${updateStatus?.state === "error" ? "error" : ""}`}>
                <span><Sparkles size={22} /></span>
                <div>
                  <small>当前版本</small>
                  <strong>{updateStatus?.currentVersion || "读取中"}</strong>
                  <p>{updateStateLabel}</p>
                </div>
              </div>

              <section className="codex-runtime-update">
                <div className="codex-runtime-update-copy">
                  <Terminal size={18} />
                  <span>
                    <strong>Codex Runtime</strong>
                    <small>
                      {codexRuntime?.ok
                        ? `${codexRuntime.version}${codexRuntime.bundledVersion ? ` · 内置基线 ${codexRuntime.bundledVersion}` : ""}`
                        : codexRuntime?.error || "正在读取运行时版本"}
                    </small>
                  </span>
                </div>
                <div className="codex-runtime-actions">
                  <button type="button" onClick={updateRuntime} disabled={codexRuntimeBusy}>
                    {codexRuntimeBusy ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}
                    检查并更新
                  </button>
                  {codexRuntime?.rollbackAvailable && (
                    <button type="button" onClick={rollbackRuntime} disabled={codexRuntimeBusy}>
                      恢复 {codexRuntime.rollbackVersion || "上一版本"}
                    </button>
                  )}
                </div>
                <p>更新走系统网络设置；下载或校验失败时继续使用当前版本，不影响 domi 和本地资料。</p>
              </section>

              <section className="update-channel-setting">
                <div>
                  <strong>更新通道</strong>
                  <span>稳定版适合团队日常使用；测试版用于提前验证新功能。</span>
                </div>
                <div className="update-channel-options" role="radiogroup" aria-label="更新通道">
                  <button
                    type="button"
                    className={draft.updateChannel === "stable" ? "selected" : ""}
                    onClick={() => setDraft((current) => ({ ...current, updateChannel: "stable" }))}
                  >稳定版</button>
                  <button
                    type="button"
                    className={draft.updateChannel === "beta" ? "selected" : ""}
                    onClick={() => setDraft((current) => ({ ...current, updateChannel: "beta" }))}
                  >测试版</button>
                </div>
              </section>

              {updateStatus?.state === "downloading" && (
                <div className="update-progress" aria-label={`下载进度 ${Math.round(updateStatus.percent)}%`}>
                  <i style={{ width: `${Math.max(0, Math.min(100, updateStatus.percent))}%` }} />
                </div>
              )}

              <div className="update-actions">
                {updateStatus?.state === "available" ? (
                  <button type="button" onClick={downloadAvailableUpdate} disabled={updateBusy}>
                    <Download size={16} />更新到 {updateStatus.availableVersion}
                  </button>
                ) : updateStatus?.state === "downloaded" ? (
                  <button
                    className="primary"
                    type="button"
                    onClick={installDownloadedUpdate}
                    disabled={updateBusy || Boolean(updateStatus.installing) || Boolean(updateStatus.restartPending && !updateStatus.error)}
                  >
                    <RefreshCw className={updateStatus.installing || updateStatus.restartPending ? "spinning" : ""} size={16} />
                    {updateStatus.error ? "重试安全重启" : "等待安全重启"}
                  </button>
                ) : (
                  <button type="button" onClick={checkUpdates} disabled={updateBusy || !updateStatus?.supported}>
                    {updateBusy || updateStatus?.state === "checking"
                      ? <LoaderCircle className="spinning" size={16} />
                      : <RefreshCw size={16} />}
                    检查更新
                  </button>
                )}
              </div>

              <div className="update-data-note">
                <ShieldCheck size={18} />
                <span>
                  <strong>升级不会清除本地数据</strong>
                  <small>对话历史和设置保存在 Application Support，任务材料保存在 domi 工作区；更新只替换应用程序。</small>
                </span>
              </div>
              {(error || notice || updateStatus?.error) && (
                <div className={`setup-feedback ${error || updateStatus?.error || updateStatus?.state === "error" ? "error" : "success"}`}>
                  {error || updateStatus?.error || notice}
                </div>
              )}
            </div>
          ) : (
            <div className="diagnostic-view">
              <div className="diagnostic-summary">
                <div>
                  <strong>{report ? (report.ok ? "系统已就绪" : "发现需要处理的问题") : "运行一次完整检查"}</strong>
                  <span>{report ? `${report.checks.filter((item) => item.ok).length}/${report.checks.length} 项通过 · ${report.durationMs}ms` : "诊断信息会自动脱敏，可安全导出给管理员排查。"}</span>
                </div>
                <button type="button" onClick={diagnose} disabled={diagnosing}>
                  {diagnosing ? <LoaderCircle className="spinning" size={16} /> : <RefreshCw size={16} />}
                  {report ? "重新检查" : "开始检查"}
                </button>
              </div>
              <div className="diagnostic-list">
                {report?.checks.map((check) => (
                  <div key={check.id}>
                    {check.ok ? <CheckCircle2 className="ok" size={18} /> : <CircleAlert className="bad" size={18} />}
                    <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                  </div>
                ))}
                {!report && <div className="diagnostic-placeholder"><ShieldCheck size={28} /><span>尚未运行诊断</span></div>}
              </div>
              {report && (
                <button className="export-diagnostics" type="button" onClick={exportReport}>
                  <Download size={15} />导出脱敏诊断报告
                </button>
              )}
              {error && <div className="setup-feedback error">{error}</div>}
            </div>
          )}

          <footer className="setup-footer">
            <span>{tab === "connection"
              ? "更改连接会重启本地 Codex 服务，不影响 domi 中的对话记录。"
              : tab === "data"
                ? "配置保存在 Application Support；覆盖安装和自动更新会继续沿用，无需重复配置。"
              : tab === "plaud"
                ? "PLAUD 登录只保存在本机 domi 专用浏览器 Profile；不会进入插件、Git 或诊断报告。"
              : tab === "updates"
                ? "更新包必须通过 Developer ID 签名与 Apple 公证。"
                : "诊断报告不包含登录令牌或 Base 标识。"}</span>
            {tab === "connection" && (
              <button
                className="setup-primary"
                type="button"
                onClick={() => saveConnection(required)}
                disabled={saving || connectionTestBusy || installBusy || !codexInstalled}
              >
                {(saving || connectionTestBusy) && <LoaderCircle className="spinning" size={16} />}
                {connectionTestBusy
                  ? "正在测试并进入…"
                  : required
                    ? "下一步：资料连接"
                    : "保存设置"}
              </button>
            )}
            {tab === "data" && (
              <button
                className="setup-primary"
                type="button"
                onClick={required ? saveDataAndContinue : () => save(false)}
                disabled={saving || feishuAuthBusy}
              >
                {(saving || feishuAuthBusy) && <LoaderCircle className="spinning" size={16} />}
                {feishuAuthBusy
                  ? "正在连接飞书…"
                  : required
                    ? "下一步：录音转写"
                    : "保存资料连接"}
              </button>
            )}
            {tab === "plaud" && (
              <button
                className="setup-primary"
                type="button"
                onClick={() => save(required)}
                disabled={saving
                  || draft.plaudConnectionMode === "unconfigured"
                  || (draft.plaudConnectionMode === "enabled" && !plaudCheck?.ok)}
              >
                {saving && <LoaderCircle className="spinning" size={16} />}
                {required ? "保存并进入 domi" : "保存 PLAUD 设置"}
              </button>
            )}
            {tab === "updates" && (
              <button className="setup-primary" type="button" onClick={saveUpdateSettings} disabled={saving || updateBusy}>
                {saving && <LoaderCircle className="spinning" size={16} />}
                保存并检查
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
