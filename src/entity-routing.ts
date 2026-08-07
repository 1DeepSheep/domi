export type EntityRoutingProject = {
  recordId: string;
  name: string;
};

export type DomiEntityResult = {
  entityType: "project" | "person";
  recordId: string;
  name: string;
};

export type ProjectMentionConfidence = "high" | "low";

export type ProjectMentionMatch<T extends EntityRoutingProject> = {
  project: T;
  confidence: ProjectMentionConfidence;
  matchedKey: string;
};

export function normalizedEntityMention(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

const GENERIC_ENTITY_TOKENS = new Set([
  "项目", "公司", "集团", "科技", "智能", "网络", "技术", "数据", "信息", "数字",
  "人工智能", "ai", "有限责任公司", "有限公司"
]);

function entityMentionKeys(value: string): Array<{
  key: string;
  confidence: ProjectMentionConfidence;
}> {
  const raw = String(value || "").normalize("NFKC");
  const parts = raw.split(/[\s()（）[\]【】·—–\-_/]+/).map(normalizedEntityMention);
  return [...new Set([normalizedEntityMention(raw), ...parts])]
    .filter((key) => !GENERIC_ENTITY_TOKENS.has(key))
    .filter((key) => !/^\d+$/.test(key))
    .filter((key) => key.length >= (/\p{Script=Han}/u.test(key) ? 2 : 3))
    .map((key) => {
      const containsHan = /\p{Script=Han}/u.test(key);
      const containsDigit = /\d/.test(key);
      const highConfidence = !containsDigit && key.length >= (containsHan ? 3 : 5);
      return {
        key,
        confidence: highConfidence ? "high" : "low"
      };
    });
}

export function projectMentionMatches<T extends EntityRoutingProject>(
  projects: T[],
  text: string
): Array<ProjectMentionMatch<T>> {
  // Keep clause punctuation as a hard boundary. Flattening the whole
  // request used to synthesize names that the user never wrote (for example,
  // “未来，道具行业” silently matched the project “未来道具”). A project key
  // may occur inside a sentence segment, but never across two clauses. Spaces
  // and hyphens stay inside a clause so canonical names such as “A9 芯片” and
  // “AutoTrust-AI” still match their normalized project names.
  const haystacks = String(text || "")
    .normalize("NFKC")
    .split(/[，。！？；;,.!?:：、…"'“”‘’—–\n\r\t/\\|()[\]{}【】]+/u)
    .map(normalizedEntityMention)
    .filter(Boolean);
  if (!haystacks.length) return [];
  return [...new Map(
    projects.flatMap((project) => {
      const matches = entityMentionKeys(project.name)
        .filter(({ key }) => haystacks.some((haystack) => haystack.includes(key)))
        .sort((left, right) => {
          if (left.confidence !== right.confidence) return left.confidence === "high" ? -1 : 1;
          return right.key.length - left.key.length;
        });
      const best = matches[0];
      return best
        ? [[project.recordId, {
            project,
            confidence: best.confidence,
            matchedKey: best.key
          }] as const]
        : [];
    })
  ).values()];
}

export function mentionedProjectCandidates<T extends EntityRoutingProject>(
  projects: T[],
  text: string
) {
  return projectMentionMatches(projects, text).map((match) => match.project);
}

export function automaticallyRoutedProject<T extends EntityRoutingProject>(
  matches: Array<ProjectMentionMatch<T>>,
  context: { currentProjectId?: string; projectIntake?: boolean } = {}
): T | undefined {
  const current = context.currentProjectId
    ? matches.find((match) => match.project.recordId === context.currentProjectId)
    : undefined;
  // A normal task already bound to a project stays there. Other company names
  // are usually comparisons, customers, competitors or examples—not a request
  // to move the task and its files.
  if (context.currentProjectId && !context.projectIntake) {
    return current?.project;
  }
  // Only one strong candidate is deterministic. Weak or multi-project matches
  // stay neutral until the workflow supplies a verified entity result.
  const confident = matches.filter((match) => match.confidence === "high");
  return confident.length === 1 ? confident[0].project : undefined;
}

export function parseDomiEntityResult(output: string): DomiEntityResult | null {
  const text = String(output || "");
  const marker = text.match(
    /(?:<!--\s*)?DOMI_ENTITY_RESULT(?:_V1)?\s*:?\s*(\{[^\r\n]*\})(?:\s*-->)?/i
  );
  if (!marker) return null;
  try {
    const parsed = JSON.parse(marker[1]) as Partial<DomiEntityResult>;
    const entityType = parsed.entityType === "person" ? "person" : parsed.entityType === "project" ? "project" : "";
    const recordId = String(parsed.recordId || "").trim();
    const name = String(parsed.name || "").trim();
    return entityType && recordId && name
      ? { entityType, recordId, name }
      : null;
  } catch {
    return null;
  }
}
