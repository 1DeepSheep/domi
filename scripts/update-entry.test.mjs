import assert from "node:assert/strict";
import test from "node:test";
import { sidebarUpdateEntry } from "../src/update-entry.ts";

function status(state, overrides = {}) {
  return {
    state,
    supported: true,
    currentVersion: "0.6.17",
    availableVersion: "0.6.18",
    channel: "stable",
    percent: 0,
    transferred: 0,
    total: 0,
    releaseDate: "",
    error: "",
    ...overrides
  };
}

test("sidebar stays quiet when there is no actionable update", () => {
  assert.equal(sidebarUpdateEntry(null), null);
  assert.equal(sidebarUpdateEntry(status("disabled", { supported: false })), null);
  assert.equal(sidebarUpdateEntry(status("idle")), null);
  assert.equal(sidebarUpdateEntry(status("checking")), null);
  assert.equal(sidebarUpdateEntry(status("up-to-date")), null);
  assert.equal(sidebarUpdateEntry(status("error", {
    availableVersion: "",
    error: "offline"
  })), null);
});

test("available update becomes a direct update action", () => {
  assert.deepEqual(sidebarUpdateEntry(status("available")), {
    label: "更新",
    detail: "v0.6.18 可用",
    state: "available"
  });
});

test("download progress is clamped and rounded for the sidebar", () => {
  assert.deepEqual(sidebarUpdateEntry(status("downloading", { percent: 41.6 })), {
    label: "正在下载更新",
    detail: "42%",
    state: "downloading"
  });
  assert.equal(sidebarUpdateEntry(status("downloading", { percent: 180 }))?.detail, "100%");
});

test("downloaded update explains automatic safe restart", () => {
  assert.deepEqual(sidebarUpdateEntry(status("downloaded")), {
    label: "更新已下载",
    detail: "正在安全保存并重启",
    state: "downloaded"
  });
  assert.deepEqual(sidebarUpdateEntry(status("downloaded", {
    restartPending: true,
    busyTaskCount: 2
  })), {
    label: "更新已下载",
    detail: "任务完成后自动重启",
    state: "downloaded"
  });
});

test("update failures remain actionable from the sidebar", () => {
  assert.deepEqual(sidebarUpdateEntry(status("error", { error: "offline" })), {
    label: "更新失败",
    detail: "点击重试",
    state: "error"
  });
  assert.deepEqual(sidebarUpdateEntry(status("downloaded", { error: "save failed" })), {
    label: "更新重启未完成",
    detail: "点击重试",
    state: "error"
  });
});
