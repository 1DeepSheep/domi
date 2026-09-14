import type { DomiPlaudSnapshot, DomiPlaudSyncResult } from "./env";

type StartupOperations = {
  isCurrent: () => boolean;
  pendingList: () => Promise<DomiPlaudSnapshot | null> | null;
  pendingSync: () => Promise<DomiPlaudSyncResult | null> | null;
  pendingMutation: () => Promise<void> | null;
  resume: () => Promise<DomiPlaudSyncResult | null>;
  list: () => Promise<DomiPlaudSnapshot | null>;
};

/** Restore the list after a local-only empty resume, without submitting work. */
export async function restorePlaudOnStartup(operations: StartupOperations) {
  let resumed = false;
  // Wait for existing bounded operations, rather than polling or discarding a
  // startup read when a manual operation owns the shared browser session.
  for (let handoff = 0; handoff < 8 && operations.isCurrent(); handoff += 1) {
    const pendingList = operations.pendingList();
    if (pendingList) {
      const snapshot = await pendingList;
      if (operations.isCurrent() && snapshot) return;
      continue;
    }
    const pendingSync = operations.pendingSync();
    if (pendingSync) {
      const result = await pendingSync;
      if (!operations.isCurrent()) return;
      if (result?.snapshot) return;
      resumed = true;
      continue;
    }
    const pendingMutation = operations.pendingMutation();
    if (pendingMutation) {
      await pendingMutation;
      continue;
    }
    if (!resumed) {
      const result = await operations.resume();
      if (!operations.isCurrent()) return;
      if (result?.snapshot) return;
      resumed = true;
    } else {
      await operations.list();
      return;
    }
  }
}
