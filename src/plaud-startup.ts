import type { DomiPlaudSnapshot, DomiPlaudSyncResult } from "./env";

type StartupOperations = {
  isCurrent: () => boolean;
  pendingList: () => Promise<DomiPlaudSnapshot | null> | null;
  pendingSync: () => Promise<DomiPlaudSyncResult | null> | null;
  pendingMutation: () => Promise<void> | null;
  resume: () => Promise<DomiPlaudSyncResult | null>;
  list: () => Promise<DomiPlaudSnapshot | null>;
};

/** Show the current remote list before starting potentially slow transcript recovery. */
export async function restorePlaudOnStartup(operations: StartupOperations) {
  for (let handoff = 0; handoff < 8 && operations.isCurrent(); handoff += 1) {
    const pendingSync = operations.pendingSync();
    if (pendingSync) {
      const result = await pendingSync;
      if (result?.snapshot) return;
      continue;
    }
    const mutation = operations.pendingMutation();
    if (mutation) {
      await mutation;
      continue;
    }
    const snapshot = await (operations.pendingList() || operations.list());
    if (!operations.isCurrent() || !snapshot?.ok || snapshot.stale || snapshot.paused || snapshot.superseded) return;
    // The list handler can already have started recovery for a ready transcript.
    await (operations.pendingSync() || operations.resume());
    return;
  }
}
