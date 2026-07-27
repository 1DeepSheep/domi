const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { parse } = require("smol-toml");
const {
  DOMI_KEYCHAIN_ACCOUNT,
  DOMI_KEYCHAIN_SERVICE,
  DOMI_PROVIDER_ID,
  CodexBootstrapService,
  createElectronNetFetcher,
  fetchOfficialInstaller,
  isOfficialCodexInstallerUrl,
  mergeRelayConfig,
  normalizeRelayBaseUrl
} = require("../electron/codex-bootstrap.cjs");

function createRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-bootstrap-"));
}

test("relay URL policy requires HTTPS except for loopback development", () => {
  assert.equal(normalizeRelayBaseUrl("https://relay.example.com/v1/"), "https://relay.example.com/v1");
  assert.equal(normalizeRelayBaseUrl("http://127.0.0.1:8080/v1"), "http://127.0.0.1:8080/v1");
  assert.throws(() => normalizeRelayBaseUrl("http://relay.example.com/v1"), /HTTPS/);
  assert.throws(() => normalizeRelayBaseUrl("https://user:pass@example.com/v1"), /不能包含账号/);
  assert.throws(() => normalizeRelayBaseUrl("https://relay.example.com/v1?token=value"), /查询参数/);
});

test("official Codex installer accepts OpenAI release redirects and rejects lookalikes", () => {
  assert.equal(isOfficialCodexInstallerUrl("https://chatgpt.com/codex/install.sh"), true);
  assert.equal(isOfficialCodexInstallerUrl("https://releases.openai.com/codex/install.sh"), true);
  assert.equal(isOfficialCodexInstallerUrl("http://releases.openai.com/codex/install.sh"), false);
  assert.equal(isOfficialCodexInstallerUrl("https://releases.openai.com.evil.example/codex/install.sh"), false);
  assert.equal(
    isOfficialCodexInstallerUrl("https://user:pass" + "@releases.openai.com/codex/install.sh"),
    false
  );
});

test("official installer download accepts the OpenAI releases redirect", async () => {
  const validScript = `#!/bin/sh\n# CODEX_INSTALL_DIR\n${"x".repeat(5000)}`;
  let requests = 0;
  const script = await fetchOfficialInstaller(async (url, options) => {
    requests += 1;
    assert.equal(options.redirect, "manual");
    if (requests === 1) {
      assert.equal(url, "https://chatgpt.com/codex/install.sh");
      return {
        ok: false,
        status: 302,
        url,
        headers: {
          get: (name) => name === "location"
            ? "https://releases.openai.com/codex/install.sh"
            : ""
        },
        text: async () => ""
      };
    }
    assert.equal(url, "https://releases.openai.com/codex/install.sh");
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => "" },
      text: async () => validScript
    };
  });
  assert.equal(script, validScript);
  assert.equal(requests, 2);
});

test("official installer download still rejects non-OpenAI redirects", async () => {
  await assert.rejects(() => fetchOfficialInstaller(async () => ({
    ok: false,
    status: 302,
    url: "https://chatgpt.com/codex/install.sh",
    headers: {
      get: (name) => name === "location"
        ? "https://releases.openai.com.evil.example/codex/install.sh"
        : ""
    },
    text: async () => ""
  })), /非官方地址/);
});

test("official installer rejects a fetcher that silently follows to a non-OpenAI host", async () => {
  await assert.rejects(() => fetchOfficialInstaller(async () => ({
    ok: true,
    status: 200,
    url: "https://releases.openai.com.evil.example/codex/install.sh",
    headers: { get: () => "" },
    text: async () => `#!/bin/sh\n# CODEX_INSTALL_DIR\n${"x".repeat(5000)}`
  })), /非官方地址/);
});

test("Electron installer fetcher follows the system network stack without auto-following redirects", async () => {
  const validScript = `#!/bin/sh\n# CODEX_INSTALL_DIR\n${"x".repeat(5000)}`;
  const requested = [];
  const fakeNet = {
    request: (options) => {
      requested.push(options);
      const request = new EventEmitter();
      request.setHeader = () => {};
      request.abort = () => {};
      request.end = () => queueMicrotask(() => {
        if (requested.length === 1) {
          request.emit(
            "redirect",
            302,
            "GET",
            "https://releases.openai.com/codex/install.sh",
            { location: ["https://releases.openai.com/codex/install.sh"] }
          );
          request.emit("error", new Error("Redirect was cancelled"));
          return;
        }
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = { "content-type": ["text/x-shellscript"] };
        request.emit("response", response);
        response.emit("data", Buffer.from(validScript));
        response.emit("end");
      });
      return request;
    }
  };

  const script = await fetchOfficialInstaller(createElectronNetFetcher(fakeNet));

  assert.equal(script, validScript);
  assert.deepEqual(requested.map((request) => request.url), [
    "https://chatgpt.com/codex/install.sh",
    "https://releases.openai.com/codex/install.sh"
  ]);
  assert.equal(requested.every((request) => request.redirect === "manual"), true);
});

test("relay config preserves unrelated settings and uses a Keychain token command", () => {
  const merged = mergeRelayConfig({
    personality: "pragmatic",
    model_providers: {
      existing: {
        name: "Existing",
        base_url: "https://existing.example.com/v1",
        wire_api: "responses"
      }
    }
  }, {
    baseUrl: "https://relay.example.com/v1",
    model: "relay-model"
  });

  assert.equal(merged.personality, "pragmatic");
  assert.equal(merged.model, "relay-model");
  assert.equal(merged.model_provider, DOMI_PROVIDER_ID);
  assert.equal(merged.model_providers.existing.name, "Existing");
  assert.deepEqual(merged.model_providers[DOMI_PROVIDER_ID].auth, {
    command: "/usr/bin/security",
    args: [
      "find-generic-password",
      "-s",
      DOMI_KEYCHAIN_SERVICE,
      "-a",
      DOMI_KEYCHAIN_ACCOUNT,
      "-w"
    ],
    timeout_ms: 5000
  });
});

test("configuring a relay stores the credential outside config.toml", async () => {
  const root = createRoot();
  const credential = "example-credential";
  const writtenCredentials = [];
  try {
    const configDirectory = path.join(root, ".codex");
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(path.join(configDirectory, "config.toml"), [
      'model = "original-model"',
      'model_provider = "original-provider"',
      'personality = "friendly"',
      ""
    ].join("\n"));
    const service = new CodexBootstrapService({
      homeDir: root,
      resolveBinary: () => "/tmp/fake-codex",
      writeCredential: async (value) => writtenCredentials.push(value),
      exec: async (binary, args) => {
        if (binary === "/tmp/fake-codex" && args[0] === "--version") {
          return { stdout: "codex-cli test\n", stderr: "" };
        }
        if (binary === "/usr/bin/security" && args[0] === "find-generic-password") {
          throw new Error("not stored yet");
        }
        throw new Error(`unexpected command: ${binary} ${args.join(" ")}`);
      }
    });

    const result = await service.configureRelay({
      baseUrl: "https://relay.example.com/v1",
      model: "relay-model",
      apiKey: credential
    });
    assert.equal(result.ok, true);
    assert.deepEqual(writtenCredentials, [credential]);

    const configContent = fs.readFileSync(service.configPath(), "utf8");
    const config = parse(configContent);
    assert.equal(configContent.includes(credential), false);
    assert.equal(config.personality, "friendly");
    assert.equal(config.model_provider, DOMI_PROVIDER_ID);
    assert.equal(config.model_providers[DOMI_PROVIDER_ID].auth.command, "/usr/bin/security");
    assert.equal(fs.statSync(service.configPath()).mode & 0o777, 0o600);

    const restored = service.restoreChatGPTConfig();
    assert.equal(restored.ok, true);
    assert.equal(restored.changed, true);
    const restoredConfig = parse(fs.readFileSync(service.configPath(), "utf8"));
    assert.equal(restoredConfig.model, "original-model");
    assert.equal(restoredConfig.model_provider, "original-provider");
    assert.equal(restoredConfig.model_providers?.[DOMI_PROVIDER_ID], undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid relay settings are rejected before a credential is written", async () => {
  const root = createRoot();
  let credentialWrites = 0;
  try {
    const service = new CodexBootstrapService({
      homeDir: root,
      resolveBinary: () => "/tmp/fake-codex",
      writeCredential: async () => {
        credentialWrites += 1;
      },
      exec: async (binary, args) => {
        if (binary === "/tmp/fake-codex" && args[0] === "--version") {
          return { stdout: "codex-cli test\n", stderr: "" };
        }
        if (binary === "/usr/bin/security") throw new Error("not configured");
        throw new Error(`unexpected command: ${binary} ${args.join(" ")}`);
      }
    });

    const result = await service.configureRelay({
      baseUrl: "http://public-relay.example.com/v1",
      model: "relay-model",
      apiKey: "example-credential"
    });
    assert.equal(result.ok, false);
    assert.equal(credentialWrites, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("official installer is idempotent and installs to the user local bin directory", async () => {
  const root = createRoot();
  let installed = false;
  let installerCalls = 0;
  try {
    const service = new CodexBootstrapService({
      homeDir: root,
      fetchInstaller: async () => {
        installerCalls += 1;
        return "#!/bin/sh\nexit 0\n";
      },
      resolveBinary: (preferredPath) => {
        if (!installed) throw new Error("not installed");
        return preferredPath || path.join(root, ".local", "bin", "codex");
      },
      writeCredential: async () => {},
      sleep: async () => {},
      exec: async (binary, args, options) => {
        if (binary === "/bin/sh") {
          assert.equal(options.env.CODEX_NON_INTERACTIVE, "1");
          assert.equal(options.env.CODEX_INSTALL_DIR, path.join(root, ".local", "bin"));
          installed = true;
          return { stdout: "", stderr: "" };
        }
        if (args[0] === "--version") return { stdout: "codex-cli test\n", stderr: "" };
        if (binary === "/usr/bin/security") throw new Error("not configured");
        throw new Error("unexpected command");
      }
    });

    const first = await service.install();
    assert.equal(first.ok, true);
    assert.equal(first.installedNow, true);
    assert.equal(installerCalls, 1);

    const second = await service.install();
    assert.equal(second.ok, true);
    assert.equal(second.installedNow, false);
    assert.equal(installerCalls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("connection test is ephemeral, read-only, non-interactive, and verifies a tool call", async () => {
  const root = createRoot();
  try {
    let capturedArgs = [];
    const service = new CodexBootstrapService({
      homeDir: root,
      resolveBinary: () => "/tmp/fake-codex",
      runCodex: async (_binary, args, prompt) => {
        capturedArgs = args;
        assert.ok(prompt.includes("DOMI_TOOL_OK"));
        return {
          stdout: [
            '{"type":"item.completed","item":{"type":"command_execution","command":"/bin/zsh -lc \\"printf DOMI_TOOL_OK\\"","aggregated_output":"DOMI_TOOL_OK"}}',
            '{"type":"item.completed","item":{"type":"agent_message","text":"DOMI_CODEX_OK"}}'
          ].join("\n"),
          stderr: ""
        };
      }
    });
    const result = await service.testConnection();
    assert.equal(result.ok, true);
    assert.deepEqual(capturedArgs.slice(0, 3), ["--ask-for-approval", "never", "exec"]);
    assert.ok(capturedArgs.includes("--ephemeral"));
    assert.ok(capturedArgs.includes("--ignore-rules"));
    assert.equal(capturedArgs[capturedArgs.indexOf("--sandbox") + 1], "read-only");
    assert.equal(capturedArgs.at(-1), "-");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("connection test does not accept markers echoed outside completed tool and model events", async () => {
  const root = createRoot();
  try {
    const service = new CodexBootstrapService({
      homeDir: root,
      resolveBinary: () => "/tmp/fake-codex",
      runCodex: async () => ({
        stdout: [
          '{"type":"thread.started","prompt":"printf DOMI_TOOL_OK then reply DOMI_CODEX_OK"}',
          '{"type":"item.started","item":{"type":"command_execution","command":"printf DOMI_TOOL_OK"}}',
          '{"type":"item.completed","item":{"type":"agent_message","text":"DOMI_TOOL_OK DOMI_CODEX_OK"}}'
        ].join("\n"),
        stderr: ""
      })
    });
    const result = await service.testConnection();
    assert.equal(result.ok, false);
    assert.equal(result.modelOk, false);
    assert.equal(result.toolOk, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
