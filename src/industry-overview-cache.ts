import type { IndustryOverviewResult } from "./env";

type Snapshot = { result: IndustryOverviewResult; refreshKey: number };
// Only the catalog is cached: Markdown remains a fresh file read so edits made
// outside domi are visible. Library identities and content never enter storage.
const catalogs = new Map<string, Snapshot>();
const requests = new Map<string, number>();
let nextRequest = 0;

export function getIndustryOverviewSnapshot(cacheKey: string) {
  return catalogs.get(cacheKey);
}

export function beginIndustryOverviewRequest(cacheKey: string) {
  const request = ++nextRequest;
  requests.set(cacheKey, request);
  return request;
}

export function finishIndustryOverviewRequest(cacheKey: string, request: number) {
  if (requests.get(cacheKey) === request) requests.delete(cacheKey);
}

export function saveIndustryOverviewSnapshot(cacheKey: string, request: number, snapshot: Snapshot) {
  if (requests.get(cacheKey) !== request) return false;
  catalogs.delete(cacheKey);
  catalogs.set(cacheKey, snapshot);
  // Keep bounded memory when users switch between multiple local libraries.
  while (catalogs.size > 6) catalogs.delete(catalogs.keys().next().value!);
  requests.delete(cacheKey);
  return true;
}
