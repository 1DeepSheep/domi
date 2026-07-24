import {
  BadgeCheck,
  CheckCircle2,
  CircleAlert,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  LogIn,
  Mic,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { workbench } from "./bridge";
import {
  AppSettings,
  AppSettingsSaveRequest,
  AppSettingsSaveResult,
  ChatGPTLoginResult,
  CodexCheckResult,
  DiagnosticCheck,
  DiagnosticReport,
  StorageMigrationPreview,
  UpdateStatus
} from "./env";

type SetupCenterProps = {
  initialTab?: "connection" | "data" | "plaud" | "updates" | "diagnostics";
  settings: AppSettings;
  codexStatus: CodexCheckResult | null;
  required: boolean;
  onClose: () => void;
  onSave: (request: AppSettingsSaveRequest) => Promise<AppSettingsSaveResult>;
  onLogin: () => Promise<ChatGPTLoginResult>;
  onRefresh: () => Promise<void>;
};

export default function SetupCenter({
  initialTab = "connection",
  settings,
  codexStatus,
  required,
  onClose,
  onSave,
  onLogin,
  onRefresh
}: SetupCenterProps) {
  const [tab, setTab] = useState<"connection" | "data" | "plaud" | "updates" | "diagnostics">(initialTab);
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [plaudCheck, setPlaudCheck] = useState<DiagnosticCheck | null>(null);
  const [plaudChecking, setPlaudChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [migrateLocalDocuments, setMigrateLocalDocuments] = useState(true);
  const [migrationPreview, setMigrationPreview] = useState<StorageMigrationPreview | null>(null);
  const [migrationPreviewBusy, setMigrationPreviewBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const switchingLocalToFeishu = settings.storageBackend === "local"
    && draft.storageBackend === "feishu";

  useEffect(() => setDraft({
    ...settings,
    authMode: "chatgpt",
    apiBaseUrl: "",
    apiModel: ""
  }), [settings]);
  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    if (!switchingLocalToFeishu) {
      setMigrationPreview(null);
      setMigrationPreviewBusy(false);
      return;
    }
    let cancelled = false;
    setMigrationPreviewBusy(true);
    workbench.previewStorageMigration().then((preview) => {
      if (!cancelled) setMigrationPreview(preview);
    }).finally(() => {
      if (!cancelled) setMigrationPreviewBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [switchingLocalToFeishu]);

  useEffect(() => {
    let cancelled = false;
    workbench.getUpdateStatus().then((status) => {
      if (!cancelled) setUpdateStatus(status);
    });
    const unsubscribe = workbench.onUpdateStatus((status) => setUpdateStatus(status));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function save(complete: boolean) {
    setSaving(true);
    setError("");
    setNotice("");
    const result = await onSave({
      ...draft,
      authMode: "chatgpt",
      apiBaseUrl: "",
      apiModel: "",
      storageMigration: switchingLocalToFeishu && migrateLocalDocuments
        ? "local-to-feishu"
        : "none",
      onboardingComplete: complete || settings.onboardingComplete
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "保存设置失败。");
      return false;
    }
    setNotice(result.migration?.ok
      ? `已迁移 ${result.migration.migratedProjectCount} 个项目、${result.migration.documentCount} 篇文档和 ${result.migration.assetCount} 张图片，并切换到飞书资料库。`
      : result.codex?.ok
        ? "连接已保存并验证。"
        : "设置已保存，请根据状态提示完成连接。");
    if (complete) onClose();
    return true;
  }

  async function saveConnectionAndContinue() {
    if (await save(false)) setTab("data");
  }

  async function saveDataAndContinue() {
    if (await save(false)) setTab("plaud");
  }

  async function checkPlaudConnection() {
    setPlaudChecking(true);
    setError("");
    setNotice("");
    try {
      const saved = await onSave({ plaudConnectionMode: "enabled" });
      if (!saved.ok) {
        setError(saved.error || "无法保存 PLAUD 设置。");
        return;
      }
      const diagnosticReport = await workbench.runDiagnostics();
      const check = diagnosticReport.checks.find((item) => item.id === "plaud") || null;
      setPlaudCheck(check);
      if (!check?.ok) {
        setError(check?.detail || "尚未检测到 PLAUD 登录，请先在 Tabbit 中登录 PLAUD。");
      } else {
        setNotice("已检测到本机 PLAUD 登录，豆米可以读取录音队列。");
      }
    } catch (diagnosticError) {
      setError(diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError));
    } finally {
      setPlaudChecking(false);
    }
  }

  async function openTabbit() {
    setError("");
    const result = await workbench.openResource("/Applications/Tabbit.app");
    if (!result.ok) {
      setError("未找到 Tabbit。请先安装 Tabbit，在其中登录 PLAUD 后回到这里检测。");
    }
  }

  async function startLogin() {
    setLoginBusy(true);
    setError("");
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
    setNotice("登录页面已在浏览器打开。完成登录后回到豆米重新检测。");
  }

  async function chooseLocalLibraryDirectory() {
    setError("");
    const targetField = draft.storageBackend === "local" ? "localRepositoryDir" : "localLibraryDir";
    const result = await workbench.selectDirectory(draft[targetField]);
    if (!result.ok) {
      setError(result.error || "无法选择本地资料库目录。");
      return;
    }
    if (result.canceled || !result.path) return;
    setDraft((current) => ({ ...current, [targetField]: result.path }));
    setNotice("已选择本地资料库目录，保存后生效。");
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
    const result = await onSave({ updateChannel: draft.updateChannel });
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "保存更新设置失败。");
      return;
    }
    setNotice(draft.updateChannel === "beta" ? "已切换到测试版通道。" : "已切换到稳定版通道。");
    await checkUpdates();
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
    const result = await workbench.installUpdate();
    if (!result.ok) {
      setError(result.error || "暂时无法安装更新。");
      setUpdateBusy(false);
    }
  }

  const updateStateLabel = updateStatus
    ? {
        disabled: "开发版不执行安装更新",
        idle: "等待检查",
        checking: "正在检查更新",
        available: `发现 ${updateStatus.availableVersion || "新版本"}`,
        "up-to-date": "当前已是最新版本",
        downloading: `正在下载 ${Math.round(updateStatus.percent)}%`,
        downloaded: `${updateStatus.availableVersion || "新版本"} 已准备好`,
        error: "更新检查失败"
      }[updateStatus.state]
    : "正在读取版本信息";

  return (
    <div className="setup-overlay" role="dialog" aria-modal="true" aria-label="豆米设置">
      <div className="setup-window">
        <aside className="setup-nav">
          <div className="setup-brand">
            <img src="./domi-icon.png" alt="" />
            <div><strong>豆米</strong><span>{required ? "首次启动配置" : "设置"}</span></div>
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
            <span>登录状态由本机 Codex 安全管理，豆米不单独保存账号凭据。</span>
          </div>
        </aside>

        <section className={`setup-content ${tab === "connection" ? "connection-tab" : ""}`}>
          <header className="setup-header">
            <div>
              <span>{required ? "开始使用豆米" : "偏好设置"}</span>
              <h2>{tab === "connection"
                ? "Codex 账号"
                : tab === "data"
                  ? "配置 Domi 资料库"
                  : tab === "plaud"
                    ? "连接 PLAUD"
                  : tab === "updates"
                    ? "软件更新"
                    : "系统诊断"}</h2>
              <p>{tab === "connection"
                ? "使用本机已登录的 ChatGPT / Codex 账号，通过 Codex app-server 执行完整任务。"
                : tab === "data"
                  ? "选择飞书协作资料库或完全本地的 SQLite + Markdown 资料库；配置仅保存在这台 Mac。"
                : tab === "plaud"
                  ? "PLAUD 仅用于把录音转成文字稿。现在不用可以直接跳过，豆米不会连接或读取录音。"
                : tab === "updates"
                  ? "检查签名版本并更新程序本体；历史、工作区和本机配置会继续保留。"
                  : "检查 Codex、Keychain、本地数据库、工作区和 Domi 插件。"}</p>
            </div>
            {!required && (
              <button className="setup-close" type="button" onClick={onClose} title="关闭设置"><X size={18} /></button>
            )}
          </header>

          {tab === "connection" ? (
            <div className="setup-form connection-form">
              <div className={`connection-panel ${codexStatus?.ok ? "ok" : "warning"}`}>
                <div className="connection-status">
                  <i className="connection-status-icon">
                    {codexStatus?.ok ? <BadgeCheck size={20} /> : <CircleAlert size={20} />}
                  </i>
                  <div>
                    <small>ChatGPT / Codex</small>
                    <strong>{codexStatus?.ok ? "ChatGPT 身份已就绪" : "尚未检测到可用身份"}</strong>
                    <span>{codexStatus?.ok
                      ? [codexStatus.account?.email, codexStatus.account?.planType, codexStatus.version].filter(Boolean).join(" · ")
                      : codexStatus?.error || "请登录 Codex 后重新检测"}</span>
                  </div>
                  <b className="connection-status-badge">
                    {codexStatus?.ok ? "已连接" : "待登录"}
                  </b>
                </div>
                <div className="setup-inline-actions">
                  <button type="button" onClick={startLogin} disabled={loginBusy}>
                    {loginBusy ? <LoaderCircle className="spinning" size={16} /> : <LogIn size={16} />}
                    {codexStatus?.ok ? "切换 ChatGPT 账号" : "登录 ChatGPT"}
                    <ExternalLink size={13} />
                  </button>
                  <button type="button" onClick={onRefresh}><RefreshCw size={15} />检测连接</button>
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
              <div className="storage-backend-options" role="radiogroup" aria-label="资料库模式">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.storageBackend === "feishu"}
                  className={draft.storageBackend === "feishu" ? "selected" : ""}
                  onClick={() => setDraft((current) => ({ ...current, storageBackend: "feishu" }))}
                >
                  <Cloud size={19} />
                  <span>
                    <strong>飞书资料库</strong>
                    <small>Base 管理项目、人脉与行业动态，Wiki 保存项目文档，本地目录归档材料。</small>
                  </span>
                  <i>{draft.storageBackend === "feishu" ? <CheckCircle2 size={17} /> : null}</i>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.storageBackend === "local"}
                  className={draft.storageBackend === "local" ? "selected" : ""}
                  onClick={() => setDraft((current) => ({ ...current, storageBackend: "local" }))}
                >
                  <HardDrive size={19} />
                  <span>
                    <strong>本地资料库</strong>
                    <small>SQLite 管理结构化数据，Markdown 保存文档，附件全部留在所选文件夹。</small>
                  </span>
                  <i>{draft.storageBackend === "local" ? <CheckCircle2 size={17} /> : null}</i>
                </button>
              </div>
              <div className="data-privacy-note">
                <ShieldCheck size={19} />
                <span>
                  <strong>{draft.storageBackend === "local" ? "数据完全保存在本机" : "插件与个人数据分离"}</strong>
                  <small>{draft.storageBackend === "local"
                    ? "不需要飞书授权。豆米只在所选目录和本机 Application Support 数据库中读写。"
                    : "飞书标识写入本机 Application Support，权限限制为当前用户；不会进入 Domi 插件、Git、DMG 或诊断报告。"}</small>
                </span>
              </div>
              {draft.storageBackend === "feishu" ? (
                <>
                  {switchingLocalToFeishu && (
                    <div className="storage-migration-card">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={migrateLocalDocuments}
                        className={migrateLocalDocuments ? "enabled" : ""}
                        onClick={() => setMigrateLocalDocuments((current) => !current)}
                      >
                        <span className="storage-migration-icon"><Cloud size={19} /></span>
                        <span>
                          <strong>先迁移本地项目文档，再切换到飞书</strong>
                          <small>{migrationPreviewBusy
                            ? "正在统计本地资料库…"
                            : migrationPreview?.ok
                              ? `将处理 ${migrationPreview.projectCount || 0} 个项目、${migrationPreview.documentCount || 0} 篇 Markdown 文档。`
                              : migrationPreview?.error || "保存时会先检查本地资料库。"}</small>
                        </span>
                        <i aria-hidden="true"><b /></i>
                      </button>
                      <p>
                        按领域和子领域写入对应 Wiki 目录，图片随文档上传，并回填 Watching List 链接。
                        原始 PDF、录音和其他附件继续保留在本地；迁移失败不会切换后端，也不会删除本地文件。
                      </p>
                    </div>
                  )}
                  <div className="data-connection-grid">
                    <section>
                      <h3>项目库</h3>
                      <label>
                        <span>Base Token</span>
                        <input value={draft.projectBaseToken} onChange={(event) => setDraft((current) => ({ ...current, projectBaseToken: event.target.value }))} placeholder="项目 Watching List 的 Base Token" spellCheck={false} />
                      </label>
                      <label>
                        <span>Table ID</span>
                        <input value={draft.projectTableId} onChange={(event) => setDraft((current) => ({ ...current, projectTableId: event.target.value }))} placeholder="项目表 Table ID" spellCheck={false} />
                      </label>
                    </section>
                    <section>
                      <h3>人脉库</h3>
                      <label>
                        <span>Base Token</span>
                        <input value={draft.peopleBaseToken} onChange={(event) => setDraft((current) => ({ ...current, peopleBaseToken: event.target.value }))} placeholder="People Base Token" spellCheck={false} />
                      </label>
                      <label>
                        <span>Table ID</span>
                        <input value={draft.peopleTableId} onChange={(event) => setDraft((current) => ({ ...current, peopleTableId: event.target.value }))} placeholder="人脉表 Table ID" spellCheck={false} />
                      </label>
                    </section>
                    <section>
                      <h3>行业动态</h3>
                      <label>
                        <span>Base Token</span>
                        <input value={draft.radarBaseToken} onChange={(event) => setDraft((current) => ({ ...current, radarBaseToken: event.target.value }))} placeholder="行业信息追踪 Base Token" spellCheck={false} />
                      </label>
                      <label>
                        <span>Table ID</span>
                        <input value={draft.radarTableId} onChange={(event) => setDraft((current) => ({ ...current, radarTableId: event.target.value }))} placeholder="新闻表 Table ID" spellCheck={false} />
                      </label>
                    </section>
                    <section>
                      <h3>文档与材料</h3>
                      <label>
                        <span>Wiki Space ID</span>
                        <input value={draft.wikiSpaceId} onChange={(event) => setDraft((current) => ({ ...current, wikiSpaceId: event.target.value }))} placeholder="团队 Wiki Space ID" spellCheck={false} />
                      </label>
                      <label className="local-library-setting">
                        <span>本地材料目录</span>
                        <div className="directory-picker">
                          <input value={draft.localLibraryDir} onChange={(event) => setDraft((current) => ({ ...current, localLibraryDir: event.target.value }))} placeholder="请选择本地材料目录" spellCheck={false} />
                          <button type="button" onClick={chooseLocalLibraryDirectory} title="选择本地材料目录" aria-label="选择本地材料目录"><FolderOpen size={16} /></button>
                        </div>
                      </label>
                    </section>
                  </div>
                </>
              ) : (
                <div className="local-storage-panel">
                  <div className="local-storage-summary">
                    <Database size={20} />
                    <span>
                      <strong>一套资料库，三种内容自动对应</strong>
                      <small>项目、人脉和行业事件写入 SQLite；项目主页与纪要写成 Markdown；BP、录音和附件保留原文件。</small>
                    </span>
                  </div>
                  <label className="local-library-setting">
                    <span>Markdown 与附件目录</span>
                    <div className="directory-picker">
                      <input
                        value={draft.localRepositoryDir}
                        onChange={(event) => setDraft((current) => ({ ...current, localRepositoryDir: event.target.value }))}
                        placeholder="请选择本地资料库目录"
                        spellCheck={false}
                      />
                      <button type="button" onClick={chooseLocalLibraryDirectory} title="选择本地资料库目录" aria-label="选择本地资料库目录">
                        <FolderOpen size={16} />
                      </button>
                    </div>
                    <small>豆米会建立行业研究、行业动态、项目库和人脉库目录；已有文件不会被删除。</small>
                  </label>
                  <div className="local-database-location">
                    <span>SQLite 数据库</span>
                    <code>{draft.localDatabasePath || "保存设置后自动创建"}</code>
                    <small>数据库保存在 Application Support，不放入同步盘，Markdown 和附件仍可选择 iCloud、OneDrive 或普通文件夹。</small>
                  </div>
                </div>
              )}
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
                  <div className="plaud-setup-copy">
                    <span className="plaud-setup-icon">
                      {plaudCheck?.ok ? <BadgeCheck size={21} /> : <Mic size={21} />}
                    </span>
                    <div>
                      <strong>{plaudCheck?.ok ? "PLAUD 已连接" : "在 Tabbit 中登录 PLAUD"}</strong>
                      <small>{plaudCheck?.detail
                        || "豆米复用本机 Tabbit 的已登录会话，不保存 Cookie、授权头或账号密码。"}</small>
                    </div>
                  </div>
                  <ol>
                    <li>打开 Tabbit，并完成 PLAUD 登录。</li>
                    <li>回到豆米，点击“检测 PLAUD”。</li>
                    <li>检测成功后即可读取录音；安装向导也允许稍后再登录。</li>
                  </ol>
                  <div className="setup-inline-actions">
                    <button type="button" onClick={openTabbit}><ExternalLink size={15} />打开 Tabbit</button>
                    <button type="button" onClick={checkPlaudConnection} disabled={plaudChecking}>
                      {plaudChecking ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}
                      检测 PLAUD
                    </button>
                  </div>
                </div>
              ) : draft.plaudConnectionMode === "disabled" ? (
                <div className="plaud-skip-note">
                  <ShieldCheck size={19} />
                  <span>
                    <strong>PLAUD 保持关闭</strong>
                    <small>本地资料库、飞书资料库、行业动态和其他 Domi 能力仍可正常使用。</small>
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
                    <Download size={16} />下载 {updateStatus.availableVersion}
                  </button>
                ) : updateStatus?.state === "downloaded" ? (
                  <button className="primary" type="button" onClick={installDownloadedUpdate} disabled={updateBusy}>
                    <RefreshCw size={16} />重启并安装
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
                  <small>对话历史和设置保存在 Application Support，任务材料保存在豆米工作区；更新只替换应用程序。</small>
                </span>
              </div>
              {(error || notice || updateStatus?.error) && (
                <div className={`setup-feedback ${error || updateStatus?.state === "error" ? "error" : "success"}`}>
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
              ? "更改连接会重启本地 Codex 服务，不影响豆米中的对话记录。"
              : tab === "data"
                ? "配置保存在 Application Support；覆盖安装和自动更新会继续沿用，无需重复配置。"
              : tab === "plaud"
                ? "PLAUD 登录保留在 Tabbit；豆米只保存是否启用这项能力。"
              : tab === "updates"
                ? "更新包必须通过 Developer ID 签名与 Apple 公证。"
                : "诊断报告不包含登录令牌或 Base 标识。"}</span>
            {tab === "connection" && (
              <button className="setup-primary" type="button" onClick={required ? saveConnectionAndContinue : () => save(false)} disabled={saving}>
                {saving && <LoaderCircle className="spinning" size={16} />}
                {required ? "下一步：资料连接" : "保存设置"}
              </button>
            )}
            {tab === "data" && (
              <button className="setup-primary" type="button" onClick={required ? saveDataAndContinue : () => save(false)} disabled={saving}>
                {saving && <LoaderCircle className="spinning" size={16} />}
                {saving && switchingLocalToFeishu && migrateLocalDocuments
                  ? "正在迁移并切换…"
                  : required
                    ? "下一步：录音转写"
                    : switchingLocalToFeishu && migrateLocalDocuments
                      ? "迁移并切换到飞书"
                      : "保存资料连接"}
              </button>
            )}
            {tab === "plaud" && (
              <button
                className="setup-primary"
                type="button"
                onClick={() => save(required)}
                disabled={saving || draft.plaudConnectionMode === "unconfigured"}
              >
                {saving && <LoaderCircle className="spinning" size={16} />}
                {required ? "保存并进入豆米" : "保存 PLAUD 设置"}
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
