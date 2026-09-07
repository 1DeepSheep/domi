const crypto = require("node:crypto");

const NEWS_DISCOVERY_PREFIX = "radar-feed-v1:";
const MAX_FEED_ITEMS = 1000;

function text(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => {
      const n = /^x/i.test(code) ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    })
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function tag(xml, names) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return text(match[1]);
  }
  return "";
}

function attribute(fragment, key) {
  const match = fragment.match(new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return text(match?.[1] || match?.[2]);
}

// Scan structural XML tags while respecting quoted attributes, comments and
// CDATA. A truncated feed must retain the last snapshot, not become an empty
// successful refresh. Collect entries by their real boundaries, not tag-like
// examples embedded inside a description's CDATA.
function feedItemBlocks(input) {
  const stack = [], blocks = [];
  let cursor = 0, rootCount = 0;
  while (cursor < input.length) {
    const start = input.indexOf("<", cursor);
    if (start < 0) break;
    const marker = input.startsWith("<![CDATA[", start) ? ["<![CDATA[", "]]>"]
      : input.startsWith("<!--", start) ? ["<!--", "-->"]
        : input.startsWith("<?", start) ? ["<?", "?>"] : null;
    if (marker) {
      const end = input.indexOf(marker[1], start + marker[0].length);
      if (end < 0) throw new Error("新闻订阅源 XML 被截断，需搜索补查。");
      cursor = end + marker[1].length; continue;
    }
    let quote = "", end = start + 1;
    for (; end < input.length; end++) {
      const char = input[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
      else if (char === "<") throw new Error("新闻订阅源 XML 标签无效。");
    }
    if (end >= input.length) throw new Error("新闻订阅源 XML 被截断，需搜索补查。");
    const raw = input.slice(start, end + 1);
    const name = raw.match(/^<\/?([A-Za-z_][\w.:-]*)(?:\s|\/?>)/)?.[1];
    if (!name) throw new Error("新闻订阅源 XML 标签无效。");
    if (raw.startsWith("</")) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new Error("新闻订阅源 XML 标签未正确闭合。");
      if (["item", "entry"].includes(name.toLowerCase())) blocks.push(input.slice(open.contentStart, start));
    } else {
      if (!stack.length) {
        rootCount++;
        if (!["rss", "feed", "rdf:rdf"].includes(name.toLowerCase())) throw new Error("该地址不是可直接解析的 RSS/Atom。");
      }
      if (/\/\s*>$/.test(raw)) {
        if (["item", "entry"].includes(name.toLowerCase())) blocks.push("");
      } else stack.push({ name, contentStart: end + 1 });
    }
    cursor = end + 1;
  }
  if (stack.length || rootCount !== 1) throw new Error("新闻订阅源 XML 不完整，需搜索补查。");
  return blocks;
}

// RSS summaries are discovery hints only. Callers must open original sources
// before treating a candidate as evidence or recording a verified event.
function parseNewsFeed(xml, feedUrl, normalizeUrl) {
  const input = String(xml || "");
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(input)) return null;
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error("新闻订阅源含不支持的 XML 实体声明。");
  const blocks = feedItemBlocks(input);
  const byUrl = new Map();
  let invalidCount = 0;
  for (const block of blocks.slice(0, MAX_FEED_ITEMS)) {
    const title = tag(block, ["title"]);
    let target = tag(block, ["link"]);
    if (!target) {
      const links = [...block.matchAll(/<link\b[^>]*\/?\s*>/gi)].map((match) => match[0]);
      const alternate = links.find((link) => !attribute(link, "rel") || attribute(link, "rel") === "alternate");
      target = attribute(alternate || "", "href");
    }
    let url;
    try {
      url = normalizeUrl(new URL(target, feedUrl).href);
      if (!target || !title) throw new Error("missing candidate");
    } catch {
      invalidCount += 1;
      continue;
    }
    const parsedDate = Date.parse(tag(block, ["pubDate", "published", "updated", "dc:date"]));
    const summary = tag(block, ["description", "summary", "content:encoded", "content"]).slice(0, 240);
    const contentHash = crypto.createHash("sha256").update(JSON.stringify([title, summary, parsedDate || null])).digest("hex");
    // Keep URL query parameters: they may identify distinct articles.
    const id = crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
    byUrl.set(url, { id, title: title.slice(0, 300), url, publishedAt: Number.isFinite(parsedDate) ? parsedDate : null, summary, contentHash });
  }
  return {
    candidates: [...byUrl.values()].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)),
    invalidCount,
    omittedCount: Math.max(0, blocks.length - MAX_FEED_ITEMS),
    parsedCount: Math.min(blocks.length, MAX_FEED_ITEMS)
  };
}

function discoverySnapshot(stateStore, sources, { limit = 50 } = {}) {
  return {
    schema: "domi.news-discovery.v1",
    sources: sources.filter((source) => source.enabled && source.kind !== "podcast").map((source) => {
      const value = stateStore.loadCache(`${NEWS_DISCOVERY_PREFIX}${source.id}`)?.value;
      const current = value?.sourceUrl === source.url ? value : null;
      const candidates = Array.isArray(current?.candidates) ? current.candidates : [];
      return {
        sourceId: source.id, name: source.name, url: source.url,
        status: current?.status || "requires_search", checkedAt: Number(current?.checkedAt) || 0,
        candidates: candidates.slice(0, limit), totalCount: candidates.length,
        omittedCount: Math.max(0, candidates.length - limit) + (Number(current?.omittedCount) || 0),
        invalidCount: Number(current?.invalidCount) || 0,
        error: current?.error || (!current ? "尚未完成程序采集，需搜索核验。" : "")
      };
    })
  };
}

module.exports = { NEWS_DISCOVERY_PREFIX, discoverySnapshot, parseNewsFeed };
