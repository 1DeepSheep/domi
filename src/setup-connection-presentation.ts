import type { CodexCheckResult } from "./env";

type SetupConnectionState = {
  status: CodexCheckResult | null;
  ready: boolean;
  checking: boolean;
  installed: boolean;
  installing: boolean;
  installError: string;
  loginWaiting: boolean;
  needsLogin: boolean;
  relayNeedsConfiguration: boolean;
  taskTestIssue: string;
  pathNeedsApply: boolean;
};

/** Keep account connectivity separate from plugin verification, without a second readiness badge. */
export function setupConnectionPresentation(state: SetupConnectionState) {
  const { status, ready, checking, installed, installing, installError, loginWaiting, needsLogin, relayNeedsConfiguration } = state;
  if (!installed) return {
    tone: installError ? "warning" : "neutral",
    title: installing ? "正在准备 Codex" : "Codex 还需准备",
    detail: installError ? "自动准备没有完成。点击重试，domi 会继续处理。" : "domi 会自动完成准备，无需打开终端。",
    account: "等待准备", plugin: "等待准备", busy: installing,
    action: "重新安装"
  };
  if (loginWaiting) return {
    tone: "neutral", title: "请在浏览器完成登录", detail: "完成后会自动回到可用状态。",
    account: "等待登录", plugin: "等待连接", busy: true, action: "重新检查连接"
  };
  if (state.pathNeedsApply) return {
    tone: "neutral", title: "连接设置尚未应用", detail: "点击下方“应用 Codex 路径”，保存后会重新检查连接。",
    account: "等待应用设置", plugin: "等待检查", busy: false, action: "重新检查连接"
  };
  if (!ready) return {
    tone: checking ? "neutral" : "warning",
    title: checking ? "正在检查连接" : needsLogin ? "登录 Codex 即可继续" : relayNeedsConfiguration ? "请完成中转站配置" : "连接检查未完成",
    detail: checking ? "正在确认这台电脑上的 Codex 连接。" : needsLogin ? "使用这台电脑上的 ChatGPT 账号登录。" : relayNeedsConfiguration ? "打开下方连接详情，填写中转站信息并保存。" : "重新检查连接，domi 会确认账号和本机服务的状态。",
    account: checking ? "正在检查" : needsLogin ? "等待登录" : "待确认",
    plugin: "等待连接", busy: checking, action: "重新检查连接"
  };
  const plugin = status?.pluginSetup;
  if (plugin?.ok && state.taskTestIssue) return {
    tone: "warning", title: /已取消/.test(state.taskTestIssue) ? "任务连接测试已取消" : "任务连接测试未通过",
    detail: "Codex 账号和 domi 组件已连接，可查看下方测试详情。",
    account: "已连接", plugin: "已就绪", busy: false, action: "重新测试任务连接"
  };
  if (plugin?.ok) return {
    tone: "ok", title: "已连接，可以使用 domi", detail: "连接已准备好，可以返回工作台。",
    account: "已连接", plugin: "已就绪", busy: false, action: "重新检查连接"
  };
  const preparing = plugin?.status === "deferred" && plugin?.reason !== "activation-verification";
  const verifying = checking || (plugin?.status === "deferred" && !preparing);
  const unverified = !plugin || plugin.status === "check-failed";
  return {
    tone: preparing || verifying ? "neutral" : "warning",
    title: preparing ? "正在准备 domi 组件" : verifying ? "正在确认 domi 组件" : unverified ? "domi 组件检查未完成" : "domi 组件还需准备",
    detail: preparing ? "Codex 已连接，domi 会在当前任务结束后完成组件准备。"
      : verifying ? "Codex 已连接，正在确认 domi 组件是否可用。"
      : unverified ? /timeout|timed out|超时/i.test(plugin?.error || "") ? "Codex 已连接，组件检查超时。可重新检查，无需重新登录。" : "Codex 已连接，上次组件检查未完成。可重新检查，无需重新登录。"
      : "Codex 已连接。点击准备组件即可继续，无需重新登录。",
    account: "已连接", plugin: preparing ? "正在准备" : verifying ? "正在检查" : unverified ? "检查未完成" : "待准备",
    busy: preparing || verifying, action: unverified ? "重新检查组件" : "准备 domi 组件"
  };
}
