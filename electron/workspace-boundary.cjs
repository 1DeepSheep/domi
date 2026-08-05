const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function expandUserPath(value) {
  const raw = String(value || "").trim();
  if (raw === "~") return os.homedir();
  if (raw.startsWith(`~${path.sep}`)) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function existingDirectoryRealPath(value) {
  const expanded = expandUserPath(value);
  if (!expanded) return "";
  try {
    const resolved = fs.realpathSync.native(path.resolve(expanded));
    return fs.statSync(resolved).isDirectory() ? resolved : "";
  } catch {
    return "";
  }
}

function stableDescendantRealPath(rootValue, candidateValue, { allowRoot = true } = {}) {
  const expandedRoot = expandUserPath(rootValue);
  const expandedCandidate = expandUserPath(candidateValue);
  if (!expandedRoot || !expandedCandidate) return "";
  const rawRoot = path.resolve(expandedRoot);
  const rawCandidate = path.resolve(expandedCandidate);
  const root = existingDirectoryRealPath(rawRoot);
  const candidate = existingDirectoryRealPath(rawCandidate);
  if (!root || !candidate) return "";
  const rawRelative = path.relative(rawRoot, rawCandidate);
  const canonicalRelative = path.relative(root, rawCandidate);
  const relative = rawRelative === ""
    || (!rawRelative.startsWith(`..${path.sep}`) && rawRelative !== ".." && !path.isAbsolute(rawRelative))
    ? rawRelative
    : canonicalRelative;
  const rawDescendant = relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  if (!rawDescendant || (!allowRoot && relative === "")) return "";
  const withinRealRoot = candidate === root
    || candidate.startsWith(`${root}${path.sep}`);
  if (!withinRealRoot) return "";

  // The configured root itself may legitimately be reached through an alias
  // (for example /var -> /private/var or a user-selected symlink). Symlinks
  // below that root are never accepted, because they can silently redirect a
  // project workspace to another project or outside the library.
  let cursor = rawRelative === relative ? rawRoot : root;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) return "";
    } catch {
      return "";
    }
  }
  return candidate;
}

function pathIsWithin(rootPath, candidatePath, { allowRoot = true } = {}) {
  const root = existingDirectoryRealPath(rootPath);
  const candidate = existingDirectoryRealPath(candidatePath);
  return Boolean(root && candidate)
    && ((allowRoot && candidate === root) || candidate.startsWith(`${root}${path.sep}`));
}

function entityWorkspaceRoots(settings = {}) {
  if (settings.storageBackend !== "local" || !settings.localRepositoryDir) return [];
  const repositoryRootRaw = path.resolve(expandUserPath(settings.localRepositoryDir));
  if (!existingDirectoryRealPath(repositoryRootRaw)) return [];
  return [
    path.join(repositoryRootRaw, "3.项目库"),
    path.join(repositoryRootRaw, "4.人脉库")
  ].filter((candidate) => stableDescendantRealPath(repositoryRootRaw, candidate, { allowRoot: false }))
    .filter(Boolean);
}

function validCodexWorkspace({ candidate, demoWorkspace, projectsDir, settings }) {
  if (!candidate) return null;
  const resolved = existingDirectoryRealPath(candidate);
  if (!resolved) return null;
  const runtimeRoot = existingDirectoryRealPath(demoWorkspace);
  const projectsRoot = existingDirectoryRealPath(projectsDir);
  const managedRuntime = resolved === runtimeRoot
    || Boolean(projectsRoot && stableDescendantRealPath(projectsRoot, candidate, { allowRoot: false }));
  const managedEntity = entityWorkspaceRoots(settings)
    .some((root) => Boolean(stableDescendantRealPath(root, candidate, { allowRoot: false })));
  return managedRuntime || managedEntity ? resolved : null;
}

function isEntityWorkspace({ workspacePath, settings }) {
  return entityWorkspaceRoots(settings)
    .some((root) => Boolean(stableDescendantRealPath(root, workspacePath, { allowRoot: false })));
}

function projectResearchCacheScope({
  payload,
  workspacePath,
  settings,
  resolveEntityWorkspace
}) {
  if (payload?.externalType !== "project" || !payload?.externalRecordId) {
    return { allowed: true, workspacePath: "" };
  }
  if (settings?.storageBackend !== "local") {
    return { allowed: true, workspacePath: "" };
  }
  try {
    const canonicalCandidate = resolveEntityWorkspace({
      entityType: "project",
      recordId: payload.externalRecordId
    });
    const projectRoot = entityWorkspaceRoots(settings)[0] || "";
    const canonical = stableDescendantRealPath(projectRoot, canonicalCandidate, { allowRoot: false });
    const requested = stableDescendantRealPath(projectRoot, workspacePath, { allowRoot: false });
    return {
      allowed: Boolean(canonical && requested && canonical === requested),
      workspacePath: canonical && canonical === requested ? canonical : ""
    };
  } catch {
    return { allowed: false, workspacePath: "" };
  }
}

module.exports = {
  entityWorkspaceRoots,
  existingDirectoryRealPath,
  isEntityWorkspace,
  pathIsWithin,
  projectResearchCacheScope,
  stableDescendantRealPath,
  validCodexWorkspace
};
