import { useState } from "react";
import { ArrowRight, AudioLines, CheckCircle2, ChevronRight, FileText, Paperclip, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import type { LocalAttachment } from "../env";
import { filesFromClipboardData, filePathsFromClipboardData } from "../clipboard-files";

export type PlaudContextDraft = {
  conversationType: string;
  projectName: string;
  participants: string;
  extraContext: string;
};

export type PlaudRecall = {
  summary?: string;
  keywords?: string[];
  excerpts?: string[];
  source?: "cache" | "extract" | "model";
};

export default function PlaudContextCard({
  fileName, createdAt, duration, draft, recall, preparing, summarizing, submitting,
  confirmed, advanced, resumableAdvanced, running, error, canSubmit, scopeRecovery, canRecoverScope, onRecoverScope, onChange, onSubmit, onRetry,
  attachments = [], importingAttachments = false, attachmentError, onAddAttachments, onDropAttachments, onPasteAttachments, onRemoveAttachment
}: {
  fileName: string;
  createdAt: number | null;
  duration: number | null;
  draft: PlaudContextDraft;
  recall?: PlaudRecall;
  preparing: boolean;
  summarizing: boolean;
  submitting: boolean;
  confirmed: boolean;
  advanced: boolean;
  resumableAdvanced: boolean;
  running: boolean;
  error?: string;
  canSubmit: boolean;
  scopeRecovery: boolean;
  canRecoverScope: boolean;
  onRecoverScope: () => void;
  onChange: (draft: PlaudContextDraft) => void;
  onSubmit: (skip: boolean) => void;
  onRetry: () => void;
  attachments?: LocalAttachment[];
  importingAttachments?: boolean;
  attachmentError?: string;
  onAddAttachments: () => void;
  onDropAttachments: (files: File[]) => void;
  onPasteAttachments: (files: File[], paths: string[]) => void;
  onRemoveAttachment: (path: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const minutes = duration ? Math.max(1, Math.round(duration / 60_000)) : null;
  const date = createdAt ? new Date(createdAt < 1e12 ? createdAt * 1000 : createdAt) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
    : "";
  const meta = [dateLabel, minutes ? `${minutes} 分钟` : ""].filter(Boolean).join(" · ");
  const disabled = submitting || confirmed || advanced || running || scopeRecovery;
  const materialsDisabled = disabled || importingAttachments;
  const submitDisabled = !canSubmit || submitting || running || importingAttachments;
  const summary = recall?.summary?.trim();
  const excerpts = (recall?.excerpts || []).filter(Boolean);
  const change = (field: keyof PlaudContextDraft, value: string) => onChange({ ...draft, [field]: value });
  return (
    <section className="plaud-context" aria-label="会议背景确认" onPaste={event => {
      const files = filesFromClipboardData(event.clipboardData);
      const paths = files.length ? [] : filePathsFromClipboardData(event.clipboardData);
      if (!files.length && !paths.length) return;
      event.preventDefault();
      event.stopPropagation();
      if (!materialsDisabled) onPasteAttachments(files, paths);
    }}>
      <div className="plaud-context-intro">
        <Sparkles size={21} aria-hidden="true" />
        <div><h2>{confirmed ? "会议信息已保存" : "先回忆一下，这场会聊了什么"}</h2>
          <p>{confirmed ? "将结合完整文字稿整理纪要，并检查重要信息是否遗漏。" : "看看文字稿里的线索，再补充你记得的信息。"}</p>
        </div>
      </div>
      <div className="plaud-context-card">
        <div className="plaud-context-recall">
          <div className="plaud-context-recall-meta"><span><AudioLines size={14} aria-hidden="true" />这段录音</span><span>{meta}</span></div>
          <h3>{fileName}</h3>
          {summary ? <p className="plaud-context-summary">{summary}</p> : excerpts.length ?
            <p className="plaud-context-summary">{excerpts[0]}</p> :
            <p className="plaud-context-pending">{preparing ? "正在读取文字稿线索，你可以先填写下面的信息。" : "暂时没有可用的文字稿片段，可以先填写会议信息。"}</p>}
          {!!recall?.keywords?.length && <div className="plaud-context-keywords"><span>录音关键词</span><span>{recall.keywords.join(" · ")}</span></div>}
          {excerpts.length > 0 && <details className="plaud-context-excerpts"><summary>查看文字稿片段<ChevronRight size={13} aria-hidden="true" /></summary>
            <div>{excerpts.map((excerpt, index) => <blockquote key={index}>{excerpt}</blockquote>)}</div>
          </details>}
          {summarizing && <p className="plaud-context-refining" role="status"><RefreshCw size={12} className="spinning" aria-hidden="true" />正在补充回忆提示，不影响填写</p>}
        </div>
        {advanced ? <>
          <div className="plaud-context-saved"><CheckCircle2 size={18} /><div><strong>{resumableAdvanced ? "沿用已有纪要，继续后续处理" : "这条录音已处理完成"}</strong><p>{resumableAdvanced ? "会议信息和已完成的步骤已保留，将从当前进度继续。" : "已有结果已保留，请查看本任务中的纪要和归档结果。"}</p></div></div>
          {error && <div className="plaud-context-error" role="alert">{error}</div>}
          {resumableAdvanced && <div className="plaud-context-actions"><span className="plaud-context-confirmed">已有内容不会重复生成</span><button type="button" className="plaud-context-submit" disabled={!canSubmit || submitting || running} onClick={() => onSubmit(false)}>{submitting || running ? <RefreshCw size={15} className="spinning" aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}{submitting || running ? "正在继续" : "继续后续处理"}</button></div>}
        </> :
          <form onSubmit={event => { event.preventDefault(); if (!submitDisabled) onSubmit(false); }}>
            <div className="plaud-context-fields">
              <div className="plaud-context-field-row">
                <label><span>会议类型 <small>请确认</small></span><select value={draft.conversationType} disabled={disabled} onChange={event => change("conversationType", event.target.value)}>
                  <option value="">请选择 / 不确定</option><option>创业公司交流</option><option>行业专家访谈</option><option>投资同业交流</option><option>内部讨论</option><option>其他</option>
                  {draft.conversationType && !["创业公司交流", "行业专家访谈", "投资同业交流", "内部讨论", "其他"].includes(draft.conversationType) && <option>{draft.conversationType}</option>}
                </select></label>
                <label><span>项目名称 <small>选填</small></span><input value={draft.projectName} disabled={disabled} maxLength={200} onChange={event => change("projectName", event.target.value)} placeholder="填写项目简称" autoComplete="off" /></label>
              </div>
              <label><span>参会者 <small>姓名、公司或职位</small></span><textarea value={draft.participants} disabled={disabled} maxLength={6000} onChange={event => change("participants", event.target.value)} placeholder="例如：项目方创始人、我和同事；也可以直接粘贴名单" rows={3} />
                <small className="plaud-context-field-help">知道多少填多少；文字稿中被提到的人不一定是参会者。</small>
              </label>
              <div className="plaud-context-materials" role="group" aria-label="公司材料 / BP" tabIndex={materialsDisabled ? -1 : 0}
                onClick={event => { if (!(event.target as HTMLElement).closest("button")) event.currentTarget.focus(); }}>
                <div className="plaud-context-materials-heading"><span>公司材料 / BP <small>选填</small></span><span>{attachments.length ? `${attachments.length} 份材料` : ""}</span></div>
                {!confirmed && <button type="button" className={`plaud-context-materials-drop${dragging && !materialsDisabled ? " is-dragging" : ""}`}
                  disabled={materialsDisabled} onClick={onAddAttachments}
                  onDragOver={event => { event.preventDefault(); event.stopPropagation(); if (!materialsDisabled && event.dataTransfer.types.includes("Files")) { event.dataTransfer.dropEffect = "copy"; setDragging(true); } }}
                  onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
                  onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); if (!materialsDisabled) onDropAttachments(Array.from(event.dataTransfer.files)); }}>
                  {importingAttachments ? <RefreshCw size={18} className="spinning" aria-hidden="true" /> : <Paperclip size={18} aria-hidden="true" />}
                  <span>{importingAttachments ? "正在添加材料…" : "添加公司材料或 BP"}<small>支持拖入或 ⌘V 粘贴 · PDF、PPT、Word、Excel、图片等</small></span>
                  {!importingAttachments && <Plus size={16} aria-hidden="true" />}
                </button>}
                {attachments.length > 0 && <ul className="plaud-context-materials-list">{attachments.map(file => <li key={file.path}>
                  <FileText size={16} aria-hidden="true" /><span title={file.name}>{file.name}</span>
                  <small>{file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.size / 1024))} KB`}</small>
                  {!confirmed && <button type="button" disabled={materialsDisabled} aria-label={`移除材料 ${file.name}`} onClick={() => onRemoveAttachment(file.path)}><X size={14} aria-hidden="true" /></button>}
                </li>)}</ul>}
                <p className="plaud-context-field-help">结合材料核对公司、产品和关键数字；纪要以本次讨论为主。</p>
                {attachmentError && <p className="plaud-context-materials-error" role="alert">{attachmentError}</p>}
              </div>
              <details className="plaud-context-extra" open={draft.extraContext ? true : undefined}>
                <summary><Plus size={13} aria-hidden="true" />补充背景或纠正上面的内容</summary>
                <textarea aria-label="补充背景" value={draft.extraContext} disabled={disabled} maxLength={6000} onChange={event => change("extraContext", event.target.value)} placeholder="例如：这是第二次交流，主要讨论客户进展。" rows={3} />
              </details>
            </div>
            {scopeRecovery && <div className="plaud-context-scope" role="status"><strong>PLAUD 连接已更新</strong><p>当前账号已核对同一条录音和文字稿。确认后可沿用已填写的信息和处理进度；纪要任务不会自动启动。</p><button type="button" disabled={!canRecoverScope || submitting || preparing || running} onClick={onRecoverScope}>{submitting ? "正在核对" : "确认沿用已填信息"}</button></div>}
            {error && <div className="plaud-context-error" role="alert"><span>{error}</span>{!canSubmit && <button type="button" disabled={preparing || submitting} onClick={onRetry}>重新读取</button>}</div>}
            <div className="plaud-context-actions">
              {confirmed ? <span className="plaud-context-confirmed"><CheckCircle2 size={15} />背景已保存，不会重复询问</span> :
                <button type="button" className="plaud-context-skip" disabled={submitDisabled} onClick={() => onSubmit(true)}>{attachments.length ? "按已有信息处理" : "暂不补充，直接处理"}</button>}
              <button type="submit" className="plaud-context-submit" disabled={submitDisabled}>
                {submitting || running ? <RefreshCw size={15} className="spinning" aria-hidden="true" /> : null}
                {running ? "纪要正在生成" : submitting ? "正在启动" : confirmed ? "继续生成纪要" : "确认并生成纪要"}
                {!submitting && !running && <ArrowRight size={15} aria-hidden="true" />}
              </button>
            </div>
          </form>}
      </div>
      {!confirmed && !advanced && <p className="plaud-context-footer">信息只需确认一次，稍后仍可补充。</p>}
    </section>
  );
}
