// React replaces these arrays when their contents change. Weak caches keep
// lookups cheap across streamed renders without retaining abandoned snapshots.
const indexes = new WeakMap<object, Map<PropertyKey, Map<unknown, unknown>>>();
const latestAssistants = new WeakMap<object, unknown>();

export function indexBy<T, K extends keyof T>(items: readonly T[], key: K): Map<T[K], T> {
  let cached = indexes.get(items);
  if (!cached) { cached = new Map(); indexes.set(items, cached); }
  let index = cached.get(key);
  if (!index) {
    index = new Map();
    // Preserve Array.find's first-match behavior, including duplicate legacy IDs.
    for (const item of items) if (!index.has(item[key])) index.set(item[key], item);
    cached.set(key, index);
  }
  return index as Map<T[K], T>;
}

export function latestAssistant<T extends { role: string }>(messages: readonly T[]): T | undefined {
  if (latestAssistants.has(messages)) return latestAssistants.get(messages) as T | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") {
      latestAssistants.set(messages, messages[i]);
      return messages[i];
    }
  }
  latestAssistants.set(messages, undefined);
  return undefined;
}

export function indexConversation<T extends { runId?: string }, I extends { messageId: string; status: string }>(
  timeline: readonly T[], interactions: readonly I[]
) {
  const chronologicalTimeline = [...timeline].reverse();
  const timelineByRunId = new Map<string, T[]>();
  for (const item of chronologicalTimeline) {
    if (!item.runId) continue;
    const group = timelineByRunId.get(item.runId) || [];
    group.push(item);
    timelineByRunId.set(item.runId, group);
  }
  const interactionsByMessageId = new Map<string, I[]>();
  const pendingMessageIds = new Set<string>();
  for (const item of interactions) {
    const group = interactionsByMessageId.get(item.messageId) || [];
    group.push(item);
    interactionsByMessageId.set(item.messageId, group);
    if (item.status === "pending") pendingMessageIds.add(item.messageId);
  }
  return { chronologicalTimeline, timelineByRunId, interactionsByMessageId, pendingMessageIds };
}
