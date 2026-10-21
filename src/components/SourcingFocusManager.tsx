import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { SourcingFocus, SourcingSnapshot } from "../sourcing-types";
import "../sourcing-focus.css";

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
  const [truncatedIds, setTruncatedIds] = useState<string[]>([]);
  const descriptionNodes = useRef(new Map<string, HTMLHeadingElement>());
  const locked = disabled || running || saving;
  const existing = focuses.find(focus => focus.id === editingId);
  const legacyEditing = Boolean(existing && existing.type !== "freeform");
  const maxDescriptionLength = legacyEditing ? 300 : 4000;

  useLayoutEffect(() => {
    const measure = () => {
      const next = [...descriptionNodes.current].filter(([, element]) => element.scrollHeight > element.clientHeight + 1).map(([id]) => id);
      setTruncatedIds(previous => previous.length === next.length && previous.every((id, index) => id === next[index]) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of descriptionNodes.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [focuses, expandedIds]);

  function reset() { setEditingId(null); setDraft(emptyDraft()); setAdvanced(false); setError(""); }
  function edit(focus: SourcingFocus) {
    if (locked) return;
    setError(""); setSaved(false); setEditingId(focus.id);
    setDraft({ name: focus.name, keywords: focus.keywords.join("、"), excludedKeywords: focus.excludedKeywords.join("、"), urls: focus.urls.join("\n") });
    setAdvanced(false);
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

  const conditionCount = Number(Boolean(draft.keywords.trim())) + Number(Boolean(draft.excludedKeywords.trim())) + Number(Boolean(draft.urls.trim()));
  return <section className="uw-focus-manager uw-focus-compact" aria-label="关注描述">
    {running && <div className="sfc-notice" role="status"><Loader2 size={13} className="uw-spinning" />搜索中，完成后可修改。</div>}
    {focuses.length > 0 && focuses.every(focus => !focus.enabled) && <div className="sfc-notice" role="status">全部关注对象已暂停，开启后继续发现。</div>}
    {error && <div className="uw-notice uw-notice-error" role="alert">{error}</div>}
    <form className={`sfc-editor${editingId ? " is-editing" : ""}`} onSubmit={submit}>
      <div className="sfc-editor-heading"><h2>{legacyEditing ? "修改原有名称（保留原范围）" : editingId ? "编辑关注" : "我想关注什么"}</h2>{editingId && <button className="uw-icon-button" type="button" aria-label="取消编辑关注" disabled={saving} onClick={reset}><X size={15} /></button>}</div>
      <fieldset disabled={locked}>
        <label className="sfc-description"><span className="uw-visually-hidden">关注描述</span><textarea id="uw-focus-description" required rows={2} maxLength={maxDescriptionLength} value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }); setSaved(false); }} placeholder="例如：关注 AI Agent，重点看 MMLab 校友、某公司离职研究员和某位教授的学生。" /></label>
        {legacyEditing && <p className="sfc-legacy-note">仅修改名称，保留原有关联范围；要混合新方向或人物，请另加一条关注。</p>}
        {existing && retainedScope(existing) && <p className="sfc-retained-scope">{retainedScope(existing)}</p>}
        <div className="sfc-editor-meta"><button className="sfc-advanced-toggle" type="button" aria-label="更多条件" aria-controls="sfc-advanced-fields" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><ChevronDown size={13} className={advanced ? "is-open" : ""} />更多条件{conditionCount > 0 && <span>{conditionCount}</span>}</button><small>{draft.name.length.toLocaleString()} / {maxDescriptionLength.toLocaleString()}</small></div>
        {advanced && <div id="sfc-advanced-fields" className="sfc-advanced"><div><label>补充关键词<input value={draft.keywords} placeholder="多个词用逗号分隔" onChange={event => setDraft({ ...draft, keywords: event.target.value })} /></label><label>排除词<input value={draft.excludedKeywords} placeholder="不关注的方向或同名机构" onChange={event => setDraft({ ...draft, excludedKeywords: event.target.value })} /></label></div><label>指定来源网址<textarea rows={2} value={draft.urls} placeholder="可留空；每行一个完整网址" onChange={event => setDraft({ ...draft, urls: event.target.value })} /></label></div>}
      </fieldset>
      <div className="sfc-editor-footer"><span role={saved ? "status" : undefined}>{saved && <><Check size={12} />已保存，下轮生效。</>}</span>{editingId && <button type="button" className="uw-inline-button" disabled={saving} onClick={reset}>取消编辑</button>}<button type="submit" className="uw-primary-button" disabled={locked || !draft.name.trim()}>{saving ? <Loader2 size={13} className="uw-spinning" /> : editingId ? <Check size={13} /> : <Plus size={13} />}{saving ? "保存中…" : editingId ? "保存修改" : "保存关注"}</button></div>
    </form>
    <div className="sfc-list-heading"><span>已关注 <b>{focuses.length}</b></span>{focuses.length > 0 && <small>{focuses.filter(focus => focus.enabled).length} 条开启</small>}</div>
    <div className="sfc-list">{focuses.length ? focuses.map(focus => {
      const result = results.find(item => item.focusId === focus.id);
      const expanded = expandedIds.includes(focus.id);
      const hasConditions = Boolean(focus.keywords.length || focus.excludedKeywords.length || focus.urls.length || retainedScope(focus));
      return <article className={`sfc-row${focus.enabled ? "" : " is-disabled"}`} key={focus.id}>
        <div className="uw-focus-row-body sfc-row-body"><h3 ref={element => { if (element) descriptionNodes.current.set(focus.id, element); else descriptionNodes.current.delete(focus.id); }} className={expanded ? "is-expanded" : ""}>{focus.name}</h3>
          <div className="sfc-row-meta">{!focus.enabled && <span className="sfc-paused">已暂停</span>}{result && <span className={`sfc-result is-${result.status}`}>{result.status === "checked" ? "上轮已检查" : result.status === "failed" ? "上轮检查失败" : "尚未完成检查"}</span>}{(expanded || truncatedIds.includes(focus.id)) && <button type="button" className="sfc-read-more" aria-expanded={expanded} onClick={() => setExpandedIds(expanded ? expandedIds.filter(id => id !== focus.id) : [...expandedIds, focus.id])}>{expanded ? "收起描述" : "展开完整描述"}</button>}</div>
          {result?.detail && <p className={`sfc-result-detail is-${result.status}`}>{result.detail}</p>}
          {hasConditions && <details className="sfc-conditions"><summary>补充条件<ChevronDown size={12} /></summary><div>{retainedScope(focus) && <p>{retainedScope(focus)}</p>}{focus.keywords.length > 0 && <p>关键词：{focus.keywords.join(" · ")}</p>}{focus.excludedKeywords.length > 0 && <p>排除：{focus.excludedKeywords.join(" · ")}</p>}{focus.urls.length > 0 && <p>指定来源：{focus.urls.join(" · ")}</p>}</div></details>}
        </div>
        <div className="sfc-row-actions"><button type="button" role="switch" className="uw-toggle" aria-checked={focus.enabled} aria-label={`${focus.enabled ? "暂停" : "开启"}关注对象 ${focus.name}`} disabled={locked} onClick={() => void persist(focuses.map(item => item.id === focus.id ? { ...item, enabled: !item.enabled } : item))}><span /></button><button type="button" className="uw-icon-button" aria-label={`编辑关注对象 ${focus.name}`} title="编辑" disabled={locked} onClick={() => edit(focus)}><Pencil size={13} /></button><button type="button" className="uw-icon-button" aria-label={`移除关注对象 ${focus.name}`} title="移除" disabled={locked} onClick={() => void persist(focuses.filter(item => item.id !== focus.id))}><Trash2 size={13} /></button></div>
      </article>;
    }) : <p className="sfc-empty">{configured ? "尚未设置关注对象，请先添加" : "还没有关注内容，在上方添加即可。"}</p>}</div>
  </section>;
}
