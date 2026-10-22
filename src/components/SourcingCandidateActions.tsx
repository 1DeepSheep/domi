import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Link2, Loader2, Search } from "lucide-react";
import type { SourcingCandidate, SourcingLibraryRef, SourcingReviewRequest } from "../sourcing-types";

export type SourcingLibraryOption = SourcingLibraryRef & { summary?: string };
export type SourcingNoteDraft = { value: string; saved?: boolean };
type Props = {
  candidate: SourcingCandidate;
  draft?: SourcingNoteDraft;
  onDraft: (draft: SourcingNoteDraft) => void;
  onReview: (request: SourcingReviewRequest) => Promise<void>;
  onSearchLibrary: (query: string, type: "project" | "person") => Promise<SourcingLibraryOption[]>;
  onFollowUp?: (candidate: SourcingCandidate, text: string) => Promise<void>;
  onOpenRecord?: (type: "project" | "person", id: string) => void;
};

const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "保存未完成，请重试。";

export default function SourcingCandidateActions({ candidate, draft, onDraft, onReview, onSearchLibrary, onFollowUp, onOpenRecord }: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [identityOpen, setIdentityOpen] = useState(false);
  const searchType = candidate.kind === "person" ? "person" : "project";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SourcingLibraryOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<SourcingLibraryOption | null>(null);
  const [searched, setSearched] = useState(false);
  const searchRequest = useRef(0);
  const busyRef = useRef(false);
  const userState = candidate.userState;
  const note = draft && !draft.saved ? draft.value : userState?.note ?? draft?.value ?? "";
  const identity = userState?.sameEntity;

  // Only query the library when the user opens the identity picker. Late search
  // responses cannot replace a newer query or a different entity type.
  useEffect(() => {
    const request = ++searchRequest.current;
    setResults([]); setSelected(null); setSearchError(""); setSearched(false);
    if (!identityOpen || !query.trim()) { setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void onSearchLibrary(query.trim(), searchType).then(items => {
        if (request !== searchRequest.current) return;
        setResults(items); setSearched(true);
      }).catch(cause => {
        if (request === searchRequest.current) setSearchError(errorMessage(cause));
      }).finally(() => {
        if (request === searchRequest.current) setSearching(false);
      });
    }, 250);
    return () => { window.clearTimeout(timer); ++searchRequest.current; };
  }, [query, searchType, identityOpen, onSearchLibrary]);

  async function act(kind: string, action: () => Promise<void>, success: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(kind); setError(""); setNotice("");
    try { await action(); setNotice(success); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(""); }
  }

  return <section className="uw-follow-up" aria-labelledby="uw-follow-up-title">
    <div className="uw-follow-up-heading"><h3 id="uw-follow-up-title">后续处理</h3><select aria-label="跟进状态" value={userState?.disposition || "none"} disabled={Boolean(busy)} onChange={event => {
      const disposition = event.target.value as NonNullable<SourcingCandidate["userState"]>["disposition"];
      void act("disposition", () => onReview({ candidateId: candidate.id, disposition }), "跟进状态已保存");
    }}><option value="none">未处理</option><option value="follow_up">继续跟进</option><option value="not_interested">暂不关注</option></select></div>
    <label className="uw-follow-up-note"><span className="uw-sr-only">处理意见或备注</span><textarea rows={3} maxLength={4000} value={note} disabled={Boolean(busy)} onChange={event => { onDraft({ value: event.target.value }); setNotice(""); }} placeholder="写下判断或下一步，例如：和库里的某个项目是同一个，帮我核对关联。" /></label>
    <div className="uw-follow-up-buttons"><button type="button" className="uw-secondary-button" disabled={Boolean(busy) || note === (userState?.note || "")} onClick={() => void act("note", async () => {
      await onReview({ candidateId: candidate.id, note }); onDraft({ value: note, saved: true });
    }, "备注已保存")}>{busy === "note" && <Loader2 size={13} className="uw-spinning" />}保存备注</button>{onFollowUp && <button type="button" className="uw-primary-button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("follow_up", async () => {
      await onFollowUp(candidate, note.trim());
    }, "已交给 domi 处理")}>{busy === "follow_up" && <Loader2 size={13} className="uw-spinning" />}交给 domi 处理<ArrowUpRight size={13} /></button>}</div>
    {busy === "disposition" && <p className="uw-follow-up-message" role="status">正在保存跟进状态…</p>}
    {error && <p className="uw-follow-up-error" role="alert">{error}</p>}
    {notice && <p className="uw-follow-up-message" role="status"><Check size={12} />{notice}</p>}
    {identity && <div className="uw-confirmed-identity"><Link2 size={13} /><div><span>用户确认：与</span> <button type="button" disabled={!onOpenRecord} onClick={() => onOpenRecord?.(identity.type, identity.id)}>{identity.name}<ArrowUpRight size={12} /></button><span> 是同一{identity.type === "project" ? "项目" : "人物"}</span><small>已记录主体关联，库内档案保持独立。</small></div><button className="uw-inline-button" type="button" disabled={Boolean(busy)} onClick={() => void act("identity", () => onReview({ candidateId: candidate.id, sameEntity: null }), "已撤销主体关联")}>撤销</button></div>}
    <button type="button" className="uw-identity-toggle" aria-expanded={identityOpen} onClick={() => { setIdentityOpen(open => !open); setError(""); }}>{identity ? "更正主体关联" : "与库内项目或人物是同一个"}<ChevronDown size={13} /></button>
    {identityOpen && <div className="uw-identity-picker">
      <div className="uw-identity-search"><span className="uw-identity-type">{searchType === "project" ? "项目库" : "人脉库"}</span><label><Search size={14} /><input aria-label="搜索库内档案" placeholder="搜索名称或别名" value={query} disabled={Boolean(busy)} onChange={event => setQuery(event.target.value)} /></label></div>
      {searching && <p className="uw-follow-up-message" role="status">正在查询资料库…</p>}
      {searchError && <p className="uw-follow-up-error" role="alert">{searchError}</p>}
      {searched && !searching && !results.length && <p className="uw-follow-up-message">未找到匹配档案，试试其他名称。</p>}
      {results.length > 0 && <div className="uw-identity-options" role="group" aria-label="库内匹配档案">{results.map(item => <button type="button" key={`${item.type}-${item.id}`} aria-pressed={selected?.id === item.id && selected.type === item.type} disabled={Boolean(busy)} onClick={() => setSelected(item)}><span><strong>{item.name}</strong>{item.summary && <small>{item.summary}</small>}</span>{selected?.id === item.id && selected.type === item.type && <Check size={14} />}</button>)}</div>}
      <div className="uw-identity-footer"><p>选择确认的档案，保存为同一主体。</p><button type="button" className="uw-secondary-button" disabled={Boolean(busy) || !selected || searching} onClick={() => {
        if (!selected) return;
        void act("identity", async () => { await onReview({ candidateId: candidate.id, sameEntity: { type: selected.type, id: selected.id } }); setIdentityOpen(false); }, "主体关联已保存");
      }}>{busy === "identity" && <Loader2 size={13} className="uw-spinning" />}确认关联</button></div>
    </div>}
  </section>;
}
