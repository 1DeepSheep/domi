/**
 * Canonical project taxonomy shared by the project library and industry news.
 *
 * Source of truth:
 * build/domi-plugin/skills/investment-mgmt/references/taxonomy.md
 */
export const PROJECT_DOMAIN_SUBDOMAINS = {
  AI: [
    "AI互动娱乐",
    "AI社交",
    "AI游戏",
    "AI视频",
    "AI图片",
    "AI造物",
    "AI心理",
    "AI语音",
    "AI效率工具",
    "AI Coding",
    "AI营销",
    "AI金融",
    "AI制药",
    "AI医疗",
    "AI招聘",
    "AI健康",
    "Agent",
    "AI数据",
    "模型层",
    "AI基础设施",
    "AI4S",
    "世界模型",
    "AI陪伴",
    "AI搜索",
    "AI 3D",
    "AI教育",
    "AI旅游"
  ],
  消费科技: ["NAS／私有云", "可穿戴", "AR/VR元宇宙", "AI玩具"],
  半导体: [
    "存储",
    "算力芯片",
    "通信芯片",
    "微处理器",
    "模拟芯片",
    "功率半导体",
    "光电芯片",
    "传感器",
    "晶圆制造",
    "封测",
    "半导体设备",
    "半导体材料",
    "EDA&IP",
    "无源器件"
  ],
  智能出行: [
    "自动驾驶",
    "OEM",
    "动力电池",
    "BMS",
    "电机电驱",
    "激光雷达",
    "毫米波雷达",
    "智能座舱",
    "汽车芯片",
    "汽车软件",
    "充换电",
    "线控底盘",
    "热管理",
    "新能源商用车"
  ],
  "具身智能&机器人": [
    "工业机器人",
    "协作机器人",
    "物流仓储机器人",
    "室内移动机器人",
    "末端执行器",
    "扫地机器人"
  ],
  前沿科技: ["卫星互联网", "eVTOL", "低空经济", "商业航天", "量子计算"],
  消费: [],
  互联网科技: [],
  能源: [],
  企业软件: []
} as const satisfies Record<string, readonly string[]>;

export type ProjectDomain = keyof typeof PROJECT_DOMAIN_SUBDOMAINS;

const PROJECT_DOMAIN_ORDER = Object.keys(PROJECT_DOMAIN_SUBDOMAINS) as ProjectDomain[];
const FOLLOWED_PROJECT_DOMAIN_ORDER: ProjectDomain[] = [
  "AI",
  "半导体",
  "智能出行",
  "前沿科技",
  "具身智能&机器人"
];
const PROJECT_DOMAIN_SET = new Set<string>(PROJECT_DOMAIN_ORDER);
const SUBDOMAIN_TO_DOMAIN = new Map<string, ProjectDomain>();

PROJECT_DOMAIN_ORDER.forEach((domain) => {
  PROJECT_DOMAIN_SUBDOMAINS[domain].forEach((subdomain) => {
    SUBDOMAIN_TO_DOMAIN.set(subdomain, domain);
  });
});

export const FOLLOWED_PROJECT_TAXONOMY_PROMPT = [
  "行业新闻的「领域／子领域」必须使用项目库 canonical 词表，并在写入前逐条校验父子关系。识别到已知子领域时，以子领域所属父级纠正领域；新闻可跨多个领域，但禁止跨组错配。",
  ...FOLLOWED_PROJECT_DOMAIN_ORDER.map((domain) =>
    `${domain}：${PROJECT_DOMAIN_SUBDOMAINS[domain].join("、")}`
  ),
  "例如：汽车芯片→智能出行，EDA&IP→半导体，工业机器人→具身智能&机器人，自动驾驶→智能出行；不得写成 AI 的子领域。"
].join("\n");

function uniqueNormalized(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * A recognized subdomain is authoritative over a malformed parent-domain value.
 * Records without a recognized subdomain retain their supplied parent domain so
 * uncategorized news remains visible while the source record is being repaired.
 */
export function projectDomainsForNews(
  domains: readonly string[],
  subdomains: readonly string[]
) {
  const inferredDomains = new Set(
    uniqueNormalized(subdomains)
      .map((subdomain) => SUBDOMAIN_TO_DOMAIN.get(subdomain))
      .filter((domain): domain is ProjectDomain => Boolean(domain))
  );

  if (inferredDomains.size > 0) {
    return PROJECT_DOMAIN_ORDER.filter((domain) => inferredDomains.has(domain));
  }

  return uniqueNormalized(domains).filter((domain) => PROJECT_DOMAIN_SET.has(domain));
}

export function projectSubdomainsForNews(
  subdomains: readonly string[],
  domain: string
) {
  const allowedSubdomains = PROJECT_DOMAIN_SUBDOMAINS[domain as ProjectDomain];
  if (!allowedSubdomains) return [];
  const allowedSet = new Set<string>(allowedSubdomains);
  return uniqueNormalized(subdomains).filter((subdomain) => allowedSet.has(subdomain));
}
