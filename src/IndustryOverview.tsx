import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { workbench } from "./bridge";
import { getIndustryOverviewSnapshot, requestIndustryOverview } from "./industry-overview-cache";
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

const newsDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
});
const newsDate = (value: number | null) => value ? newsDateFormatter.format(value) : "日期待核";
const EMPTY_NEWS: DomiNewsItem[] = [];
const EMPTY_ENTRIES: IndustryOverviewEntry[] = [];
const markdownPlugins = [remarkGfm, remarkSafeLineBreaks];

// Parse one document only when its content/navigation context changes. Progress
// ticks and unrelated task updates must not repeatedly parse a large table.
const IndustryMarkdown = memo(function IndustryMarkdown({ content, isDetail, news, onLink }: {
  content: string; isDetail: boolean; news: ReactNode;
  onLink: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const components = useMemo<Components>(() => ({
    h2: ({ node, children }) => <>
      {!isDetail && node?.children.some(child => child.type === "text" && /^项目(?:对比|对照)$/.test(child.value)) && news}
      <h2>{children}</h2>
    </>,
    table: ({ children }) => <div className="industry-overview-table"><table>{children}</table></div>,
    a: ({ href = "", children }) => <a href={href} onClick={event => onLink(event, href)}>{children}</a>
  }), [isDetail, news, onLink]);
  return <ReactMarkdown remarkPlugins={markdownPlugins} skipHtml
    urlTransform={url => url === "domi-folder:current" ? url : defaultUrlTransform(url)}
    components={components}>{content}</ReactMarkdown>;
});

function IndustryOverview({ cacheKey, refreshKey, onOpenAttachment }: {
  cacheKey: string;
  refreshKey: number;
  onOpenAttachment: (path: string) => void;
}) {
  const initialCatalog = useRef(getIndustryOverviewSnapshot(cacheKey));
  const [entries, setEntries] = useState<IndustryOverviewEntry[]>(() => initialCatalog.current?.result.entries || []);
  const [projectCount, setProjectCount] = useState<number | undefined>(() => initialCatalog.current?.result.projectCount);
  const [catalogNews, setCatalogNews] = useState<DomiNewsItem[] | undefined>(() => initialCatalog.current?.result.news);
  const [hasCatalog, setHasCatalog] = useState(Boolean(initialCatalog.current));
  const [catalogLoading, setCatalogLoading] = useState(!initialCatalog.current);
  const [catalogError, setCatalogError] = useState("");
  const [route, setRoute] = useState<BoardRoute>(HOME);
  const [page, setPage] = useState<MarkdownDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => initialCatalog.current?.result.conflicts?.length
    ? `${initialCatalog.current.result.conflicts.length} 页有人工修改，已保留，待合并后再更新。` : "");
  const [retryKey, setRetryKey] = useState(0);
  const routeRef = useRef<BoardRoute>(HOME);
  const requestRef = useRef(0);
  const lastRefreshRef = useRef(refreshKey);
  const readerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(new Map<string, number>());
  const failedRouteRef = useRef<BoardRoute | null>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const rememberScroll = useCallback(() => {
    scrollRef.current.set(routeKey(routeRef.current), readerRef.current?.scrollTop || 0);
  }, []);
  const showRoute = useCallback((next: BoardRoute, document: MarkdownDocument | null) => {
    routeRef.current = next;
    setRoute(next);
    setPage(document);
    requestAnimationFrame(() => {
      if (readerRef.current) readerRef.current.scrollTop = scrollRef.current.get(routeKey(next)) || 0;
    });
  }, []);
  const readRoute = useCallback(async (next: BoardRoute, retainDocument = false) => {
    const request = ++requestRef.current;
    failedRouteRef.current = null;
    setError("");
    if (!next.entry) { showRoute(HOME, null); setLoading(false); return; }
    setLoading(true);
    // Keep the industry breadcrumb available even if its document cannot be read.
    // Failed company/material reads retain the last readable page instead.
    if (!next.detailPath && !retainDocument) showRoute(next, null);
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
  }, [showRoute]);
  const navigate = useCallback((next: BoardRoute) => { rememberScroll(); void readRoute(next); }, [rememberScroll, readRoute]);

  useEffect(() => {
    const snapshot = getIndustryOverviewSnapshot(cacheKey);
    const force = retryKey > 0 || lastRefreshRef.current !== refreshKey || Boolean(snapshot && snapshot.refreshKey !== refreshKey);
    lastRefreshRef.current = refreshKey;
    const pageRequestAtStart = requestRef.current;
    let disposed = false;
    rememberScroll();
    setCatalogLoading(true);
    setCatalogError("");
    const request = requestIndustryOverview(cacheKey, refreshKey, force, workbench.refreshIndustryOverviews);
    const applyCatalog = (result: import("./env").IndustryOverviewResult) => {
      setEntries(result.entries || []);
      setProjectCount(result.projectCount);
      setCatalogNews(result.news);
      setHasCatalog(true);
      setNotice(result.conflicts?.length ? `${result.conflicts.length} 页有人工修改，已保留，待合并后再更新。` : "");
    };
    void request.cached.then(cached => { if (cached && !disposed) applyCatalog(cached.result); });
    void (async () => {
      try {
        const fresh = await request.result;
        if (!fresh || disposed) return;
        const result = fresh.result;
        const available = result.entries || [];
        applyCatalog(result);
        // Background catalog validation must not start a competing document
        // read or replace navigation the user performed while it was pending.
        if (!force || requestRef.current !== pageRequestAtStart) return;
        const current = routeRef.current;
        const entry = available.find(item => item.path === current.entry?.path);
        await readRoute(entry ? { ...current, entry } : HOME, true);
      } catch (cause) {
        if (disposed) return;
        setCatalogError(cause instanceof Error ? cause.message : "行业看板暂时无法刷新。");
      } finally {
        if (!disposed) setCatalogLoading(false);
      }
    })();
    return () => { disposed = true; };
  }, [cacheKey, refreshKey, retryKey]);

  useEffect(() => () => { requestRef.current += 1; }, []);

  const news = catalogNews ?? EMPTY_NEWS;
  const entry = route.entry;
  const isDetail = Boolean(route.detailPath);
  const catalog = useMemo(() => {
    const domains: IndustryOverviewEntry[] = [];
    const domainByName = new Map<string, IndustryOverviewEntry>();
    const childrenByDomain = new Map<string, IndustryOverviewEntry[]>();
    const entryByPath = new Map<string, IndustryOverviewEntry>();
    for (const item of entries) {
      entryByPath.set(item.path, item);
      if (!item.subdomain) { domains.push(item); domainByName.set(item.domain, item); }
      else {
        const children = childrenByDomain.get(item.domain) || [];
        children.push(item); childrenByDomain.set(item.domain, children);
      }
    }
    return { domains, domainByName, childrenByDomain, entryByPath };
  }, [entries]);
  const { domains } = catalog;
  const parent = entry?.subdomain ? catalog.domainByName.get(entry.domain) : null;
  const children = entry ? catalog.childrenByDomain.get(entry.domain) || EMPTY_ENTRIES : EMPTY_ENTRIES;
  const newsIndex = useMemo(() => {
    const recent = industryNews(news);
    const byDomain = new Map<string, DomiNewsItem[]>();
    // Deduplicate/filter/sort once for the whole catalog, not once per card and
    // again for each route. Each domain list keeps the same chronological order.
    for (const item of recent) for (const domain of new Set(item.domains)) {
      const items = byDomain.get(domain) || [];
      items.push(item); byDomain.set(domain, items);
    }
    return { recent, byDomain };
  }, [news]);
  const recentNews = useMemo(() => {
    if (!entry) return newsIndex.recent;
    const items = newsIndex.byDomain.get(entry.domain) || EMPTY_NEWS;
    return entry.subdomain ? items.filter(item => item.subdomains?.includes(entry.subdomain!)) : items;
  }, [newsIndex, entry]);
  const body = useMemo(() => (page?.content || "").replace(/^\uFEFF?(?:<!-- domi:managed:start -->\r?\n)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""), [page?.content]);
  const industryBody = useMemo(() => isDetail ? body : body.replace(/^\s*# [^\n]*(?:行业速览|行业看板)\s*\n/, ""), [body, isDetail]);
  const projectHeading = useMemo(() => /^## 项目(?:对比|对照)\s*$/m.test(industryBody), [industryBody]);
  const pagePath = page?.path;
  const onMarkdownLink = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith("#")) return;
    event.preventDefault();
    if (!pagePath || loadingRef.current) return;
    if (/^https?:\/\//i.test(href)) { void workbench.openResource(href); return; }
    if (href === "domi-folder:current") {
      void workbench.openResource(pagePath.slice(0, pagePath.lastIndexOf("/"))); return;
    }
    const target = localMarkdownTarget(href, pagePath);
    if (!target) return;
    if (/\.(?:md|markdown)$/i.test(target)) {
      const targetEntry = catalog.entryByPath.get(target);
      navigate(targetEntry ? { entry: targetEntry } : { entry, detailPath: target });
    } else if (/\.pdf$/i.test(target)) onOpenAttachment(target);
    else void workbench.openResource(target);
  }, [pagePath, catalog.entryByPath, entry, navigate, onOpenAttachment]);

  const newsView = useMemo(() => <section className="industry-board-news" aria-label="近期行业动态">
      <div className="industry-board-section-heading"><h2>近期动态</h2><span>已归档 · 最近 30 天</span></div>
      {recentNews.length ? <ul>{recentNews.slice(0, 4).map(item => <li key={item.recordId}>
        <div><time>{newsDate(item.publishedAt)}</time><span>{item.source || "来源待补"}</span></div>
        {/^https?:\/\//i.test(item.url) ? <a href={item.url} onClick={event => { event.preventDefault(); void workbench.openResource(item.url); }}>
          {item.title}<ArrowUpRight size={14} aria-hidden="true" />
        </a> : <strong>{item.title}</strong>}
      </li>)}</ul> : <p className="industry-board-empty">当前资料库暂无{entry ? "该行业的" : ""}近 30 天动态。</p>}
    </section>, [recentNews, Boolean(entry)]);

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
        <span><strong>{entries.length - domains.length}</strong> 个子行业</span>
        {projectCount !== undefined && <span><strong>{projectCount}</strong> 个入库项目</span>}
      </div>}
      {(loading || catalogLoading) && <span role="status"><RefreshCw className="spinning" size={14} />{loading || !hasCatalog ? "正在读取" : "后台更新中"}</span>}
    </div>
    {error && <div className="industry-overview-notice" role="alert">{error} <button type="button" onClick={() => {
      if (failedRouteRef.current) void readRoute(failedRouteRef.current);
    }}>重试</button></div>}
    {catalogError && <div className="industry-overview-notice" role="alert">{catalogError}{hasCatalog ? "，已保留上次内容。" : ""} <button type="button" onClick={() => setRetryKey(value => value + 1)}>重试</button></div>}
    {notice && <div className="industry-overview-notice">{notice}</div>}
    <div className={`industry-overview-reader${!entry ? " industry-board-home" : ""}`} ref={readerRef} aria-busy={loading || (catalogLoading && !hasCatalog)}>
      {!entry ? <>
        <div className="industry-board-grid">
          {domains.map(domain => {
            const subdomains = catalog.childrenByDomain.get(domain.domain) || EMPTY_ENTRIES;
            const latest = newsIndex.byDomain.get(domain.domain)?.[0];
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
        {hasCatalog && !entries.length && <p className="industry-board-empty">当前资料库尚无行业资料。</p>}
        {newsView}
      </> : isDetail ? <>
        <button className="industry-board-back" type="button" onClick={() => navigate({ entry })}><ChevronLeft size={16} />返回{entry.subdomain || entry.domain}</button>
        <IndustryMarkdown content={body} isDetail={isDetail} news={newsView} onLink={onMarkdownLink} />
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
        {page && <><IndustryMarkdown content={industryBody} isDetail={isDetail} news={newsView} onLink={onMarkdownLink} />{!projectHeading && newsView}</>}
      </>}
    </div>
  </section>;
}

export default memo(IndustryOverview);
