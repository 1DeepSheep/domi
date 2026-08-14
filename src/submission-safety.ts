export type AttachmentPathItem = {
  path: string;
};

/**
 * Replace only attachment paths that belong to the submitted snapshot.
 * Any text edits, newly added attachments, ordering and other draft state stay
 * under the caller's control.
 */
export function reconcileCommittedAttachmentPaths<T extends AttachmentPathItem>(
  currentAttachments: readonly T[],
  submittedAttachments: readonly T[],
  committedAttachments: readonly T[]
): readonly T[] {
  const replacements = new Map<string, T>();
  submittedAttachments.forEach((attachment, index) => {
    const committed = committedAttachments[index];
    if (committed && committed.path !== attachment.path) {
      replacements.set(attachment.path, committed);
    }
  });
  if (!replacements.size) return currentAttachments;

  let changed = false;
  const next = currentAttachments.map((attachment) => {
    const replacement = replacements.get(attachment.path);
    if (!replacement) return attachment;
    changed = true;
    return replacement;
  });
  return changed ? next : currentAttachments;
}

export function isThreadSubmissionBusy(
  threadId: string,
  activeRunId: string | undefined,
  foregroundStartingThreadIds: ReadonlySet<string>,
  queueStartingThreadIds: ReadonlySet<string>,
  settlingThreadIds: ReadonlySet<string> = new Set()
) {
  return Boolean(activeRunId)
    || foregroundStartingThreadIds.has(threadId)
    || queueStartingThreadIds.has(threadId)
    || settlingThreadIds.has(threadId);
}

export function codexThreadOwnerIds(
  threads: ReadonlyArray<{
    id: string;
    codexThreadId?: string;
    messages?: ReadonlyArray<{ executionCodexThreadId?: string }>;
  }>,
  candidateThreadId: string | undefined
) {
  const candidate = String(candidateThreadId || "").trim();
  if (!candidate) return [];
  return threads
    .filter((thread) =>
      thread.codexThreadId === candidate
      || thread.messages?.some((message) => message.executionCodexThreadId === candidate)
    )
    .map((thread) => thread.id);
}

export function resumableCodexThreadId(
  threads: ReadonlyArray<{
    id: string;
    codexThreadId?: string;
    quarantinedCodexThreadIds?: string[];
    messages?: ReadonlyArray<{ executionCodexThreadId?: string }>;
  }>,
  sourceThreadId: string,
  candidateThreadId: string | undefined,
  isolated: boolean
) {
  const candidate = String(candidateThreadId || "").trim();
  if (isolated || !candidate) return undefined;
  const source = threads.find((thread) => thread.id === sourceThreadId);
  if (source?.quarantinedCodexThreadIds?.includes(candidate)) return undefined;
  const ownerIds = codexThreadOwnerIds(threads, candidate);
  return ownerIds.length === 1 && ownerIds[0] === sourceThreadId
    ? candidate
    : undefined;
}

/**
 * Resolve the single remote Codex conversation that represents one local task.
 *
 * Entity/file execution may be isolated, but that must not split the user's
 * visible task into multiple conversational contexts. For legacy tasks that
 * already contain a private execution id, the most recent assistant turn is
 * preferred and becomes the task's canonical conversation on the next event.
 */
export function taskConversationCodexThreadId(
  threads: ReadonlyArray<{
    id: string;
    codexThreadId?: string;
    quarantinedCodexThreadIds?: string[];
    messages?: ReadonlyArray<{
      role?: string;
      executionCodexThreadId?: string;
    }>;
  }>,
  sourceThreadId: string
) {
  const source = threads.find((thread) => thread.id === sourceThreadId);
  if (!source) return undefined;
  const latestAssistant = [...(source.messages || [])]
    .reverse()
    .find((message) => message.role === "assistant");
  const candidates = [
    latestAssistant?.executionCodexThreadId,
    source.codexThreadId
  ];
  for (const rawCandidate of candidates) {
    const candidate = String(rawCandidate || "").trim();
    if (!candidate || source.quarantinedCodexThreadIds?.includes(candidate)) continue;
    const ownerIds = codexThreadOwnerIds(threads, candidate);
    if (ownerIds.length === 1 && ownerIds[0] === sourceThreadId) {
      return candidate;
    }
  }
  return undefined;
}

export function quarantineDuplicateCodexThreadOwnership<
  T extends {
    id: string;
    codexThreadId?: string;
    quarantinedCodexThreadIds?: string[];
    messages?: ReadonlyArray<{ executionCodexThreadId?: string }>;
  }
>(
  threads: readonly T[],
  candidateThreadId: string | undefined
): { threads: T[]; quarantinedThreadIds: string[] } {
  const candidate = String(candidateThreadId || "").trim();
  if (!candidate) return { threads: [...threads], quarantinedThreadIds: [] };
  const ownerIds = codexThreadOwnerIds(threads, candidate);
  if (ownerIds.length <= 1) {
    return { threads: [...threads], quarantinedThreadIds: [] };
  }
  const ownerIdSet = new Set(ownerIds);
  return {
    threads: threads.map((thread) => ownerIdSet.has(thread.id)
      ? {
          ...thread,
          ...(thread.codexThreadId === candidate ? { codexThreadId: undefined } : {}),
          quarantinedCodexThreadIds: [
            ...new Set([...(thread.quarantinedCodexThreadIds || []), candidate])
          ]
        }
      : thread) as T[],
    quarantinedThreadIds: ownerIds
  };
}

export function recoveryCodexThreadId(
  canonicalThreadId: string | undefined,
  executionThreadId: string | undefined,
  isolated: boolean
) {
  return isolated
    ? String(executionThreadId || "").trim() || undefined
    : String(executionThreadId || canonicalThreadId || "").trim() || undefined;
}
