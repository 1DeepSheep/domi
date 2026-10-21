import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, CheckCheck, ChevronRight, CircleHelp, Clock3, ExternalLink, FlaskConical, GitBranch, Link2, Loader2, Pause, Play, Plus, Radar, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, Users, X } from "lucide-react";
import type { SourcingCandidate, SourcingFocus, SourcingSettings, SourcingSnapshot, SourcingSource } from "../sourcing-types";
import "../underwater.css";
import SourcingFocusManager from "./SourcingFocusManager";
import SourcingLibraryContext, { LibraryContextSummary } from "./SourcingLibraryContext";

type Filter = "new" | "review" | "archived" | "all";
type Props = {
  snapshot: SourcingSnapshot | null;
  loading?: boolean;
  error?: string;
  preview?: boolean;
  busy?: boolean;
  initialTab?: "leads" | "scope";
  onRefresh: () => void;
  onRun: () => void;
  onSaveSettings: (settings: Partial<SourcingSettings>) => Promise<void>;
  onSaveSources: (sources: SourcingSource[]) => Promise<void>;
  onSaveFocuses: (focuses: SourcingFocus[]) => Promise<void>;
  onOpenRecord?: (type: "project" | "person", id: string) => void;
  onOpenUrl: (url: string) => void;
};

const SOURCE_LABELS: Record<SourcingSource["type"], string> = { lab: "重点实验室", person: "人物延展", project: "项目延展", event: "活动与社区", open_source: "开源产品", other: "其他来源" };
const KIND_LABELS = { company: "创业公司", team: "早期团队", person: "创始人线索", product: "独立产品" };
const FILTERS: { id: Filter; label: string }[] = [{ id: "new", label: "新发现" }, { id: "review", label: "待核验" }, { id: "archived", label: "已入库" }, { id: "all", label: "全部" }];
const SHORT_DATE = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const dateLabel = (value?: number) => value && Number.isFinite(value) ? SHORT_DATE.format(value) : "尚未更新";
const timeLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const isArchived = (candidate: SourcingCandidate) => ["created", "matched"].includes(candidate.intake.status);
const needsReview = (candidate: SourcingCandidate) => ["pending", "needs_review"].includes(candidate.intake.status) && candidate.stage !== "excluded";
const cleanUrl = (value: string) => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.toString() : null; } catch { return null; } };
const hostLabel = (value: string) => { try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return value; } };

function SourceIcon({ type, size = 16 }: { type: string; size?: number }) {
  if (type === "lab") return <FlaskConical size={size} />;
  if (type === "person") return <Users size={size} />;
  if (type === "project") return <GitBranch size={size} />;
  if (type === "open_source") return <BookOpen size={size} />;
  return <Link2 size={size} />;
}

function IntakeBadge({ candidate }: { candidate: SourcingCandidate }) {
  const status = candidate.intake.status;
  return <span className={`uw-intake uw-intake-${status}`}>
    {status === "created" ? <CheckCheck size={13} /> : status === "matched" ? <Link2 size={13} /> : <CircleHelp size={13} />}
    {status === "created" ? "已建立档案" : status === "matched" ? "已关联库内档案" : status === "needs_review" ? "关系待核验" : "待核验入库"}
  </span>;
}

export default function UnderwaterPanel({ snapshot, loading = false, error = "", preview = false, busy = false, initialTab = "leads", onRefresh, onRun, onSaveSettings, onSaveSources, onSaveFocuses, onOpenRecord, onOpenUrl }: Props) {
  const [tab, setTab] = useState<"leads" | "scope">(initialTab);
  const [filter, setFilter] = useState<Filter>("all");
  const [sourceType, setSourceType] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", url: "", type: "lab" as SourcingSource["type"] });
  const closeRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const candidates = snapshot?.candidates || [];
  const sources = snapshot?.sources || [];
  const focuses = snapshot?.focuses || [];
  const allFocusPaused = focuses.length > 0 && focuses.every(focus => !focus.enabled);
  const noConfiguredFocus = snapshot?.focusConfigured === true && focuses.length === 0;
  const focusCoverage = snapshot?.run.focusCoverage;
  const settings = snapshot?.settings;
  const running = snapshot?.run.status === "running" || busy;
  const disabled = saving || loading;
  const selected = candidates.find(candidate => candidate.id === selectedId);
  const sourceByUrl = useMemo(() => new Map(sources.map(source => [source.url, source])), [sources]);
  const counts = useMemo(() => ({ new: candidates.filter(candidate => candidate.stage === "new").length, review: candidates.filter(needsReview).length, archived: candidates.filter(isArchived).length, all: candidates.filter(candidate => candidate.stage !== "excluded").length }), [candidates]);
  const visibleCandidates = useMemo(() => candidates.filter(candidate => {
    if (candidate.stage === "excluded") return false;
    if (filter === "new" && candidate.stage !== "new") return false;
    if (filter === "review" && !needsReview(candidate)) return false;
    if (filter === "archived" && !isArchived(candidate)) return false;
    if (sourceType !== "all" && !candidate.sources.some(source => source.type === sourceType || sourceByUrl.get(source.url)?.type === sourceType)) return false;
    return !query || [candidate.name, ...candidate.founders, candidate.domain, candidate.summary, ...candidate.tags].join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase());
  }).sort((a, b) => b.discoveredAt - a.discoveredAt), [candidates, filter, sourceType, query, sourceByUrl]);

  useEffect(() => {
    if (!selectedId) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
      if (event.key !== "Tab") return;
      const controls = detailRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, input:not([disabled]), select:not([disabled]), [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", listener);
    return () => { window.removeEventListener("keydown", listener); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [selectedId]);

  async function save(action: () => Promise<void>) {
    if (saving) return;
    setSaving(true); setActionError("");
    try { await action(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : "保存未完成，请重试。"); }
    finally { setSaving(false); }
  }
  function startSourceEdit(source?: SourcingSource) {
    setEditingId(source?.id || null);
    setDraft(source ? { name: source.name, url: source.url, type: source.type } : { name: "", url: "", type: "lab" });
    setAdding(true); setActionError("");
  }
  async function submitSource(event: FormEvent) {
    event.preventDefault();
    const url = cleanUrl(draft.url);
    if (!url || !draft.name.trim()) { setActionError("请填写来源名称和有效的网址。"); return; }
    if (sources.some(source => source.url === url && source.id !== editingId)) { setActionError("这个网址已在发现范围中。"); return; }
    await save(async () => {
      const source: SourcingSource = { id: editingId || `source-${crypto.randomUUID()}`, name: draft.name.trim(), url, type: draft.type, enabled: true, status: "pending" };
      await onSaveSources(editingId ? sources.map(item => item.id === editingId ? { ...item, name: source.name, url, type: source.type } : item) : [...sources, source]);
      setAdding(false); setEditingId(null);
    });
  }
  const latestSuccess = snapshot?.run.lastSuccessAt;
  const visibleError = actionError || error || snapshot?.error || (snapshot?.run.status === "failed" ? snapshot.run.error : "");

  return <section className="underwater-panel" aria-label="水下项目" aria-busy={loading}>
    {preview && <div className="uw-preview-notice"><span><Sparkles size={14} />界面预览</span><p>项目与关注对象为界面示例；状态、数量与入库结果仅作展示，不代表实际搜索或入库。</p></div>}
    <div className="uw-page-scroll">
      <header className="uw-page-header">
        <div><div className="uw-eyebrow"><span />SOURCING</div><h1>水下项目</h1><p>从人、实验室和产品出发，发现新闻之前的创业线索。</p></div>
        <div className="uw-header-actions"><button className="uw-icon-button" title="刷新搜索结果" aria-label="刷新搜索结果" disabled={loading} onClick={onRefresh}><RefreshCw size={17} className={loading ? "uw-spinning" : ""} /></button><button className="uw-primary-button" disabled={running || loading || allFocusPaused || noConfiguredFocus} title={noConfiguredFocus ? "先添加一个关注对象" : allFocusPaused ? "先开启一个关注对象" : undefined} onClick={onRun}>{running ? <Loader2 size={16} className="uw-spinning" /> : <Radar size={16} />}{running ? "正在发现" : "立即搜索"}</button></div>
      </header>

      <div className="uw-schedule-strip">
        <span className={`uw-status-dot ${settings?.enabled ? "is-active" : ""}`} />
        <strong>{settings?.enabled ? `每天 ${timeLabel(settings.localHour)} 自动发现` : "每日自动发现已暂停"}</strong>
        <span className="uw-schedule-zone">北京时间</span><span className="uw-strip-divider" /><span>上次成功更新 <b>{dateLabel(latestSuccess)}</b></span>
        <button className="uw-inline-button" disabled={disabled || !settings} onClick={() => void save(() => onSaveSettings({ enabled: !settings?.enabled }))}>{settings?.enabled ? <Pause size={13} /> : <Play size={13} />}{settings?.enabled ? "暂停" : "开启"}</button>
        <button className="uw-inline-button uw-schedule-settings" onClick={() => setTab("scope")}><Settings2 size={13} />设置</button>
      </div>

      {visibleError && <div className="uw-notice uw-notice-error" role="alert"><CircleHelp size={17} /><span>{visibleError}{latestSuccess ? " 已保留上次成功结果。" : ""}</span><button onClick={onRefresh} type="button">重试</button></div>}
      {snapshot?.run.status === "partial" && <div className="uw-notice" role="status"><CircleHelp size={16} /><span>{snapshot.run.coverage?.failed ? `本次发现已保存；${snapshot.run.coverage.failed} 个来源未完成，后续会继续检查。` : "本次已完成的发现结果已保存，其余搜索范围会继续检查。"}</span><button type="button" onClick={() => setTab("scope")}>查看来源</button></div>}
      {focusCoverage && (focusCoverage.failed > 0 || focusCoverage.pending > 0) && <div className="uw-notice" role="status"><Search size={16} /><span>关注对象已检查 {focusCoverage.checked} 个，{focusCoverage.failed > 0 ? `${focusCoverage.failed} 个检查失败` : ""}{focusCoverage.failed > 0 && focusCoverage.pending > 0 ? "、" : ""}{focusCoverage.pending > 0 ? `${focusCoverage.pending} 个尚未完成` : ""}；这些对象的搜索结果仍待补全。</span><button type="button" onClick={() => setTab("scope")}>查看关注对象</button></div>}
      {(allFocusPaused || noConfiguredFocus) && tab !== "scope" && <div className="uw-notice" role="status">{noConfiguredFocus ? "尚未设置关注对象，请先添加。" : "全部关注对象已暂停，开启后继续发现。"}<button type="button" onClick={() => setTab("scope")}>设置关注对象</button></div>}
      {running && <div className="uw-live-progress" role="status"><Loader2 className="uw-spinning" size={16} /><span>正在检查公开来源、核验创业信号并与资料库查重</span><small>发现结果会陆续更新</small></div>}

      {tab === "leads" && <div className="uw-summary-grid">
        <button onClick={() => { setTab("leads"); setFilter("new"); }} className="uw-summary-cell uw-summary-featured"><span>新发现线索 <ArrowUpRight size={15} /></span><strong>{loading && !snapshot ? "—" : counts.new}<small>条</small></strong><p>从公开信息中发现创业迹象</p></button>
        <button onClick={() => { setTab("leads"); setFilter("review"); }} className="uw-summary-cell"><span>待核验 <CircleHelp size={15} /></span><strong>{loading && !snapshot ? "—" : counts.review}<small>条</small></strong><p>身份、主体或关系有待确认</p></button>
        <button onClick={() => { setTab("leads"); setFilter("archived"); }} className="uw-summary-cell"><span>已入库与关联 <CheckCheck size={16} /></span><strong>{loading && !snapshot ? "—" : counts.archived}<small>条</small></strong><p>查重后建立或补充现有档案</p></button>
        <button onClick={() => setTab("scope")} className="uw-summary-cell"><span>持续关注对象 <GitBranch size={16} /></span><strong>{focuses.filter(focus => focus.enabled).length}<small>个</small></strong><p>方向 · 实验室 · 公司 · 人物</p></button>
      </div>}

      <div className="uw-main-tabs" role="tablist" aria-label="水下项目视图"><button type="button" role="tab" aria-selected={tab === "leads"} onClick={() => setTab("leads")}>项目线索</button><button type="button" role="tab" aria-selected={tab === "scope"} onClick={() => setTab("scope")}>发现范围<span>{focuses.length}</span></button></div>

      {tab === "leads" ? <div className="uw-leads-view">
        <div className="uw-list-toolbar"><div className="uw-filters" aria-label="线索状态">{FILTERS.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{counts[item.id]}</span></button>)}</div><label className="uw-search-field"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目、创始人" aria-label="搜索项目、创始人" />{query && <button aria-label="清空搜索" onClick={() => setQuery("")}><X size={13} /></button>}</label></div>
        <div className="uw-source-filter"><span>发现路径</span><button type="button" aria-pressed={sourceType === "all"} onClick={() => setSourceType("all")}>全部</button>{Object.entries(SOURCE_LABELS).filter(([key]) => key !== "other").map(([key, label]) => <button type="button" key={key} aria-pressed={sourceType === key} onClick={() => setSourceType(key)}>{label}</button>)}</div>
        {loading && !snapshot ? <div className="uw-empty-state"><Loader2 className="uw-spinning" size={27} /><h2>正在读取水下线索</h2><p>检索结果与持续关注的来源会显示在这里。</p></div> : visibleCandidates.length ? <>
          <div className="uw-list-heading"><span>项目 / 创始人</span><span>发现信号、联系路径与项目关联</span><span>详情</span></div>
          <div className="uw-candidate-list">{visibleCandidates.map(candidate => <article className="uw-candidate" key={candidate.id}>
            <button className="uw-candidate-identity" onClick={() => setSelectedId(candidate.id)} aria-label={`查看 ${candidate.name} 详情`}><div className={`uw-candidate-monogram uw-kind-${candidate.kind}`}>{candidate.name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, "").slice(0, 1).toUpperCase()}</div><div><h2>{candidate.name}<span>{KIND_LABELS[candidate.kind]}</span></h2><p className="uw-founder-line">{candidate.founders.length ? candidate.founders.join(" · ") : "创始人待确认"}</p><p className="uw-candidate-summary">{candidate.summary}</p><div className="uw-candidate-tags"><span>{candidate.domain || "方向待确认"}</span>{candidate.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</div></div></button>
            <div className="uw-candidate-evidence"><p className="uw-signal"><span className="uw-signal-marker" />{candidate.signal}</p><div className="uw-discovery-path">{candidate.discoveryPath.slice(0, 3).map((part, index) => <span key={`${part}-${index}`}>{index > 0 && <ChevronRight size={11} />}{part}</span>)}</div><div className="uw-candidate-result"><IntakeBadge candidate={candidate} /><time>{dateLabel(candidate.discoveredAt)} 发现</time></div><LibraryContextSummary candidate={candidate} lastAttemptAt={snapshot?.run.lastAttemptAt} onOpen={() => setSelectedId(candidate.id)} /></div>
            <button className="uw-detail-button" aria-label={`查看 ${candidate.name} 证据与详情`} onClick={() => setSelectedId(candidate.id)}><ArrowUpRight size={18} /></button>
          </article>)}</div>
          <footer className="uw-list-footer"><ShieldCheck size={14} /><span>先核验、再查重入库。已有项目与人脉补充关联，身份存疑的线索保留待核验。</span><b>{visibleCandidates.length} 条线索</b></footer>
        </> : <div className="uw-empty-state"><div className="uw-empty-symbol"><Radar size={29} /></div><h2>{candidates.length ? "没有符合条件的线索" : "从第一条创业线索开始"}</h2><p>{candidates.length ? "试试其他状态、发现路径或关键词。" : "关注重点实验室、已知项目和人物，持续发现潜在创始人与创业团队。"}</p><button className="uw-secondary-button" onClick={() => { if (candidates.length) { setFilter("all"); setSourceType("all"); setQuery(""); } else setTab("scope"); }}>{candidates.length ? "清除筛选" : "设置发现范围"}<ArrowRight size={14} /></button></div>}
      </div> : <div className="uw-scope-view">
        <SourcingFocusManager focuses={focuses} configured={snapshot?.focusConfigured} results={snapshot?.run.focusResults} running={running} disabled={disabled} onSaveFocuses={onSaveFocuses} />
        <div className="uw-scope-intro uw-supplemental-heading"><div><h2>补充数据来源 <span>{sources.length}</span></h2><p>可选：指定校友页、访谈、社区或开源主页。暂停或移除后，该网址不再参与搜索，包括关注对象指定的网址。</p></div><button className="uw-secondary-button" onClick={() => startSourceEdit()} disabled={disabled}><Plus size={15} />添加来源</button></div>
        {adding && <form className="uw-source-form" onSubmit={event => void submitSource(event)}><div className="uw-source-form-heading"><h3>{editingId ? "编辑关注来源" : "添加关注来源"}</h3><button type="button" className="uw-icon-button" aria-label="关闭来源编辑" onClick={() => setAdding(false)}><X size={16} /></button></div><div className="uw-source-fields"><label>来源名称<input required autoFocus placeholder="例如：某实验室成员与校友" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>来源类型<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as SourcingSource["type"] })}>{Object.entries(SOURCE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label className="uw-source-url-field">公开网址<input required type="url" placeholder="https://" value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} /></label></div><div className="uw-source-form-footer"><button type="button" className="uw-inline-button" onClick={() => setAdding(false)}>取消</button><button className="uw-primary-button" type="submit" disabled={saving}>{saving ? "保存中…" : "保存来源"}</button></div></form>}
        <div className="uw-scope-grid"><div className="uw-source-list">{sources.length ? sources.map(source => <article className={`uw-source-row${source.enabled && source.inScope !== false ? "" : " is-disabled"}`} key={source.id}><div className="uw-source-icon"><SourceIcon type={source.type} size={19} /></div><div className="uw-source-body"><h3><button type="button" onClick={() => startSourceEdit(source)}>{source.name}</button><span>{SOURCE_LABELS[source.type]}</span></h3><button className="uw-source-address" onClick={() => onOpenUrl(source.url)}>{hostLabel(source.url)}<ExternalLink size={11} /></button>{source.detail && <p>{source.detail}</p>}{source.inScope === false && <p className="uw-source-out-of-scope">关联关注对象已暂停或移除，本轮不搜索。</p>}<small className={source.status === "failed" ? "uw-source-failed" : ""}>{source.status === "failed" ? "上次检查未完成" : source.lastCheckedAt ? `最近检查 ${dateLabel(source.lastCheckedAt)}` : "等待首次检查"}</small></div><div className="uw-source-controls"><button type="button" role="switch" className="uw-toggle" aria-checked={source.enabled} aria-label={`${source.enabled ? "暂停" : "开启"}关注 ${source.name}`} disabled={disabled} onClick={() => void save(() => onSaveSources(sources.map(item => item.id === source.id ? { ...item, enabled: !item.enabled } : item)))}><span /></button><button type="button" className="uw-icon-button" aria-label={`移除来源 ${source.name}`} title="移除来源" disabled={disabled} onClick={() => void save(() => onSaveSources(sources.filter(item => item.id !== source.id)))}><Trash2 size={14} /></button></div></article>) : <div className="uw-sources-empty"><FlaskConical size={26} /><h3>还没有关注来源</h3><p>可以从实验室校友页、创始人主页或产品社区开始。</p><button className="uw-secondary-button" onClick={() => startSourceEdit()}><Plus size={14} />添加第一个来源</button></div>}</div>
          <aside className="uw-settings-card"><div className="uw-settings-card-title"><Clock3 size={17} /><h3>每日发现</h3></div><div className="uw-settings-switch-row"><span>自动更新</span><button type="button" role="switch" className="uw-toggle" aria-checked={Boolean(settings?.enabled)} aria-label="每日自动更新" disabled={disabled || !settings} onClick={() => void save(() => onSaveSettings({ enabled: !settings?.enabled }))}><span /></button></div><label className="uw-time-setting">更新时间<select aria-label="每天更新时间" value={settings?.localHour ?? 9} disabled={disabled || !settings} onChange={event => void save(() => onSaveSettings({ localHour: Number(event.target.value) }))}>{Array.from({ length: 24 }, (_, hour) => <option value={hour} key={hour}>{timeLabel(hour)}</option>)}</select></label><p className="uw-setting-note">北京时间 · 每天一次<br />客户端运行时执行，错过的更新会在恢复后补查。</p><div className="uw-settings-rule" /><div className="uw-settings-switch-row"><span>核验后自动入库</span><button type="button" role="switch" className="uw-toggle" aria-checked={Boolean(settings?.autoIntake)} aria-label="核验后自动入库" disabled={disabled || running || !settings} onClick={() => void save(() => onSaveSettings({ autoIntake: !settings?.autoIntake }))}><span /></button></div><p className="uw-setting-note">与项目库、人脉库查重。明确的新主体建立档案；已有主体补充证据与关系。</p><div className="uw-intake-note"><ShieldCheck size={16} /><span>同名、隐形团队与主体不明的线索保留待核验。</span></div></aside></div>
      </div>}
    </div>
    {selected && <div className="uw-detail-overlay" onClick={() => setSelectedId(null)}><aside ref={detailRef} className="uw-detail-panel" role="dialog" aria-modal="true" aria-labelledby="uw-detail-title" onClick={event => event.stopPropagation()}><header className="uw-detail-header"><span>线索详情</span><button ref={closeRef} className="uw-icon-button" aria-label="关闭线索详情" onClick={() => setSelectedId(null)}><X size={19} /></button></header><div className="uw-detail-content"><span className="uw-detail-kind">{KIND_LABELS[selected.kind]}</span><h2 id="uw-detail-title">{selected.name}</h2><p className="uw-detail-founder">{selected.founders.join(" · ") || "创始人待确认"}</p><p className="uw-detail-summary">{selected.summary}</p><IntakeBadge candidate={selected} /><SourcingLibraryContext candidate={selected} lastAttemptAt={snapshot?.run.lastAttemptAt} onOpenRecord={onOpenRecord} onOpenUrl={onOpenUrl} /><section><h3>为什么发现这条线索</h3><p>{selected.signal}</p><div className="uw-detail-path">{selected.discoveryPath.map((part, index) => <div key={`${index}-${part}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{part}</p></div>)}</div></section><section><h3>公开证据 <span>{selected.sources.length}</span></h3>{selected.sources.map((source, index) => <button key={`${source.url}-${index}`} className="uw-evidence-link" onClick={() => onOpenUrl(source.url)}><div><strong>{source.title || hostLabel(source.url)}</strong><small>{hostLabel(source.url)}</small></div><ArrowUpRight size={16} /></button>)}</section><section><h3>归档与主体关联</h3>{selected.relatedEntities.length ? selected.relatedEntities.map(entity => <button className="uw-related-record" key={`${entity.type}-${entity.id}`} disabled={!onOpenRecord} onClick={() => onOpenRecord?.(entity.type, entity.id)}><div><span>{entity.type === "project" ? "项目" : "人脉"}</span><strong>{entity.name}</strong><small>{entity.relation}</small></div><ChevronRight size={15} /></button>) : <p className="uw-detail-muted">{selected.intake.status === "created" ? "已为确认的新主体建立档案。" : "尚未确认与现有项目、人脉的关系。"}</p>}{selected.intake.reason && <p className="uw-detail-muted">{selected.intake.reason}</p>}{selected.intake.projectId && onOpenRecord && <button className="uw-secondary-button uw-record-open" onClick={() => onOpenRecord("project", selected.intake.projectId!)}>打开项目档案<ArrowUpRight size={14} /></button>}{Boolean(selected.intake.personIds?.length) && onOpenRecord && selected.intake.personIds!.map((id, index) => <button key={id} className="uw-inline-button uw-record-open" onClick={() => onOpenRecord("person", id)}>打开人脉档案{selected.intake.personIds!.length > 1 ? ` ${index + 1}` : ""}<ArrowUpRight size={14} /></button>)}</section>{selected.nextAction && <section className="uw-next-action"><h3>下一步关注</h3><p>{selected.nextAction}</p></section>}<div className="uw-detail-dates"><span>首次发现 {dateLabel(selected.discoveredAt)}</span><span>最近检查 {dateLabel(selected.lastSeenAt)}</span></div></div></aside></div>}
  </section>;
}
