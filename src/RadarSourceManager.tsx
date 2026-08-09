import {
  AlertCircle,
  Check,
  MessageSquareText,
  Mic2,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Upload,
  Trash2,
  X
} from "lucide-react";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { workbench } from "./bridge";
import { useAppConfirm } from "./AppConfirmDialog";
import type {
  PodcastJob,
  PodcastProcessResult,
  RadarSource,
  RadarSourceBulkImportResult,
  RadarSourceKind,
  RadarSourceSaveRequest,
  RadarSourceSnapshot
} from "./env";

type RadarSourceManagerProps = {
  open: boolean;
  onClose: () => void;
  onSnapshot?: (snapshot: RadarSourceSnapshot) => void;
  onPodcastTranscript?: (
    job: PodcastJob,
    result: PodcastProcessResult
  ) => Promise<void> | void;
};

type SourceDraft = {
  id?: string;
  kind: RadarSourceKind;
  name: string;
  url: string;
  priority: "normal" | "important";
  keywords: string;
  enabled: boolean;
  autoProcess: boolean;
};

const EMPTY_DRAFT: SourceDraft = {
  kind: "news",
  name: "",
  url: "",
  priority: "normal",
  keywords: "",
  enabled: true,
  autoProcess: false
};

const TABS: Array<{ kind: RadarSourceKind; label: string; icon: typeof Newspaper }> = [
  { kind: "news", label: "新闻源", icon: Newspaper },
  { kind: "wechat", label: "重点公众号", icon: MessageSquareText },
  { kind: "podcast", label: "播客", icon: Mic2 }
];

function sourceDraft(source: RadarSource): SourceDraft {
  return {
    id: source.id,
    kind: source.kind,
    name: source.name,
    url: source.url,
    priority: source.priority,
    keywords: source.keywords.join("，"),
    enabled: source.enabled,
    autoProcess: source.autoProcess
  };
}

function splitKeywords(value: string) {
  return [...new Set(value.split(/[,，;；\n]/).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

function podcastStatus(job: PodcastJob) {
  if (job.status === "transcript_ready") return "PLAUD 文字稿已就绪";
  if (job.status === "transcribing") return "PLAUD 正在生成";
  if (job.status === "downloading") return "正在下载公开音频";
  if (job.status === "downloaded") return "已下载，等待 PLAUD";
  if (job.status === "failed") return "处理失败";
  if (job.status === "skipped") return "已跳过";
  return "等待处理";
}

export default function RadarSourceManager({
  open,
  onClose,
  onSnapshot,
  onPodcastTranscript
}: RadarSourceManagerProps) {
  const { confirm, confirmDialog } = useAppConfirm();
  const [tab, setTab] = useState<RadarSourceKind>("news");
  const [snapshot, setSnapshot] = useState<RadarSourceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [bulkImportFileName, setBulkImportFileName] = useState("");
  const [bulkImportKeywords, setBulkImportKeywords] = useState("");
  const [bulkImportImportant, setBulkImportImportant] = useState(true);
  const [bulkImportPreview, setBulkImportPreview] = useState<RadarSourceBulkImportResult | null>(null);
  const [bulkImportBusy, setBulkImportBusy] = useState(false);
  const bulkImportFileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const sources = useMemo(
    () => (snapshot?.sources || []).filter((source) => source.kind === tab),
    [snapshot, tab]
  );
  const podcastSourceIds = useMemo(
    () => new Set(sources.map((source) => source.id)),
    [sources]
  );
  const jobs = useMemo(
    () => (snapshot?.jobs || [])
      .filter((job) => tab === "podcast" && podcastSourceIds.has(job.sourceId))
      .sort((left, right) => (right.publishedAt || right.discoveredAt) - (left.publishedAt || left.discoveredAt)),
    [snapshot, tab, podcastSourceIds]
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await workbench.listRadarSources();
      if (!result.ok) {
        setError(result.error || "暂时无法读取本机信源配置。");
        return;
      }
      setSnapshot(result);
      onSnapshot?.(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.name.trim()) {
      setError(draft.kind === "wechat" ? "请输入公众号名称。" : "请输入信源名称。");
      return;
    }
    if (draft.kind !== "wechat" && !draft.url.trim()) {
      setError(draft.kind === "podcast" ? "请粘贴播客 RSS、节目页或公开单集链接。" : "请粘贴新闻源网址。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const request: RadarSourceSaveRequest = {
        id: draft.id,
        kind: draft.kind,
        name: draft.name.trim(),
        url: draft.url.trim(),
        enabled: draft.enabled,
        priority: draft.priority,
        keywords: splitKeywords(draft.keywords),
        autoProcess: draft.kind === "podcast" && draft.autoProcess
      };
      const result = await workbench.saveRadarSource(request);
      if (!result.ok) {
        setError(result.error || "保存失败，请检查链接后重试。");
        return;
      }
      setDraft(null);
      setNotice(draft.id ? "信源已更新。" : "信源已添加，只保存在这台 Mac。 ");
      await load();
    } finally {
      setSaving(false);
    }
  }

  function resetBulkImport() {
    setBulkImportOpen(false);
    setBulkImportText("");
    setBulkImportFileName("");
    setBulkImportKeywords("");
    setBulkImportImportant(true);
    setBulkImportPreview(null);
    if (bulkImportFileRef.current) bulkImportFileRef.current.value = "";
  }

  function openBulkImport() {
    setDraft(null);
    setError("");
    setNotice("");
    setBulkImportOpen(true);
    setBulkImportPreview(null);
  }

  async function chooseBulkImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError("List 文件超过 4 MB，请拆分后再导入。");
      event.target.value = "";
      return;
    }
    try {
      const text = await file.text();
      setBulkImportText(text);
      setBulkImportFileName(file.name);
      setBulkImportPreview(null);
      setError("");
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "无法读取这个 List 文件。");
    }
  }

  async function runBulkImport(previewOnly: boolean) {
    if (!bulkImportText.trim()) {
      setError("请粘贴公众号名单，或选择一个 TXT、LIST、CSV、TSV 文件。");
      return;
    }
    setBulkImportBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await workbench.bulkImportRadarSources({
        kind: "wechat",
        text: bulkImportText,
        fileName: bulkImportFileName || undefined,
        previewOnly,
        enabled: true,
        priority: bulkImportImportant ? "important" : "normal",
        keywords: splitKeywords(bulkImportKeywords)
      });
      if (!result.ok) {
        setError(result.error || "批量导入失败，请检查名单格式后重试。");
        return;
      }
      setBulkImportPreview(result);
      if (previewOnly) return;
      const imported = result.stats.importedCount;
      setNotice(imported
        ? `已导入 ${imported} 个公众号；重复和已有账号已自动跳过。`
        : "没有需要新增的公众号；重复和已有账号已自动跳过。");
      resetBulkImport();
      await load();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : String(bulkError));
    } finally {
      setBulkImportBusy(false);
    }
  }

  async function remove(source: RadarSource) {
    const approved = await confirm({
      title: "删除这个信源？",
      message: `“${source.name}”将不再参与后续扫描。`,
      detail: "已生成的本地文档、纪要和行业资料不会被删除。",
      confirmLabel: "删除信源",
      tone: "danger"
    });
    if (!approved) return;
    setError("");
    const result = await workbench.deleteRadarSource({ sourceId: source.id });
    if (!result.ok) {
      setError(result.error || "删除失败。");
      return;
    }
    setNotice("信源已删除，既有纪要和行业资料仍保留。 ");
    await load();
  }

  async function toggleSource(source: RadarSource) {
    const result = await workbench.saveRadarSource({
      id: source.id,
      kind: source.kind,
      name: source.name,
      url: source.url,
      enabled: !source.enabled,
      priority: source.priority,
      keywords: source.keywords,
      autoProcess: source.autoProcess
    });
    if (!result.ok) {
      setError(result.error || "更新失败。");
      return;
    }
    await load();
  }

  async function processJob(job: PodcastJob) {
    if (processingIds.has(job.id)) return;
    setProcessingIds((current) => new Set(current).add(job.id));
    setError("");
    setNotice(`正在下载“${job.title}”并交给 PLAUD，窗口可以继续使用。`);
    try {
      const result = await workbench.processPodcastEpisode({ jobId: job.id });
      if (!result.ok) {
        setError(result.error || "播客处理失败。");
        return;
      }
      setNotice("PLAUD 文字稿已生成，domi 正在整理并归档。 ");
      if (result.job) await onPodcastTranscript?.(result.job, result);
      setNotice("播客纪要已整理并按项目或行业归档。 ");
      await load();
    } finally {
      setProcessingIds((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
    }
  }

  async function sync() {
    setSyncing(true);
    setError("");
    setNotice("正在检查已启用信源的新内容…");
    try {
      const result = await workbench.syncRadarSources({ limit: 12 });
      if (!result.ok && !result.partial) {
        setError(result.error || "信源同步失败。");
        return;
      }
      const nextSnapshot: RadarSourceSnapshot = {
        ok: true,
        sources: result.sources,
        jobs: result.jobs,
        updatedAt: result.updatedAt,
        error: result.error
      };
      setSnapshot(nextSnapshot);
      onSnapshot?.(nextSnapshot);
      const discovered = result.results.reduce((sum, item) => sum + item.discoveredCount, 0);
      setNotice(discovered ? `发现 ${discovered} 期新内容。` : "已检查，没有发现新内容。 ");

      const autoSources = new Map(
        result.sources
          .filter((source) => source.kind === "podcast" && source.enabled && source.autoProcess)
          .map((source) => [source.id, source] as const)
      );
      const candidates = result.jobs.filter((job) => {
        const source = autoSources.get(job.sourceId);
        if (!source || job.status !== "discovered") return false;
        if (!source.keywords.length) return true;
        const haystack = `${job.title} ${job.description}`.toLocaleLowerCase("zh-CN");
        return source.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase("zh-CN")));
      }).sort(
        (left, right) => (right.publishedAt || right.discoveredAt) - (left.publishedAt || left.discoveredAt)
      ).slice(0, 1);
      for (const job of candidates) await processJob(job);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setSyncing(false);
    }
  }

  if (!open) return null;

  return (
    <div className="radar-source-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section id="radar-source-panel" className="radar-source-panel" role="dialog" aria-modal="true" aria-labelledby="radar-source-title">
        <header>
          <div>
            <span>行业动态</span>
            <h2 id="radar-source-title">信源管理</h2>
            <p>配置仅保存在本机；公开播客音频交给你的 PLAUD 转写。</p>
          </div>
          <button type="button" aria-label="关闭信源管理" onClick={onClose}><X size={19} /></button>
        </header>

        <div className="radar-source-tabs" role="tablist">
          {TABS.map((item) => {
            const Icon = item.icon;
            const count = snapshot?.sources.filter((source) => source.kind === item.kind).length || 0;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={tab === item.kind}
                className={tab === item.kind ? "active" : ""}
                onClick={() => { setTab(item.kind); setDraft(null); resetBulkImport(); setError(""); }}
                key={item.kind}
              >
                <Icon size={16} />{item.label}<small>{count}</small>
              </button>
            );
          })}
        </div>

        <div className="radar-source-toolbar">
          <p>{tab === "news"
            ? "扫描时优先核验这些网站。"
            : tab === "wechat"
              ? "记录重点公众号名称与关注关键词；不绕过微信访问限制。"
              : "支持公开 RSS、小宇宙公开节目页或单集页；拒绝付费、私密和 DRM 内容。"}</p>
          <span>
            <button type="button" onClick={() => { resetBulkImport(); setDraft({ ...EMPTY_DRAFT, kind: tab }); }}>
              <Plus size={15} />添加
            </button>
            {tab === "wechat" && (
              <button type="button" onClick={openBulkImport} aria-expanded={bulkImportOpen}>
                <Upload size={15} />批量上传
              </button>
            )}
            <button type="button" onClick={() => void sync()} disabled={syncing || loading}>
              <RefreshCw className={syncing ? "spinning" : ""} size={15} />同步信源
            </button>
          </span>
        </div>

        {error && <div className="radar-source-error"><AlertCircle size={15} />{error}</div>}
        {notice && <div className="radar-source-notice"><Check size={15} />{notice}</div>}

        {tab === "wechat" && bulkImportOpen && (
          <section className="radar-source-bulk" aria-label="批量上传重点公众号">
            <div className="radar-source-form-title">
              <div>
                <strong>批量上传重点公众号</strong>
                <small>一行一个名称；也支持带表头的 CSV / TSV。</small>
              </div>
              <button type="button" aria-label="关闭批量上传" onClick={resetBulkImport}><X size={15} /></button>
            </div>
            <textarea
              value={bulkImportText}
              onChange={(event) => {
                setBulkImportText(event.target.value);
                setBulkImportFileName("");
                setBulkImportPreview(null);
              }}
              placeholder={'粘贴公众号名单，例如：\n晚点LatePost\n机器之心\n甲子光年'}
              spellCheck={false}
            />
            <div className="radar-source-bulk-file">
              <input
                ref={bulkImportFileRef}
                type="file"
                accept=".txt,.list,.csv,.tsv,text/plain,text/csv,text/tab-separated-values"
                onChange={(event) => void chooseBulkImportFile(event)}
              />
              <button type="button" onClick={() => bulkImportFileRef.current?.click()}>
                <Upload size={14} />选择 List 文件
              </button>
              <span>{bulkImportFileName || "TXT / LIST / CSV / TSV，最大 4 MB"}</span>
            </div>
            <div className="radar-source-bulk-options">
              <label>
                <span>统一关注关键词（可选）</span>
                <input
                  value={bulkImportKeywords}
                  placeholder="AI、半导体，用逗号分隔"
                  onChange={(event) => { setBulkImportKeywords(event.target.value); setBulkImportPreview(null); }}
                />
              </label>
              <label className="radar-source-bulk-check">
                <input
                  type="checkbox"
                  checked={bulkImportImportant}
                  onChange={(event) => { setBulkImportImportant(event.target.checked); setBulkImportPreview(null); }}
                />
                标记为重点关注
              </label>
            </div>
            {bulkImportPreview && (
              <div className="radar-source-bulk-preview">
                <div className="radar-source-bulk-stats">
                  <span>可导入 <strong>{bulkImportPreview.stats.importableCount}</strong></span>
                  <span>已有 {bulkImportPreview.stats.existingCount}</span>
                  <span>本批重复 {bulkImportPreview.stats.duplicateCount}</span>
                  <span className={bulkImportPreview.stats.invalidCount ? "error" : ""}>无效 {bulkImportPreview.stats.invalidCount}</span>
                </div>
                <div className="radar-source-bulk-list">
                  {bulkImportPreview.items.slice(0, 50).map((item) => (
                    <div key={`${item.row}-${item.name}-${item.status}`}>
                      <span>{item.row}</span>
                      <strong>{item.name || "未命名"}</strong>
                      <small className={item.status === "invalid" ? "error" : item.status}>
                        {item.status === "new" ? "将导入"
                          : item.status === "existing" ? "已有"
                            : item.status === "duplicate" ? "本批重复"
                              : item.error || "无效"}
                      </small>
                    </div>
                  ))}
                  {(bulkImportPreview.previewTruncated || bulkImportPreview.items.length > 50) && (
                    <p>这里只预览前 50 行，导入时会处理全部有效记录。</p>
                  )}
                </div>
              </div>
            )}
            <div className="radar-source-bulk-actions">
              <small>名单与设置只保存在本机，软件更新不会清除。</small>
              <span>
                <button type="button" onClick={() => void runBulkImport(true)} disabled={bulkImportBusy}>
                  {bulkImportBusy ? "处理中" : "预览并去重"}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void runBulkImport(false)}
                  disabled={bulkImportBusy || !bulkImportPreview || bulkImportPreview.stats.importableCount === 0}
                >
                  导入 {bulkImportPreview?.stats.importableCount || 0} 个
                </button>
              </span>
            </div>
          </section>
        )}

        {draft && (
          <form className="radar-source-form" onSubmit={save}>
            <div className="radar-source-form-title">
              <strong>{draft.id ? "编辑" : "添加"}{TABS.find((item) => item.kind === draft.kind)?.label}</strong>
              <button type="button" aria-label="取消编辑" onClick={() => setDraft(null)}><X size={15} /></button>
            </div>
            <label>
              <span>{draft.kind === "wechat" ? "公众号名称" : "名称"}</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>
              <span>{draft.kind === "wechat" ? "主页或文章链接（可选）" : draft.kind === "podcast" ? "RSS、节目页或公开单集链接" : "网址"}</span>
              <input value={draft.url} placeholder="https://" onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
            </label>
            <label>
              <span>关注关键词</span>
              <input value={draft.keywords} placeholder="公司、技术或人物，用逗号分隔" onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} />
            </label>
            <div className="radar-source-form-options">
              <label><input type="checkbox" checked={draft.priority === "important"} onChange={(event) => setDraft({ ...draft, priority: event.target.checked ? "important" : "normal" })} />重点关注</label>
              {draft.kind === "podcast" && <label><input type="checkbox" checked={draft.autoProcess} onChange={(event) => setDraft({ ...draft, autoProcess: event.target.checked })} />发现新单集后自动交给 PLAUD</label>}
            </div>
            <button className="radar-source-save" type="submit" disabled={saving}>{saving ? "保存中" : "保存信源"}</button>
          </form>
        )}

        <div className="radar-source-content">
          {loading && !snapshot ? <div className="radar-source-empty">正在读取本机信源…</div> : null}
          {!loading && !sources.length ? <div className="radar-source-empty">还没有{TABS.find((item) => item.kind === tab)?.label}，点击“添加”开始。</div> : null}
          {sources.map((source) => (
            <article className={`radar-source-row ${source.enabled ? "" : "disabled"}`} key={source.id}>
              <button
                type="button"
                className={`radar-source-toggle ${source.enabled ? "on" : ""}`}
                aria-label={source.enabled ? `停用 ${source.name}` : `启用 ${source.name}`}
                aria-pressed={source.enabled}
                onClick={() => void toggleSource(source)}
              ><i /></button>
              <div>
                <strong>{source.name}{source.priority === "important" && <em>重点</em>}</strong>
                <span>{source.url || "按公众号名称检索"}</span>
                {source.keywords.length ? <small>{source.keywords.join(" · ")}</small> : null}
                {source.error ? <small className="error">{source.error}</small> : null}
              </div>
              <span className="radar-source-actions">
                <button type="button" aria-label={`编辑 ${source.name}`} onClick={() => setDraft(sourceDraft(source))}><Pencil size={15} /></button>
                <button type="button" aria-label={`删除 ${source.name}`} onClick={() => void remove(source)}><Trash2 size={15} /></button>
              </span>
            </article>
          ))}

          {tab === "podcast" && jobs.length > 0 && (
            <section className="podcast-discovery-list">
              <h3>发现的单集 <small>{jobs.length}</small></h3>
              {jobs.slice(0, 30).map((job) => {
                const processing = processingIds.has(job.id) || ["downloading", "transcribing"].includes(job.status);
                return (
                  <article key={job.id}>
                    <div>
                      <strong>{job.title}</strong>
                      <span>{job.podcastTitle || "播客"}{job.publishedAt ? ` · ${new Date(job.publishedAt).toLocaleDateString("zh-CN")}` : ""}</span>
                      <small className={job.status === "failed" ? "error" : ""}>{podcastStatus(job)}{job.error ? `：${job.error}` : ""}</small>
                    </div>
                    {job.status !== "transcript_ready" && job.status !== "skipped" ? (
                      <button type="button" disabled={processing} onClick={() => void processJob(job)}>
                        <RefreshCw className={processing ? "spinning" : ""} size={14} />{processing ? "处理中" : "用 PLAUD 转写"}
                      </button>
                    ) : <span className="podcast-ready"><Check size={14} />已就绪</span>}
                  </article>
                );
              })}
            </section>
          )}
        </div>
      </section>
      {confirmDialog}
    </div>
  );
}
