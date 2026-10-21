import { useState, type FormEvent } from "react";
import { Check, ChevronDown, Compass, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { SourcingFocus, SourcingSnapshot } from "../sourcing-types";

type Draft = { name: string; keywords: string; excludedKeywords: string; urls: string };
const emptyDraft = (): Draft => ({ name: "", keywords: "", excludedKeywords: "", urls: "" });
const splitWords = (value: string) => [...new Set(value.split(/[,，、;；\n]/).map(word => word.trim()).filter(Boolean))];
const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const RELATIONS: Record<string, string> = { members: "实验室成员", alumni: "校友", founders: "创始人", employees: "核心员工", former_employees: "离职员工", students: "学生", coauthors: "共同作者", collaborators: "合作者" };
function retainedScope(focus: SourcingFocus) {
  if (focus.type === "freeform") return "";
  if (focus.type === "direction") return "保留原有方向范围，寻找相关创始人与团队";
  if (!focus.relations.length) return "保留原有范围：只跟踪对象本身，不扩展关联人物";
  return `保留原有关联范围：${focus.relations.map(relation => focus.type === "person" && relation === "employees" ? "共事成员" : RELATIONS[relation] || relation).join("、")}`;
}

export default function SourcingFocusManager({ focuses, configured = false, results = [], running = false, disabled = false, onSaveFocuses }: {
  focuses: SourcingFocus[];
  configured?: boolean;
  results?: SourcingSnapshot["run"]["focusResults"];
  running?: boolean;
  disabled?: boolean;
  onSaveFocuses: (focuses: SourcingFocus[]) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const locked = disabled || running || saving;
  const existing = focuses.find(focus => focus.id === editingId);
  const legacyEditing = Boolean(existing && existing.type !== "freeform");
  const maxDescriptionLength = legacyEditing ? 300 : 4000;

  function reset() { setEditingId(null); setDraft(emptyDraft()); setAdvanced(false); setError(""); }
  function edit(focus: SourcingFocus) {
    if (locked) return;
    setError(""); setSaved(false); setEditingId(focus.id);
    setDraft({ name: focus.name, keywords: focus.keywords.join("、"), excludedKeywords: focus.excludedKeywords.join("、"), urls: focus.urls.join("\n") });
    setAdvanced(Boolean(focus.keywords.length || focus.excludedKeywords.length || focus.urls.length));
    requestAnimationFrame(() => {
      const field = document.getElementById("uw-focus-description") as HTMLTextAreaElement | null;
      field?.focus(); field?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  async function persist(next: SourcingFocus[], clear = false) {
    if (locked) return;
    setSaving(true); setError(""); setSaved(false);
    try { await onSaveFocuses(next); setSaved(clear); if (clear || (editingId && !next.some(focus => focus.id === editingId))) reset(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "关注描述未能保存，请重试。"); }
    finally { setSaving(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || !draft.name.trim()) return;
    const urls: string[] = [];
    const urlsUnchanged = existing && draft.urls === existing.urls.join("\n");
    if (urlsUnchanged) urls.push(...existing.urls);
    for (const value of urlsUnchanged ? [] : draft.urls.split(/\n/).map(url => url.trim()).filter(Boolean)) {
      try { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol)) throw new Error(); urls.push(url.toString()); }
      catch { setError(`请检查指定来源网址：${value}。只接受完整的 http 或 https 链接；也可以留空。`); setAdvanced(true); return; }
    }
    // Existing structured records retain their type and relationship boundary.
    // Newly written descriptions are interpreted only as explicitly requested.
    const focus: SourcingFocus = {
      ...(existing || {}), id: editingId || `focus-${crypto.randomUUID()}`, name: draft.name.trim(),
      type: existing?.type || "freeform", relations: existing ? [...existing.relations] : [],
      keywords: existing && draft.keywords === existing.keywords.join("、") ? [...existing.keywords] : splitWords(draft.keywords),
      excludedKeywords: existing && draft.excludedKeywords === existing.excludedKeywords.join("、") ? [...existing.excludedKeywords] : splitWords(draft.excludedKeywords),
      urls: urlsUnchanged ? urls : [...new Set(urls)], enabled: existing?.enabled ?? true
    };
    const identity = (item: SourcingFocus) => JSON.stringify([item.type, normalize(item.name), [...new Set(item.keywords.map(normalize))].sort(), [...new Set(item.excludedKeywords.map(normalize))].sort(), [...new Set(item.relations)].sort(), [...new Set(item.urls)].sort()]);
    if (focuses.some(item => item.id !== editingId && identity(item) === identity(focus))) { setError("这条关注描述和补充条件已经存在。若是同名人物，可补充机构或个人主页区分。"); return; }
    void persist(editingId ? focuses.map(item => item.id === editingId ? focus : item) : [...focuses, focus], true);
  }

  return <section className="uw-focus-manager uw-focus-natural" aria-label="关注描述">
    <header className="uw-focus-heading"><div><div className="uw-focus-kicker"><Search size={13} />让搜索围绕你的关注展开</div><h2>我想关注什么</h2><p>方向、实验室、公司、人名和关联关系可以写在一起，持续寻找相关的潜在创始人与创业项目。</p></div></header>
    {running && <div className="uw-focus-running" role="status"><Loader2 size={14} className="uw-spinning" />本轮搜索进行中，完成后可调整关注描述。</div>}
    {focuses.length > 0 && focuses.every(focus => !focus.enabled) && <div className="uw-notice" role="status">全部关注对象已暂停，开启后继续发现。</div>}
    {error && <div className="uw-notice uw-notice-error" role="alert">{error}</div>}
    {saved && <div className="uw-focus-saved" role="status"><Check size={14} />关注已保存，从下一轮搜索生效；也可点击页面右上方“立即搜索”。</div>}
    <form className={`uw-focus-form uw-focus-composer${editingId ? " is-editing" : ""}`} onSubmit={submit}>
      <div className="uw-focus-form-heading"><h3>{legacyEditing ? "修改原有名称（保留原范围）" : editingId ? "编辑这条关注" : "写下你的关注"}</h3>{editingId && <button className="uw-icon-button" type="button" aria-label="取消编辑关注" disabled={saving} onClick={reset}><X size={16} /></button>}</div>
      <fieldset disabled={locked}>
        <label className="uw-focus-description-label"><span className="uw-visually-hidden">关注描述</span><textarea id="uw-focus-description" required rows={legacyEditing ? 2 : 4} maxLength={maxDescriptionLength} value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }); setSaved(false); }} placeholder={"例如：关注 AI Agent 和具身智能，重点看 MMLab 校友、相关开源作者，以及已有人脉周围有创业迹象的人。\n也可以写：围绕某家公司离职的研究员，或某位教授的学生、共同作者寻找早期创业团队。"} /></label>
        <div className="uw-focus-composer-hint"><span>{legacyEditing ? "这条保留原有名称和关联范围。如需混合新方向或人物，请取消编辑后另写一条关注。" : "可以写成一段话，也可以分行补充；每次保存为一条持续关注。"}</span><small>{draft.name.length.toLocaleString()} / {maxDescriptionLength.toLocaleString()}</small></div>
        {existing && retainedScope(existing) && <div className="uw-focus-retained-scope"><Check size={13} /><span>{retainedScope(existing)}。修改描述会保留这些已有设置。</span></div>}
        <button className="uw-focus-advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><ChevronDown size={14} className={advanced ? "is-open" : ""} />补充搜索条件<span>可选</span></button>
        {advanced && <div className="uw-focus-advanced"><div><label>补充关键词<input value={draft.keywords} placeholder="如：多模态、机器人、前研究员；用逗号分隔" onChange={event => setDraft({ ...draft, keywords: event.target.value })} /></label><label>排除词<input value={draft.excludedKeywords} placeholder="不希望出现的方向或同名机构" onChange={event => setDraft({ ...draft, excludedKeywords: event.target.value })} /></label></div><label>指定来源网址<textarea rows={3} value={draft.urls} placeholder={"可留空；domi 会自行寻找公开来源\n需要指定时，每行填写一个完整网址"} onChange={event => setDraft({ ...draft, urls: event.target.value })} /></label></div>}
      </fieldset><div className="uw-focus-form-footer"><p>{editingId ? "保留原有范围，更新这条关注。" : "保存后持续关注，可随时修改或暂停。"}</p>{editingId && <button type="button" className="uw-inline-button" disabled={saving} onClick={reset}>取消编辑</button>}<button type="submit" className="uw-primary-button" disabled={locked || !draft.name.trim()}>{saving ? <Loader2 size={14} className="uw-spinning" /> : editingId ? <Check size={14} /> : <Plus size={14} />}{saving ? "保存中…" : editingId ? "保存修改" : "保存关注"}</button></div>
    </form>
    <div className="uw-focus-list-heading"><span>持续关注<b>{focuses.length}</b></span><small>{focuses.filter(focus => focus.enabled).length} 条开启 · 公开信息核验 · 与项目、人脉查重</small></div>
    <div className="uw-focus-list">{focuses.length ? focuses.map(focus => {
      const result = results.find(item => item.focusId === focus.id);
      const expanded = expandedIds.includes(focus.id);
      return <article className={`uw-focus-row uw-focus-description-row${focus.enabled ? "" : " is-disabled"}`} key={focus.id}>
        <div className="uw-focus-row-icon"><Compass size={17} /></div><div className="uw-focus-row-body"><div><h3 className={expanded ? "is-expanded" : ""}>{focus.name}</h3>{!focus.enabled && <small>已暂停</small>}</div>{focus.name.length > 140 && <button type="button" className="uw-focus-read-more" onClick={() => setExpandedIds(expanded ? expandedIds.filter(id => id !== focus.id) : [...expandedIds, focus.id])}>{expanded ? "收起描述" : "展开完整描述"}</button>}{retainedScope(focus) && <p>{retainedScope(focus)}</p>}
        {Boolean(focus.keywords.length || focus.excludedKeywords.length || focus.urls.length) && <div className="uw-focus-row-details">{focus.keywords.length > 0 && <span>关键词：{focus.keywords.join(" · ")}</span>}{focus.excludedKeywords.length > 0 && <span>排除：{focus.excludedKeywords.join(" · ")}</span>}{focus.urls.length > 0 && <span>{focus.urls.length} 个指定来源</span>}</div>}
        {result && <div className={`uw-focus-result is-${result.status}`}><span>{result.status === "checked" ? "上轮已检查" : result.status === "failed" ? "上轮检查失败" : "尚未完成检查"}</span>{result.detail && <small>{result.detail}</small>}</div>}</div>
        <div className="uw-focus-row-actions"><button type="button" role="switch" className="uw-toggle" aria-checked={focus.enabled} aria-label={`${focus.enabled ? "暂停" : "开启"}关注对象 ${focus.name}`} disabled={locked} onClick={() => void persist(focuses.map(item => item.id === focus.id ? { ...item, enabled: !item.enabled } : item))}><span /></button><button type="button" className="uw-icon-button" aria-label={`编辑关注对象 ${focus.name}`} title="编辑" disabled={locked} onClick={() => edit(focus)}><Pencil size={14} /></button><button type="button" className="uw-icon-button" aria-label={`移除关注对象 ${focus.name}`} title="移除" disabled={locked} onClick={() => void persist(focuses.filter(item => item.id !== focus.id))}><Trash2 size={14} /></button></div>
      </article>;
    }) : <div className="uw-focus-empty"><Compass size={24} /><h3>{configured ? "尚未设置关注对象，请先添加" : "写下第一条关注，开始持续发现"}</h3><p>在上方写一段你想关注的内容，方向、机构和人物可以放在一起。</p></div>}</div>
  </section>;
}
