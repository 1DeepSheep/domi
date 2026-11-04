import type { DomiPerson, DomiProject } from "./env";

function normalize(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("zh-CN");
}

function matchRank(query: string, name: string, identities: string[], metadata: string[], notes = "") {
  const primary = normalize(name);
  const alternatives = identities.map(normalize).filter(Boolean);
  if (primary === query) return 0;
  if (alternatives.includes(query)) return 1;
  if (primary.startsWith(query)) return 2;
  if (alternatives.some(value => value.startsWith(query))) return 3;
  if (primary.includes(query)) return 4;
  if (alternatives.some(value => value.includes(query))) return 5;
  if (normalize(metadata.join(" ")).includes(query)) return 6;
  if (normalize(notes).includes(query)) return 7;
  return Infinity;
}

function rankedMatches<T>(items: readonly T[], rank: (item: T) => number) {
  // Keep snapshot order for equally relevant matches.
  return items.map((item, index) => ({ item, index, rank: rank(item) }))
    .filter(result => Number.isFinite(result.rank))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(result => result.item);
}

export function searchSidebarEntities(
  projects: readonly DomiProject[],
  people: readonly DomiPerson[],
  input: string
) {
  const query = normalize(input);
  if (!query) return { projects: [], people: [] };
  return {
    projects: rankedMatches(projects, project => matchRank(
      query,
      project.name,
      [project.legalName || "", ...(project.aliases || [])],
      [project.domain, project.status, ...project.subdomains, ...(project.cities || []), ...(project.investors || [])],
      project.notes
    )),
    people: rankedMatches(people, person => matchRank(
      query,
      person.name,
      [],
      [person.organization, person.status, ...person.types, ...person.cities]
    ))
  };
}
