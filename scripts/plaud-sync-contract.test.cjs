const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizePlaudSyncItem, summarizePlaudSync } = require("../electron/plaud-sync-state.cjs");

assert.ok(process.env.DOMI_PLUGIN_CONTRACT_ROOT, "Set DOMI_PLUGIN_CONTRACT_ROOT to the plugin checkout.");
const plugin = path.resolve(process.env.DOMI_PLUGIN_CONTRACT_ROOT, "skills/plaud/scripts/plaud.js");

test("real plugin recovery outcomes reach the client without treating waiting as failed generation", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-sync-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, "config.json");
  fs.writeFileSync(config, JSON.stringify({ plaudConnectionMode: "enabled" }));
  const child = spawnSync(process.execPath, ["-e", `
    const fs = require('node:fs'), path = require('node:path');
    const {__test: api} = require(process.argv[1]);
    if (!api.syncPending) { console.log(JSON.stringify({legacy: true})); process.exit(0); }
    const root = process.argv[2];
    fs.mkdirSync(api.STATE_DIR, {recursive: true});
    fs.writeFileSync(api.STATE_FILE, JSON.stringify({version: 1, records: {
      ready: {fileId: 'ready', stage: 'generating', generationAcceptedAt: '2026-09-01T00:00:00Z'},
      pending: {fileId: 'pending', stage: 'generation_unknown'},
      network: {fileId: 'network', stage: 'generating'}
    }}));
    let time = 0, submissions = 0;
    const client = {
      generateFile: async () => { submissions++; throw new Error('Generation is forbidden in recovery'); },
      listFiles: async () => { throw new Error('Listing new files is forbidden in recovery'); },
      downloadTranscript: async (id, output) => {
        if (id === 'pending') throw new Error('Transcript not found for file pending');
        if (id === 'network') throw new Error('TypeError: Failed to fetch');
        fs.mkdirSync(output, {recursive: true});
        const mdPath = path.join(output, 'synthetic.md'), rawPath = path.join(output, 'synthetic.json');
        fs.writeFileSync(mdPath, '# Synthetic\\n\\nVerified transcript text.');
        fs.writeFileSync(rawPath, '[]');
        return {mdPath, rawPath, fileName: 'Synthetic'};
      }
    };
    api.syncPending(3, path.join(root, 'output'), 3, 1, {
      readOnly: true, now: () => time, pause: async ms => {time += ms;},
      withClientImpl: async callback => callback(client)
    }).then(result => console.log(JSON.stringify({result, submissions}))).catch(error => {
      console.error(error.message); process.exitCode = 1;
    });
  `, plugin, root], {
    encoding: "utf8", timeout: 15000,
    env: { PATH: process.env.PATH, NODE_PATH: path.resolve(__dirname, "../node_modules"),
      DOMI_PLAUD_STATE_DIR: path.join(root, "state"), DOMI_CONFIG_PATH: config }
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const output = JSON.parse(child.stdout);
  // Earlier plugin versions remain supported by the broader receipt suite;
  // their absence of this capability must not be mistaken for permission to
  // call the old, unsafe generation command during automatic recovery.
  if (output.legacy) return t.skip("Plugin predates the read-only recovery contract");
  assert.equal(output.submissions, 0);
  const items = output.result.results.map(item => normalizePlaudSyncItem(item, { source: "recovered" }));
  assert.deepEqual(Object.fromEntries(items.map(item => [item.fileId, item.outcome])), {
    ready: "ready", pending: "waiting", network: "retryable"
  });
  const summary = summarizePlaudSync(items);
  assert.equal(summary.status, "partial");
  assert.equal(summary.recoveredCount, 1);
  assert.equal(summary.waitingCount, 1);
  assert.equal(summary.retryableCount, 1);
  assert.equal(summary.failedCount, 0);
});
