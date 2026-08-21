import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  managedCodexEnvironment,
  resolveManagedCodexPath,
} from "../src/codex-client.js";
import {
  parseMacSystemProxy,
  resolvedProxyEnvironment,
} from "../src/proxy-environment.js";

test("Weixin bridge prefers Domi's managed Codex runtime and companion tools", (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "domi-managed-codex-"));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const releaseRoot = path.join(homeDir, ".codex", "packages", "standalone", "releases", "0.145.0-test");
  const binary = path.join(releaseRoot, "bin", "codex");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.mkdirSync(path.join(releaseRoot, "codex-path"), { recursive: true });
  fs.mkdirSync(path.join(releaseRoot, "codex-resources", "zsh", "bin"), { recursive: true });
  fs.writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
  fs.mkdirSync(path.join(homeDir, ".local", "bin"), { recursive: true });
  fs.symlinkSync(binary, path.join(homeDir, ".local", "bin", "codex"));

  const resolved = resolveManagedCodexPath({ homeDir, environment: {} });
  assert.equal(resolved, path.join(homeDir, ".local", "bin", "codex"));
  const environment = managedCodexEnvironment(resolved, { PATH: "/usr/bin" }, {});
  assert.equal(environment.PATH.split(path.delimiter)[0], fs.realpathSync(path.join(releaseRoot, "codex-path")));
  assert.equal(
    environment.PATH.split(path.delimiter)[1],
    fs.realpathSync(path.join(releaseRoot, "codex-resources", "zsh", "bin")),
  );
  assert.equal(environment.PATH.split(path.delimiter).at(-1), "/usr/bin");
});

test("Weixin bridge converts the active macOS proxy into Codex CLI environment variables", () => {
  const systemProxy = parseMacSystemProxy(`<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : *.local
    2 : <local>
  }
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}`);
  const environment = resolvedProxyEnvironment({}, systemProxy);

  assert.equal(environment.http_proxy, "http://127.0.0.1:7897");
  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:7897");
  assert.equal(environment.all_proxy, "socks5h://127.0.0.1:7897");
  assert.equal(environment.NO_PROXY, "127.0.0.1,.local");
});

test("explicit proxy settings override macOS system proxy settings", () => {
  const environment = resolvedProxyEnvironment(
    { https_proxy: "http://explicit.example:8080" },
    { https_proxy: "http://system.example:7897" },
  );
  assert.equal(environment.https_proxy, "http://explicit.example:8080");
  assert.equal(environment.HTTPS_PROXY, "http://explicit.example:8080");
});

test("an explicit executable Codex path overrides the managed default", (t) => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "domi-explicit-codex-"));
  t.after(() => fs.rmSync(homeDir, { recursive: true, force: true }));
  const explicit = path.join(homeDir, "custom-codex");
  fs.writeFileSync(explicit, "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(
    resolveManagedCodexPath({ homeDir, environment: { CODEX_WECHAT_CODEX_PATH: explicit } }),
    explicit,
  );
});
