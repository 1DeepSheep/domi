/**
 * Canonical project taxonomy shared by the project library and industry news.
 *
 * Source of truth: shared/investment-taxonomy.json. The public plugin taxonomy
 * contract is validated against the same vocabulary during release checks.
 */
import canonicalTaxonomy from "../shared/investment-taxonomy.json" with { type: "json" };
import {
  RADAR_DOMAIN_ORDER,
  radarDomainForStoredDomain,
  radarTaxonomyPrompt
} from "./radar-domains";

export const PROJECT_DOMAIN_SUBDOMAINS = canonicalTaxonomy;

export type ProjectDomain = keyof typeof PROJECT_DOMAIN_SUBDOMAINS;

const PROJECT_DOMAIN_ORDER = Object.keys(PROJECT_DOMAIN_SUBDOMAINS) as ProjectDomain[];
const PROJECT_DOMAIN_SET = new Set<string>(PROJECT_DOMAIN_ORDER);
const SUBDOMAIN_TO_DOMAIN = new Map<string, ProjectDomain>();

PROJECT_DOMAIN_ORDER.forEach((domain) => {
  PROJECT_DOMAIN_SUBDOMAINS[domain].forEach((subdomain) => {
    SUBDOMAIN_TO_DOMAIN.set(subdomain, domain);
  });
});

export const FOLLOWED_PROJECT_TAXONOMY_PROMPT = radarTaxonomyPrompt(RADAR_DOMAIN_ORDER);
export { radarTaxonomyPrompt };

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

  return uniqueNormalized(domains)
    .map(radarDomainForStoredDomain)
    .filter((domain) => PROJECT_DOMAIN_SET.has(domain));
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
