import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown, GitBranch, Link2, Users } from "lucide-react";
import type { SourcingCandidate } from "../sourcing-types";

type ContactPaths = NonNullable<SourcingCandidate["contactPaths"]>;
type ResearchLinks = NonNullable<SourcingCandidate["researchLinks"]>;
type Entity = ContactPaths["items"][number]["via"];
type Evidence = ContactPaths["items"][number]["evidence"][number];
type Actions = { onOpenRecord?: (type: "project" | "person", id: string) => void; onOpenUrl: (url: string) => void };
const RELATIONS: Record<ResearchLinks["items"][number]["relation"], string> = { similar_product: "相似产品", same_direction: "同一研究方向", competitor: "竞争关系", upstream: "上游能力", downstream: "下游需求", complementary: "互补产品", team_connection: "团队关联" };
type ContextState = Pick<ContactPaths, "status" | "checkedAt">;
const isHistorical = (result: ContextState | undefined, lastAttemptAt?: number) => Boolean(result && result.status !== "pending" && (!Number.isFinite(result.checkedAt) || !Number.isFinite(lastAttemptAt) || Number(result.checkedAt) < Number(lastAttemptAt)));
const stateLabel = (result?: ContextState, lastAttemptAt?: number) => !result ? "尚未检查" : result.status === "pending" ? "检查未完成" : isHistorical(result, lastAttemptAt) ? result.status === "not_found" ? "上次未找到，本轮待复核" : "本轮待复核" : result.status === "not_found" ? "本轮未找到" : "已检查";
const hostLabel = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const DATE = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const checkedTime = (value?: number) => value && Number.isFinite(value) ? <time className="uw-context-checked">检查于 {DATE.format(value)}</time> : null;

export function LibraryContextSummary({ candidate, lastAttemptAt, onOpen }: { candidate: SourcingCandidate; lastAttemptAt?: number; onOpen: () => void }) {
  const paths = candidate.contactPaths;
  const links = candidate.researchLinks;
  const contacts = paths && paths.status !== "not_found" ? paths.items : [];
  const research = links && links.status !== "not_found" ? links.items : [];
  const primaryContact = contacts.find(item => item.basis === "library_record") || contacts[0];
  const contactSuffix = isHistorical(paths, lastAttemptAt) ? " · 本轮待复核" : paths?.status === "pending" ? " · 检查未完成" : "";
  const researchSuffix = isHistorical(links, lastAttemptAt) ? " · 本轮待复核" : links?.status === "pending" ? " · 检查未完成" : "";
  return <div className="uw-library-summary">
    <button type="button" onClick={onOpen} aria-label={`查看 ${candidate.name} 的联系路径`}><Users size={12} /><span className="uw-library-summary-label">{primaryContact?.basis === "public_overlap" ? "潜在入口" : "联系路径"}</span><span className={primaryContact ? "has-result" : ""}>{primaryContact ? `${primaryContact.via.name}${primaryContact.basis === "public_overlap" ? " · 关系待确认" : " · 引荐待确认"}${contacts.length > 1 ? ` 等 ${contacts.length} 条` : ""}${contactSuffix}` : stateLabel(paths, lastAttemptAt)}</span><ArrowUpRight size={12} /></button>
    <button type="button" onClick={onOpen} aria-label={`查看 ${candidate.name} 的已有项目关联`}><GitBranch size={12} /><span className="uw-library-summary-label">项目关联</span><span className={research.length ? "has-result" : ""}>{research.length ? `${research[0].target.name} · ${RELATIONS[research[0].relation]}${research.length > 1 ? ` 等 ${research.length} 项` : ""}${researchSuffix}` : stateLabel(links, lastAttemptAt)}</span><ArrowUpRight size={12} /></button>
  </div>;
}

function EntityButton({ entity, onOpenRecord, prefix = "" }: { entity: Entity; onOpenRecord?: Actions["onOpenRecord"]; prefix?: string }) {
  return <button type="button" className="uw-context-entity" disabled={!onOpenRecord} onClick={() => onOpenRecord?.(entity.type, entity.id)} aria-label={`打开${entity.type === "project" ? "项目" : "人脉"}档案 ${entity.name}`}>{prefix && <span>{prefix}</span>}<strong>{entity.name}</strong><ArrowUpRight size={13} /></button>;
}

function EvidenceList({ evidence, onOpenRecord, onOpenUrl }: { evidence: Evidence[] } & Actions) {
  if (!evidence.length) return <p className="uw-context-no-evidence">依据尚待补充。</p>;
  return <details className="uw-context-evidence"><summary><BookOpen size={12} />查看依据<span>{evidence.length}</span><ChevronDown size={13} /></summary><div>{evidence.map((item, index) => <div className="uw-context-evidence-item" key={`${item.kind}-${index}`}>{item.kind === "library" ? <EntityButton entity={item.entity} onOpenRecord={onOpenRecord} prefix={item.entity.type === "person" ? "人脉档案" : "项目档案"} /> : <button type="button" className="uw-context-web-link" onClick={() => onOpenUrl(item.url)}><span>公开来源</span>{hostLabel(item.url)}<ArrowUpRight size={13} /></button>}<blockquote>{item.quote}</blockquote>{item.kind === "library" && item.documentPath && <small>依据来自关联档案材料</small>}</div>)}</div></details>;
}

function ContextEmpty({ result, note, kind, lastAttemptAt }: { result?: ContextState; note?: string; kind: "contact" | "research"; lastAttemptAt?: number }) {
  const historical = isHistorical(result, lastAttemptAt);
  return <div className="uw-context-empty"><span>{stateLabel(result, lastAttemptAt)}</span><p>{result?.status === "not_found" ? historical ? "保留上次检查结论，本轮尚未完成复核。" : kind === "contact" ? "本轮未找到有依据的联系路径。" : "本轮未找到具体的已有项目或方向关联。" : result?.status === "pending" ? kind === "contact" ? "项目库、人脉库的联系路径检查尚未完成。" : "与已有项目和研究方向的关联检查尚未完成。" : kind === "contact" ? "尚未完成项目库、人脉库的联系路径检查。" : "尚未检查与已有项目和研究方向的具体关系。"}</p>{note && <small>{note}</small>}</div>;
}

export default function SourcingLibraryContext({ candidate, lastAttemptAt, onOpenRecord, onOpenUrl }: { candidate: SourcingCandidate; lastAttemptAt?: number } & Actions) {
  const paths = candidate.contactPaths;
  const links = candidate.researchLinks;
  const contacts = paths && paths.status !== "not_found" ? paths.items : [];
  const research = links && links.status !== "not_found" ? links.items : [];
  return <>
    <section className="uw-context-section" aria-labelledby="uw-contact-paths-title"><h3 id="uw-contact-paths-title"><Users size={14} />可以通过谁联系{contacts.length > 0 && <span>{contacts.length} 条线索</span>}</h3>
      {contacts.length ? <>{(isHistorical(paths, lastAttemptAt) || paths?.status === "pending") && <div className="uw-context-history">{paths?.status === "pending" ? "联系路径检查未完成，以下为目前已有的线索。" : "以下为上次检查的联系线索，本轮待复核。"}</div>}<p className="uw-context-section-note">以下是可先询问的路径，关系与引荐意愿仍需确认。</p><div className="uw-context-card-list">{contacts.map((item, index) => <article className="uw-contact-card" key={`${item.via.type}-${item.via.id}-${index}`}>
        <div className={`uw-contact-basis is-${item.basis}`}><Link2 size={11} />{item.basis === "library_record" ? "有库内关系依据" : "公开关系待确认"}</div>
        <EntityButton entity={item.via} onOpenRecord={onOpenRecord} prefix="可先询问" />
        {item.chain.length > 0 && <div className="uw-contact-chain">{item.chain.map((step, stepIndex) => <span key={`${stepIndex}-${step}`}>{stepIndex > 0 && <ArrowRight size={11} />}{step}</span>)}</div>}
        <p className="uw-context-reason">{item.reason}</p>
        {item.nextStep && <div className="uw-contact-next"><span>建议下一步</span><p>{item.nextStep}</p></div>}
        <EvidenceList evidence={item.evidence} onOpenRecord={onOpenRecord} onOpenUrl={onOpenUrl} />
      </article>)}</div>{paths?.note && <p className="uw-context-footnote">{paths.note}</p>}</> : <ContextEmpty kind="contact" result={paths} lastAttemptAt={lastAttemptAt} note={paths?.note} />}{checkedTime(paths?.checkedAt)}
    </section>
    <section className="uw-context-section" aria-labelledby="uw-research-links-title"><h3 id="uw-research-links-title"><GitBranch size={14} />与已有项目和方向的关联{research.length > 0 && <span>{research.length} 项</span>}</h3>
      {research.length ? <>{(isHistorical(links, lastAttemptAt) || links?.status === "pending") && <div className="uw-context-history">{links?.status === "pending" ? "项目与方向的关联检查未完成，以下为目前已有的对照。" : "以下为上次检查的项目与方向关联，本轮待复核。"}</div>}<div className="uw-context-card-list">{research.map((item, index) => <article className="uw-research-card" key={`${item.target.type}-${item.target.id}-${index}`}><div className="uw-research-card-heading"><span>{RELATIONS[item.relation]}</span><EntityButton entity={item.target} onOpenRecord={onOpenRecord} /></div><div className="uw-research-comparison"><div><span>关联点</span><p>{item.reason}</p></div><div><span>不同点</span><p>{item.difference || "差异尚待核验。"}</p></div></div><EvidenceList evidence={item.evidence} onOpenRecord={onOpenRecord} onOpenUrl={onOpenUrl} /></article>)}</div>{links?.note && <p className="uw-context-footnote">{links.note}</p>}</> : <ContextEmpty kind="research" result={links} lastAttemptAt={lastAttemptAt} note={links?.note} />}{checkedTime(links?.checkedAt)}
    </section>
  </>;
}
