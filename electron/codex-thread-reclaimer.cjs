// Terminal conversations keep their persisted history, but not their MCP clients.
class CodexThreadReclaimer {
  constructor({ onError = () => {} } = {}) {
    this.pending = new Map();
    this.onError = onError;
  }
  release(client, threadId) {
    if (!client?.child || !threadId) return Promise.resolve(false);
    const existing = this.pending.get(threadId);
    if (existing?.client === client) return existing.promise;
    const child = client.child;
    const entry = { client };
    entry.promise = (async () => {
      // Never restart a closed server merely to reclaim resources.
      if (client.child !== child || client.intentionalClose) return false;
      const snapshot = await client.request('thread/read', { threadId, includeTurns: false }, { timeoutMs: 5000 });
      if (client.child !== child || client.intentionalClose) return false;
      if (snapshot?.thread?.id !== threadId || snapshot.thread.status?.type !== 'idle') return false;
      const result = await client.request('thread/unsubscribe', { threadId }, { timeoutMs: 5000 });
      return ['unsubscribed', 'notSubscribed', 'notLoaded'].includes(result?.status);
    })().catch(error => { this.onError(error); return false; }).finally(() => {
      if (this.pending.get(threadId) === entry) this.pending.delete(threadId);
    });
    this.pending.set(threadId, entry);
    return entry.promise;
  }
  async wait(threadId) {
    await this.pending.get(threadId)?.promise;
  }
}
module.exports = { CodexThreadReclaimer };
