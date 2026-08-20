<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

<p align="center">
  <img src="public/domi-icon.png" width="96" alt="domi 图标">
</p>

<h1 align="center">domi</h1>

<p align="center">
  <strong>懂研究、会判断、能执行的 AI 投资分析师</strong><br>
  domi 将资料整理、研究分析、结构化入库、持续跟踪和后续行动串联成一套完整的投资工作流，并将资料沉淀在你的 Mac 上。
</p>

<p align="center">
  <a href="https://github.com/1DeepSheep/domi/releases/latest"><strong>下载最新版</strong></a>
  ·
  <a href="https://github.com/1DeepSheep/domi-plugin">查看 domi 插件</a>
  ·
  <a href="https://github.com/1DeepSheep/domi/issues">反馈问题</a>
</p>

> 当前公开版支持 Apple Silicon（arm64）和 Intel（x64）Mac，要求 macOS 12 Monterey 或更高版本。安装包已经 Developer ID 签名、Apple 公证并附加公证票据。

## 不只是生成一份内容，而是把工作完整做下去

通用 AI 很擅长回答一个问题；投资工作更需要把分散的输入变成可继续推进的系统记录和行动。domi 把 Codex、投资 Skills、本地资料库和可选外部连接组织成一条可验证的执行链：

> **信息采集 → 研究与判断 → 结构化归档 → 持续跟踪 → 执行动作**

例如，把一次项目交流录音交给 domi 后，它可以继续完成文字稿、结构化纪要、核心观点、项目初评和跟进事项，并把结果放回对应项目，而不是只返回一段无法继续管理的文本。所有外部写入仍以用户本轮的明确指令为前提。

## domi 最有价值的地方

### 1. 像分析师一样推进端到端工作流

在同一个任务里读取材料、调用工具、形成判断、写入资料库并给出下一步。任务保留上下文、附件、执行时间线和结果，不需要在人和多个工具之间反复复制粘贴。

### 2. 为投资工作而设计，而不是通用聊天壳

客户端自动安装匹配版本的 [domi 插件](https://github.com/1DeepSheep/domi-plugin)，提供项目研究、人物研究、投资快评、IC 报告、基本面与财务分析、行业扫描、会议纪要、项目入库和待办维护等投资工作流。

### 3. 能把零散信息变成可积累的机构记忆

项目、人脉、行业动态、纪要和待办事项以结构化索引与 Markdown 文档持续沉淀。domi 可以在用户选定的本地资料范围内查找已有材料，把新研究和历史信息关联起来，而不是每次从空白对话开始。

### 4. 本地优先，数据归用户

SQLite + Markdown 是唯一权威资料库，文档、图片和附件保存在用户选择的本地工作区。应用更新只替换客户端，不删除用户任务、信源清单、历史内容或连接设置；数据库升级前会保留备份。

### 5. 飞书是知识外挂和发布平台，不是管理前提

不连接飞书也能使用 domi 的本地资料库、文档库、行业动态和研究能力。连接自己的飞书账号后，可以按明确指令搜索 Base／Wiki／Docs／Drive、创建或编辑文档、发布本地 Markdown 副本或发送消息；飞书内容不会自动覆盖本地主库。

### 6. 从单个项目扩展到一个领域的信息规模

行业雷达可以维护新闻源、RSS、重点公众号和公开播客，按领域持续整理新闻、融资、技术、政策、市场与公司动态。研究任务也可以围绕某个赛道梳理项目、团队和关系线索，并把值得继续跟进的对象转成待办事项。

## 可以直接交给 domi 的工作

| 交给 domi 的输入 | 可以继续完成的工作 |
| --- | --- |
| 一段录音、音频或文字稿 | 生成文字稿或精修记录、结构化纪要、核心观点和跟进事项；项目类交流可继续做初评和入库 |
| 公司名、链接、BP、截图或 Datapack | 桌面研究、材料核验、项目画像、基本面／财务分析、投资评级和项目资料归档 |
| 一个赛道或研究问题 | Mapping 项目与人物、梳理技术和产业链、发现信息缺口、形成结构化研究或 slides |
| 招股书、财务报表或项目材料 | 提取经营与财务指标、分析商业模式和关键风险、形成可追溯的判断 |
| 一个待决策项目 | 投资快评、推进建议、IC 材料和交易谈判准备 |
| 一组关注领域和信源 | 行业动态扫描、事件归一和去重、重要性判断、融资与公司动态追踪 |
| 本地 Markdown 文档 | 在本地继续编辑、关联到项目；按明确指令发布为经过回读校验的飞书文档副本 |
| 会面主题、时间、地点和参会人 | 通过可选 Outlook 连接向明确选择的参会人发送日程邀请 |

这些能力由客户端、已安装的 domi 插件、Codex 及用户选择连接的服务共同完成；需要登录或外部账号的能力只有在用户完成相应连接后才可用。

## 典型使用方式

```text
把这段创始人交流录音整理成纪要，给出核心判断和跟进事项，并归档到对应项目。

研究这家公司：核验公开信息和已有材料，分析商业模式与财务表现，判断是否值得继续推进。

Mapping 具身智能赛道的项目和关键人物，标出值得优先认识的人，并形成研究文档。

追踪 AI4S 最近一周的重要行业动态，去重后只保留会影响投资判断的事件。

基于 BP、Datapack 和历史交流写一份 IC 报告；所有结论标明证据和仍需核验的问题。

把这篇本地 Markdown 发布到我的飞书知识库，并在发布后核对标题、列表、表格、链接和图片。
```

## 工作台包含什么

- **连续任务**：流式执行、停止、恢复上下文、附件、排队与操作时间线；消息固定留在发送时的任务中。
- **资料库**：直接查看和编辑项目、人脉及行业动态的结构化字段，自动保存到本地 SQLite 和 Markdown。
- **文档库**：浏览、搜索和编辑本地 Markdown，预览 PDF，管理图片和附件。
- **行业雷达**：按领域查看最新动态，维护新闻源、重点公众号和播客信源，支持重点公众号文本或 List 文件批量导入。
- **待办事项**：把关键节点、研究缺口和下一步行动维护到本地 `0.待办事项.md` 和客户端看板。
- **可选 PLAUD**：读取用户自己的 PLAUD 录音队列，转写后继续完成纪要、判断、归档与待办。
- **可选飞书**：把飞书作为外部参考资料库和发布平台，保留完整的 Base、Wiki、Docs、Drive、IM 和 Contact 能力。
- **可选 Outlook**：向用户指定的一个或多个参会人发送日程邀请。
- **可选微信桥接**：从自己的微信远程布置相互隔离的 Codex 任务，接收阶段进度、长结果与真实文件附件；Mac 保持在线即可，不要求另建云端任务服务。
- **安全更新**：发现新版本后在客户端下载；等待运行中的任务结束并完成安全落盘后，再重启安装。

## 本地主库与外部连接

domi 只有一套权威资料库：SQLite 保存项目、人脉、行业动态、待办和运行状态；Markdown、图片及附件统一放在用户选择的 `domi工作区`。飞书、PLAUD 和 Outlook 都是可选连接。

用户明确要求把某篇本地 Markdown 发布到飞书时，domi 会在写入前检查支持的内容和本地资源，上传图片，并在写入后回读校验文本与结构。无法证明兼容的内容会停止发布，不会静默丢失；远端副本也不会替代本地原件。

从旧版飞书主库升级的用户，在完成显式、安全并逐条验证的本地导入前，旧 Base、Wiki 和本地材料会继续按原模式运行。domi 不会静默切换到空的本地库，也不会自动删除或覆盖旧飞书内容。

## 安装

### 1. 下载适合这台 Mac 的版本

1. 打开 [domi Releases](https://github.com/1DeepSheep/domi/releases/latest)。
2. M 系列芯片下载名称以 `arm64.dmg` 结尾的安装包；Intel 芯片下载名称以 `x64.dmg` 结尾的安装包。
3. 打开 DMG，把「domi」拖入“应用程序”文件夹，然后启动。

### 2. 连接 Codex

首次启动时，domi 会检测 Codex CLI；如果尚未安装，会校验并解压安装包内置的 OpenAI 官方独立发行版，无需打开终端，也不依赖当时能否连接 GitHub。运行时保存在 Codex 官方的 `~/.codex/packages/standalone`，并在 `~/.local/bin` 建立用户级链接，不修改系统目录。

随后选择一种身份方式：

- **ChatGPT 账号**：打开 Codex 官方登录，复用本机 ChatGPT／Codex 账号；
- **Responses 中转站**：填写兼容 OpenAI Responses API 的地址、模型名称和 API Key。密钥只写入 macOS 钥匙串。

点击“测试完整连接”后，domi 会用不保存历史的临时任务验证模型响应和 Shell 工具调用，两项都通过后才完成设置。普通 Chat Completions 接口不支持完整 Codex 能力。配置说明见 [Codex CLI 官方文档](https://developers.openai.com/codex/cli) 和 [Codex 配置参考](https://developers.openai.com/codex/config-reference)。

### 3. 建立本地工作区

选择一个上级目录；domi 会创建或复用 `domi工作区`，初始化 SQLite、Markdown 目录和 `0.待办事项.md`。随后可以直接开始使用，也可以按需连接飞书、PLAUD 和 Outlook。新用户不需要手工填写 Base Token、Table ID 或 Wiki Space ID。

domi 会自动安装与当前客户端匹配的 domi 插件，普通用户不需要单独安装 Skills 或插件。

## 资料保存在哪里

正式版默认数据目录与应用程序分离：

```text
~/Library/Application Support/domi/domi.sqlite3
~/Library/Application Support/domi/backups/
~/Documents/domi/
```

用户也可以在首次设置时选择其他本地工作区位置。覆盖安装和自动更新只替换应用程序，不会删除用户的任务、目录映射、信源清单、历史内容或连接设置。源码开发版使用 `~/Library/Application Support/domi-dev/`，与正式版数据隔离。

## 隐私与安全边界

- 仓库和安装包不包含维护者或用户的历史任务、录音、项目材料、飞书标识或连接凭据。
- ChatGPT／Codex 登录由本机 Codex 管理；中转站 API Key 只保存在 macOS 钥匙串。
- 飞书令牌由本机飞书工具和 macOS 钥匙串管理；PLAUD 只使用 domi 专用浏览器 Profile，不读取日常浏览器 Profile。
- 未连接 PLAUD 时，domi 不会读取录音队列；未收到明确指令时，不会把本地资料发布到飞书或发送消息。
- 应用更新会等待任务空闲并安全落盘；数据库 schema 变更前自动保留最近三份备份。
- Keychain、SQLite、工作区和 Codex App Server 可在“系统诊断”中进行脱敏检查。

更多说明见 [PRIVACY.md](PRIVACY.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 更新

发现 GitHub Release 新版本后，domi 会在左下角显示更新入口。用户点击后下载更新；运行中的任务会继续完成，任务和数据安全落盘后客户端才重启安装。Codex Runtime 可以在“设置 → 软件更新”中单独检查和更新，失败时继续使用当前版本。

也可以随时前往 [domi Releases](https://github.com/1DeepSheep/domi/releases/latest) 手动下载安装。

## 从源码运行

```bash
git clone https://github.com/1DeepSheep/domi.git
cd domi
npm install
npm run dev
```

个人微信桥接也与客户端源码一起维护；从源码启用时运行：

```bash
npm run wechat:login
npm run wechat:install
```

凭证、任务和附件保存在 `~/Library/Application Support/domi/wechat-bridge/`，不会写入仓库。详细说明见 [services/wechat-bridge/README.md](services/wechat-bridge/README.md)。

`npm run dev` 默认从 `~/plugins/domi` 读取 domi 插件源码。也可以通过 `DOMI_PLUGIN_SOURCE=/absolute/path npm run dev` 指定其他插件目录。

提交或打包前运行：

```bash
npm run privacy:check
npm run privacy:history
npm run check
```

构建、签名、公证和发布流程见 [docs/RELEASE.md](docs/RELEASE.md)。

## 相关仓库

- [domi](https://github.com/1DeepSheep/domi)：Mac 客户端源码、问题反馈与签名公证后的 Releases
- [domi-plugin](https://github.com/1DeepSheep/domi-plugin)：投资工作流、路由和 Skills

## License

[Apache License 2.0](LICENSE)
