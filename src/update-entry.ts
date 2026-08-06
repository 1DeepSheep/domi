import type { UpdateStatus } from "./env";

export type SidebarUpdateEntry = {
  label: string;
  detail: string;
  state: "available" | "downloading" | "downloaded";
};

export function sidebarUpdateEntry(status: UpdateStatus | null): SidebarUpdateEntry | null {
  if (!status?.supported) return null;

  if (status.state === "available") {
    return {
      label: "发现新版本",
      detail: status.availableVersion ? `v${status.availableVersion} 可下载` : "点击查看更新",
      state: "available"
    };
  }

  if (status.state === "downloading") {
    return {
      label: "正在下载更新",
      detail: `${Math.max(0, Math.min(100, Math.round(status.percent || 0)))}% · 点击查看进度`,
      state: "downloading"
    };
  }

  if (status.state === "downloaded") {
    return {
      label: "更新已准备好",
      detail: status.availableVersion ? `v${status.availableVersion} · 点击安装` : "点击安装并重启",
      state: "downloaded"
    };
  }

  return null;
}
