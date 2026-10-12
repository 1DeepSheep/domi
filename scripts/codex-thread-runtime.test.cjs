#!/usr/bin/env node
// Optional protocol smoke: node scripts/codex-thread-runtime.test.cjs /path/to/codex [...]
// Uses real installed binaries with a local deterministic Responses provider. It
// never reads the user's Codex home, authenticates, or invokes a remote model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { CodexAppServer } = require('../electron/codex-app-server.cjs');

const binaries = process.argv.slice(2);
if (!binaries.length) {
  console.log('SKIP real Codex thread smoke: supply one or more Codex binary paths.');
  process.exit(0);
}

function within(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

async function run(binaryPath) {
  assert.ok(path.isAbsolute(binaryPath), 'Use an absolute binary path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domi-thread-protocol-'));
  const home = path.join(root, 'home');
  const intake = path.join(root, 'intake');
  const archived = path.join(root, 'archived-project');
  const shared = path.join(root, 'shared-evidence');
  for (const directory of [home, intake, archived, shared]) fs.mkdirSync(directory);
  const requests = [];
  const notifications = [];
  const logs = [];
  const measures = {};
  let client;
  const provider = http.createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/v1/responses');
      assert.equal(request.headers.authorization, undefined);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      const n = requests.length;
      const text = `SYNTHETIC_REPLY_${n}`;
      const item = { id: `msg_${n}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const emit = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      emit('response.created', { response: { id: `resp_${n}`, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'in_progress' } });
      emit('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
      emit('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      emit('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text });
      emit('response.output_item.done', { output_index: 0, item });
      emit('response.completed', { response: { id: `resp_${n}`, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
      response.end();
    } catch (error) {
      logs.push(error.stack);
      response.writeHead(500);
      response.end('Synthetic provider failed');
    }
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  fs.writeFileSync(path.join(home, 'config.toml'), [
    'model = "gpt-5.2"', 'model_provider = "mock"', 'approval_policy = "never"', 'sandbox_mode = "read-only"',
    '[model_providers.mock]', 'name = "Synthetic protocol test"', `base_url = "${baseUrl}"`,
    'wire_api = "responses"', 'requires_openai_auth = false', '[features]', 'shell_tool = false', ''
  ].join('\n'));
  const createClient = () => new CodexAppServer({
    cwd: intake, version: '0.0.0-test', requestTimeoutMs: 15_000,
    runtimeProvider: () => ({ codexPath: binaryPath, env: {
      CODEX_HOME: home, HOME: home, OPENAI_API_KEY: '', CODEX_API_KEY: '',
      OPENAI_BASE_URL: baseUrl, RUST_LOG: 'error'
    } }),
    onNotification: (method, params) => notifications.push({ method, params }),
    onLog: (text) => logs.push(text)
  });
  async function stopClient() {
    if (!client) return;
    const child = client.child;
    const exited = child && child.exitCode === null ? once(child, 'exit') : Promise.resolve();
    client.close();
    await within(exited, 5_000, 'App server shutdown');
  }
  async function timed(label, fn) {
    const started = performance.now();
    const result = await fn();
    measures[label] = Math.round((performance.now() - started) * 100) / 100;
    return result;
  }
  async function turn(threadId, text, overrides = {}) {
    const result = await client.request('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }], ...overrides });
    const completed = await within(new Promise((resolve) => {
      const inspect = () => {
        const event = notifications.find(({ method, params }) => method === 'turn/completed' && params.threadId === threadId && params.turn.id === result.turn.id);
        if (event) resolve(event.params.turn);
        else setTimeout(inspect, 10).unref();
      };
      inspect();
    }), 15_000, 'Synthetic turn completion');
    assert.equal(completed.status, 'completed', JSON.stringify(completed.error));
    return completed;
  }
  try {
    client = createClient();
    await timed('initialize', () => client.start());
    const started = await timed('threadStart', () => client.request('thread/start', {
      cwd: intake, model: 'gpt-5.2', modelProvider: 'mock', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false
    }));
    const threadId = started.thread.id;
    await timed('firstTurn', () => turn(threadId, 'SYNTHETIC_ORIGINAL_USER_MESSAGE'));
    const policy = { type: 'workspaceWrite', writableRoots: [archived, shared], networkAccess: false };
    await timed('movedCwdTurn', () => turn(threadId, 'SYNTHETIC_FOLLOWUP_AFTER_ARCHIVE', { cwd: archived, sandboxPolicy: policy }));
    assert.equal(requests.length, 2);
    const movedContext = JSON.stringify(requests[1].input);
    assert.ok(movedContext.includes('SYNTHETIC_ORIGINAL_USER_MESSAGE'));
    assert.ok(movedContext.includes('SYNTHETIC_REPLY_1'));
    assert.ok(movedContext.includes('SYNTHETIC_FOLLOWUP_AFTER_ARCHIVE'));
    assert.ok(movedContext.includes(archived));
    const loaded = await timed('loadedResumeExcludeTurns', () => client.request('thread/resume', { threadId, excludeTurns: true }));
    assert.equal(loaded.thread.id, threadId);
    assert.equal(loaded.cwd, archived);
    assert.equal(loaded.sandbox.type, 'workspaceWrite');
    assert.equal(loaded.sandbox.networkAccess, false);
    assert.ok(loaded.sandbox.writableRoots.includes(shared), 'Additional explicit writable roots survive the cwd change');
    assert.deepEqual(loaded.thread.turns, []);
    const metadata = await timed('turnMetadata', () => client.request('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' }));
    assert.equal(metadata.data.length, 1);
    assert.equal(metadata.data[0].status, 'completed');
    assert.equal(metadata.data[0].itemsView, 'notLoaded');
    assert.deepEqual(metadata.data[0].items, []);
    await stopClient();
    client = createClient();
    await client.start();
    const cold = await timed('coldResumeExcludeTurns', () => client.request('thread/resume', { threadId, cwd: archived, excludeTurns: true }));
    assert.equal(cold.thread.id, threadId);
    assert.deepEqual(cold.thread.turns, []);
    assert.equal(cold.cwd, archived);
    const allMetadata = await client.request('thread/turns/list', { threadId, limit: 10, sortDirection: 'asc', itemsView: 'notLoaded' });
    assert.equal(allMetadata.data.length, 2);
    assert.ok(allMetadata.data.every((entry) => entry.status === 'completed' && entry.itemsView === 'notLoaded' && entry.items.length === 0));
    await timed('postColdResumeTurn', () => turn(threadId, 'SYNTHETIC_AFTER_COLD_RESUME', { cwd: archived, sandboxPolicy: policy }));
    assert.equal(requests.length, 3, 'No duplicate model submission during resume or metadata reads');
    const coldContext = JSON.stringify(requests[2].input);
    for (const marker of ['SYNTHETIC_ORIGINAL_USER_MESSAGE', 'SYNTHETIC_REPLY_1', 'SYNTHETIC_FOLLOWUP_AFTER_ARCHIVE', 'SYNTHETIC_REPLY_2', 'SYNTHETIC_AFTER_COLD_RESUME']) assert.ok(coldContext.includes(marker), `Cold resume lost ${marker}`);
    const history = await timed('fullHistoryReadback', () => client.request('thread/turns/list', { threadId, limit: 10, sortDirection: 'asc', itemsView: 'full' }));
    assert.equal(history.data.length, 3);
    const historyText = JSON.stringify(history.data);
    for (const marker of ['SYNTHETIC_ORIGINAL_USER_MESSAGE', 'SYNTHETIC_REPLY_1', 'SYNTHETIC_FOLLOWUP_AFTER_ARCHIVE', 'SYNTHETIC_REPLY_2', 'SYNTHETIC_AFTER_COLD_RESUME', 'SYNTHETIC_REPLY_3']) assert.ok(historyText.includes(marker), `Persisted history lost ${marker}`);
    const stored = await client.request('thread/read', { threadId, includeTurns: false });
    assert.equal(stored.thread.id, threadId);
    // thread.cwd is historical creation metadata in some runtimes. Live cwd
    // was asserted from resume.cwd and the actual provider request above.
    assert.ok(coldContext.includes(archived));
    assert.equal(fs.existsSync(path.join(home, 'auth.json')), false);
    console.log(JSON.stringify({ ok: true, cliVersion: started.thread.cliVersion, modelRequests: requests.length, remoteModelRequests: 0, historyTurns: history.data.length, measures }));
  } catch (error) {
    console.error(logs.join('').slice(-5000));
    throw error;
  } finally {
    await stopClient();
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

(async () => { for (const binary of binaries) await run(binary); })().catch((error) => { console.error(error); process.exitCode = 1; });
