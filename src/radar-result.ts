export type RadarRejectedCounts = {
  duplicate: number;
  not_event: number;
  unverified: number;
  unavailable: number;
  out_of_scope: number;
};

export type ParsedRadarResult = {
  checkedThrough: number | null;
  candidates: number;
  added: number;
  updated: number;
  unchanged: number;
  failed: number;
  rejected: RadarRejectedCounts;
  searchedDomains: string[];
  completedDomains: string[];
  incompleteDomains: string[];
  checkpointDomains: string[];
  queriesByDomain: Record<string, number>;
  deeptechChecked: boolean;
  configuredSourcesAttempted: number;
  configuredSourcesFailed: number;
  coverageIssues: string[];
};

const RADAR_RESULT_MARKER = "RADAR_RESULT";
const REJECTION_KEYS = [
  "duplicate",
  "not_event",
  "unverified",
  "unavailable",
  "out_of_scope"
] as const;

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function radarDomains(value: unknown, selected: ReadonlySet<string>) {
  if (!Array.isArray(value)) return [];
  const values = new Set(
    value.map((item) => String(item || "").trim())
      .filter((item) => selected.has(item))
  );
  return [...selected].filter((domain) => values.has(domain));
}

function resultObjectFromOutput(output: string): Record<string, unknown> | null {
  const lines = String(output || "").split(/\r?\n/).reverse();
  for (const line of lines) {
    const markerIndex = line.indexOf(RADAR_RESULT_MARKER);
    if (markerIndex < 0) continue;
    const jsonStart = line.indexOf("{", markerIndex);
    const jsonEnd = line.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) continue;
    try {
      const result = JSON.parse(line.slice(jsonStart, jsonEnd + 1));
      if (result && typeof result === "object" && !Array.isArray(result)) {
        return result as Record<string, unknown>;
      }
    } catch {
      // Keep looking for an earlier valid marker.
    }
  }
  return null;
}

export function parseRadarResult(
  output: string,
  selectedDomains: readonly string[],
  configuredSourcesTotal = 0
): ParsedRadarResult | null {
  const result = resultObjectFromOutput(output);
  if (!result) return null;
  const coverage = result.coverage && typeof result.coverage === "object" && !Array.isArray(result.coverage)
    ? result.coverage as Record<string, unknown>
    : {};
  const selected = new Set<string>(selectedDomains);
  const searchedDomains = radarDomains(coverage.searched_domains, selected);
  const searchedSet = new Set<string>(searchedDomains);
  const rawQueries = coverage.queries_by_domain && typeof coverage.queries_by_domain === "object"
    ? coverage.queries_by_domain as Record<string, unknown>
    : {};
  const queriesByDomain: Record<string, number> = {};
  for (const domain of selectedDomains) {
    queriesByDomain[domain] = nonNegativeInteger(rawQueries[domain]);
  }
  const completedDomains = selectedDomains.filter((domain) =>
    searchedSet.has(domain) && (queriesByDomain[domain] || 0) >= 1
  );
  const completedSet = new Set<string>(completedDomains);
  const incompleteDomains = selectedDomains.filter((domain) => !completedSet.has(domain));
  const deeptechChecked = coverage.deeptech_checked === true;
  const configuredSourcesAttempted = nonNegativeInteger(coverage.configured_sources_attempted);
  const configuredSourcesFailed = nonNegativeInteger(coverage.configured_sources_failed);
  const added = nonNegativeInteger(result.added);
  const updated = nonNegativeInteger(result.updated);
  const unchanged = nonNegativeInteger(result.unchanged);
  const failed = nonNegativeInteger(result.failed);
  const candidates = nonNegativeInteger(result.candidates);
  const rejected = Object.fromEntries(
    REJECTION_KEYS.map((key) => [key, nonNegativeInteger(
      result.rejected && typeof result.rejected === "object"
        ? (result.rejected as Record<string, unknown>)[key]
        : 0
    )])
  ) as RadarRejectedCounts;
  const accountedCandidates = added + updated + unchanged + failed
    + REJECTION_KEYS.reduce((total, key) => total + rejected[key], 0);
  const coverageIssues: string[] = [];
  if (incompleteDomains.length) {
    coverageIssues.push(`未完整检索：${incompleteDomains.join("、")}`);
  }
  if (!deeptechChecked) coverageIssues.push("未完成 DeepTech 深科技定向扫源");
  if (configuredSourcesAttempted < configuredSourcesTotal) {
    coverageIssues.push(`重点信源仅检查 ${configuredSourcesAttempted}/${configuredSourcesTotal}`);
  }
  if (configuredSourcesFailed > 0) {
    coverageIssues.push(`${configuredSourcesFailed} 个重点信源检查失败`);
  }
  if (accountedCandidates !== candidates) {
    coverageIssues.push(`候选漏斗合计 ${accountedCandidates} 条，与候选总数 ${candidates} 条不一致`);
  }
  const globallyVerifiable = deeptechChecked
    && configuredSourcesAttempted >= configuredSourcesTotal
    && accountedCandidates === candidates;
  const checkedThrough = Date.parse(String(result.checked_through || ""));
  return {
    checkedThrough: Number.isFinite(checkedThrough) && checkedThrough > 0 ? checkedThrough : null,
    candidates,
    added,
    updated,
    unchanged,
    failed,
    rejected,
    searchedDomains,
    completedDomains,
    incompleteDomains,
    checkpointDomains: globallyVerifiable ? completedDomains : [],
    queriesByDomain,
    deeptechChecked,
    configuredSourcesAttempted,
    configuredSourcesFailed,
    coverageIssues
  };
}

export function radarRejectionSummary(result: ParsedRadarResult) {
  const labels: Array<[keyof RadarRejectedCounts, string]> = [
    ["duplicate", "重复"],
    ["not_event", "信息增量不足"],
    ["unverified", "未充分核验"],
    ["unavailable", "原文不可访问"],
    ["out_of_scope", "不在关注范围"]
  ];
  return labels
    .filter(([key]) => result.rejected[key] > 0)
    .map(([key, label]) => `${label} ${result.rejected[key]} 条`)
    .join("、");
}
