import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { Codex } from "@openai/codex-sdk";

import { resolvedProxyEnvironment } from "./proxy-environment.js";

function executable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveManagedCodexPath({ homeDir = os.homedir(), environment = process.env } = {}) {
  const candidates = [
    environment.CODEX_WECHAT_CODEX_PATH,
    path.join(homeDir, ".local", "bin", "codex"),
    path.join(homeDir, ".codex", "packages", "standalone", "current", "bin", "codex"),
  ].filter(Boolean);
  return candidates.find((candidate) => path.isAbsolute(candidate) && executable(candidate)) || "";
}

export function managedCodexEnvironment(codexPath, environment = process.env, systemProxy) {
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => typeof value === "string"),
  );
  Object.assign(inherited, resolvedProxyEnvironment(inherited, systemProxy));
  if (!codexPath) return inherited;
  const resolvedBinary = fs.realpathSync(codexPath);
  const packageRoot = path.resolve(path.dirname(resolvedBinary), "..");
  const managedPaths = [
    path.join(packageRoot, "codex-path"),
    path.join(packageRoot, "codex-resources", "zsh", "bin"),
  ].filter((candidate) => fs.existsSync(candidate));
  inherited.PATH = [...managedPaths, inherited.PATH || ""].filter(Boolean).join(path.delimiter);
  return inherited;
}

export function createCodexClient(options = {}) {
  const codexPath = resolveManagedCodexPath(options);
  if (!codexPath) return { client: new Codex(), codexPath: "", managed: false };
  return {
    client: new Codex({
      codexPathOverride: codexPath,
      env: managedCodexEnvironment(codexPath, options.environment, options.systemProxy),
    }),
    codexPath,
    managed: true,
  };
}
