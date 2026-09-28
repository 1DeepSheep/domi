import type { IndustryOverviewResult } from "./env";

type Snapshot = { result: IndustryOverviewResult; refreshKey: number };
type Read = (options: { force?: boolean; cachedOnly?: boolean }) => Promise<IndustryOverviewResult>;
type Request = { refreshKey: number; force: boolean; cached: Promise<Snapshot | undefined>; result: Promise<Snapshot | undefined> };
// Only catalogs are cached: Markdown is read again on navigation so external
// edits remain visible. No library content or identity enters renderer storage.
const catalogs = new Map<string, Snapshot>();
const requests = new Map<string, Request>();
let activeSource = "";

export function getIndustryOverviewSnapshot(cacheKey: string) {
  return catalogs.get(cacheKey);
}

function save(cacheKey: string, snapshot: Snapshot) {
  catalogs.delete(cacheKey);
  catalogs.set(cacheKey, snapshot);
  while (catalogs.size > 6) catalogs.delete(catalogs.keys().next().value!);
}

export function requestIndustryOverview(cacheKey: string, refreshKey: number, force: boolean, read: Read) {
  // An A -> B -> A settings switch must validate A again, rather than join a
  // request that captured A before the switch. Repeated visits to A can share it.
  if (activeSource !== cacheKey) {
    requests.delete(activeSource);
    activeSource = cacheKey;
  }
  const pending = requests.get(cacheKey);
  if (pending?.refreshKey === refreshKey && (!force || pending.force)) return pending;
  const request = { refreshKey, force } as Request;
  requests.set(cacheKey, request);
  const isCurrent = () => requests.get(cacheKey) === request;
  const existing = catalogs.get(cacheKey);
  request.cached = existing ? Promise.resolve(existing) : Promise.resolve()
    .then(() => read({ cachedOnly: true }))
    .then(result => {
      // An empty cache miss is not an empty source library. A late disk snapshot
      // cannot replace the fresh result or another library's request.
      if (!isCurrent() || !result.cached || (!result.ok && !result.entries?.length)) return undefined;
      const snapshot = { result, refreshKey };
      save(cacheKey, snapshot);
      return snapshot;
    }).catch(() => undefined);
  request.result = Promise.resolve().then(() => read({ force })).then(result => {
    if (!result.ok && !result.entries?.length) throw new Error(result.error || "行业看板暂时无法刷新。");
    if (!isCurrent()) return undefined;
    const snapshot = { result, refreshKey };
    save(cacheKey, snapshot);
    return snapshot;
  }).catch(async cause => {
    // Even when fresh validation fails first, finish the independent disk-cache
    // read so offline startup still shows the last usable catalog.
    await request.cached;
    throw cause;
  }).finally(() => { if (isCurrent()) requests.delete(cacheKey); });
  return request;
}
