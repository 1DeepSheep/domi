import crypto from "node:crypto";

import { splitText } from "./protocol.js";

export const BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
export const BOT_TYPE = "3";
export const CHANNEL_VERSION = "2.4.6";
export const BOT_AGENT = "domi-wechat/0.6.42";

export const MessageItemType = Object.freeze({
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
});

const APP_ID = "bot";
const APP_CLIENT_VERSION = (2 << 16) | (4 << 8) | 6;
const DEFAULT_SEND_RETRY_DELAYS_MS = [500, 1_500];

function randomWechatUin() {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function commonHeaders() {
  return {
    "iLink-App-Id": APP_ID,
    "iLink-App-ClientVersion": String(APP_CLIENT_VERSION),
  };
}

function authenticatedHeaders(token) {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": randomWechatUin(),
    ...commonHeaders(),
  };
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
}

function retryableSendError(error) {
  if (error?.name === "AbortError") return true;
  return /(?:fetch failed|request timed out|econnreset|econnrefused|etimedout|eai_again|enetunreach|socket hang up|sendmessage HTTP (?:408|425|429|5\d\d))/i.test(String(error?.message ?? error));
}

async function fetchText(url, options, label) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${body.slice(0, 300)}`);
  return body;
}

async function postJson({ baseUrl, token, endpoint, body, label, timeoutMs = 15_000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const text = await fetchText(
      new URL(endpoint, `${baseUrl.replace(/\/$/, "")}/`),
      {
        method: "POST",
        headers: authenticatedHeaders(token),
        body: JSON.stringify({ ...body, base_info: baseInfo() }),
        signal: controller.signal,
      },
      label,
    );
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

export async function createLoginQr() {
  const url = new URL("ilink/bot/get_bot_qrcode", `${BASE_URL}/`);
  url.searchParams.set("bot_type", BOT_TYPE);
  const text = await fetchText(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...commonHeaders() },
      body: JSON.stringify({ local_token_list: [] }),
    },
    "get_bot_qrcode",
  );
  return JSON.parse(text);
}

export async function pollLoginQr(qrcode, verifyCode, baseUrl = BASE_URL) {
  const url = new URL("ilink/bot/get_qrcode_status", `${baseUrl}/`);
  url.searchParams.set("qrcode", qrcode);
  if (verifyCode) url.searchParams.set("verify_code", verifyCode);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const text = await fetchText(
      url,
      { method: "GET", headers: commonHeaders(), signal: controller.signal },
      "get_qrcode_status",
    );
    return JSON.parse(text);
  } catch (error) {
    if (error?.name === "AbortError") return { status: "wait" };
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getUpdates({ baseUrl, token, cursor, timeoutMs = 40_000 }) {
  try {
    return await postJson({
      baseUrl,
      token,
      endpoint: "ilink/bot/getupdates",
      body: { get_updates_buf: cursor ?? "" },
      label: "getupdates",
      timeoutMs,
    });
  } catch (error) {
    if (error?.name === "AbortError") return { ret: 0, msgs: [], get_updates_buf: cursor ?? "" };
    throw error;
  }
}

export async function getUploadUrl({ credentials, request }) {
  return postJson({
    baseUrl: credentials.baseUrl,
    token: credentials.token,
    endpoint: "ilink/bot/getuploadurl",
    body: request,
    label: "getuploadurl",
  });
}

export async function sendMessageItem({
  credentials,
  toUserId,
  contextToken,
  item,
  runId,
  retryDelaysMs = DEFAULT_SEND_RETRY_DELAYS_MS,
}) {
  const clientId = `domi-wechat-${crypto.randomUUID()}`;
  const body = {
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [item],
      context_token: contextToken,
      run_id: runId,
    },
  };
  let attempt = 0;
  while (true) {
    try {
      const response = await postJson({
        baseUrl: credentials.baseUrl,
        token: credentials.token,
        endpoint: "ilink/bot/sendmessage",
        body,
        label: "sendmessage",
        timeoutMs: 8_000,
      });
      if (response.ret && response.ret !== 0) {
        throw new Error(`sendmessage ret=${response.ret}: ${response.errmsg ?? "unknown error"}`);
      }
      return { messageId: clientId };
    } catch (error) {
      const retryDelay = retryDelaysMs[attempt];
      if (retryDelay === undefined || !retryableSendError(error)) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

export async function sendText({ credentials, toUserId, contextToken, text, runId }) {
  const chunks = splitText(text);
  for (let index = 0; index < chunks.length; index += 1) {
    const prefix = chunks.length > 1 ? `（${index + 1}/${chunks.length}）\n` : "";
    await sendMessageItem({
      credentials,
      toUserId,
      contextToken,
      runId,
      item: { type: MessageItemType.TEXT, text_item: { text: `${prefix}${chunks[index]}` } },
    });
  }
}

function textFromItem(item) {
  if (item?.type === MessageItemType.TEXT && item.text_item?.text != null) {
    const text = String(item.text_item.text).trim();
    const reference = item.ref_msg;
    if (!reference) return { text, quotedText: "" };
    const quoted = [reference.title, textFromItem(reference.message_item).text].filter(Boolean).join(" | ");
    return { text, quotedText: quoted };
  }
  if (item?.type === MessageItemType.VOICE && item.voice_item?.text) {
    return { text: String(item.voice_item.text).trim(), quotedText: "" };
  }
  return { text: "", quotedText: "" };
}

export function extractInbound(message) {
  let text = "";
  let quotedText = "";
  const mediaItems = [];
  for (const item of message?.item_list ?? []) {
    const extracted = textFromItem(item);
    if (!text && extracted.text) text = extracted.text;
    if (!quotedText && extracted.quotedText) quotedText = extracted.quotedText;
    if ([MessageItemType.IMAGE, MessageItemType.VOICE, MessageItemType.FILE, MessageItemType.VIDEO].includes(item?.type)) {
      mediaItems.push(item);
    }
    const quotedItem = item?.ref_msg?.message_item;
    if (quotedItem && [MessageItemType.IMAGE, MessageItemType.VOICE, MessageItemType.FILE, MessageItemType.VIDEO].includes(quotedItem.type)) {
      mediaItems.push(quotedItem);
    }
  }
  return { text, quotedText, mediaItems };
}
