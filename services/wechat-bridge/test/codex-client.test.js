import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  managedCodexEnvironment,
  resolveManagedCodexPath,
} from "../src/codex-client.js";

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
  const environment = managedCodexEnvironment(resolved, { PATH: "/usr/bin" });
  assert.equal(environment.PATH.split(path.delimiter)[0], fs.realpathSync(path.join(releaseRoot, "codex-path")));
  assert.equal(
    environment.PATH.split(path.delimiter)[1],
    fs.realpathSync(path.join(releaseRoot, "codex-resources", "zsh", "bin")),
  );
  assert.equal(environment.PATH.split(path.delimiter).at(-1), "/usr/bin");
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
