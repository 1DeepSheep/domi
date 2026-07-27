# domi 发布与更新

## 仓库分层

- `domi`：公开客户端源码与发行仓库，保存代码、公共素材、测试、文档，并通过 GitHub Releases 发布签名、公证后的 DMG、ZIP、blockmap 和更新清单。
- `domi-plugin`：公开 domi 插件源码仓库；每次客户端发布只接受该仓库 `main` 的最新提交。
- `~/Library/Application Support/domi/`：每台 Mac 的数据库、设置、缓存索引与运行时快照，不进入 Git。
- `~/Documents/domi/`：正式版任务材料与输出，不进入 Git。
- macOS Keychain：API Key、登录令牌、签名私钥和公证凭据，不进入 Git 或安装包。

仓库 URL 可以公开，访问令牌不可以。不要把 GitHub Token 写进客户端、插件、配置示例或安装包。若发行仓库改为私有，客户端无法在不携带 Token 的情况下自动更新；此时应改用受控 HTTPS 更新源。

两个公开仓库都必须从无私人历史的根提交开始。删除敏感内容后继续提交不能清除旧版本；历史扫描失败时必须重建仓库，而不是只做普通 revert。

## 版本规则

- 稳定版：`0.2.0`，发布 `latest-mac.yml`。
- 测试版：`0.2.0-beta.1`，发布 `beta-mac.yml`，GitHub Release 标记为 prerelease。
- 已发布版本不得覆盖同一版本号；每次发布必须先提升 `package.json` 的 `version`。

## 本机发布

1. 先提交并推送 domi 插件改动，且每次插件内容变化都必须提升 `.codex-plugin/plugin.json` 的 `version`。
2. 在插件仓库运行 `node scripts/public-release-check.cjs --history`；在客户端仓库运行 `npm run privacy:history` 和 `npm run check`。源码、完整历史、类型检查和主进程语法检查必须全部通过。
3. 运行 `npm run dist:mac`。该命令会从官方公开插件仓库拉取最新 `main`，记录提交和内容哈希，并把该快照封装进客户端；Fork 可通过 `DOMI_PLUGIN_REPOSITORY` 覆盖仓库地址。拉取或校验失败会直接终止发布。
4. 验证签名、公证和 stapling；失败时不得创建 Release。
5. 确认 DMG 最终内容扫描通过，只上传 `release/<version>/` 中这一版本的文件。禁止把整个历史 `release/` 目录批量上传。

打包使用的是 GitHub 已提交版本，不会读取 `~/plugins/domi` 中尚未提交的工作区改动。这样正式安装包可复现，也不会意外发布半成品。`npm run pack:mac` 仅用于本机测试，会读取本机插件工作区。

安装或更新后的 domi 首次检查 Codex 时，会把安装包内的 domi 快照注册为 `domi@domi-managed`。如果本机插件较旧、来源不同，或版本相同但提交哈希变化，domi 会替换为随本次客户端发布的版本；用户手动安装的更高版本不会被降级。

## GitHub 发布保护

CI 应在 `main` 更新、`v*` 标签和手动触发时同时检出客户端与 domi 插件，锁定插件最新 `main` 后执行完整检查。

公开插件仓库不需要额外的个人访问令牌。GitHub Actions 仅使用仓库自动提供的最小权限 `GITHUB_TOKEN`；Apple 签名与公证凭据只能保存在 Actions Secrets 或构建机 Keychain 中。

Release 前必须确认保护检查成功。不要绕过失败检查手工上传旧安装包。

发布凭据通过本机 Keychain 或临时环境变量提供。禁止创建包含真实值的 `.env`、`.npmrc`、证书或私钥文件。

若公证文件已成功提交，但 `electron-builder` 在等待 Apple 结果时因网络中断退出，不要重复构建。先用 `xcrun notarytool info <submission-id> --keychain-profile domi-notary` 确认状态；状态变为 `Accepted` 后运行 `npm run dist:mac:resume`，它会给缓存中的同一份 `.app` 贴票并生成 DMG、ZIP、blockmap 和更新清单。

`dist:mac:resume` 不会重新拉取插件，因为它必须继续处理已经签名并提交公证的同一份 `.app`。如果 domi 在公证等待期间又更新，应提升客户端版本并重新执行一次完整的 `npm run dist:mac`，不能把新插件塞进已提交公证的产物。

## 升级数据保护

更新只替换 `/Applications/domi.app`。数据库继续使用固定路径 `~/Library/Application Support/domi/domi.sqlite3`，任务文件继续使用 `~/Documents/domi/`。

数据库 schema 变更前会在 `~/Library/Application Support/domi/backups/` 自动保存最多三份备份。迁移失败时启动会中止，不会以空白数据库覆盖原历史。

`0.5.0` 起产品展示名统一为小写 `domi`。首次启动时会迁移 `0.4.x` 使用的旧 Application Support 目录和默认文稿工作区；目标目录已存在时只补充缺失文件，重命名和复制均失败时保留旧路径继续运行。稳定的 `appId` 与 Keychain 服务名不变，因此任务历史、连接设置和凭据会继续继承。

`0.2.0` 是首个内置自动更新能力的版本。更早版本无法主动下载 `0.2.0`，需要由用户手动覆盖安装一次；由于 `appId` 与数据目录保持不变，这次覆盖安装同样会继承历史、配置和 Keychain 凭据。安装 `0.2.0` 后，后续版本可由客户端自动完成下载与重启安装。
