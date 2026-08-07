const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RADAR_SOURCES_SETTINGS_KEY = "radar-sources-v1";
const PODCAST_JOBS_CACHE_KEY = "radar-podcast-jobs-v1";
const SOURCE_KINDS = new Set(["news", "wechat", "podcast"]);
const PODCAST_JOB_STATES = new Set([
  "discovered",
  "downloading",
  "downloaded",
  "transcribing",
  "transcript_ready",
  "failed",
  "skipped"
]);
const DEFAULT_DISCOVERY_LIMIT = 12;
const MAX_DISCOVERY_LIMIT = 50;
const DEFAULT_TEXT_LIMIT_BYTES = 4 * 1024 * 1024;
const DEFAULT_AUDIO_LIMIT_BYTES = 1024 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function stripMarkup(value) {
  return decodeEntities(decodeEntities(value).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationSeconds(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d+(?::\d+){0,2}$/.test(raw)) {
    return raw.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }
  const iso = raw.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!iso) return null;
  return Math.round(
    (Number(iso[1]) || 0) * 86400
      + (Number(iso[2]) || 0) * 3600
      + (Number(iso[3]) || 0) * 60
      + (Number(iso[4]) || 0)
  );
}

function isPrivateIpLiteral(hostname) {
  const host = String(hostname || "").replace(/^\[|]$/g, "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (/^(?:0|127)\./.test(host) || /^169\.254\./.test(host) || /^10\./.test(host)) return true;
  const parts = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (parts) {
    const values = parts.slice(1).map(Number);
    if (values.some((part) => part > 255)) return true;
    if (values[0] === 192 && values[1] === 168) return true;
    if (values[0] === 172 && values[1] >= 16 && values[1] <= 31) return true;
  }
  return /^(?:fc|fd|fe8|fe9|fea|feb)/.test(host);
}

function normalizePublicUrl(value, { optional = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw && optional) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("请输入完整的公开 http(s) 链接。");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("信源只支持公开的 http(s) 链接。");
  }
  if (parsed.username || parsed.password || isPrivateIpLiteral(parsed.hostname)) {
    throw new Error("不能访问包含凭据、本机或内网地址的信源。");
  }
  parsed.hash = "";
  return parsed.href;
}

function findTagValue(xml, names) {
  for (const name of names) {
    const match = String(xml || "").match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return stripMarkup(match[1]);
  }
  return "";
}

function findAttribute(fragment, elementName, attributeName) {
  const element = String(fragment || "").match(new RegExp(`<${elementName}\\b([^>]*)>`, "i"));
  if (!element) return "";
  const attribute = element[1].match(new RegExp(`${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeEntities(attribute?.[1] || attribute?.[2] || "").trim();
}

function parsePodcastRss(xml, sourceUrl) {
  const source = normalizePublicUrl(sourceUrl);
  const channelTitle = findTagValue(xml, ["title"]);
  const items = [...String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  return items.map((match) => {
    const item = match[1];
    const mediaUrl = findAttribute(item, "enclosure", "url")
      || findAttribute(item, "media:content", "url");
    if (!mediaUrl) return null;
    let normalizedMedia;
    try {
      normalizedMedia = normalizePublicUrl(new URL(mediaUrl, source).href);
    } catch {
      return null;
    }
    const link = findTagValue(item, ["link", "guid"]);
    let episodeUrl = source;
    if (link) {
      try {
        episodeUrl = normalizePublicUrl(new URL(link, source).href);
      } catch {
        episodeUrl = source;
      }
    }
    return {
      title: findTagValue(item, ["title"]) || "未命名播客单集",
      description: findTagValue(item, ["description", "content:encoded", "itunes:summary"]),
      publishedAt: parseTimestamp(findTagValue(item, ["pubDate", "published", "updated"])),
      durationSec: parseDurationSeconds(findTagValue(item, ["itunes:duration", "duration"])),
      episodeUrl,
      mediaUrl: normalizedMedia,
      podcastTitle: channelTitle,
      sourceFormat: "rss",
      publicAccess: true
    };
  }).filter(Boolean);
}

function walkJson(value, visitor, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  visitor(value);
  for (const nested of Object.values(value)) walkJson(nested, visitor, seen);
}

function firstJsonValue(root, keys) {
  let found;
  walkJson(root, (value) => {
    if (found !== undefined) return;
    for (const key of keys) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== "") {
        found = value[key];
        return;
      }
    }
  });
  return found;
}

function scriptContents(html, selector) {
  const values = [];
  const expression = selector === "jsonld"
    ? /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi
    : /<script\b[^>]*id\s*=\s*(?:"__NEXT_DATA__"|'__NEXT_DATA__')[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || "").matchAll(expression)) values.push(match[1]);
  return values;
}

function parseJsonScripts(html, selector) {
  return scriptContents(html, selector).flatMap((content) => {
    try {
      return [JSON.parse(decodeEntities(content).trim())];
    } catch {
      return [];
    }
  });
}

function metaContent(html, property) {
  for (const match of String(html || "").matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = match[1];
    const key = attrs.match(/(?:property|name)\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    if (String(key?.[1] || key?.[2] || "").toLowerCase() !== property.toLowerCase()) continue;
    const content = attrs.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (content) return decodeEntities(content[1] || content[2] || "").trim();
  }
  return "";
}

function parseXiaoyuzhouEpisode(html, pageUrl) {
  const episodeUrl = normalizePublicUrl(pageUrl);
  const jsonLd = parseJsonScripts(html, "jsonld");
  const nextData = parseJsonScripts(html, "next")[0] || null;
  let episodeNode = null;
  for (const root of jsonLd) {
    walkJson(root, (value) => {
      if (episodeNode) return;
      const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
      if (type.some((item) => String(item || "").toLowerCase() === "podcastepisode")) episodeNode = value;
    });
  }

  const privateFlag = firstJsonValue(nextData, ["isPrivateMedia", "isPrivate"]);
  const payType = firstJsonValue(nextData, ["payType"]);
  const accessible = episodeNode?.isAccessibleForFree;
  if (privateFlag === true
    || accessible === false
    || String(accessible || "").toLowerCase() === "false"
    || (payType != null && !["", "free", "0", "none"].includes(String(payType).toLowerCase()))) {
    throw new Error("该播客单集是付费或私密内容，domi 不会绕过访问限制下载。");
  }

  const associated = episodeNode?.associatedMedia || episodeNode?.encoding || {};
  const enclosure = firstJsonValue(nextData, ["enclosure"]);
  const enclosureUrl = typeof enclosure === "string"
    ? enclosure
    : enclosure?.url || enclosure?.contentUrl;
  const mediaCandidate = associated?.contentUrl
    || associated?.url
    || enclosureUrl
    || metaContent(html, "og:audio")
    || metaContent(html, "og:audio:url");
  if (!mediaCandidate) {
    throw new Error("公开页面没有提供可下载的音频地址；可能是付费、私密或页面结构已更新。");
  }
  const mediaUrl = normalizePublicUrl(new URL(mediaCandidate, episodeUrl).href);
  const nextEpisode = firstJsonValue(nextData, ["episode"]);
  const title = String(
    episodeNode?.name
      || episodeNode?.headline
      || nextEpisode?.title
      || metaContent(html, "og:title")
      || "未命名播客单集"
  ).trim();
  return {
    title,
    description: stripMarkup(
      episodeNode?.description
        || nextEpisode?.description
        || metaContent(html, "og:description")
    ),
    publishedAt: parseTimestamp(
      episodeNode?.datePublished
        || nextEpisode?.pubDate
        || nextEpisode?.publishedAt
    ),
    durationSec: parseDurationSeconds(
      episodeNode?.duration
        || nextEpisode?.duration
        || firstJsonValue(nextData, ["duration"])
    ),
    episodeUrl,
    mediaUrl,
    podcastTitle: String(
      episodeNode?.partOfSeries?.name
        || firstJsonValue(nextData, ["podcastTitle", "podcastName"])
        || ""
    ).trim(),
    sourceFormat: "xiaoyuzhou",
    publicAccess: true
  };
}

function parseXiaoyuzhouEpisodeLinks(html, pageUrl) {
  const base = normalizePublicUrl(pageUrl);
  const links = [];
  for (const match of String(html || "").matchAll(/(?:href\s*=\s*(?:"([^"]+)"|'([^']+)')|https:\/\/www\.xiaoyuzhoufm\.com\/episode\/[a-z0-9]+)/gi)) {
    const raw = match[1] || match[2] || match[0];
    const href = raw.replace(/^href\s*=\s*["']?|["']$/g, "");
    let parsed;
    try {
      parsed = new URL(href, base);
    } catch {
      continue;
    }
    if (parsed.hostname !== "www.xiaoyuzhoufm.com" || !/^\/episode\/[a-z0-9]+\/?$/i.test(parsed.pathname)) continue;
    parsed.search = "";
    parsed.hash = "";
    links.push(parsed.href);
  }
  return [...new Set(links)];
}

function normalizeStringList(value, limit = 30) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(/[\n,，;；]+/);
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit);
}

function sourceId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function normalizeSource(input, previous = null, now = Date.now()) {
  const kind = SOURCE_KINDS.has(input?.kind) ? input.kind : previous?.kind;
  if (!SOURCE_KINDS.has(kind)) throw new Error("信源类型必须是新闻源、重点公众号或播客源。");
  const name = String(input?.name ?? previous?.name ?? "").trim().slice(0, 120);
  if (!name) throw new Error("请填写信源名称。");
  const rawUrl = input?.url ?? previous?.url ?? "";
  const url = normalizePublicUrl(rawUrl, { optional: kind === "wechat" });
  if (kind !== "wechat" && !url) throw new Error("请填写公开信源链接。");
  return {
    id: String(previous?.id || input?.id || sourceId()),
    kind,
    name,
    url,
    enabled: input?.enabled === undefined ? previous?.enabled !== false : input.enabled !== false,
    priority: input?.priority === undefined
      ? (previous?.priority === "important" ? "important" : "normal")
      : (input.priority === "important" ? "important" : "normal"),
    keywords: normalizeStringList(input?.keywords ?? previous?.keywords),
    autoProcess: kind === "podcast" && (input?.autoProcess === true || (input?.autoProcess === undefined && previous?.autoProcess === true)),
    createdAt: Number(previous?.createdAt) || now,
    updatedAt: now,
    lastCheckedAt: Number(previous?.lastCheckedAt) || 0,
    lastSuccessAt: Number(previous?.lastSuccessAt) || 0,
    error: String(previous?.error || "")
  };
}

function normalizeJob(job) {
  if (!job || !job.id || !job.sourceId || !job.mediaUrl) return null;
  return {
    id: String(job.id),
    sourceId: String(job.sourceId),
    title: String(job.title || "未命名播客单集"),
    description: String(job.description || ""),
    publishedAt: Number(job.publishedAt) || null,
    durationSec: Number(job.durationSec) || null,
    episodeUrl: String(job.episodeUrl || ""),
    mediaUrl: String(job.mediaUrl),
    podcastTitle: String(job.podcastTitle || ""),
    sourceFormat: String(job.sourceFormat || ""),
    status: PODCAST_JOB_STATES.has(job.status) ? job.status : "discovered",
    localAudioPath: String(job.localAudioPath || ""),
    transcriptPath: String(job.transcriptPath || ""),
    plaudFileId: String(job.plaudFileId || ""),
    discoveredAt: Number(job.discoveredAt) || Date.now(),
    updatedAt: Number(job.updatedAt) || Date.now(),
    error: String(job.error || "")
  };
}

function jobIdFor(sourceIdValue, episode) {
  return crypto.createHash("sha256")
    .update(`${sourceIdValue}\u0000${episode.episodeUrl || ""}\u0000${episode.mediaUrl}`)
    .digest("hex")
    .slice(0, 32);
}

async function readResponseLimited(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > maxBytes) throw new Error("信源响应超过安全大小限制。");
  const chunks = [];
  let total = 0;
  if (response.body && typeof response.body[Symbol.asyncIterator] === "function") {
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw new Error("信源响应超过安全大小限制。");
      chunks.push(buffer);
    }
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error("信源响应超过安全大小限制。");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function safeFetch(fetchImpl, rawUrl, options = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持网络请求。");
  let current = normalizePublicUrl(rawUrl);
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await fetchImpl(current, {
        method: options.method || "GET",
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          "User-Agent": "domi/industry-radar (+public-feed-reader)",
          Accept: options.accept || "application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.5",
          ...(options.headers || {})
        },
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      if (timedOut) throw new Error(`读取信源超时（${Math.round(timeoutMs / 1000)} 秒）。`);
      throw error;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer);
      await response.body?.cancel?.().catch?.(() => undefined);
      const location = response.headers?.get?.("location");
      if (!location || redirectCount === 5) throw new Error("信源重定向次数过多。");
      current = normalizePublicUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      clearTimeout(timer);
      throw new Error(`信源返回 HTTP ${response.status}。`);
    }
    return {
      response,
      url: current,
      cleanup: () => clearTimeout(timer),
      didTimeout: () => timedOut,
      timeoutMs
    };
  }
  throw new Error("信源重定向次数过多。");
}

function mediaExtension(mediaUrl, contentType) {
  const candidate = path.extname(new URL(mediaUrl).pathname).toLowerCase();
  if ([".mp3", ".m4a", ".mp4", ".aac", ".wav", ".ogg", ".opus", ".flac"].includes(candidate)) return candidate;
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  return ({
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "video/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/flac": ".flac"
  })[type] || ".m4a";
}

class RadarSourceService {
  constructor({ stateStore, cacheDir, fetchImpl, now } = {}) {
    if (!stateStore) throw new Error("RadarSourceService requires stateStore");
    this.stateStore = stateStore;
    this.cacheDir = path.resolve(cacheDir || path.join(os.homedir(), ".domi", "cache", "podcasts"));
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.now = now || (() => Date.now());
  }

  loadSources() {
    const stored = this.stateStore.loadAppSettings(RADAR_SOURCES_SETTINGS_KEY, { version: 1, sources: [] });
    const raw = Array.isArray(stored?.value) ? stored.value : stored?.value?.sources;
    return {
      sources: (Array.isArray(raw) ? raw : []).flatMap((item) => {
        try {
          return [normalizeSource(item, item, Number(item.updatedAt) || this.now())];
        } catch {
          return [];
        }
      }),
      updatedAt: Number(stored?.updatedAt) || 0
    };
  }

  saveSources(sources) {
    return this.stateStore.saveAppSettings(RADAR_SOURCES_SETTINGS_KEY, {
      version: 1,
      sources
    });
  }

  loadJobs() {
    const stored = this.stateStore.loadCache(PODCAST_JOBS_CACHE_KEY);
    const raw = Array.isArray(stored?.value) ? stored.value : stored?.value?.jobs;
    return {
      jobs: (Array.isArray(raw) ? raw : []).map(normalizeJob).filter(Boolean),
      updatedAt: Number(stored?.updatedAt) || 0
    };
  }

  saveJobs(jobs) {
    const limited = [...jobs]
      .sort((left, right) => Number(right.publishedAt || right.discoveredAt) - Number(left.publishedAt || left.discoveredAt))
      .slice(0, 1000);
    return this.stateStore.saveCache(PODCAST_JOBS_CACHE_KEY, { version: 1, jobs: limited });
  }

  list() {
    const sourceState = this.loadSources();
    const jobState = this.loadJobs();
    return {
      ok: true,
      sources: sourceState.sources,
      jobs: jobState.jobs,
      updatedAt: Math.max(sourceState.updatedAt, jobState.updatedAt)
    };
  }

  save(input = {}) {
    const state = this.loadSources();
    const previous = input.id ? state.sources.find((item) => item.id === String(input.id)) : null;
    if (input.id && !previous) throw new Error("要更新的信源不存在。");
    const source = normalizeSource(input, previous, this.now());
    const sources = previous
      ? state.sources.map((item) => item.id === source.id ? source : item)
      : [...state.sources, source];
    const saved = this.saveSources(sources);
    return { ok: true, source, sources, updatedAt: saved.updatedAt };
  }

  delete(sourceIdValue) {
    const id = String(sourceIdValue || "").trim();
    if (!id) throw new Error("缺少信源 ID。");
    const state = this.loadSources();
    const sources = state.sources.filter((item) => item.id !== id);
    const jobs = this.loadJobs().jobs.filter((item) => item.sourceId !== id);
    const sourceSaved = this.saveSources(sources);
    const jobSaved = this.saveJobs(jobs);
    return {
      ok: true,
      deleted: sources.length !== state.sources.length,
      sourceId: id,
      sources,
      jobs,
      updatedAt: Math.max(sourceSaved.updatedAt, jobSaved.updatedAt)
    };
  }

  async fetchText(url, options = {}) {
    const request = await safeFetch(this.fetchImpl, url, options);
    try {
      const buffer = await readResponseLimited(request.response, Number(options.maxBytes) || DEFAULT_TEXT_LIMIT_BYTES);
      return {
        text: buffer.toString("utf8"),
        url: request.url,
        contentType: String(request.response.headers?.get?.("content-type") || "")
      };
    } catch (error) {
      if (request.didTimeout()) {
        throw new Error(`读取信源超时（${Math.round(request.timeoutMs / 1000)} 秒）。`);
      }
      throw error;
    } finally {
      request.cleanup();
    }
  }

  async discoverSource(source, limit) {
    if (source.kind !== "podcast") return [];
    const first = await this.fetchText(source.url);
    const parsedUrl = new URL(first.url);
    const isXiaoyuzhou = parsedUrl.hostname === "www.xiaoyuzhoufm.com" || parsedUrl.hostname === "xiaoyuzhoufm.com";
    if (isXiaoyuzhou && /^\/episode\//.test(parsedUrl.pathname)) {
      return [parseXiaoyuzhouEpisode(first.text, first.url)];
    }
    if (isXiaoyuzhou) {
      const links = parseXiaoyuzhouEpisodeLinks(first.text, first.url).slice(0, limit);
      const episodes = [];
      for (const link of links) {
        try {
          const page = await this.fetchText(link);
          episodes.push(parseXiaoyuzhouEpisode(page.text, page.url));
        } catch (error) {
          if (/付费或私密/.test(String(error?.message || ""))) continue;
          throw error;
        }
      }
      return episodes;
    }
    if (/\b(?:rss|xml|atom)\b/i.test(first.contentType) || /^\s*<\?xml|<rss\b|<feed\b/i.test(first.text)) {
      return parsePodcastRss(first.text, first.url).slice(0, limit);
    }
    return [parseXiaoyuzhouEpisode(first.text, first.url)];
  }

  async sync(request = {}) {
    const sourceState = this.loadSources();
    const selected = sourceState.sources.filter((source) =>
      source.enabled && (!request.sourceId || source.id === String(request.sourceId))
    );
    const limit = Math.min(Math.max(Number(request.limit) || DEFAULT_DISCOVERY_LIMIT, 1), MAX_DISCOVERY_LIMIT);
    const existingJobs = this.loadJobs().jobs;
    const jobsById = new Map(existingJobs.map((job) => [job.id, job]));
    const results = [];
    const checkedAt = this.now();
    const sourceUpdates = new Map();
    for (const source of selected) {
      if (source.kind !== "podcast") {
        sourceUpdates.set(source.id, { ...source, lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, error: "" });
        results.push({ sourceId: source.id, ok: true, discoveredCount: 0 });
        continue;
      }
      try {
        const episodes = await this.discoverSource(source, limit);
        let discoveredCount = 0;
        for (const episode of episodes) {
          const id = jobIdFor(source.id, episode);
          const previous = jobsById.get(id);
          const job = normalizeJob({
            ...previous,
            ...episode,
            id,
            sourceId: source.id,
            status: previous?.status || "discovered",
            discoveredAt: Number(previous?.discoveredAt) || checkedAt,
            updatedAt: checkedAt,
            error: previous?.status === "failed" ? previous.error : ""
          });
          if (!previous) discoveredCount += 1;
          jobsById.set(id, job);
        }
        sourceUpdates.set(source.id, { ...source, lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, error: "" });
        results.push({ sourceId: source.id, ok: true, discoveredCount, totalCount: episodes.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sourceUpdates.set(source.id, { ...source, lastCheckedAt: checkedAt, error: message });
        results.push({ sourceId: source.id, ok: false, discoveredCount: 0, error: message });
      }
    }
    // Network discovery can take several seconds. Merge only health fields into
    // the latest source rows so an edit/delete made while discovery was running
    // is never reverted by an older snapshot.
    const latestSources = this.loadSources().sources;
    const sources = latestSources.map((source) => {
      const update = sourceUpdates.get(source.id);
      if (!update) return source;
      return {
        ...source,
        lastCheckedAt: update.lastCheckedAt,
        lastSuccessAt: update.lastSuccessAt,
        error: update.error,
        updatedAt: Math.max(Number(source.updatedAt) || 0, checkedAt)
      };
    });
    // Preserve transcript/download state that may have advanced concurrently;
    // discovery refreshes descriptive metadata only.
    const latestJobsById = new Map(this.loadJobs().jobs.map((job) => [job.id, job]));
    for (const candidate of jobsById.values()) {
      const latest = latestJobsById.get(candidate.id);
      latestJobsById.set(candidate.id, latest ? normalizeJob({
        ...latest,
        title: candidate.title,
        description: candidate.description,
        publishedAt: candidate.publishedAt,
        durationSec: candidate.durationSec,
        episodeUrl: candidate.episodeUrl,
        mediaUrl: candidate.mediaUrl,
        podcastTitle: candidate.podcastTitle,
        sourceFormat: candidate.sourceFormat,
        updatedAt: Math.max(Number(latest.updatedAt) || 0, checkedAt)
      }) : candidate);
    }
    const jobs = [...latestJobsById.values()]
      .filter((job) => sources.some((source) => source.id === job.sourceId));
    const sourceSaved = this.saveSources(sources);
    const jobSaved = this.saveJobs(jobs);
    return {
      ok: results.every((item) => item.ok),
      partial: results.some((item) => item.ok) && results.some((item) => !item.ok),
      sources,
      jobs: this.loadJobs().jobs,
      results,
      updatedAt: Math.max(sourceSaved.updatedAt, jobSaved.updatedAt)
    };
  }

  getJob(jobId) {
    const job = this.loadJobs().jobs.find((item) => item.id === String(jobId || ""));
    if (!job) throw new Error("播客任务不存在或已清理。");
    return job;
  }

  updateJob(jobId, patch = {}) {
    const state = this.loadJobs();
    const index = state.jobs.findIndex((item) => item.id === String(jobId || ""));
    if (index < 0) throw new Error("播客任务不存在或已清理。");
    const job = normalizeJob({ ...state.jobs[index], ...patch, id: state.jobs[index].id, updatedAt: this.now() });
    const jobs = [...state.jobs];
    jobs[index] = job;
    const saved = this.saveJobs(jobs);
    return { job, jobs, updatedAt: saved.updatedAt };
  }

  async download(jobId, options = {}) {
    const job = this.getJob(jobId);
    fs.mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.cacheDir, 0o700);
    } catch {
      // Best effort on filesystems without POSIX permissions.
    }
    this.updateJob(job.id, { status: "downloading", error: "" });
    const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULT_AUDIO_LIMIT_BYTES);
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || DEFAULT_DOWNLOAD_TIMEOUT_MS);
    let partPath = "";
    let request = null;
    try {
      request = await safeFetch(this.fetchImpl, job.mediaUrl, {
        timeoutMs,
        accept: "audio/*, video/mp4;q=0.9, application/octet-stream;q=0.5"
      });
      const { response } = request;
      const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (/text\/html|application\/json/.test(contentType)) {
        throw new Error("音频链接返回的不是公开音频文件。");
      }
      const contentLength = Number(response.headers?.get?.("content-length") || 0);
      if (contentLength > maxBytes) throw new Error("播客音频超过下载大小限制。");
      const extension = mediaExtension(job.mediaUrl, contentType);
      const finalPath = path.join(this.cacheDir, `${job.id}${extension}`);
      try {
        const stat = fs.statSync(finalPath);
        if (stat.isFile() && stat.size > 0 && stat.size <= maxBytes) {
          await response.body?.cancel?.().catch?.(() => undefined);
          const updated = this.updateJob(job.id, { status: "downloaded", localAudioPath: finalPath, error: "" });
          return { ok: true, cached: true, path: finalPath, bytes: stat.size, job: updated.job };
        }
      } catch {
        // Download below.
      }
      partPath = path.join(this.cacheDir, `.${job.id}.${crypto.randomBytes(6).toString("hex")}.part`);
      const handle = await fs.promises.open(partPath, "wx", 0o600);
      let total = 0;
      try {
        if (response.body && typeof response.body[Symbol.asyncIterator] === "function") {
          for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk);
            total += buffer.length;
            if (total > maxBytes) throw new Error("播客音频超过下载大小限制。");
            await handle.write(buffer);
          }
        } else {
          const buffer = Buffer.from(await response.arrayBuffer());
          total = buffer.length;
          if (total > maxBytes) throw new Error("播客音频超过下载大小限制。");
          await handle.write(buffer);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (total <= 0) throw new Error("播客音频下载结果为空。");
      await fs.promises.rename(partPath, finalPath);
      partPath = "";
      const updated = this.updateJob(job.id, { status: "downloaded", localAudioPath: finalPath, error: "" });
      return { ok: true, cached: false, path: finalPath, bytes: total, job: updated.job };
    } catch (error) {
      if (partPath) await fs.promises.rm(partPath, { force: true }).catch(() => undefined);
      const message = request?.didTimeout()
        ? `播客音频下载超时（${Math.round(timeoutMs / 1000)} 秒）。`
        : error instanceof Error ? error.message : String(error);
      this.updateJob(job.id, { status: "failed", localAudioPath: "", error: message });
      throw new Error(message);
    } finally {
      request?.cleanup();
    }
  }

  async removeAudio(audioPath) {
    const resolved = path.resolve(String(audioPath || ""));
    const relative = path.relative(this.cacheDir, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
    await fs.promises.rm(resolved, { force: true });
    return true;
  }

  async cleanup(options = {}) {
    const maxAgeMs = Math.max(0, Number(options.maxAgeMs) || DEFAULT_CACHE_MAX_AGE_MS);
    const cutoff = this.now() - maxAgeMs;
    let removed = 0;
    let entries = [];
    try {
      entries = await fs.promises.readdir(this.cacheDir, { withFileTypes: true });
    } catch {
      return { ok: true, removed: 0 };
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(this.cacheDir, entry.name);
      try {
        const stat = await fs.promises.stat(filePath);
        if (entry.name.endsWith(".part") || entry.name.includes(".part") || stat.mtimeMs < cutoff) {
          await fs.promises.rm(filePath, { force: true });
          removed += 1;
        }
      } catch {
        // A concurrent cleanup may already have removed it.
      }
    }
    return { ok: true, removed };
  }
}

module.exports = {
  DEFAULT_AUDIO_LIMIT_BYTES,
  PODCAST_JOBS_CACHE_KEY,
  RADAR_SOURCES_SETTINGS_KEY,
  RadarSourceService,
  normalizePublicUrl,
  normalizeSource,
  parseDurationSeconds,
  parsePodcastRss,
  parseXiaoyuzhouEpisode,
  parseXiaoyuzhouEpisodeLinks,
  safeFetch
};
