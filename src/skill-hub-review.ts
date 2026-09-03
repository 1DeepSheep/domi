import type { SkillHubCandidate } from "./env";

/** Discovery is not authorization: a concurrent task may have created a Skill. */
export function newSkillHubCandidatesForReview(
  candidates: readonly SkillHubCandidate[],
  baselineIds: ReadonlySet<string>
) {
  return candidates
    .filter((candidate) => candidate.status === "available" && !baselineIds.has(candidate.id))
    .map((candidate) => candidate.id);
}
