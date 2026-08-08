<p align="center">
  <img src="public/domi-icon.png" width="96" alt="domi 图标">
</p>

<h1 align="center">domi</h1>

<p align="center">
  面向投资研究与项目管理的 Mac 桌面智能工作台。<br>
  在熟悉的对话界面里调用本机 Codex，把行业动态、项目研究、会议纪要和资料归档串成一条工作流。
</p>

<p align="center">
  <a href="https://github.com/1DeepSheep/domi/releases/latest">下载最新版</a>
  ·
  <a href="https://github.com/1DeepSheep/domi-plugin">domi 插件</a>
  ·
  <a href="https://github.com/1DeepSheep/domi/issues">反馈问题</a>
</p>

> 当前公开版同时提供 Apple Silicon（arm64）和 Intel（x64）Mac 安装包，支持 macOS 12 Monterey 及以上版本。两种安装包都内置经过 SHA-256 校验、与本机架构匹配的 OpenAI Codex CLI 和 FFmpeg 基线，首次启动可离线完成运行时准备，再进行连接测试。

## 一眼看懂 domi 能做什么

- **行业雷达**：自动刷新行业新闻，按领域和子领域筛选，突出值得关注的新动态。
- **项目研究**：从公司名、链接、BP、截图或已有材料出发，完成桌面研究、投资分析和项目归档。
- **人物与机构研究**：整理创始人、团队、投资机构和关系线索，形成可继续维护的人物资料。
- **投资工作流**：支持投资快评、IC 材料、交易谈判、结构化研究及 HTML/PDF slides 报告。
- **会议与录音**：处理文字稿与音频，生成纪要、核心结论和跟进事项；PLAUD 为可选连接。
- **待办事项**：把关键节点、新入库对象、重点项目／人物动态和长期未跟进事项维护到本地 `0.待办事项.md`，在客户端看板中执行或忽略；只有用户明确要求时才向飞书发布副本。
- **Outlook 日程**：整理主题、时间和地点，向用户明确选择的一个或多个参会人发送 Outlook 日程邀请。
- **本地主库 + 飞书外挂**：SQLite + Markdown 始终是项目、人脉、行业动态和待办事项的管理基础；可选连接用户自己的飞书账号，按明确指令搜索 Base／Wiki、读取云文档、发布或编辑文档及发送消息。
- **连续任务执行**：对话绑定 Codex 任务，支持流式回答、停止执行、恢复上下文、文件附件和操作时间线。

## 安装

### 1. 下载 domi

1. 打开 [domi Releases](https://github.com/1DeepSheep/domi/releases/latest)。
2. M 系列芯片下载名称以 `arm64.dmg` 结尾的安装包；Intel 芯片下载名称以 `x64.dmg` 结尾的安装包。
3. 打开 DMG，把「domi」拖入“应用程序”文件夹。
4. 启动 domi。公开安装包已经 Developer ID 签名、Apple 公证并附加公证票据。

### 2. 安装并连接 Codex

首次启动时，domi 会检测可用的 Codex CLI；如果尚未安装，会自动校验并解压安装包内置的 OpenAI 官方独立发行版，无需打开终端，也不依赖当时能否连接 GitHub。运行时保存在 Codex 官方的 `~/.codex/packages/standalone` 目录，并在 `~/.local/bin` 建立用户级链接，不修改系统目录。Apple Silicon 与 Intel 的版本、来源和校验值分别记录在 [`resources/codex-runtime.json`](resources/codex-runtime.json) 与 [`resources/codex-runtime-x64.json`](resources/codex-runtime-x64.json)，第三方说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

随后选择一种身份方式：

- **ChatGPT 账号**：打开 Codex 官方登录，复用本机 ChatGPT / Codex 账号；
- **Responses 中转站**：填写兼容 OpenAI Responses API 的地址、模型名称和 API Key。密钥只写入 macOS 钥匙串，`~/.codex/config.toml` 只保存地址、模型和读取钥匙串的命令。

最后点击“测试完整连接”。domi 会启动一次不保存历史、只读沙箱的临时 Codex 任务，同时验证模型响应和 Shell 工具调用；两项都通过后才允许完成首次设置。普通 Chat Completions 接口不支持完整 Codex 能力，不能作为中转站使用。安装方式与配置格式分别遵循 [Codex CLI 官方文档](https://learn.chatgpt.com/docs/codex/cli) 和 [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。

### 3. 配置本地资料库和可选连接

继续按向导完成资料库和可选连接：

1. 选择一个上级目录；domi 会在其中创建或复用 `domi工作区`，初始化本地 SQLite、Markdown 目录和 `0.待办事项.md`；
2. 根据需要连接飞书。授权范围仍包含 Base、Wiki、Docs、Drive、IM 和 Contact，便于按明确指令搜索外部资料、读取或发布飞书文档以及发送消息；完整授权不会把飞书变成主资料库，也不会自动建 Base、迁移或覆盖本地资料；
3. 根据需要连接 PLAUD：选择 Google Chrome 或 Tabbit，在 domi 专用浏览器 Profile 中登录自己的账号并完成只读验证；也可以直接跳过，以后再连接。安装包已经内置离线 FFmpeg/ffprobe，M4A 等本地录音无需 Homebrew 即可转换后上传；连接失败时可以在该页面调用 Codex 连接助手进行诊断和安全修复。

domi 会自动安装与当前客户端匹配的 domi 插件。普通用户不需要另外安装插件。

## 资料保存在哪里

domi 只有一套权威资料库：SQLite 保存项目、人脉、行业动态、待办和运行状态；Markdown、图片及附件统一放在“所选目录 / domi工作区”中。飞书连接是可选的外部参考资料库和发布平台，不会改变本地主库。

本地 Markdown 编辑器支持粘贴图片；复制整篇文档时也会复制可用的图片内容。用户明确要求把某篇本地 Markdown 发布到飞书时，domi 会上传本地图片、写入飞书文档并回读校验文本与结构；只有校验通过才报告成功。无法证明无损兼容的格式会在写入前停止，不会静默丢失内容。

从旧版飞书主库升级的用户，在完成显式、安全并逐条验证的本地导入前，旧 Base 和 Wiki 会继续按原模式运行，避免项目、人脉和历史文档突然不可见。domi 不会静默切换到空的本地库，也不会自动删除、覆盖或迁移旧飞书内容；只有用户明确完成安全导入并核验后，本地主库才接管管理。

正式版默认数据目录与应用程序分离：

```text
~/Library/Application Support/domi/domi.sqlite3
~/Library/Application Support/domi/backups/
~/Documents/domi/
```

源码开发版使用 `~/Library/Application Support/domi-dev/`，与正式版数据库、设置、日志和 PLAUD 专用浏览器 Profile 隔离。Codex Marketplace 对当前 macOS 用户全局注册，因此开发版与正式版只共享 `~/Library/Application Support/domi/runtime/domi-marketplace/` 这一份不含用户资料的插件运行目录，避免同名 Marketplace 指向两个路径。正式安装版同时限制为单实例运行，避免两个后台同步器并发写入。

首次安装得到的是空白工作台。覆盖安装和自动更新只替换应用程序，不会删除用户的任务、目录映射或连接设置；数据库升级前会自动保留最近三份备份。由 `0.4.x` 升级到 `0.5.0` 时，domi 会在首次启动时把旧版 Application Support 和默认文稿工作区迁移到上述新目录；如果迁移无法完成，会继续使用原目录，避免把用户显示成空白工作台。

## 隐私与连接

- 仓库和安装包不包含维护者的历史任务、录音、项目材料、组织名称、飞书地址或连接凭据。
- ChatGPT/Codex 登录状态由本机 Codex 管理；中转站 API Key 只保存在 macOS 钥匙串，不写入 domi 设置、Codex 配置、日志或诊断报告。
- 飞书、PLAUD、Outlook 上次验证的发送账号、常用参会人和目录映射由每位用户在自己的 Mac 上配置并保存在本地；飞书授权令牌由 lark-cli 与 macOS 钥匙串管理，不进入仓库、安装包或诊断报告。
- Outlook OAuth 由 Codex 的 Outlook Calendar 连接器管理，domi 不保存其令牌。
- PLAUD 完全可选；未连接时不会启动 PLAUD 队列或读取录音。连接时只使用 `Application Support/domi/plaud-browser` 下的专用 Profile，不读取或复制用户日常 Chrome／Tabbit Profile；断开连接可删除该专用登录数据。
- PLAUD 本地音频转换优先使用安装包内置的无网络 LGPL FFmpeg/ffprobe，不修改系统目录，也不依赖用户安装 Homebrew；对应版本、构建参数、校验值、许可证和完整源码归档随应用分发。
- Keychain、SQLite、工作区和 Codex App Server 可在“系统诊断”中进行脱敏检查。

## 更新

正式版内置两类更新：

- **domi 客户端**：发现 GitHub Release 新版本后可以下载并重启安装，原有资料库、任务历史和连接设置继续保留；
- **Codex Runtime**：在“设置 → 软件更新”中点击“检查并更新”。domi 使用系统网络设置运行 OpenAI 官方更新器，更新后保留上一版本入口；下载、校验或启动验证失败时继续使用当前版本，也可以手动恢复上一版本。

也可以随时前往 [domi Releases](https://github.com/1DeepSheep/domi/releases/latest) 手动下载最新版。

## 从源码运行

面向贡献者的本地开发：

```bash
git clone https://github.com/1DeepSheep/domi.git
cd domi
npm install
npm run dev
```

`npm run dev` 默认从 `~/plugins/domi` 读取 domi 插件源码。也可以通过 `DOMI_PLUGIN_SOURCE=/absolute/path npm run dev` 指定其他插件目录。

提交或打包前运行：

```bash
npm run privacy:check
npm run privacy:history
npm run check
```

构建和签名、公证、发布流程见 [docs/RELEASE.md](docs/RELEASE.md)。

## 相关仓库

- [domi](https://github.com/1DeepSheep/domi)：桌面客户端源码、问题反馈与签名公证后的 macOS Releases
- [domi-plugin](https://github.com/1DeepSheep/domi-plugin)：投资工作流、路由和 Skills

## License

[Apache License 2.0](LICENSE)
