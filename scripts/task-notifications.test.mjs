import assert from "node:assert/strict";
import test from "node:test";
import {
  clearTaskResultUnread,
  isTaskResultVisible,
  navigateTaskNotification,
  recordTaskResult,
  taskNotificationContent,
  taskNotificationId,
  unreadTaskCount
} from "../src/task-notifications.ts";

const thread = (id = "a") => ({ id, title: id, messages: [{ id: `${id}-1`, content: "result" }] });

test("only the foreground current conversation counts as seeing the result", () => {
  const visible = { threadId: "a", activeThreadId: "a", workspaceView: "conversation", windowFocused: true, visibilityState: "visible", documentPanelFocused: false };
  assert.equal(isTaskResultVisible(visible), true);
  for (const patch of [{ activeThreadId: "b" }, { workspaceView: "data" }, { windowFocused: false }, { visibilityState: "hidden" }, { documentPanelFocused: true }]) {
    assert.equal(isTaskResultVisible({ ...visible, ...patch }), false, JSON.stringify(patch));
  }
});

test("completed, failed and waiting results become unread; an active stop does not", () => {
  for (const outcome of ["completed", "failed", "waiting-input"]) {
    const result = recordTaskResult([thread()], "a", "a-1", outcome, false);
    assert.equal(result[0].hasUnreadCompletion, true);
    assert.equal(result[0].messages[0].taskNotificationOutcome, outcome);
    assert.equal(unreadTaskCount(result), 1);
    assert.ok(taskNotificationContent(outcome, "Task"));
  }
  assert.equal(recordTaskResult([thread()], "a", "a-1", "stopped", false)[0].hasUnreadCompletion, false);
  assert.equal(taskNotificationContent("stopped", "Task"), null);
});

test("a replayed terminal or rebound native run cannot re-mark a viewed local result unread", () => {
  const completed = recordTaskResult([thread()], "a", "a-1", "completed", false);
  const viewed = clearTaskResultUnread(completed, "a");
  const restored = JSON.parse(JSON.stringify(viewed));
  const replay = recordTaskResult(restored, "a", "a-1", "completed", false);
  assert.equal(replay[0], restored[0]);
  assert.equal(replay[0].hasUnreadCompletion, false);
  assert.equal(replay[0].messages[0].taskNotificationRead, true);
  assert.equal(replay[0].messages[0].taskNotificationId, taskNotificationId("a", "a-1"));
});

test("a subsequent automatic turn or stop preserves older unread results until opened", () => {
  const first = recordTaskResult([thread()], "a", "a-1", "completed", false);
  const started = [{ ...first[0], messages: [...first[0].messages, { id: "a-2", status: "running" }] }];
  const stopped = recordTaskResult(started, "a", "a-2", "stopped", false);
  assert.equal(stopped[0].hasUnreadCompletion, true);
  assert.equal(stopped[0].messages[0].taskNotificationRead, false);
  const viewed = clearTaskResultUnread(stopped, "a");
  assert.equal(viewed[0].hasUnreadCompletion, false);
  assert.ok(viewed[0].messages.every(message => message.taskNotificationRead));
});

test("foreground completion marks both the new and older result receipts read", () => {
  const previous = recordTaskResult([thread()], "a", "a-1", "completed", false);
  previous[0].messages.push({ id: "a-2" });
  const result = recordTaskResult(previous, "a", "a-2", "completed", true);
  assert.equal(result[0].hasUnreadCompletion, false);
  assert.ok(result[0].messages.every(message => message.taskNotificationRead));
});

test("Dock counts all accessible unread tasks; viewing or deleting one leaves the others", () => {
  const results = ["a", "b", "c"].reduce((state, id) => recordTaskResult(state, id, `${id}-1`, "completed", false), [thread("a"), thread("b"), thread("c")]);
  assert.equal(unreadTaskCount(results), 3);
  const viewed = clearTaskResultUnread(results, "b");
  assert.equal(unreadTaskCount(viewed), 2);
  assert.equal(unreadTaskCount(viewed.filter(item => item.id !== "a")), 1);
  assert.equal(viewed[0], results[0]);
});

test("notification body uses only a bounded title and never splits a Unicode character", () => {
  const longTitle = "🙂".repeat(100) + "\nprivate transcript";
  const content = taskNotificationContent("completed", longTitle);
  assert.equal(Array.from(content.body).length, 80);
  assert.equal(content.body, "🙂".repeat(79) + "…");
  assert.equal(taskNotificationContent("failed", "Title\nprivate transcript").body, "Title");
  assert.equal(taskNotificationContent("waiting-input", " ").body, "未命名任务");
});

test("cancelled or failed notification navigation can be retried, but concurrent clicks are coalesced", async () => {
  const target = { threadId: "a", notificationId: "result-a" };
  const opened = new Set();
  const inFlight = new Set();
  let resolveNavigation;
  let calls = 0;
  const pending = navigateTaskNotification(target, opened, inFlight, () => {
    calls += 1;
    return new Promise(resolve => { resolveNavigation = resolve; });
  });
  assert.equal(await navigateTaskNotification(target, opened, inFlight, async () => { calls += 1; return true; }), false);
  assert.equal(calls, 1);
  resolveNavigation(false);
  assert.equal(await pending, false);
  assert.equal(opened.size, 0);
  assert.equal(inFlight.size, 0);
  assert.equal(await navigateTaskNotification(target, opened, inFlight, async () => { throw new Error("save failed"); }), false);
  assert.equal(opened.size, 0);
  assert.equal(await navigateTaskNotification(target, opened, inFlight, async () => true), true);
  assert.equal(opened.has(target.notificationId), true);
  assert.equal(await navigateTaskNotification(target, opened, inFlight, async () => { throw new Error("must not run again"); }), false);
});
