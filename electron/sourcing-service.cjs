"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);

function emptySnapshot(error) {
  return { ok: false, configured: false, error: error.message || String(error), candidates: [], sources: [],
    settings: { enabled: false, localHour: 9, timeZone: "Asia/Shanghai", autoIntake: true }, run: { status: "idle" } };
}
function flatten(result) {
  const { snapshot, ...metadata } = result;
  if (!snapshot) throw new Error("水下项目插件未返回可读取的台账。");
  return { ...snapshot, ...metadata };
}

/** Adapter to the installed plugin: it never imports seeds or writes project/person records. */
class SourcingService {
  constructor({ integration, executeCommand = execute } = {}) {
    this.integration = integration;
    this.executeCommand = executeCommand;
  }
  async command(command, request = {}) {
    let temporaryDirectory;
    try {
      const source = this.integration.readProjectConfig();
      if (source.backend !== "local") throw new Error("当前资料库仍以飞书为主。水下项目暂不支持此后端，不会另建本地资料库。");
      const plugin = this.integration.findPlugin();
      const script = path.join(plugin.root, "scripts", "sourcing-ledger.cjs");
      if (!fs.existsSync(script)) throw new Error("当前 domi 插件尚未包含水下项目搜索，请更新插件后重试。");
      const args = [script, command];
      if (command !== "snapshot") {
        temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-sourcing-"));
        fs.chmodSync(temporaryDirectory, 0o700);
        const inputPath = path.join(temporaryDirectory, "request.json");
        fs.writeFileSync(inputPath, JSON.stringify(request), { mode: 0o600 });
        args.push("--json-file", inputPath);
      }
      let stdout;
      try {
        ({ stdout } = await this.executeCommand(process.execPath, args, {
          cwd: plugin.root, timeout: 30000, maxBuffer: 12 * 1024 * 1024,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(this.integration.domiConfigPath ? { DOMI_CONFIG_PATH: this.integration.domiConfigPath } : {}) }
        }));
      } catch (error) {
        if (!error.stdout) throw error;
        stdout = error.stdout;
      }
      return flatten(JSON.parse(String(stdout).trim()));
    } catch (error) { return emptySnapshot(error); }
    finally { if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
  }
  list() { return this.command("snapshot"); }
  configure(request = {}) { return this.command("configure", { settings: request.settings, sources: request.sources }); }
  begin(request = {}) { return this.command("begin", { force: request.force === true }); }
  async finish(request = {}) {
    const payload = { runId: request.runId, leaseToken: request.leaseToken, ...(request.error ? { error: String(request.error) } : {}) };
    if (payload.error) return this.command("fail", payload);
    const result = await this.command("complete", payload);
    if (!result.ok && result.configured && result.run.status === "running" && result.run.runId === payload.runId) {
      // A completed Codex turn without a persisted receipt is a failed scan.
      const failed = await this.command("fail", { ...payload, error: result.error || "本轮搜索缺少已持久化回执。" });
      return { ...failed, ok: false, error: result.error || failed.error };
    }
    return result;
  }
}
module.exports = { SourcingService, emptySnapshot, flatten };
