import type { UpdateStatus } from "./env";

export type SidebarUpdateEntry = {
  label: string;
  detail: string;
  state: "available" | "downloading" | "downloaded" | "error";
};

function retryDetail(error: string | undefined, fallback = "点击重试") {
  const detail = String(error || "").replace(/\s+/g, " ").trim();
  if (!detail) return fallback;
  const summary = detail.length > 42 ? `${detail.slice(0, 41)}…` : detail;
  return `${summary} · 点击重试`;
}

export function sidebarUpdateEntry(status: UpdateStatus | null): SidebarUpdateEntry | null {
  if (!status?.supported) return null;

  if (status.state === "available") {
    return {
      label: "更新",
      detail: status.availableVersion ? `v${status.availableVersion} 可用` : "新版本可用",
      state: "available"
    };
  }

  if (status.state === "downloading") {
    return {
      label: "正在下载更新",
      detail: `${Math.max(0, Math.min(100, Math.round(status.percent || 0)))}%`,
      state: "downloading"
    };
  }

  if (status.state === "downloaded") {
    if (status.installing) {
      return {
        label: "正在安装更新",
        detail: "将自动重启 domi",
        state: "downloaded"
      };
    }
    if (status.error) {
      return {
        label: "更新重启未完成",
        detail: retryDetail(status.error),
        state: "error"
      };
    }
    if (status.restartPending && Number(status.busyTaskCount || 0) > 0) {
      return {
        label: "更新已下载",
        detail: "任务完成后自动重启",
        state: "downloaded"
      };
    }
    return {
      label: "更新已下载",
      detail: "正在安全保存并重启",
      state: "downloaded"
    };
  }

  if (status.state === "error") {
    if (!status.availableVersion) return null;
    return {
      label: "更新失败",
      detail: retryDetail(status.error),
      state: "error"
    };
  }

  return null;
}
