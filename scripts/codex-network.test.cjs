const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const test = require("node:test");
const { createCodexNetworkResolver, parseProxyRules } = require("../electron/codex-network.cjs");
const { CodexAppServer } = require("../electron/codex-app-server.cjs");
const { codexClientIdleForSkillReload } = require("../electron/codex-run-context.cjs");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const childKeys = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"];
const relay = { authMode: "relay", providerEndpoint: "https://api.example.com/v1", env: {} };

function mainFunctions(names, dependencies, state = "") {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const functions = names.map(name => {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert(start >= 0, `Missing main function ${name}`);
    const rest = source.slice(start);
    const next = rest.slice(1).search(/^(?:async )?function \w+\(/m);
    assert(next >= 0, `Missing boundary after ${name}`);
    return rest.slice(0, next + 1);
  });
  const context = vm.createContext(dependencies);
  vm.runInContext(`${state}\n${functions.join("\n")}`, context);
  return context;
}

function runtimeHarness(resolver, connectionTarget) {
  return mainFunctions(["getPreparedCodexRuntime", "getCodexClient"], {
    crypto, process: { env: {} }, codexNetwork: resolver,
    getCodexRuntime: () => ({ authMode: "chatgpt", env: {} }),
    getCodexBootstrap: () => ({ connectionTarget }),
    CodexAppServer: class { constructor(options) { Object.assign(this, options); } },
    demoWorkspace: "/synthetic", app: { getVersion: () => "fixture" },
    handleCodexNotification() {}, handleCodexUserInputRequest() {}, handleCodexUserInputRequestClosed() {}
  }, 'var codexClient = null, codexNetworkFingerprint = "", codexNetworkDiagnostic = null;');
}

test("explicit uppercase and lowercase proxy environments win without a system lookup", async () => {
  for (const key of childKeys) {
    let lookups = 0;
    const resolver = createCodexNetworkResolver({ resolveProxy: () => { lookups++; return "DIRECT"; } });
    const input = Object.freeze({ [key]: "http://127.0.0.1:8123", KEEP: "untouched" });
    const result = await resolver.resolve({ ...relay, env: input });
    assert.equal(result.ok, true); assert.equal(lookups, 0);
    assert.equal(result.diagnostic.source, "environment");
    assert.equal(result.env[key.toUpperCase()], input[key]);
    assert.equal(result.env[key.toLowerCase()], input[key]);
    assert.equal(input.KEEP, "untouched"); assert.equal(result.env.KEEP, undefined);
  }
});

test("lowercase explicit proxy wins case conflicts and existing bypass lists are retained", async () => {
  const resolver = createCodexNetworkResolver();
  const result = await resolver.resolve({ ...relay, env: {
    HTTP_PROXY: "http://127.0.0.1:8123", http_proxy: "http://127.0.0.1:8124",
    HTTPS_PROXY: "http://127.0.0.1:8125", NO_PROXY: "internal.example.com,localhost",
    no_proxy: "other.example.com,127.0.0.1", ALL_PROXY: "socks5h://127.0.0.1:8126"
  } });
  assert.equal(result.env.HTTP_PROXY, "http://127.0.0.1:8124");
  assert.equal(result.env.https_proxy, "http://127.0.0.1:8125");
  assert.equal(result.env.all_proxy, "socks5h://127.0.0.1:8126");
  assert.equal(result.diagnostic.caseConflict, true);
  assert.deepEqual(new Set(result.env.NO_PROXY.split(",")), new Set([
    "internal.example.com", "other.example.com", "localhost", "127.0.0.1", "::1"
  ]));
  assert.equal(result.env.no_proxy, result.env.NO_PROXY);
});

test("credential-bearing explicit env is passed only to the child, never into diagnostics", async () => {
  const result = await createCodexNetworkResolver().resolve({ ...relay, env: {
    HTTPS_PROXY: "http://fixture:short@127.0.0.1:8123", NO_PROXY: "private.example.com"
  } });
  assert.equal(result.env.HTTPS_PROXY, "http://fixture:short@127.0.0.1:8123");
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /fixture|short|127\.0\.0\.1|8123|private/);
});

test("HTTP-only environment is preserved but does not falsely promise HTTPS proxy coverage", async () => {
  const result = await createCodexNetworkResolver().resolve({ ...relay, env: { HTTP_PROXY: "http://127.0.0.1:8123" } });
  assert.equal(result.diagnostic.httpsProxyConfigured, false);
  assert.equal(result.env.HTTPS_PROXY, "");
});

test("system PAC DIRECT keeps its priority over later proxies", async () => {
  const result = await createCodexNetworkResolver({ resolveProxy: async () => "DIRECT; PROXY 127.0.0.1:8123" }).resolve(relay);
  assert.equal(result.ok, true); assert.equal(result.diagnostic.source, "direct");
  assert.equal(result.diagnostic.fallbackLimited, true);
  for (const key of childKeys) assert.equal(result.env[key], "");
});

test("system HTTP, HTTPS, SOCKS4 and SOCKS5 proxies preserve the correct scheme", async () => {
  for (const [rule, expected, protocol] of [
    ["PROXY 127.0.0.1:8123", "http://127.0.0.1:8123", "http"],
    ["HTTP proxy.example.com:80", "http://proxy.example.com", "http"],
    ["HTTPS proxy.example.com:443", "https://proxy.example.com", "https"],
    ["SOCKS 127.0.0.1:8123", "socks4://127.0.0.1:8123", "socks4"],
    ["SOCKS4 127.0.0.1:8123", "socks4://127.0.0.1:8123", "socks4"],
    ["SOCKS5 [::1]:8123", "socks5h://[::1]:8123", "socks5h"]
  ]) {
    const result = await createCodexNetworkResolver({ resolveProxy: async () => rule }).resolve(relay);
    assert.equal(result.ok, true, rule); assert.equal(result.diagnostic.protocol, protocol);
    for (const key of childKeys) assert.equal(result.env[key], expected, rule);
    assert.deepEqual(new Set(result.env.NO_PROXY.split(",")), new Set(["localhost", "127.0.0.1", "::1"]));
  }
});

test("PAC fallback candidates are not skipped or falsely claimed to be automatic failover", () => {
  const parsed = parseProxyRules("PROXY first.example.com:8123; SOCKS5 second.example.com:8124; DIRECT");
  assert.equal(parsed.proxy, "http://first.example.com:8123");
  assert.equal(parsed.fallbackLimited, true);
  assert.equal(parseProxyRules("UNKNOWN first.example.com:8123; DIRECT").ok, false);
});

test("ChatGPT checks actual model and login destinations rather than a GitHub download rule", async () => {
  const targets = [];
  const result = await createCodexNetworkResolver({ resolveProxy: async target => { targets.push(target); return "DIRECT"; } }).resolve({ env: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(targets, ["https://chatgpt.com/backend-api/codex", "https://auth.openai.com/"]);
});

test("relay lookup uses its configured provider endpoint and removes query credentials", async () => {
  const targets = [];
  const result = await createCodexNetworkResolver({ resolveProxy: async target => { targets.push(target); return "DIRECT"; } })
    .resolve({ ...relay, providerEndpoint: "https://api.example.com/v1?private=fixture#fragment" });
  assert.equal(result.ok, true); assert.deepEqual(targets, ["https://api.example.com/v1"]);
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /fixture|api\.example/);
});

test("a common PAC proxy plus DIRECT login is represented using NO_PROXY", async () => {
  const result = await createCodexNetworkResolver({ resolveProxy: async target => target.includes("auth.openai.com")
    ? "DIRECT" : "PROXY 127.0.0.1:8123" }).resolve({ env: { NO_PROXY: "internal.example.com" } });
  assert.equal(result.ok, true); assert.equal(result.diagnostic.directTargetCount, 1);
  assert.equal(result.env.HTTPS_PROXY, "http://127.0.0.1:8123");
  assert(result.env.NO_PROXY.split(",").includes("auth.openai.com"));
  assert(result.env.NO_PROXY.split(",").includes("internal.example.com"));
  assert(!result.env.NO_PROXY.split(",").includes("chatgpt.com"));
});

test("different proxies and conflicting paths on one host are explicitly unsupported", async () => {
  for (const options of [
    { endpoints: ["https://api.example.com/v1", "https://login.example.com/"], secondRule: "PROXY 127.0.0.1:8124" },
    { endpoints: ["https://api.example.com/v1", "https://api.example.com/login"], secondRule: "DIRECT" },
    { endpoints: ["https://api.example.com/v1", "https://example.com/"], secondRule: "DIRECT" }
  ]) {
    const result = await createCodexNetworkResolver({ resolveProxy: async target => target.endsWith("/v1")
      ? "PROXY 127.0.0.1:8123" : options.secondRule }).resolve({ ...relay, endpoints: options.endpoints });
    assert.equal(result.ok, false); assert.equal(result.diagnostic.status, "unsupported_split_routing");
    assert.equal(result.diagnostic.code, "DOMI_CODEX_PROXY_SPLIT_UNSUPPORTED");
    for (const key of childKeys) assert.equal(result.env[key], "");
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /127\.0\.0\.1|8123|api\.example/);
  }
});

test("unavailable and rejected system lookups return bounded safe failures, never a DIRECT success", async () => {
  const absent = await createCodexNetworkResolver().resolve(relay);
  assert.equal(absent.ok, false); assert.equal(absent.diagnostic.code, "DOMI_CODEX_PROXY_LOOKUP_UNAVAILABLE");
  const failed = await createCodexNetworkResolver({ resolveProxy: async () => { throw new Error("PRIVATE_CONNECTION_DETAIL"); } }).resolve(relay);
  assert.equal(failed.ok, false); assert.equal(failed.diagnostic.code, "DOMI_CODEX_PROXY_LOOKUP_FAILED");
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_CONNECTION_DETAIL/);
});

test("parallel PAC queries share a short upper bound and late rejections cannot escape", async () => {
  const late = deferred();
  const result = await createCodexNetworkResolver({ resolveProxy: () => late.promise, timeoutMs: 15 }).resolve({ env: {} });
  assert.equal(result.ok, false); assert.equal(result.diagnostic.code, "DOMI_CODEX_PROXY_LOOKUP_TIMEOUT");
  late.reject(new Error("PRIVATE_LATE_DETAIL"));
  await new Promise(resolve => setImmediate(resolve));
});

test("invalid or credential-bearing system PAC rules never become a usable proxy", async () => {
  for (const rule of ["", "PROXY 127.0.0.1:0", "PROXY 127.0.0.1:99999", "PROXY fixture:short@127.0.0.1:8123", "PROXY bad/path:8123", "DIRECT extra", "PROXY localhost"]) {
    const result = await createCodexNetworkResolver({ resolveProxy: () => rule }).resolve(relay);
    assert.equal(result.ok, false, rule); assert.equal(result.diagnostic.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /fixture|short|127\.0\.0\.1/);
  }
});

test("invalid endpoint is reported before a proxy lookup", async () => {
  let calls = 0;
  const resolver = createCodexNetworkResolver({ resolveProxy: () => { calls++; return "DIRECT"; } });
  for (const providerEndpoint of ["", "bad endpoint", "file:///tmp/example", "https://fixture:short@127.0.0.1:8123"]) {
    const result = await resolver.resolve({ ...relay, providerEndpoint });
    assert.equal(result.ok, false); assert.equal(result.diagnostic.code, "DOMI_CODEX_PROXY_ENDPOINT_INVALID");
  }
  assert.equal(calls, 0);
});

test("cached system lookup is shared, refresh and expiration detect VPN changes", async () => {
  let clock = 0, calls = 0, rule = "PROXY 127.0.0.1:8123";
  const resolver = createCodexNetworkResolver({ resolveProxy: async () => { calls++; return rule; }, now: () => clock, cacheTtlMs: 100 });
  const first = await resolver.resolve(relay);
  assert.equal(first.env.HTTPS_PROXY, "http://127.0.0.1:8123");
  rule = "SOCKS5 127.0.0.1:8124";
  assert.equal((await resolver.resolve(relay)).diagnostic.cached, true); assert.equal(calls, 1);
  const refreshed = await resolver.resolve({ ...relay, refresh: true });
  assert.equal(refreshed.env.ALL_PROXY, "socks5h://127.0.0.1:8124"); assert.equal(calls, 2);
  rule = "DIRECT"; clock = 101;
  assert.equal((await resolver.resolve(relay)).diagnostic.source, "direct"); assert.equal(calls, 3);
  resolver.invalidate(); await resolver.resolve(relay); assert.equal(calls, 4);
});

test("concurrent reads share lookup but retain each caller's NO_PROXY", async () => {
  const late = deferred(); let calls = 0;
  const resolver = createCodexNetworkResolver({ resolveProxy: () => { calls++; return late.promise; } });
  const first = resolver.resolve({ ...relay, env: { NO_PROXY: "one.example.com" } });
  const second = resolver.resolve({ ...relay, env: { NO_PROXY: "two.example.com" } });
  late.resolve("PROXY 127.0.0.1:8123");
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1); assert(a.env.NO_PROXY.includes("one.example.com"));
  assert(b.env.NO_PROXY.includes("two.example.com")); assert(!b.env.NO_PROXY.includes("one.example.com"));
});

test("a late pre-refresh lookup cannot overwrite the refreshed VPN route", async () => {
  const old = deferred(); let calls = 0;
  const resolver = createCodexNetworkResolver({ resolveProxy: () => ++calls === 1 ? old.promise : "PROXY 127.0.0.1:8124" });
  const first = resolver.resolve(relay);
  await new Promise(resolve => setImmediate(resolve));
  const fresh = await resolver.resolve({ ...relay, refresh: true });
  assert.equal(fresh.env.HTTP_PROXY, "http://127.0.0.1:8124");
  old.resolve("PROXY 127.0.0.1:8123");
  const obsolete = await first;
  assert.equal(obsolete.ok, false); assert.equal(obsolete.diagnostic.status, "superseded");
  assert.equal((await resolver.resolve(relay)).env.HTTP_PROXY, "http://127.0.0.1:8124");
});


test("invalidating an in-flight network lookup revokes its result", async () => {
  const old = deferred();
  const resolver = createCodexNetworkResolver({ resolveProxy: () => old.promise });
  const pending = resolver.resolve(relay);
  resolver.invalidate(); old.resolve("PROXY 127.0.0.1:8123");
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.diagnostic.code, "DOMI_CODEX_PROXY_LOOKUP_SUPERSEDED");
});

test("concurrent inherited provider preparation tags the client with its own environment", async () => {
  let calls = 0;
  const resolver = createCodexNetworkResolver({ resolveProxy: async target => target.includes("first.")
    ? "PROXY 127.0.0.1:8123" : "PROXY 127.0.0.1:8124" });
  const context = runtimeHarness(resolver, () => ({ authMode: "relay", providerEndpoint: ++calls === 1
    ? "https://first.example.com/v1" : "https://second.example.com/v1" }));
  // An external Codex config edit can change the inherited provider while an
  // already-running preparation is waiting for Electron's system proxy lookup.
  const client = context.getCodexClient();
  const [clientRuntime, otherRuntime] = await Promise.all([client.runtimeProvider(), context.getPreparedCodexRuntime()]);
  assert.equal(clientRuntime.env.HTTPS_PROXY, "http://127.0.0.1:8123");
  assert.equal(otherRuntime.env.HTTPS_PROXY, "http://127.0.0.1:8124");
  const expected = crypto.createHash("sha256").update(JSON.stringify(clientRuntime.env)).digest("hex");
  assert.equal(clientRuntime.networkFingerprint, expected);
  assert.equal(client.networkFingerprint, expected);
  assert.notEqual(client.networkFingerprint, otherRuntime.networkFingerprint);
});

test("main runtime preparation joins a newer refresh instead of exposing a superseded failure", async () => {
  const old = deferred(); let calls = 0;
  const resolver = createCodexNetworkResolver({ resolveProxy: () => ++calls === 1
    ? old.promise : "PROXY 127.0.0.1:8124" });
  const context = runtimeHarness(resolver, () => ({ authMode: "relay", providerEndpoint: relay.providerEndpoint }));
  const original = context.getPreparedCodexRuntime();
  await new Promise(resolve => setImmediate(resolve));
  const refreshed = await context.getPreparedCodexRuntime({ refresh: true });
  old.resolve("PROXY 127.0.0.1:8123");
  const joined = await original;
  assert.equal(joined.env.HTTPS_PROXY, "http://127.0.0.1:8124");
  assert.equal(joined.networkFingerprint, refreshed.networkFingerprint);
  assert.equal(calls, 2);
});

test("a pending network reload waits for active and starting tasks and rechecks when scheduled", () => {
  const activeRuns = new Map([["fixture", {}]]), startingCodexRunIds = new Set(), scheduled = [];
  let closes = 0, invalidations = 0;
  const context = mainFunctions(["schedulePendingSkillHubCodexReload", "resetCodexClient"], {
    activeRuns, startingCodexRunIds, codexClientIdleForSkillReload,
    setImmediate: callback => scheduled.push(callback),
    serviceCoordinator: { invalidate: () => { invalidations++; } },
    liveCodexThreads: new Map(), codexThreadTurnIds: new Map(), resolvedCodexUserInputs: new Set(),
    fixtureClient: { close: () => { closes++; } }
  }, 'var codexClient = fixtureClient, codexNetworkReloadPending = true, skillHubCodexReloadPending = false, codexCheckGeneration = 0;');
  context.schedulePendingSkillHubCodexReload();
  assert.equal(scheduled.length, 0);
  activeRuns.clear(); startingCodexRunIds.add("starting");
  context.schedulePendingSkillHubCodexReload();
  assert.equal(scheduled.length, 0);
  startingCodexRunIds.clear(); context.schedulePendingSkillHubCodexReload();
  assert.equal(scheduled.length, 1);
  activeRuns.set("new", {}); scheduled.shift()();
  assert.equal(closes, 0); assert.equal(context.codexNetworkReloadPending, true);
  activeRuns.clear(); context.schedulePendingSkillHubCodexReload(); scheduled.shift()();
  assert.equal(closes, 1); assert.equal(invalidations, 1);
  assert.equal(context.codexClient, null); assert.equal(context.codexNetworkReloadPending, false);
});

test("resolved PAC routes reach a real subprocess and a refresh applies only to a new process", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "domi-network-child-"));
  const binary = path.join(temporary, "codex");
  const observedKeys = [...childKeys, "NO_PROXY", "no_proxy"];
  // This synthetic stdio server only echoes the explicitly supplied proxy keys.
  // It does not contact a service, read a Codex home, or execute model tasks.
  fs.writeFileSync(binary, `#!/usr/bin/env node
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (!request.id) return;
  const result = request.method === "fixture/environment"
    ? Object.fromEntries(${JSON.stringify(observedKeys)}.map(key => [key, process.env[key]])) : {};
  process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
});
`, { mode: 0o755 });
  fs.writeFileSync(path.join(temporary, "codex-code-mode-host"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  let rule = "PROXY 127.0.0.1:8123";
  const resolver = createCodexNetworkResolver({ resolveProxy: target => target.includes("auth.openai.com") ? "DIRECT" : rule });
  const prepared = () => resolver.resolve({ env: { NO_PROXY: "internal.example.com" } });
  const clients = [];
  const createClient = () => {
    const client = new CodexAppServer({
      cwd: temporary, version: "fixture", requestTimeoutMs: 5_000,
      runtimeProvider: async () => {
        const result = await prepared();
        assert.equal(result.ok, true);
        return { codexPath: binary, env: result.env };
      }
    });
    clients.push(client);
    return client;
  };
  try {
    const original = createClient();
    const first = await original.request("fixture/environment");
    for (const key of childKeys) assert.equal(first[key], "http://127.0.0.1:8123");
    assert.equal(first.NO_PROXY, first.no_proxy);
    for (const host of ["localhost", "127.0.0.1", "::1", "internal.example.com", "auth.openai.com"]) {
      assert(first.NO_PROXY.split(",").includes(host));
    }
    rule = "SOCKS5 127.0.0.1:8124";
    await resolver.resolve({ env: {}, refresh: true });
    assert.deepEqual(await original.request("fixture/environment"), first);
    original.close();
    const next = await createClient().request("fixture/environment");
    for (const key of childKeys) assert.equal(next[key], "socks5h://127.0.0.1:8124");
    assert.equal(next.NO_PROXY, first.NO_PROXY);
  } finally {
    for (const client of clients) client.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
