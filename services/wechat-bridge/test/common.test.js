import assert from "node:assert/strict";
import test from "node:test";

import { MessageItemType, sendMessageItem } from "../src/common.js";

const credentials = { baseUrl: "https://example.test", token: "test-token" };

test("outbound messages retry transient failures with one stable client id", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      const error = new Error("request timed out");
      error.name = "AbortError";
      throw error;
    }
    return { ok: true, text: async () => JSON.stringify({ ret: 0 }) };
  };

  const result = await sendMessageItem({
    credentials,
    toUserId: "owner",
    contextToken: "context",
    runId: "run",
    item: { type: MessageItemType.TEXT, text_item: { text: "已收到" } },
    retryDelaysMs: [0],
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].msg.client_id, requests[1].msg.client_id);
  assert.equal(result.messageId, requests[0].msg.client_id);
});

test("outbound messages do not retry permanent API rejection", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return { ok: true, text: async () => JSON.stringify({ ret: 400, errmsg: "invalid request" }) };
  };

  await assert.rejects(
    sendMessageItem({
      credentials,
      toUserId: "owner",
      contextToken: "context",
      runId: "run",
      item: { type: MessageItemType.TEXT, text_item: { text: "已收到" } },
      retryDelaysMs: [0, 0],
    }),
    /sendmessage ret=400/,
  );
  assert.equal(attempts, 1);
});

test("an acknowledgement failure cannot prevent the accepted task from being prepared", async () => {
  const source = await import("node:fs/promises")
    .then((fs) => fs.readFile(new URL("../src/index.js", import.meta.url), "utf8"));
  assert.match(
    source,
    /try\s*{\s*await replyMessage\([\s\S]*?catch \(error\)[\s\S]*?任务仍会入队[\s\S]*?void prepareTask\(message, task, inbound\)/,
  );
});
