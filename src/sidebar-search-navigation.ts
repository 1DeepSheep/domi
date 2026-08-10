export type SidebarSearchDirection = "next" | "previous";

export function nextSidebarSearchKey(
  keys: readonly string[],
  activeKey: string,
  direction: SidebarSearchDirection
) {
  if (!keys.length) return "";

  const activeIndex = keys.indexOf(activeKey);
  if (direction === "next") {
    return keys[activeIndex < 0 || activeIndex === keys.length - 1 ? 0 : activeIndex + 1];
  }
  return keys[activeIndex <= 0 ? keys.length - 1 : activeIndex - 1];
}

export function validSidebarSearchKey(keys: readonly string[], activeKey: string) {
  return keys.includes(activeKey) ? activeKey : (keys[0] || "");
}

export function canonicalEntityHomepagePath(
  workspacePath: string,
  entityType: "project" | "person"
) {
  const basePath = String(workspacePath || "").replace(/[\\/]+$/, "");
  if (!basePath) return "";
  const separator = basePath.includes("\\") && !basePath.includes("/") ? "\\" : "/";
  return `${basePath}${separator}${entityType === "person" ? "人物主页.md" : "项目主页.md"}`;
}

function normalizedDocumentPath(value: string) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

export function entityPrimaryDocumentPath(
  workspacePath: string,
  entityType: "project" | "person",
  indexedDocumentPath = ""
) {
  const normalizedWorkspace = normalizedDocumentPath(workspacePath);
  const normalizedIndexed = normalizedDocumentPath(indexedDocumentPath);
  const indexedSegments = normalizedIndexed.split("/");
  if (
    normalizedWorkspace
    && normalizedIndexed
    && !indexedSegments.includes("..")
    && normalizedIndexed !== normalizedWorkspace
    && normalizedIndexed.startsWith(`${normalizedWorkspace}/`)
  ) {
    return indexedDocumentPath;
  }
  return canonicalEntityHomepagePath(workspacePath, entityType);
}

export type SidebarSearchDocumentNode = {
  kind: string;
  path: string;
  children?: SidebarSearchDocumentNode[];
};

export function documentLibraryExpansionPath(
  nodes: readonly SidebarSearchDocumentNode[],
  targetPath: string
): string[] | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node.kind === "folder" ? [node.path] : [];
    if (node.kind !== "folder" || !node.children?.length) continue;
    const childPath = documentLibraryExpansionPath(node.children, targetPath);
    if (childPath !== null) return [node.path, ...childPath];
  }
  return null;
}

export function documentLibraryHasDocumentPath(
  nodes: readonly SidebarSearchDocumentNode[],
  targetPath: string
): boolean {
  for (const node of nodes) {
    if (node.path === targetPath) return node.kind !== "folder";
    if (
      node.kind === "folder"
      && node.children?.length
      && documentLibraryHasDocumentPath(node.children, targetPath)
    ) return true;
  }
  return false;
}
