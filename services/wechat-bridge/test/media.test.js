import assert from "node:assert/strict";
import test from "node:test";

import { encodeOutboundAesKey } from "../src/media.js";

test("outbound Weixin media keys encode the 32-character hex key expected by clients", () => {
  const rawKey = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const encoded = encodeOutboundAesKey(rawKey);

  assert.equal(
    Buffer.from(encoded, "base64").toString("utf8"),
    "00112233445566778899aabbccddeeff",
  );
});

test("outbound Weixin media keys reject invalid AES-128 key lengths", () => {
  assert.throws(() => encodeOutboundAesKey(Buffer.alloc(15)), /有效的加密密钥/);
  assert.throws(() => encodeOutboundAesKey("001122"), /有效的加密密钥/);
});
