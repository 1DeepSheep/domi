import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { workbench } from "./bridge";
import type { DomiNewsItem, IndustryOverviewEntry, MarkdownDocument } from "./env";

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

type BoardRoute = { entry: IndustryOverviewEntry | null; detailPath?: string };
const HOME: BoardRoute = { entry: null };
const routeKey = (route: BoardRoute) => route.detailPath || route.entry?.path || "home";

export function industryNews(items: DomiNewsItem[], entry?: IndustryOverviewEntry | null, now = Date.now()) {
  const since = now - 30 * 24 * 60 * 60 * 1000;
  return [...new Map(items.map(item => [item.recordId, item])).values()]
    .filter(item => item.worthFollowing !== false && Number.isFinite(item.publishedAt) && Number(item.publishedAt) >= since
      && Number(item.publishedAt) <= now
      && (!entry || (item.domains?.includes(entry.domain)
        && (!entry.subdomain || item.subdomains?.includes(entry.subdomain)))))
    .sort((a, b) => Number(b.publishedAt) - Number(a.publishedAt));
}

const newsDate = (value: number | null) => value ? new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
}).format(value) : "日期待核";

export default function IndustryOverview({ refreshKey, news = [], onOpenAttachment }: {
  refreshKey: number;
  news?: DomiNewsItem[];
  onOpenAttachment: (path: string) => void;
}) {
  const [entries, setEntries] = useState<IndustryOverviewEntry[]>([]);
  const [projectCount, setProjectCount] = useState<number>();
  const [route, setRoute] = useState<BoardRoute>(HOME);
  const [page, setPage] = useState<MarkdownDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const routeRef = useRef<BoardRoute>(HOME);
  const requestRef = useRef(0);
  const catalogRequestRef = useRef(0);
  const readerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(new Map<string, number>());
  const failedRouteRef = useRef<BoardRoute | null>(null);

  function rememberScroll() {
    scrollRef.current.set(routeKey(routeRef.current), readerRef.current?.scrollTop || 0);
  }
  function showRoute(next: BoardRoute, document: MarkdownDocument | null) {
    routeRef.current = next;
    setRoute(next);
    setPage(document);
    requestAnimationFrame(() => {
      if (readerRef.current) readerRef.current.scrollTop = scrollRef.current.get(routeKey(next)) || 0;
    });
  }
  async function readRoute(next: BoardRoute) {
    const request = ++requestRef.current;
    failedRouteRef.current = null;
    setError("");
    if (!next.entry) { showRoute(HOME, null); setLoading(false); return; }
    setLoading(true);
    // Keep the industry breadcrumb available even if its document cannot be read.
    // Failed company/material reads retain the last readable page instead.
    if (!next.detailPath) showRoute(next, null);
    try {
      const result = await workbench.readMarkdown({ resource: next.detailPath || next.entry.path });
      if (request !== requestRef.current) return;
      if (!result.ok || !result.document) throw new Error(result.error || "无法读取文档。");
      showRoute(next, result.document);
    } catch (cause) {
      if (request === requestRef.current) {
        failedRouteRef.current = next;
        setError(cause instanceof Error ? cause.message : "无法读取文档。");
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }
  function navigate(next: BoardRoute) { rememberScroll(); void readRoute(next); }

  useEffect(() => {
    const request = ++catalogRequestRef.current;
    const pageRequestAtStart = requestRef.current;
    let disposed = false;
    rememberScroll();
    setLoading(true);
    setError("");
    failedRouteRef.current = null;
    void (async () => {
      try {
        const result = await workbench.refreshIndustryOverviews();
        if (disposed || request !== catalogRequestRef.current) return;
        if (!result.ok && !result.entries?.length) throw new Error(result.error || "行业看板暂时无法刷新。");
        const available = result.entries || [];
        setEntries(available);
        setProjectCount(result.projectCount);
        const messages = [];
        if (result.conflicts?.length) messages.push(`${result.conflicts.length} 页有人工修改，已保留，待合并后再更新。`);
        setNotice(messages.join(" "));
        // A fresh visit always starts at the all-industry board. Refresh only
        // preserves a route chosen during this visit, never the old dropdown preference.
        if (requestRef.current !== pageRequestAtStart) return;
        const current = routeRef.current;
        const entry = available.find(item => item.path === current.entry?.path);
        await readRoute(entry ? { ...current, entry } : HOME);
      } catch (cause) {
        if (disposed || request !== catalogRequestRef.current) return;
        setError(cause instanceof Error ? cause.message : "行业看板暂时无法刷新。");
        setLoading(false);
      }
    })();
    return () => { disposed = true; catalogRequestRef.current += 1; requestRef.current += 1; };
  }, [refreshKey, retryKey]);

  const entry = route.entry;
  const isDetail = Boolean(route.detailPath);
  const parent = entry?.subdomain ? entries.find(item => item.domain === entry.domain && !item.subdomain) : null;
  const domains = entries.filter(item => !item.subdomain);
  const children = entry ? entries.filter(item => item.domain === entry.domain && item.subdomain) : [];
  const recentNews = useMemo(() => industryNews(news, entry), [news, entry]);
  const body = (page?.content || "").replace(/^\uFEFF?(?:<!-- domi:managed:start -->\r?\n)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const industryBody = isDetail ? body : body.replace(/^\s*# [^\n]*(?:行业速览|行业看板)\s*\n/, "");
  const projectHeading = /^## 项目(?:对比|对照)\s*$/m.exec(industryBody);

  function markdown(content: string) {
    return <ReactMarkdown remarkPlugins={[remarkGfm, remarkSafeLineBreaks]} skipHtml
      urlTransform={(url) => url === "domi-folder:current" ? url : defaultUrlTransform(url)}
      components={{
        h2: ({ node, children }) => <>
          {!isDetail && node?.children.some(child => child.type === "text" && /^项目(?:对比|对照)$/.test(child.value)) && renderNews()}
          <h2>{children}</h2>
        </>,
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
            const targetEntry = entries.find(item => item.path === target);
            navigate(targetEntry ? { entry: targetEntry } : { entry, detailPath: target });
          } else if (/\.pdf$/i.test(target)) onOpenAttachment(target);
          else void workbench.openResource(target);
        }}>{children}</a>
      }}>{content}</ReactMarkdown>;
  }

  function renderNews() {
    return <section className="industry-board-news" aria-label="近期行业动态">
      <div className="industry-board-section-heading"><h2>近期动态</h2><span>已归档 · 最近 30 天</span></div>
      {recentNews.length ? <ul>{recentNews.slice(0, 4).map(item => <li key={item.recordId}>
        <div><time>{newsDate(item.publishedAt)}</time><span>{item.source || "来源待补"}</span></div>
        {/^https?:\/\//i.test(item.url) ? <a href={item.url} onClick={event => { event.preventDefault(); void workbench.openResource(item.url); }}>
          {item.title}<ArrowUpRight size={14} aria-hidden="true" />
        </a> : <strong>{item.title}</strong>}
      </li>)}</ul> : <p className="industry-board-empty">当前资料库暂无{entry ? "该行业的" : ""}近 30 天动态。</p>}
    </section>;
  }

  const homeButton = <button type="button" aria-current={!entry ? "page" : undefined} onClick={() => navigate(HOME)}>全行业总览</button>;

  return <section className="industry-overview-workspace" aria-label="行业看板">
    <div className={`industry-overview-toolbar${!entry ? " industry-board-home-toolbar" : ""}`}>
      <nav aria-label="行业浏览路径" className="industry-board-breadcrumb">
        {!entry ? <h1>{homeButton}</h1> : homeButton}
        {entry && <><ChevronRight size={14} aria-hidden="true" />
          <button type="button" aria-current={!entry.subdomain && !isDetail ? "page" : undefined}
            onClick={() => navigate({ entry: parent || entry })}>{entry.domain || "未分类"}</button></>}
        {entry?.subdomain && <><ChevronRight size={14} aria-hidden="true" />
          <button type="button" aria-current={!isDetail ? "page" : undefined} onClick={() => navigate({ entry })}>{entry.subdomain}</button></>}
        {isDetail && <><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">项目资料</span></>}
      </nav>
      {!entry && <div className="industry-board-stats"><span><strong>{domains.length}</strong> 个行业</span>
        <span><strong>{entries.filter(item => item.subdomain).length}</strong> 个子行业</span>
        {projectCount !== undefined && <span><strong>{projectCount}</strong> 个入库项目</span>}
      </div>}
      {loading && <span role="status"><RefreshCw className="spinning" size={14} />正在读取</span>}
    </div>
    {error && <div className="industry-overview-notice" role="alert">{error} <button type="button" onClick={() => {
      if (failedRouteRef.current) void readRoute(failedRouteRef.current);
      else setRetryKey(value => value + 1);
    }}>重试</button></div>}
    {notice && <div className="industry-overview-notice">{notice}</div>}
    <div className={`industry-overview-reader${!entry ? " industry-board-home" : ""}`} ref={readerRef} aria-busy={loading}>
      {!entry ? <>
        <div className="industry-board-grid">
          {domains.map(domain => {
            const subdomains = entries.filter(item => item.domain === domain.domain && item.subdomain);
            const latest = industryNews(news, domain)[0];
            const directions = subdomains.slice(0, 4).map(item => item.subdomain).join(" · ") || "查看行业概况与项目";
            return <button className="industry-board-card" type="button" key={domain.path}
              aria-label={`查看${domain.domain}行业`} onClick={() => navigate({ entry: domain })}>
              <div className="industry-board-card-title"><h2>{domain.domain || "未分类"}</h2><ChevronRight size={19} aria-hidden="true" /></div>
              <div className="industry-board-card-counts"><span>{domain.projectCount} 个项目</span><span>{subdomains.length} 个子行业</span></div>
              <p title={subdomains.map(item => item.subdomain).join(" · ") || directions}>{directions}{subdomains.length > 4 ? ` 等 ${subdomains.length} 个方向` : ""}</p>
              {latest && <div className="industry-board-card-news"><small title={latest.source || "已归档动态"}>{newsDate(latest.publishedAt)} · {latest.source || "已归档动态"}</small><span title={latest.title}>{latest.title}</span></div>}
            </button>;
          })}
        </div>
        {!loading && !entries.length && !error && <p className="industry-board-empty">当前资料库尚无行业资料。</p>}
        {renderNews()}
      </> : isDetail ? <>
        <button className="industry-board-back" type="button" onClick={() => navigate({ entry })}><ChevronLeft size={16} />返回{entry.subdomain || entry.domain}</button>
        {markdown(body)}
      </> : <>
        <header className="industry-board-heading"><h1>{entry.subdomain || entry.domain}行业概况</h1>
          <p>本库收录 {entry.projectCount} 个项目{!entry.subdomain && children.length ? ` · ${children.length} 个子行业` : ""}</p>
        </header>
        {!entry.subdomain && children.length > 0 && <section className="industry-board-subdomains" aria-label="细分行业">
          <h2>细分行业</h2><div>{children.map(child => <button type="button" key={child.path}
            aria-label={`查看${child.subdomain}行业`} onClick={() => navigate({ entry: child })}>
            <span>{child.subdomain}</span><small>{child.projectCount} 个项目</small><ChevronRight size={14} aria-hidden="true" />
          </button>)}</div>
        </section>}
        {page && <>{markdown(industryBody)}{!projectHeading && renderNews()}</>}
      </>}
    </div>
  </section>;
}
