const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { parse, stringify } = require("smol-toml");
const {
  codexEnvironment,
  resolveCodexBinary
} = require("./codex-app-server.cjs");

const execFileAsync = promisify(execFile);
const CODEX_INSTALLER_URL = "https://chatgpt.com/codex/install.sh";
const OFFICIAL_CODEX_INSTALLER_HOSTS = new Set([
  "chatgpt.com",
  "www.chatgpt.com",
  "releases.openai.com"
]);
const DOMI_PROVIDER_ID = "domi_relay";
const DOMI_KEYCHAIN_SERVICE = "com.domi.codex.relay";
const DOMI_KEYCHAIN_ACCOUNT = "provider-api-key";

function userFacingError(error) {
  return String(error instanceof Error ? error.message : error || "未知错误")
    .replace(/https?:\/\/[^\s"'`]+/gi, "[远程地址]")
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{12,}\b/g, "[已隐藏密钥]")
    .slice(0, 800);
}

function normalizeRelayBaseUrl(value) {
  const raw = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("请输入完整的中转站地址，例如 https://relay.example.com/v1。");
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) {
    throw new Error("中转站必须使用 HTTPS；仅本机 localhost 可以使用 HTTP。");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("中转站地址不能包含账号、密码、查询参数或锚点。");
  }
  return parsed.href.replace(/\/+$/, "");
}

function normalizeRelayModel(value) {
  const model = String(value || "").trim();
  if (!model || model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    throw new Error("请输入中转站实际支持的模型名称。");
  }
  return model;
}

function keychainAuthConfig() {
  return {
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
  };
}

function isOfficialCodexInstallerUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && OFFICIAL_CODEX_INSTALLER_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function headerValue(headers, name) {
  if (headers && typeof headers.get === "function") {
    return headers.get(name) || "";
  }
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function createElectronNetFetcher(netModule, {
  timeoutMs = 30_000,
  maxBodyBytes = 1024 * 1024
} = {}) {
  if (!netModule || typeof netModule.request !== "function") {
    throw new Error("Electron 网络模块不可用。");
  }
  return (url, options = {}) => new Promise((resolve, reject) => {
    let settled = false;
    let responseBody;
    let abortHandler;
    const request = netModule.request({
      url,
      method: "GET",
      redirect: "manual"
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal && abortHandler) {
        options.signal.removeEventListener("abort", abortHandler);
      }
      callback();
    };
    const fail = (error) => finish(() => reject(error));
    const timer = setTimeout(() => {
      request.abort();
      fail(new Error("Codex 官方安装程序下载超时。"));
    }, timeoutMs);

    for (const [name, value] of Object.entries(options.headers || {})) {
      request.setHeader(name, value);
    }
    request.on("redirect", (statusCode, _method, redirectUrl, responseHeaders) => {
      finish(() => resolve({
        ok: false,
        status: statusCode,
        url,
        headers: {
          get: (name) => name.toLowerCase() === "location"
            ? redirectUrl
            : headerValue(responseHeaders, name)
        },
        text: async () => ""
      }));
    });
    request.on("response", (response) => {
      const chunks = [];
      let receivedBytes = 0;
      response.on("data", (chunk) => {
        if (settled) return;
        const value = Buffer.from(chunk);
        receivedBytes += value.length;
        if (receivedBytes > maxBodyBytes) {
          request.abort();
          fail(new Error("Codex 官方安装程序内容过大，已停止下载。"));
          return;
        }
        chunks.push(value);
      });
      response.on("error", fail);
      response.on("end", () => {
        responseBody = Buffer.concat(chunks).toString("utf8");
        finish(() => resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          url,
          headers: {
            get: (name) => headerValue(response.headers, name)
          },
          text: async () => responseBody
        }));
      });
    });
    request.on("error", fail);
    if (options.signal) {
      abortHandler = () => {
        request.abort();
        fail(options.signal.reason || new Error("Codex 官方安装程序下载已取消。"));
      };
      if (options.signal.aborted) {
        abortHandler();
        return;
      }
      options.signal.addEventListener("abort", abortHandler, { once: true });
    }
    request.end();
  });
}

function mergeRelayConfig(source, { baseUrl, model }) {
  const config = source && typeof source === "object" ? structuredClone(source) : {};
  config.model = normalizeRelayModel(model);
  config.model_provider = DOMI_PROVIDER_ID;
  config.model_providers = config.model_providers && typeof config.model_providers === "object"
    ? config.model_providers
    : {};
  config.model_providers[DOMI_PROVIDER_ID] = {
    name: "domi Responses 中转站",
    base_url: normalizeRelayBaseUrl(baseUrl),
    wire_api: "responses",
    request_max_retries: 4,
    stream_max_retries: 5,
    stream_idle_timeout_ms: 300000,
    auth: keychainAuthConfig()
  };
  return config;
}

async function fetchOfficialInstaller(fetcher = fetch) {
  let currentUrl = CODEX_INSTALLER_URL;
  const signal = AbortSignal.timeout(30_000);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (!isOfficialCodexInstallerUrl(currentUrl)) {
      throw new Error("Codex 安装程序被重定向到了非官方地址，已停止安装。");
    }
    const response = await fetcher(currentUrl, {
      redirect: "manual",
      headers: { "user-agent": "domi Codex Bootstrap" },
      signal
    });
    if (response.status >= 300 && response.status < 400) {
      const location = headerValue(response.headers, "location");
      if (!location) {
        throw new Error("Codex 官方安装程序返回了无效的重定向。");
      }
      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).href;
      } catch {
        throw new Error("Codex 官方安装程序返回了无效的重定向。");
      }
      if (!isOfficialCodexInstallerUrl(nextUrl)) {
        throw new Error("Codex 安装程序被重定向到了非官方地址，已停止安装。");
      }
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Codex 官方安装程序下载失败（HTTP ${response.status}）。`);
    }
    if (response.url && !isOfficialCodexInstallerUrl(response.url)) {
      throw new Error("Codex 安装程序被重定向到了非官方地址，已停止安装。");
    }
    const script = await response.text();
    if (!script.startsWith("#!/bin/sh") || !script.includes("CODEX_INSTALL_DIR") || script.length < 5000) {
      throw new Error("Codex 官方安装程序内容校验失败。");
    }
    return script;
  }
  throw new Error("Codex 官方安装程序重定向次数过多，已停止安装。");
}

function writeCredentialToKeychain(credential) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", [
      "add-generic-password",
      "-U",
      "-s",
      DOMI_KEYCHAIN_SERVICE,
      "-a",
      DOMI_KEYCHAIN_ACCOUNT,
      "-w"
    ], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("写入 macOS 钥匙串超时。"));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `macOS 钥匙串返回 ${code}。`));
    });
    child.stdin.end(`${credential}\n${credential}\n`);
  });
}

function runCodexWithPrompt(binary, args, prompt, {
  env,
  timeout = 2 * 60_000,
  maxBuffer = 8 * 1024 * 1024
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) > maxBuffer) {
        child.kill("SIGTERM");
        finish(() => reject(new Error("Codex 连接测试输出过大，已停止。")));
        return current;
      }
      return next;
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("Codex 连接测试超时。")));
    }, timeout);
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      finish(() => reject(error));
    });
    child.once("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(stderr.trim() || `Codex 连接测试退出（${code}）。`));
      });
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") finish(() => reject(error));
    });
    child.stdin.end(prompt);
  });
}

class CodexBootstrapService {
  constructor({
    homeDir = os.homedir(),
    exec = execFileAsync,
    fetchInstaller = fetchOfficialInstaller,
    resolveBinary = resolveCodexBinary,
    installBundled = null,
    runtimeManager = null,
    installerEnvironment = async () => ({}),
    writeCredential = writeCredentialToKeychain,
    runCodex = runCodexWithPrompt,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  } = {}) {
    this.homeDir = homeDir;
    this.exec = exec;
    this.fetchInstaller = fetchInstaller;
    this.resolveBinary = resolveBinary;
    this.installBundled = installBundled;
    this.runtimeManager = runtimeManager;
    this.installerEnvironment = installerEnvironment;
    this.writeCredential = writeCredential;
    this.runCodex = runCodex;
    this.sleep = sleep;
  }

  configPath() {
    return path.join(this.homeDir, ".codex", "config.toml");
  }

  providerStatePath() {
    return path.join(this.homeDir, ".codex", "domi-provider-state.json");
  }

  async status(preferredPath = "") {
    try {
      const binary = this.resolveBinary(preferredPath);
      const { stdout } = await this.exec(binary, ["--version"], {
        env: codexEnvironment(),
        timeout: 15_000
      });
      return {
        ok: true,
        installed: true,
        path: binary,
        version: String(stdout || "").trim(),
        credentialStored: await this.hasRelayCredential()
      };
    } catch (error) {
      return {
        ok: false,
        installed: false,
        path: "",
        version: "",
        credentialStored: false,
        error: userFacingError(error)
      };
    }
  }

  async install() {
    const existing = await this.status();
    if (existing.ok) return { ...existing, installedNow: false };

    if (this.installBundled) {
      try {
        const installed = await this.installBundled();
        await this.sleep(100);
        const status = await this.status(installed.path);
        if (!status.ok) {
          throw new Error(status.error || "内置 Codex Runtime 已安装，但没有找到可执行文件。");
        }
        return { ...status, installedNow: true, source: "bundled" };
      } catch (error) {
        return {
          ok: false,
          installed: false,
          installedNow: false,
          path: "",
          version: "",
          credentialStored: false,
          error: userFacingError(error)
        };
      }
    }

    return this.installOnline();
  }

  async installOnline({ update = false } = {}) {
    const previous = update ? this.runtimeManager?.captureCurrent?.() : null;
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-install-"));
    const installerPath = path.join(temporaryDirectory, "install.sh");
    try {
      const script = await this.fetchInstaller();
      fs.writeFileSync(installerPath, script, { mode: 0o700 });
      const proxyEnvironment = await this.installerEnvironment();
      await this.exec("/bin/sh", [installerPath], {
        env: codexEnvironment({
          HOME: this.homeDir,
          CODEX_NON_INTERACTIVE: "1",
          CODEX_INSTALL_DIR: path.join(this.homeDir, ".local", "bin"),
          ...proxyEnvironment
        }),
        timeout: 5 * 60_000,
        maxBuffer: 4 * 1024 * 1024
      });
      await this.sleep(100);
      const installedPath = path.join(this.homeDir, ".local", "bin", "codex");
      const status = await this.status(installedPath);
      if (!status.ok) {
        throw new Error(status.error || "Codex 已执行安装，但没有找到可执行文件。");
      }
      if (update && this.runtimeManager) {
        const runtime = await this.runtimeManager.recordExternalUpdate(previous);
        return {
          ...status,
          ...runtime,
          runtime,
          installedNow: true,
          source: "official-update"
        };
      }
      return { ...status, installedNow: true, source: "official" };
    } catch (error) {
      if (update && previous) this.runtimeManager?.restoreCaptured?.(previous);
      return {
        ok: false,
        installed: false,
        installedNow: false,
        path: "",
        version: "",
        credentialStored: false,
        error: userFacingError(error)
      };
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async updateRuntime() {
    return this.installOnline({ update: true });
  }

  async runtimeStatus() {
    if (!this.runtimeManager) {
      const status = await this.status();
      return {
        ...status,
        managed: false,
        bundledVersion: "",
        rollbackAvailable: false,
        rollbackVersion: ""
      };
    }
    const managed = await this.runtimeManager.snapshot();
    if (managed.ok) return managed;
    const external = await this.status();
    if (!external.ok) return managed;
    return {
      ...managed,
      ok: true,
      managed: false,
      path: external.path,
      version: external.version,
      error: ""
    };
  }

  async rollbackRuntime() {
    try {
      if (!this.runtimeManager) throw new Error("当前版本不支持 Codex Runtime 回退。");
      return await this.runtimeManager.rollback();
    } catch (error) {
      return { ok: false, error: userFacingError(error) };
    }
  }

  readConfig() {
    const targetPath = this.configPath();
    if (!fs.existsSync(targetPath)) return {};
    const content = fs.readFileSync(targetPath, "utf8");
    if (!content.trim()) return {};
    return parse(content);
  }

  writeRelayConfig({ baseUrl, model }) {
    const targetPath = this.configPath();
    const directory = path.dirname(targetPath);
    const existing = this.readConfig();
    const providerStatePath = this.providerStatePath();
    if (!fs.existsSync(providerStatePath)) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(providerStatePath, `${JSON.stringify({
        hadModel: Object.prototype.hasOwnProperty.call(existing, "model"),
        model: existing.model,
        hadModelProvider: Object.prototype.hasOwnProperty.call(existing, "model_provider"),
        modelProvider: existing.model_provider
      }, null, 2)}\n`, { mode: 0o600 });
    }
    const merged = mergeRelayConfig(existing, { baseUrl, model });
    const nextContent = `${stringify(merged).trim()}\n`;
    const temporaryPath = `${targetPath}.domi-tmp`;

    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (fs.existsSync(targetPath)) {
      const backupPath = `${targetPath}.domi-backup-${Date.now()}`;
      fs.copyFileSync(targetPath, backupPath);
      fs.chmodSync(backupPath, 0o600);
    }
    fs.writeFileSync(temporaryPath, nextContent, { mode: 0o600 });
    fs.renameSync(temporaryPath, targetPath);
    fs.chmodSync(targetPath, 0o600);
    return {
      path: targetPath,
      baseUrl: normalizeRelayBaseUrl(baseUrl),
      model: normalizeRelayModel(model),
      providerId: DOMI_PROVIDER_ID
    };
  }

  restoreChatGPTConfig() {
    const targetPath = this.configPath();
    if (!fs.existsSync(targetPath)) return { ok: true, changed: false };
    try {
      const config = this.readConfig();
      if (config.model_provider !== DOMI_PROVIDER_ID) {
        return { ok: true, changed: false };
      }
      const providerStatePath = this.providerStatePath();
      let previous = {};
      if (fs.existsSync(providerStatePath)) {
        previous = JSON.parse(fs.readFileSync(providerStatePath, "utf8"));
      }
      if (previous.hadModel) config.model = previous.model;
      else delete config.model;
      if (previous.hadModelProvider) config.model_provider = previous.modelProvider;
      else delete config.model_provider;
      if (config.model_providers && typeof config.model_providers === "object") {
        delete config.model_providers[DOMI_PROVIDER_ID];
        if (Object.keys(config.model_providers).length === 0) delete config.model_providers;
      }
      const temporaryPath = `${targetPath}.domi-tmp`;
      fs.writeFileSync(temporaryPath, `${stringify(config).trim()}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, targetPath);
      fs.chmodSync(targetPath, 0o600);
      fs.rmSync(providerStatePath, { force: true });
      return { ok: true, changed: true };
    } catch (error) {
      return { ok: false, changed: false, error: userFacingError(error) };
    }
  }

  async saveRelayCredential(apiKey) {
    const credential = String(apiKey || "").trim();
    if (
      !credential
      || credential.length < 8
      || credential.length > 4096
      || /[\u0000-\u001f\u007f]/.test(credential)
    ) {
      throw new Error("请输入有效的中转站 API Key。");
    }
    await this.writeCredential(credential);
  }

  async hasRelayCredential() {
    try {
      await this.exec("/usr/bin/security", [
        "find-generic-password",
        "-s",
        DOMI_KEYCHAIN_SERVICE,
        "-a",
        DOMI_KEYCHAIN_ACCOUNT
      ], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      return true;
    } catch {
      return false;
    }
  }

  async configureRelay({ baseUrl, model, apiKey, keepExistingKey = false }) {
    try {
      const installed = await this.status();
      if (!installed.ok) {
        return { ok: false, error: "请先安装 Codex CLI，再配置中转站。" };
      }
      const normalizedBaseUrl = normalizeRelayBaseUrl(baseUrl);
      const normalizedModel = normalizeRelayModel(model);
      const hasExistingKey = await this.hasRelayCredential();
      if (!keepExistingKey || !hasExistingKey) {
        await this.saveRelayCredential(apiKey);
      }
      const config = this.writeRelayConfig({
        baseUrl: normalizedBaseUrl,
        model: normalizedModel
      });
      return {
        ok: true,
        ...config,
        credentialStored: true,
        codexPath: installed.path,
        version: installed.version
      };
    } catch (error) {
      return { ok: false, error: userFacingError(error) };
    }
  }

  async testConnection(preferredPath = "") {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-test-"));
    try {
      const binary = this.resolveBinary(preferredPath);
      const prompt = [
        "这是 domi 安装后的连接测试。",
        "请使用 shell 工具恰好执行一次 `printf DOMI_TOOL_OK`，",
        "确认看到命令输出后，最终只回复 DOMI_CODEX_OK。"
      ].join("");
      const { stdout } = await this.runCodex(binary, [
        "--ask-for-approval",
        "never",
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--json",
        "-C",
        temporaryDirectory,
        "-"
      ], prompt, {
        env: codexEnvironment(),
        timeout: 2 * 60_000,
        maxBuffer: 8 * 1024 * 1024
      });
      const output = String(stdout || "");
      const events = output
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
      const modelOk = events.some((event) => {
        if (event?.type !== "item.completed") return false;
        const item = event.item && typeof event.item === "object" ? event.item : event;
        const itemType = item.type || event.itemType;
        return itemType === "agent_message"
          && String(item.text || event.text || "").trim() === "DOMI_CODEX_OK";
      });
      const toolOk = events.some((event) => {
        if (event?.type !== "item.completed") return false;
        const item = event.item && typeof event.item === "object" ? event.item : event;
        const itemType = item.type || event.itemType;
        return itemType === "command_execution"
          && String(item.aggregated_output || event.aggregated_output || "").includes("DOMI_TOOL_OK");
      });
      if (!modelOk || !toolOk) {
        throw new Error(modelOk
          ? "模型响应正常，但没有确认 Shell 工具调用。"
          : "Codex 没有返回预期的测试结果。");
      }
      return {
        ok: true,
        modelOk,
        toolOk,
        detail: "Responses 模型响应与 Shell 工具调用均已通过。"
      };
    } catch (error) {
      return {
        ok: false,
        modelOk: false,
        toolOk: false,
        error: userFacingError(error)
      };
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

module.exports = {
  CODEX_INSTALLER_URL,
  OFFICIAL_CODEX_INSTALLER_HOSTS,
  DOMI_KEYCHAIN_ACCOUNT,
  DOMI_KEYCHAIN_SERVICE,
  DOMI_PROVIDER_ID,
  CodexBootstrapService,
  createElectronNetFetcher,
  fetchOfficialInstaller,
  isOfficialCodexInstallerUrl,
  keychainAuthConfig,
  mergeRelayConfig,
  normalizeRelayBaseUrl,
  normalizeRelayModel,
  userFacingError
};
