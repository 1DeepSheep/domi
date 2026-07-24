# 豆米

豆米是一个面向投资团队的 Mac 桌面端 agent 工作台。界面由 Electron + React 实现，底层通过本机 `codex app-server` 调用 Codex。

## 运行

```bash
npm install
npm run dev
```

`npm run dev` 会先从 `~/plugins/domi` 复制最新的本地 Domi 插件源码，并在开发版启动检查时刷新 Codex 中由豆米管理的插件。修改插件后重启开发命令即可生效；也可以通过 `DOMI_PLUGIN_SOURCE=/absolute/path npm run dev` 指定其他本地插件仓库。

开发模式下请确保本机已安装 Codex：

```bash
codex --version
codex login status
```

## Codex 连接

首次启动会进入配置向导，支持两种模式：

- **本机 Codex**：复用这台 Mac 上已经登录的 ChatGPT / Codex 身份，也可以从豆米打开登录页面。

设置页内置脱敏系统诊断，检查 Keychain、工作区、SQLite、Codex App Server 和 Domi 插件。

## 当前能力

- 左侧任务列表与投资技能入口，可新建、切换和恢复任务。
- 中间 Codex 风格对话框，支持普通提问、文件附件、Domi 插件与工作流。
- 首页提供行业雷达、推进执行、PLAUD 队列以及一键投资工作流。
- Electron 主进程保持 `codex app-server` 长连接，并把 JSON-RPC 事件实时推给前端。
- 豆米对话绑定 Codex thread，支持同一对话连续执行、流式回答和上下文续聊。
- 支持停止当前 turn、展示工具与文件操作时间线，以及本轮 token 用量。
- 复用本机 Codex 的 ChatGPT 登录身份，不在客户端内保存 OpenAI API Key。
- 右侧工作看板展示推进建议、PLAUD 录音与 Domi 连接状态。
- 右侧栏支持 Markdown 直接编辑及 PDF 预览。
- 正式版支持稳定版/测试版更新通道、后台检查、下载和重启安装。
- 正式安装包内置发布时锁定的最新 Domi 插件；客户端启动会自动安装或升级该插件，并保留用户手动安装的更高版本。
- 客户端名称为「豆米」，应用图标来自 `public/domi-icon.png`。

## 本地数据

正式版用户数据与应用程序分离：

```text
~/Library/Application Support/豆米/domi.sqlite3
~/Library/Application Support/豆米/backups/
~/Documents/豆米/
```

开发版使用独立工作区，不会把任务数据写进源码目录：

```text
~/Documents/豆米开发工作区/
```

ChatGPT/Codex 登录由本机 Codex 管理。飞书、PLAUD 等连接信息、签名私钥、公证凭据、数据库和任务材料均不得进入 Git 或安装包。

首次安装是干净工作台；覆盖安装或自动更新只替换 `/Applications/豆米.app`，不会删除上述本地数据。数据库升级前会自动保留最近三份备份。

## 隐私检查

提交或打包前运行：

```bash
npm run privacy:check
npm run privacy:history
npm run check
```

`privacy:check` 检查准备发布的源码，`privacy:history` 额外检查全部 Git 历史。运行时目录、数据库、录音、密钥与发布产物均已加入 `.gitignore`。发布细节见 `docs/RELEASE.md`。

## macOS 构建

仅构建 Apple Silicon 的 `.app`：

```bash
npm run pack:mac
```

构建 Apple Silicon 的 DMG/ZIP：

```bash
npm run dist:mac
```

`dist:mac` 会先从公开的官方 Domi 插件仓库拉取并锁定最新 `main`，再将插件快照写入安装包。Domi 插件改动必须先提交、推送并提升插件版本，未提交的本地修改不会进入正式安装包。Fork 可通过 `DOMI_PLUGIN_REPOSITORY` 指定自己的插件仓库。产物按版本写入 `release/<version>/`。

公开分发前必须在构建机器安装有效的 Apple `Developer ID Application` 证书，并配置 Apple 公证凭据；`electron-builder` 会自动发现签名身份。没有证书时可以生成本地测试包，但其他用户的 macOS 会显示来源与安全警告。

源码与插件仓库可以公开，但必须从通过当前源码、完整 Git 历史和最终 DMG 三层隐私检查的干净根提交开始。自动更新文件发布到独立的公开发行仓库。不要在客户端内嵌 GitHub Token。完整发布和升级规则见 `docs/RELEASE.md`。
