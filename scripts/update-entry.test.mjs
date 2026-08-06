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
  assert.equal(sidebarUpdateEntry(status("error", { error: "offline" })), null);
});

test("available update becomes a compact navigation entry", () => {
  assert.deepEqual(sidebarUpdateEntry(status("available")), {
    label: "发现新版本",
    detail: "v0.6.18 可下载",
    state: "available"
  });
});

test("download progress is clamped and rounded for the sidebar", () => {
  assert.deepEqual(sidebarUpdateEntry(status("downloading", { percent: 41.6 })), {
    label: "正在下载更新",
    detail: "42% · 点击查看进度",
    state: "downloading"
  });
  assert.equal(sidebarUpdateEntry(status("downloading", { percent: 180 }))?.detail, "100% · 点击查看进度");
});

test("downloaded update points users to installation", () => {
  assert.deepEqual(sidebarUpdateEntry(status("downloaded")), {
    label: "更新已准备好",
    detail: "v0.6.18 · 点击安装",
    state: "downloaded"
  });
});
