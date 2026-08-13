const CODEX_FILE_CITATION_PREFIX = "domi-file-citation:";

export type CodexFileCitation = {
  path: string;
  label: string;
  artifactKind?: string;
  sheet?: string;
  range?: string;
};

type MessageAstNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MessageAstNode[];
};

function decodedAttributeValue(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function parseCitationAttributes(source: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w-]*)\s*=\s*"((?:\\.|[^"\\])*)"/g;
  for (const match of source.matchAll(pattern)) {
    attributes[match[1]] = decodedAttributeValue(match[2]);
  }
  return attributes;
}

function decodedPathLabel(path: string) {
  const withoutTrailingSlash = path.replace(/[\\/]+$/, "");
  const rawName = withoutTrailingSlash.split(/[\\/]/).pop() || path;
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

export function parseCodexFileCitation(source: string): CodexFileCitation | null {
  const attributes = parseCitationAttributes(source);
  const path = attributes.path?.trim();
  if (!path) return null;

  const fileLabel = attributes.label?.trim() || decodedPathLabel(path);
  const location = attributes.sheet
    ? `${attributes.sheet}${attributes.range ? `!${attributes.range}` : ""}`
    : attributes.range || "";

  return {
    path,
    label: location ? `${fileLabel} · ${location}` : fileLabel,
    artifactKind: attributes.artifact_kind,
    sheet: attributes.sheet,
    range: attributes.range
  };
}

export function codexFileCitationHref(path: string) {
  return `${CODEX_FILE_CITATION_PREFIX}${encodeURIComponent(path)}`;
}

export function codexFileCitationPath(href?: string) {
  if (!href?.startsWith(CODEX_FILE_CITATION_PREFIX)) return "";
  try {
    return decodeURIComponent(href.slice(CODEX_FILE_CITATION_PREFIX.length));
  } catch {
    return "";
  }
}

export function splitCodexFileCitations(value: string) {
  const segments: Array<
    | { type: "text"; value: string }
    | { type: "citation"; value: CodexFileCitation }
  > = [];
  const pattern = /:codex-file-citation\{((?:[^}"']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*)\}/g;
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: "text", value: value.slice(cursor, index) });
    const citation = parseCodexFileCitation(match[1]);
    if (citation) {
      segments.push({ type: "citation", value: citation });
    } else {
      segments.push({ type: "text", value: match[0] });
    }
    cursor = index + match[0].length;
  }

  if (cursor < value.length) segments.push({ type: "text", value: value.slice(cursor) });
  return segments;
}

export function remarkCodexFileCitations() {
  return (tree: MessageAstNode) => {
    const visit = (node: MessageAstNode) => {
      if (node.type === "link" || node.type === "linkReference") return;
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value?.includes(":codex-file-citation{")) {
          visit(child);
          return [child];
        }
        return splitCodexFileCitations(child.value).map((segment): MessageAstNode => {
          if (segment.type === "text") return { type: "text", value: segment.value };
          return {
            type: "link",
            url: codexFileCitationHref(segment.value.path),
            title: segment.value.path,
            children: [{ type: "text", value: segment.value.label }]
          };
        });
      });
    };
    visit(tree);
  };
}
