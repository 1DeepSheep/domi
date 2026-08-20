# domi 微信桥接

微信桥接是 domi 仓库内的独立后台服务。它通过腾讯 iLink 接收绑定账号的微信消息，使用 Codex SDK 创建相互隔离的任务线程，并把进度、结果及文件附件发回微信。

## 运行边界

- 源码与 domi 一起版本化、测试和发布。
- 服务与 domi 界面分进程运行；关闭窗口不会主动终止桥接。
- 凭证、任务、同步游标、附件和使用统计只保存在 `~/Library/Application Support/domi/wechat-bridge/`。
- `CODEX_WECHAT_WORKDIR` 控制 Codex 工作目录，默认是当前用户的 `Documents/Codex`。
- `CODEX_WECHAT_FULL_ACCESS=0` 可切换到受限工作区模式；当前个人桥接默认保持全权限模式。

## 本机使用

```bash
npm install
npm run wechat:login
npm run wechat:start
```

从旧桥接迁移时，可以在首次启动时设置：

```bash
CODEX_WECHAT_LEGACY_STATE_DIR=/path/to/old/state npm run wechat:start
```

只复制缺失的凭证和会话状态，不删除旧目录。

## 微信体验

- 每个新任务立即返回独立编号，例如 `W001`。
- 不同任务使用不同 Codex thread；引用 `W001`、`1号任务`或回复带编号的消息可继续原任务。
- 最多并发两个不同任务；同一任务的补充内容保持串行。
- 长任务在阶段变化和持续运行时发送进度，`/status` 可随时查询。
- 支持接收图片、文件、视频和语音媒体；图片作为 Codex 视觉输入，其余附件以本地文件交给工作流。
- 用户明确要求发送文件时，Codex 最终回复中引用的本地文件会作为真实微信附件上传，不再发送手机无法打开的本地路径链接。
- 超长回复自动分段，不再静默截断。

## 管理指令

- `/help`：查看帮助。
- `/status [W001]`：查看桥接与任务状态。
- `/tasks`：查看最近任务。
- `/cancel W001`：取消运行或排队任务。
- `/new`：清除当前任务焦点，让下一条消息创建新任务。
- `/model`：查看或切换模型。

## 第三方代码

媒体加解密、上传和消息结构实现参考并改编自腾讯 `openclaw-weixin`，许可证见 `THIRD_PARTY_LICENSES/TENCENT_OPENCLAW_WEIXIN.txt`。
