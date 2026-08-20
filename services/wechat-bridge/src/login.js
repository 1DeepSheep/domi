import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";

import QRCode from "qrcode";
import qrcode from "qrcode-terminal";

import { BASE_URL, createLoginQr, pollLoginQr } from "./common.js";
import {
  CREDENTIALS_PATH,
  STATE_DIR,
  ensurePrivateDir,
  migrateLegacyState,
  writeJsonPrivate,
} from "./state.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function main() {
  const migrated = migrateLegacyState();
  if (migrated.includes("credentials.json")) {
    console.log("已迁移原微信连接凭证，无需重新扫码。");
    return;
  }
  console.log("正在向微信申请绑定二维码…");
  ensurePrivateDir();
  const qrImagePath = path.join(STATE_DIR, "wechat-login-qr.png");
  let qr;

  async function refreshQr() {
    qr = await createLoginQr();
    if (!qr.qrcode || !qr.qrcode_img_content) throw new Error("微信没有返回有效二维码。");
    qrcode.generate(qr.qrcode_img_content, { small: true });
    await QRCode.toFile(qrImagePath, qr.qrcode_img_content, { width: 640, margin: 2 });
    console.log("请使用微信扫一扫并在手机上确认。");
    console.log(`二维码图片：${qrImagePath}`);
  }

  await refreshQr();
  let pollingBaseUrl = BASE_URL;
  let verifyCode;
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const status = await pollLoginQr(qr.qrcode, verifyCode, pollingBaseUrl);
    switch (status.status) {
      case "wait":
        process.stdout.write(".");
        break;
      case "scaned":
        process.stdout.write("\n已扫码，等待手机确认…\n");
        verifyCode = undefined;
        break;
      case "need_verifycode":
        verifyCode = (await rl.question("请输入微信手机端显示的配对数字：")).trim();
        break;
      case "scaned_but_redirect":
        if (status.redirect_host) pollingBaseUrl = `https://${status.redirect_host}`;
        break;
      case "confirmed": {
        if (!status.bot_token || !status.ilink_bot_id) throw new Error("微信确认成功，但未返回完整连接凭证。");
        writeJsonPrivate(CREDENTIALS_PATH, {
          token: status.bot_token,
          accountId: status.ilink_bot_id,
          ownerUserId: status.ilink_user_id,
          baseUrl: status.baseurl || pollingBaseUrl,
          createdAt: new Date().toISOString(),
        });
        process.stdout.write(`\n绑定成功。凭证保存在：${STATE_DIR}\n`);
        return;
      }
      case "binded_redirect":
        throw new Error("这个微信机器人已绑定其他实例，请先解除连接后重试。");
      case "expired":
        process.stdout.write("\n二维码已过期，正在刷新…\n");
        verifyCode = undefined;
        pollingBaseUrl = BASE_URL;
        await refreshQr();
        break;
      case "verify_code_blocked":
        throw new Error("配对数字多次错误，连接已暂停，请稍后重试。");
      default:
        throw new Error(`未知登录状态：${status.status || "empty"}`);
    }
  }
  throw new Error("等待扫码超时，请重新运行 npm run wechat:login。");
}

try {
  await main();
} finally {
  rl.close();
}
