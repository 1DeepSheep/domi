// Electron resolves the macOS/PAC routing rules; Codex is a separate process
// and needs an equivalent environment. Never change the system proxy settings.
const DEFAULT_CHATGPT_ENDPOINT = "https://chatgpt.com/backend-api/codex";
const DEFAULT_AUTH_ENDPOINT = "https://auth.openai.com";
const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];
const LOCAL_BYPASS = ["localhost", "127.0.0.1", "::1"];

function bypassEntries(...values) {
  return [...new Set(values.flatMap(value => String(value || "").split(","))
    .map(value => value.trim()).filter(Boolean))];
}

function environmentOverrides(environment = {}) {
  const env = {};
  let explicit = false;
  let caseConflict = false;
  for (const upper of PROXY_KEYS) {
    const lower = upper.toLowerCase();
    const lowerValue = String(environment[lower] || "").trim();
    const upperValue = String(environment[upper] || "").trim();
    // Lowercase is the conventional proxy spelling. Normalize both aliases so
    // differing client libraries cannot silently choose different routes.
    const value = lowerValue || upperValue;
    caseConflict ||= Boolean(lowerValue && upperValue && lowerValue !== upperValue);
    explicit ||= Boolean(value);
    env[upper] = env[lower] = value;
  }
  const bypass = bypassEntries(environment.no_proxy, environment.NO_PROXY, ...LOCAL_BYPASS);
  env.NO_PROXY = env.no_proxy = bypass.join(",");
  return { env, explicit, caseConflict };
}

function normalizedEndpoint(value) {
  const endpoint = new URL(String(value || ""));
  if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("Invalid service endpoint");
  }
  // Only the service address belongs in a proxy lookup, never query credentials.
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.href;
}

function serviceEndpoints({ authMode = "chatgpt", providerEndpoint, endpoints } = {}) {
  const values = endpoints || (authMode === "relay"
    ? [providerEndpoint]
    : [providerEndpoint || DEFAULT_CHATGPT_ENDPOINT, DEFAULT_AUTH_ENDPOINT]);
  if (!Array.isArray(values) || !values.length || values.length > 8) throw new Error("Invalid endpoints");
  return [...new Set(values.map(normalizedEndpoint))];
}

function parseProxyRules(rules) {
  const candidates = String(rules || "").split(";").map(value => value.trim()).filter(Boolean);
  if (!candidates.length) return { ok: false, code: "DOMI_CODEX_PROXY_RULES_INVALID" };
  const fallbackLimited = candidates.length > 1;
  // DIRECT is an ordered candidate, not something to skip in search of a proxy.
  if (/^DIRECT$/i.test(candidates[0])) return { ok: true, kind: "direct", fallbackLimited };
  const match = candidates[0].match(/^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+([^\s]+)$/i);
  if (!match) return { ok: false, code: "DOMI_CODEX_PROXY_RULES_UNSUPPORTED" };
  const address = match[2].match(/^(\[[0-9a-f:.]+\]|[a-z0-9_.-]+):(\d{1,5})$/i);
  if (!address || Number(address[2]) < 1 || Number(address[2]) > 65535) {
    return { ok: false, code: "DOMI_CODEX_PROXY_RULES_INVALID" };
  }
  const protocol = { PROXY: "http", HTTP: "http", HTTPS: "https", SOCKS: "socks4", SOCKS4: "socks4", SOCKS5: "socks5h" }[match[1].toUpperCase()];
  try {
    const proxy = new URL(`${protocol}://${address[1]}:${Number(address[2])}`);
    return { ok: true, kind: "proxy", protocol, proxy: proxy.href.replace(/\/$/, ""), fallbackLimited };
  } catch {
    return { ok: false, code: "DOMI_CODEX_PROXY_RULES_INVALID" };
  }
}

function routingEnvironment(targets, routes, baseEnv) {
  const failed = routes.find(route => !route.ok);
  if (failed) return { ok: false, env: baseEnv, diagnostic: {
    source: "system", status: "unavailable", code: failed.code,
    targetCount: targets.length, fallbackLimited: false
  } };
  const proxies = [...new Set(routes.filter(route => route.kind === "proxy").map(route => route.proxy))];
  const hostRoutes = new Map();
  let conflictingHost = false;
  targets.forEach((target, index) => {
    const host = new URL(target).hostname;
    const route = routes[index].kind === "direct" ? "DIRECT" : routes[index].proxy;
    if (hostRoutes.has(host) && hostRoutes.get(host) !== route) conflictingHost = true;
    hostRoutes.set(host, route);
  });
  const fallbackLimited = routes.some(route => route.fallbackLimited);
  const directHostnames = targets.filter((_target, index) => routes[index].kind === "direct")
    .map(target => new URL(target).hostname);
  // NO_PROXY domain entries commonly cover subdomains too. Do not generate a
  // bypass for a parent domain that would accidentally bypass a proxied target.
  const bypassConflict = targets.some((target, index) => routes[index].kind === "proxy"
    && directHostnames.some(host => new URL(target).hostname.endsWith(`.${host}`)));
  if (proxies.length > 1 || conflictingHost || bypassConflict) return { ok: false, env: baseEnv, diagnostic: {
    source: "system", status: "unsupported_split_routing", code: "DOMI_CODEX_PROXY_SPLIT_UNSUPPORTED",
    targetCount: targets.length, fallbackLimited
  } };
  const directHosts = targets.filter((_target, index) => routes[index].kind === "direct")
    .map(target => new URL(target).hostname.replace(/^\[|\]$/g, ""));
  const env = { ...baseEnv };
  if (proxies.length) {
    // A single HTTP(S) or SOCKS proxy can serve both URL schemes. Set both
    // protocol-specific and catch-all spellings for CLI/library compatibility.
    for (const key of PROXY_KEYS) env[key] = env[key.toLowerCase()] = proxies[0];
    env.NO_PROXY = env.no_proxy = bypassEntries(baseEnv.NO_PROXY, ...directHosts).join(",");
  }
  return { ok: true, env, diagnostic: {
    source: proxies.length ? "system" : "direct",
    status: proxies.length ? "proxy" : "direct",
    protocol: routes.find(route => route.kind === "proxy")?.protocol || "direct",
    targetCount: targets.length, directTargetCount: directHosts.length, fallbackLimited
  } };
}

function createCodexNetworkResolver({
  resolveProxy,
  timeoutMs = 1_500,
  cacheTtlMs = 30_000,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const revisions = new Map();
  let generation = 0;
  const timeout = Math.max(1, Math.min(Number(timeoutMs) || 1_500, 5_000));
  const ttl = Math.max(0, Math.min(Number(cacheTtlMs) || 0, 60_000));

  async function lookup(target) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => resolveProxy(target)).then(parseProxyRules,
          () => ({ ok: false, code: "DOMI_CODEX_PROXY_LOOKUP_FAILED" })),
        new Promise(resolve => { timer = setTimeoutFn(() => resolve({ ok: false, code: "DOMI_CODEX_PROXY_LOOKUP_TIMEOUT" }), timeout); })
      ]);
    } finally { if (timer !== undefined) clearTimeoutFn(timer); }
  }

  return {
    invalidate() { generation++; cache.clear(); pending.clear(); revisions.clear(); },
    async resolve(options = {}) {
      const base = environmentOverrides(options.env || process.env);
      if (base.explicit) return { ok: true, env: base.env, diagnostic: {
        source: "environment", status: "proxy", caseConflict: base.caseConflict,
        noProxyPreserved: true, localBypass: true,
        httpsProxyConfigured: Boolean(base.env.HTTPS_PROXY || base.env.ALL_PROXY)
      } };
      let targets;
      try { targets = serviceEndpoints(options); }
      catch { return { ok: false, env: base.env, diagnostic: {
        source: "system", status: "unavailable", code: "DOMI_CODEX_PROXY_ENDPOINT_INVALID"
      } }; }
      if (typeof resolveProxy !== "function") return { ok: false, env: base.env, diagnostic: {
        source: "system", status: "unavailable", code: "DOMI_CODEX_PROXY_LOOKUP_UNAVAILABLE"
      } };
      const key = JSON.stringify(targets);
      if (options.refresh) { cache.delete(key); pending.delete(key); }
      const requestedGeneration = generation;
      let entry = cache.get(key);
      let cached = Boolean(entry && entry.expiresAt > now());
      if (!cached) {
        let work = pending.get(key);
        if (!work) {
          const startedGeneration = generation;
          revisions.set(key, (revisions.get(key) || 0) + 1);
          work = Promise.all(targets.map(lookup));
          pending.set(key, work);
          void work.then(routes => {
            // An older result cannot replace a refreshed VPN/PAC lookup.
            if (generation !== startedGeneration || pending.get(key) !== work) return;
            pending.delete(key);
            if (cache.size >= 32) cache.delete(cache.keys().next().value);
            cache.set(key, { routes, expiresAt: now() + (routes.every(route => route.ok) ? ttl : Math.min(ttl, 1_000)) });
          });
        }
        const requestedRevision = revisions.get(key);
        entry = { routes: await work };
        if (generation !== requestedGeneration || revisions.get(key) !== requestedRevision) return {
          ok: false, env: base.env, diagnostic: {
            source: "system", status: "superseded", code: "DOMI_CODEX_PROXY_LOOKUP_SUPERSEDED"
          }
        };
      }
      const result = routingEnvironment(targets, entry.routes, base.env);
      return { ...result, diagnostic: { ...result.diagnostic, cached, localBypass: true, noProxyPreserved: true } };
    }
  };
}

module.exports = { createCodexNetworkResolver, parseProxyRules };
