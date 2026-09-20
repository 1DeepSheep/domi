import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { workbench } from "./bridge";
import type { IndustryOverviewEntry, MarkdownDocument } from "./env";

function remarkSafeLineBreaks() {
  return (tree: { children?: Array<{ type: string; value?: string; children?: unknown[] }> }) => {
    function visit(node: any) {
      if (!node.children) return;
      for (let i = 0; i < node.children.length; i += 1) {
        const child = node.children[i];
        if (child.type === "html" && /^<br\s*\/?\s*>$/i.test(child.value || "")) node.children[i] = { type: "break" };
        else visit(child);
      }
    }
    visit(tree);
  };
}

const SELECTION_KEY = "domi.industryOverview.selection.v1";

export function localMarkdownTarget(href: string, documentPath: string) {
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return "";
  try {
    const base = new URL("file:///");
    base.pathname = documentPath.split("/").map(encodeURIComponent).join("/");
    const target = new URL(href, base);
    if (target.protocol !== "file:" || target.host) return "";
    return decodeURIComponent(target.pathname);
  } catch { return ""; }
}

export default function IndustryOverview({ refreshKey, onOpenAttachment }: {
  refreshKey: number;
  onOpenAttachment: (path: string) => void;
}) {
  const [entries, setEntries] = useState<IndustryOverviewEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [page, setPage] = useState<MarkdownDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedRef = useRef("");
  const requestRef = useRef(0);
  const readerRef = useRef<HTMLDivElement>(null);
  const overviewScrollRef = useRef(0);

  async function readPage(path: string, returning = false) {
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await workbench.readMarkdown({ resource: path });
      if (request !== requestRef.current) return;
      if (!result.ok || !result.document) throw new Error(result.error || "无法读取文档。");
      setPage(result.document);
      requestAnimationFrame(() => {
        if (readerRef.current) readerRef.current.scrollTop = returning ? overviewScrollRef.current : 0;
      });
    } catch (cause) {
      if (request === requestRef.current) {
        setError(cause instanceof Error ? cause.message : "无法读取文档。");
        if (path === selectedRef.current) setPage(null);
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    const request = ++requestRef.current;
    let disposed = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const result = await workbench.refreshIndustryOverviews();
        if (disposed || request !== requestRef.current) return;
        if (!result.ok && !result.entries?.length) throw new Error(result.error || "行业速览暂时无法刷新。");
        setEntries(result.entries || []);
        const messages = [];
        if (result.conflicts?.length) messages.push(`${result.conflicts.length} 页有人工修改，已保留，待合并后再更新。`);
        if (result.warnings?.length) messages.push("部分资料尚不完整；各行业页已标明缺口。");
        setNotice(messages.join(" "));
        let saved = selectedRef.current;
        try { saved ||= localStorage.getItem(SELECTION_KEY) || ""; } catch { /* optional preference */ }
        const selected = result.entries.find((entry) => entry.path === saved)
          || result.entries.find((entry) => entry.projectCount > 0 && !entry.subdomain)
          || result.entries[0];
        if (!selected) { setPage(null); setLoading(false); return; }
        selectedRef.current = selected.path;
        setSelectedPath(selected.path);
        await readPage(selected.path);
      } catch (cause) {
        if (disposed || request !== requestRef.current) return;
        setError(cause instanceof Error ? cause.message : "行业速览暂时无法刷新。");
        setLoading(false);
      }
    })();
    return () => { disposed = true; requestRef.current += 1; };
  }, [refreshKey]);

  const isDetail = Boolean(page && page.path !== selectedPath);
  const body = (page?.content || "").replace(/^\uFEFF?(?:<!-- domi:managed:start -->\r?\n)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const domains = [...new Set(entries.map((entry) => entry.domain))];
  return <section className="industry-overview-workspace" aria-label="行业速览">
    <div className="industry-overview-toolbar">
      {isDetail ? <button type="button" onClick={() => void readPage(selectedPath, true)}>
        <ChevronLeft size={16} />返回行业速览
      </button> : <label>行业
        <select aria-label="选择行业" value={selectedPath} disabled={loading} onChange={(event) => {
          const path = event.target.value;
          selectedRef.current = path;
          setSelectedPath(path);
          overviewScrollRef.current = 0;
          try { localStorage.setItem(SELECTION_KEY, path); } catch { /* optional preference */ }
          void readPage(path);
        }}>
          {!entries.length && <option value="">暂无行业资料</option>}
          {domains.map((domain) => <optgroup key={domain} label={domain || "未分类"}>
            {entries.filter((entry) => entry.domain === domain).map((entry) =>
              <option key={entry.path} value={entry.path}>{entry.subdomain || `${entry.domain || "未分类"}总览`} · {entry.projectCount} 项目</option>)}
          </optgroup>)}
        </select>
      </label>}
      {loading && <span role="status"><RefreshCw className="spinning" size={14} />正在读取</span>}
    </div>
    {error && <div className="industry-overview-notice" role="alert">{error}</div>}
    {notice && !isDetail && <div className="industry-overview-notice">{notice}</div>}
    <div className="industry-overview-reader" ref={readerRef} aria-busy={loading}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkSafeLineBreaks]} skipHtml
        urlTransform={(url) => url === "domi-folder:current" ? url : defaultUrlTransform(url)}
        components={{
          table: ({ children }) => <div className="industry-overview-table"><table>{children}</table></div>,
          a: ({ href = "", children }) => <a href={href} onClick={(event) => {
            if (href.startsWith("#")) return;
            event.preventDefault();
            if (!page || loading) return;
            if (/^https?:\/\//i.test(href)) { void workbench.openResource(href); return; }
            if (href === "domi-folder:current") {
              void workbench.openResource(page.path.slice(0, page.path.lastIndexOf("/"))); return;
            }
            const target = localMarkdownTarget(href, page.path);
            if (!target) return;
            if (/\.(?:md|markdown)$/i.test(target)) {
              if (!isDetail) overviewScrollRef.current = readerRef.current?.scrollTop || 0;
              void readPage(target, target === selectedPath);
            } else if (/\.pdf$/i.test(target)) onOpenAttachment(target);
            else void workbench.openResource(target);
          }}>{children}</a>
        }}>{body}</ReactMarkdown>
      {!loading && !page && !error && <p>当前资料库尚无行业速览。</p>}
    </div>
  </section>;
}
