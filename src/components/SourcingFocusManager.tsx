import { useState, type FormEvent } from "react";
import { ArrowUpRight, Building2, Check, ChevronDown, Compass, FlaskConical, Loader2, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import type { SourcingFocus, SourcingSnapshot } from "../sourcing-types";

type FocusType = SourcingFocus["type"];
type Relation = SourcingFocus["relations"][number];
const TYPES: { type: FocusType; name: string; description: string; placeholder: string; relations: Relation[] }[] = [
  { type: "direction", name: "领域 / 方向", description: "沿研究方向寻找团队", placeholder: "例如：AI Agent、具身智能", relations: [] },
  { type: "lab", name: "重点实验室", description: "关注成员与校友创业", placeholder: "例如：MMLab", relations: ["members", "alumni", "students", "collaborators"] },
  { type: "company", name: "公司 / 项目", description: "延展团队与离职人才", placeholder: "输入公司、项目或团队名称", relations: ["founders", "employees", "former_employees"] },
  { type: "person", name: "重要人物", description: "沿合作关系发现创始人", placeholder: "输入姓名，可补充机构以便区分", relations: ["students", "coauthors", "collaborators", "employees"] }
];
const RELATIONS: Record<Relation, string> = { members: "实验室成员", alumni: "校友", founders: "创始人", employees: "核心员工", former_employees: "离职员工", students: "学生", coauthors: "共同作者", collaborators: "合作者" };
const relationLabel = (type: FocusType, relation: Relation) => type === "person" && relation === "employees" ? "共事成员" : RELATIONS[relation];
const splitWords = (value: string) => [...new Set(value.split(/[,，、;；\n]/).map(word => word.trim()).filter(Boolean))];
const normalizeName = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
function FocusIcon({ type, size = 18 }: { type: FocusType; size?: number }) {
  return type === "direction" ? <Compass size={size} /> : type === "lab" ? <FlaskConical size={size} /> : type === "company" ? <Building2 size={size} /> : <Users size={size} />;
}
type Draft = { name: string; type: FocusType; keywords: string; excludedKeywords: string; relations: Relation[]; urls: string };
function blankDraft(type: FocusType): Draft { return { name: "", type, keywords: "", excludedKeywords: "", relations: [...TYPES.find(item => item.type === type)!.relations], urls: "" }; }

export default function SourcingFocusManager({ focuses, configured = false, results = [], running = false, disabled = false, onSaveFocuses }: {
  focuses: SourcingFocus[];
  configured?: boolean;
  results?: SourcingSnapshot["run"]["focusResults"];
  running?: boolean;
  disabled?: boolean;
  onSaveFocuses: (focuses: SourcingFocus[]) => Promise<void>;
}) {
  const [activeType, setActiveType] = useState<FocusType | "all">("all");
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft("direction"));
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const locked = disabled || running || saving;
  const visible = focuses.filter(focus => activeType === "all" || focus.type === activeType);
  const draftType = TYPES.find(item => item.type === draft.type)!;

  function start(type: FocusType, focus?: SourcingFocus) {
    if (locked) return;
    setError(""); setSaved(false); setEditingId(focus?.id || null); setEditing(true);
    setDraft(focus ? { name: focus.name, type: focus.type, keywords: focus.keywords.join("、"), excludedKeywords: focus.excludedKeywords.join("、"), relations: [...focus.relations], urls: focus.urls.join("\n") } : blankDraft(type));
    setAdvanced(Boolean(focus && (focus.keywords.length || focus.excludedKeywords.length || focus.urls.length)));
  }
  async function persist(next: SourcingFocus[], close = false) {
    if (locked) return;
    setSaving(true); setError(""); setSaved(false);
    try { await onSaveFocuses(next); setSaved(true); if (close) { setEditing(false); setEditingId(null); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "关注对象未能保存，请重试。"); }
    finally { setSaving(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const name = draft.name.trim();
    if (!name) { setError("请填写关注对象的名称。"); return; }
    const urls: string[] = [];
    for (const value of draft.urls.split(/\n/).map(url => url.trim()).filter(Boolean)) {
      try { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol)) throw new Error(); urls.push(url.toString()); }
      catch { setError(`请检查指定来源网址：${value}。只接受完整的 http 或 https 链接；也可以留空。`); setAdvanced(true); return; }
    }
    const existing = focuses.find(focus => focus.id === editingId);
    const focus: SourcingFocus = { id: editingId || `focus-${crypto.randomUUID()}`, name, type: draft.type, keywords: splitWords(draft.keywords), excludedKeywords: splitWords(draft.excludedKeywords), relations: draft.type === "direction" ? [] : draft.relations, urls: [...new Set(urls)], enabled: existing?.enabled ?? true };
    const identity = (item: SourcingFocus) => JSON.stringify([item.type, normalizeName(item.name), [...new Set(item.keywords.map(normalizeName))].sort(), [...new Set(item.excludedKeywords.map(normalizeName))].sort(), [...new Set(item.relations)].sort(), [...new Set(item.urls)].sort()]);
    if (focuses.some(item => item.id !== editingId && identity(item) === identity(focus))) { setError("这个关注对象及其身份信息已存在。若是同名人物，可补充机构关键词或个人主页区分。"); return; }
    void persist(editingId ? focuses.map(item => item.id === editingId ? focus : item) : [...focuses, focus], true);
  }

  return <section className="uw-focus-manager" aria-label="关注对象">
    <header className="uw-focus-heading"><div><div className="uw-focus-kicker"><Search size={13} />从你关心的对象出发</div><h2>寻找他们周围，正在创业的人</h2><p>指定重点方向、实验室、公司或人物，持续寻找相关的潜在创始人与创业项目。</p></div><button className="uw-primary-button" type="button" disabled={locked} onClick={() => start(activeType === "all" ? "direction" : activeType)}><Plus size={15} />添加关注对象</button></header>
    <div className="uw-focus-types">{TYPES.map(item => {
      const items = focuses.filter(focus => focus.type === item.type);
      return <div className={`uw-focus-type${activeType === item.type ? " is-selected" : ""}`} key={item.type}><button className="uw-focus-type-filter" type="button" aria-pressed={activeType === item.type} aria-label={`筛选${item.name}`} onClick={() => setActiveType(activeType === item.type ? "all" : item.type)}><div className="uw-focus-type-top"><span><FocusIcon type={item.type} /></span><strong>{items.filter(focus => focus.enabled).length}<small>关注中</small></strong></div><h3>{item.name}</h3><p>{item.description}</p></button><button className="uw-focus-type-add" type="button" aria-label={`添加${item.name}`} disabled={locked} onClick={() => start(item.type)}><Plus size={13} />添加</button></div>;
    })}</div>
    {running && <div className="uw-focus-running" role="status"><Loader2 size={14} className="uw-spinning" />本轮搜索进行中，完成后可调整关注对象。</div>}
    {focuses.length > 0 && focuses.every(focus => !focus.enabled) && <div className="uw-notice" role="status">全部关注对象已暂停，开启后继续发现。</div>}
    {error && <div className="uw-notice uw-notice-error" role="alert">{error}</div>}
    {saved && !editing && <div className="uw-focus-saved" role="status"><Check size={14} />关注对象已保存，从下一轮搜索生效；也可点击页面右上方“立即搜索”。</div>}
    {editing && <form className="uw-focus-form" onSubmit={submit}>
      <div className="uw-focus-form-heading"><h3>{editingId ? "编辑关注对象" : "添加关注对象"}</h3><button className="uw-icon-button" type="button" aria-label="关闭关注对象编辑" disabled={saving} onClick={() => setEditing(false)}><X size={16} /></button></div>
      <fieldset disabled={locked}><div className="uw-focus-form-fields"><label>对象类型<select value={draft.type} onChange={event => { const type = event.target.value as FocusType; setDraft({ ...draft, type, relations: [...TYPES.find(item => item.type === type)!.relations] }); }}>{TYPES.map(item => <option value={item.type} key={item.type}>{item.name}</option>)}</select></label><label className="uw-focus-name-field">名称<input autoFocus required maxLength={160} value={draft.name} placeholder={draftType.placeholder} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label></div>
        {draft.type === "direction" ? <p className="uw-focus-direction-note">持续寻找这个方向的新团队、独立产品与创始人，并核验公开创业信号。</p> : <div className="uw-focus-relations"><span>重点寻找哪些相关的人</span><div>{draftType.relations.map(relation => <button type="button" key={relation} aria-pressed={draft.relations.includes(relation)} onClick={() => setDraft({ ...draft, relations: draft.relations.includes(relation) ? draft.relations.filter(item => item !== relation) : [...draft.relations, relation] })}>{draft.relations.includes(relation) ? <Check size={12} /> : <Plus size={12} />}{relationLabel(draft.type, relation)}</button>)}</div><small>{draft.relations.length ? "只保留有创业迹象的人物线索；关系不明确时继续核验。" : "只跟踪对象本身，不扩展关联人物。"}</small></div>}
        <button className="uw-focus-advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><ChevronDown size={14} className={advanced ? "is-open" : ""} />细化搜索范围<span>可选</span></button>
        {advanced && <div className="uw-focus-advanced"><div><label>补充关键词<input value={draft.keywords} placeholder="如：多模态、机器人、前研究员；用逗号分隔" onChange={event => setDraft({ ...draft, keywords: event.target.value })} /></label><label>排除词<input value={draft.excludedKeywords} placeholder="不希望出现的方向或同名机构" onChange={event => setDraft({ ...draft, excludedKeywords: event.target.value })} /></label></div><label>指定来源网址<textarea rows={3} value={draft.urls} placeholder={"可留空；domi 会自行寻找公开来源\n需要指定时，每行填写一个完整网址"} onChange={event => setDraft({ ...draft, urls: event.target.value })} /></label></div>}
      </fieldset><div className="uw-focus-form-footer"><p>只填名称即可。保存后从下一轮生效，也可立即搜索。</p><button type="button" className="uw-inline-button" disabled={saving} onClick={() => setEditing(false)}>取消</button><button type="submit" className="uw-primary-button" disabled={locked}>{saving ? "保存中…" : "保存关注对象"}</button></div>
    </form>}
    <div className="uw-focus-list-heading"><span>{activeType === "all" ? "全部关注对象" : TYPES.find(item => item.type === activeType)!.name}<b>{visible.length}</b></span>{activeType !== "all" && <button type="button" className="uw-inline-button" onClick={() => setActiveType("all")}>显示全部<ArrowUpRight size={12} /></button>}<small>公开信息核验 · 与现有项目、人脉查重</small></div>
    <div className="uw-focus-list">{visible.length ? visible.map(focus => { const result = results.find(item => item.focusId === focus.id); return <article className={`uw-focus-row${focus.enabled ? "" : " is-disabled"}`} key={focus.id}><div className={`uw-focus-row-icon uw-focus-icon-${focus.type}`}><FocusIcon type={focus.type} size={17} /></div><div className="uw-focus-row-body"><div><h3>{focus.name}</h3><span>{TYPES.find(item => item.type === focus.type)!.name}</span>{!focus.enabled && <small>已暂停</small>}</div><p>{focus.type === "direction" ? "寻找相关方向的创始人、新团队与独立产品" : focus.relations.length ? `寻找${focus.relations.map(relation => relationLabel(focus.type, relation)).join("、")}中的潜在创业者` : "只跟踪对象本身，不扩展关联人物"}</p>{Boolean(focus.keywords.length || focus.excludedKeywords.length || focus.urls.length) && <div className="uw-focus-row-details">{focus.keywords.length > 0 && <span>关键词：{focus.keywords.join(" · ")}</span>}{focus.excludedKeywords.length > 0 && <span>排除：{focus.excludedKeywords.join(" · ")}</span>}{focus.urls.length > 0 && <span>{focus.urls.length} 个指定来源</span>}</div>}{result && <div className={`uw-focus-result is-${result.status}`}><span>{result.status === "checked" ? "上轮已检查" : result.status === "failed" ? "上轮检查失败" : "尚未完成检查"}</span>{result.detail && <small>{result.detail}</small>}</div>}</div><div className="uw-focus-row-actions"><button type="button" role="switch" className="uw-toggle" aria-checked={focus.enabled} aria-label={`${focus.enabled ? "暂停" : "开启"}关注对象 ${focus.name}`} disabled={locked} onClick={() => void persist(focuses.map(item => item.id === focus.id ? { ...item, enabled: !item.enabled } : item))}><span /></button><button type="button" className="uw-icon-button" aria-label={`编辑关注对象 ${focus.name}`} title="编辑" disabled={locked} onClick={() => start(focus.type, focus)}><Pencil size={14} /></button><button type="button" className="uw-icon-button" aria-label={`移除关注对象 ${focus.name}`} title="移除" disabled={locked} onClick={() => void persist(focuses.filter(item => item.id !== focus.id))}><Trash2 size={14} /></button></div></article>; }) : <div className="uw-focus-empty"><Compass size={24} /><h3>{focuses.length ? "这个类别还没有关注对象" : configured ? "尚未设置关注对象，请先添加" : "先添加一个你最关心的方向或机构"}</h3><p>只需名称，就能开始寻找相关的创始人与创业项目。</p><button className="uw-secondary-button" type="button" disabled={locked} onClick={() => start(activeType === "all" ? "direction" : activeType)}><Plus size={14} />{focuses.length ? "添加此类对象" : "添加第一个关注对象"}</button></div>}</div>
  </section>;
}
