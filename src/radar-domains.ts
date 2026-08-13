import canonicalTaxonomy from "../shared/investment-taxonomy.json" with { type: "json" };

export const RADAR_DOMAIN_ORDER = [
  "AI",
  "半导体",
  "智能出行",
  "前沿科技",
  "具身智能&机器人",
  "消费",
  "生物医药"
] as const;

export type RadarDomain = (typeof RADAR_DOMAIN_ORDER)[number];

export const LEGACY_RADAR_DEFAULT_DOMAINS: RadarDomain[] = [
  "AI",
  "半导体",
  "智能出行",
  "前沿科技",
  "具身智能&机器人"
];

const RADAR_DOMAIN_SET = new Set<string>(RADAR_DOMAIN_ORDER);

export function normalizeRadarDomains(
  value: unknown,
  fallback: readonly RadarDomain[] = LEGACY_RADAR_DEFAULT_DOMAINS
): RadarDomain[] {
  if (!Array.isArray(value)) return [...fallback];
  const selected = new Set(
    value.map((item) => String(item || "").trim()).filter((item) => RADAR_DOMAIN_SET.has(item))
  );
  return RADAR_DOMAIN_ORDER.filter((domain) => selected.has(domain));
}

export function radarTaxonomyPrompt(domains: readonly string[]) {
  const selected = normalizeRadarDomains(domains, []);
  return [
    "本轮行业新闻的领域范围只允许使用 followed_domains 中的值；不得自行扩大范围。领域／子领域必须使用项目库 canonical 词表，并在写入前逐条校验父子关系。新闻可跨已关注领域，但禁止写入未关注领域。",
    ...selected.map((domain) => `${domain}：${canonicalTaxonomy[domain].join("、")}`),
    "兼容规则：历史值“消费科技”只在读取时归入“消费”，新事件与新项目不得再写“消费科技”。AI 是核心产品能力时可标 AI；药物、器械、诊断产品本身是核心时标生物医药；同时满足时新闻可双标，项目仍只保留一个主领域。",
    "例如：汽车芯片→智能出行，EDA&IP→半导体，工业机器人→具身智能&机器人；不得因出现 AI 字样而覆盖更准确的行业父级。"
  ].join("\n");
}

export function radarDomainForStoredDomain(domain: string) {
  const normalized = String(domain || "").trim();
  return normalized === "消费科技" ? "消费" : normalized;
}
