<p align="center">
  <img src="public/domi-icon.png" width="96" alt="domi 图标">
</p>

<h1 align="center">domi</h1>

<p align="center">
  面向投资研究与项目管理的 Mac 桌面智能工作台。<br>
  在熟悉的对话界面里调用本机 Codex，把行业动态、项目研究、会议纪要和资料归档串成一条工作流。
</p>

<p align="center">
  <a href="https://github.com/1DeepSheep/domi-releases/releases/latest">下载最新版</a>
  ·
  <a href="https://github.com/1DeepSheep/domi-plugin">domi 插件</a>
  ·
  <a href="https://github.com/1DeepSheep/domi-workbench/issues">反馈问题</a>
</p>

> 当前公开版仅提供 Apple Silicon Mac 安装包。安装包内置经过 SHA-256 校验的 OpenAI Codex CLI 基线，首次启动可离线完成运行时准备，再进行连接测试。

## 一眼看懂 domi 能做什么

- **行业雷达**：自动刷新行业新闻，按领域和子领域筛选，突出值得关注的新动态。
- **项目研究**：从公司名、链接、BP、截图或已有材料出发，完成桌面研究、投资分析和项目归档。
- **人物与机构研究**：整理创始人、团队、投资机构和关系线索，形成可继续维护的人物资料。
- **投资工作流**：支持投资快评、IC 材料、交易谈判、结构化研究及 HTML/PDF slides 报告。
- **会议与录音**：处理文字稿与音频，生成纪要、核心结论和跟进事项；PLAUD 为可选连接。
- **两种资料库**：既可完全使用本地 SQLite + Markdown，也可连接用户自己的飞书多维表格和 Wiki。
- **连续任务执行**：对话绑定 Codex 任务，支持流式回答、停止执行、恢复上下文、文件附件和操作时间线。

## 安装

### 1. 下载 domi

1. 打开 [domi Releases](https://github.com/1DeepSheep/domi-releases/releases/latest)。
2. 下载名称以 `arm64.dmg` 结尾的安装包。
3. 打开 DMG，把「domi」拖入“应用程序”文件夹。
4. 启动 domi。公开安装包已经 Developer ID 签名、Apple 公证并附加公证票据。

### 2. 安装并连接 Codex

首次启动时，domi 会检测可用的 Codex CLI；如果尚未安装，会自动校验并解压安装包内置的 OpenAI 官方独立发行版，无需打开终端，也不依赖当时能否连接 GitHub。运行时保存在 Codex 官方的 `~/.codex/packages/standalone` 目录，并在 `~/.local/bin` 建立用户级链接，不修改系统目录。版本、来源与校验值记录在 [`resources/codex-runtime.json`](resources/codex-runtime.json)，第三方说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

随后选择一种身份方式：

- **ChatGPT 账号**：打开 Codex 官方登录，复用本机 ChatGPT / Codex 账号；
- **Responses 中转站**：填写兼容 OpenAI Responses API 的地址、模型名称和 API Key。密钥只写入 macOS 钥匙串，`~/.codex/config.toml` 只保存地址、模型和读取钥匙串的命令。

最后点击“测试完整连接”。domi 会启动一次不保存历史、只读沙箱的临时 Codex 任务，同时验证模型响应和 Shell 工具调用；两项都通过后才允许完成首次设置。普通 Chat Completions 接口不支持完整 Codex 能力，不能作为中转站使用。安装方式与配置格式分别遵循 [Codex CLI 官方文档](https://learn.chatgpt.com/docs/codex/cli) 和 [Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。

### 3. 选择资料库和可选连接

继续按向导完成两项选择：

1. 选择“本地资料库”或“飞书资料库”；
2. 根据需要连接 PLAUD，也可以直接跳过，以后再连接。

domi 会自动安装与当前客户端匹配的 domi 插件。普通用户不需要另外安装插件。

## 资料保存在哪里

| 模式 | 适合谁 | 数据如何保存 |
| --- | --- | --- |
| 本地资料库 | 希望开箱即用、资料不依赖第三方云服务的用户 | SQLite 保存结构化索引和状态；Markdown、图片及其他附件保存在用户选择的本地目录 |
| 飞书资料库 | 已使用飞书 Wiki 和多维表格协作的团队 | 用户在自己的 Mac 上配置 Base、表格和 Wiki 映射；项目材料仍可保存在本地目录 |

本地 Markdown 编辑器支持粘贴图片；复制整篇文档时也会复制可用的图片内容。两种模式可以使用同一套项目分类、研究和写作规则，区别只在资料写入位置。

从本地模式切换到飞书时，可选择先迁移本地资料：domi 会按领域和子领域把项目主页、纪要与研究 Markdown 写入对应 Wiki，上传文档内图片，并把项目、人脉、行业动态分别写入 Watching List、People Base 和行业动态 Base。项目按公司名称、人脉按姓名与所属组织、新闻按事件 ID 匹配现有记录；每条写入都会回读校验。只有全部资料通过校验后才切换模式，本地文件、SQLite 数据和原始附件始终保留。

正式版默认数据目录与应用程序分离：

```text
~/Library/Application Support/domi/domi.sqlite3
~/Library/Application Support/domi/backups/
~/Documents/domi/
```

首次安装得到的是空白工作台。覆盖安装和自动更新只替换应用程序，不会删除用户的任务、目录映射或连接设置；数据库升级前会自动保留最近三份备份。由 `0.4.x` 升级到 `0.5.0` 时，domi 会在首次启动时把旧版 Application Support 和默认文稿工作区迁移到上述新目录；如果迁移无法完成，会继续使用原目录，避免把用户显示成空白工作台。

## 隐私与连接

- 仓库和安装包不包含维护者的历史任务、录音、项目材料、组织名称、飞书地址或连接凭据。
- ChatGPT/Codex 登录状态由本机 Codex 管理；中转站 API Key 只保存在 macOS 钥匙串，不写入 domi 设置、Codex 配置、日志或诊断报告。
- 飞书、PLAUD 和目录映射由每位用户在自己的 Mac 上配置并保存在本地。
- PLAUD 完全可选；未连接时不会启动 PLAUD 队列或读取录音。
- Keychain、SQLite、工作区和 Codex App Server 可在“系统诊断”中进行脱敏检查。

## 更新

正式版内置两类更新：

- **domi 客户端**：发现 GitHub Release 新版本后可以下载并重启安装，原有资料库、任务历史和连接设置继续保留；
- **Codex Runtime**：在“设置 → 软件更新”中点击“检查并更新”。domi 使用系统网络设置运行 OpenAI 官方更新器，更新后保留上一版本入口；下载、校验或启动验证失败时继续使用当前版本，也可以手动恢复上一版本。

也可以随时前往 [发行仓库](https://github.com/1DeepSheep/domi-releases/releases/latest) 手动下载最新版。

## 从源码运行

面向贡献者的本地开发：

```bash
git clone https://github.com/1DeepSheep/domi-workbench.git
cd domi-workbench
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

- [domi-workbench](https://github.com/1DeepSheep/domi-workbench)：桌面客户端源码
- [domi-plugin](https://github.com/1DeepSheep/domi-plugin)：投资工作流、路由和 Skills
- [domi-releases](https://github.com/1DeepSheep/domi-releases)：签名、公证后的 macOS 安装包

## License

[Apache License 2.0](LICENSE)
