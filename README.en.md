<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <img src="public/domi-icon.png" width="96" alt="domi icon">
</p>

<h1 align="center">domi</h1>

<p align="center">
  <strong>An AI investment analyst built for research, judgment, and execution</strong><br>
  domi connects material organization, investment analysis, structured records, ongoing monitoring, and next actions in one workflow—with your knowledge base on your Mac.
</p>

<p align="center">
  <a href="https://github.com/1DeepSheep/domi/releases/latest"><strong>Download the latest release</strong></a>
  ·
  <a href="https://github.com/1DeepSheep/domi-plugin">Explore the domi plugin</a>
  ·
  <a href="https://github.com/1DeepSheep/domi/issues">Report an issue</a>
</p>

> The current public release supports both Apple Silicon (arm64) and Intel (x64) Macs and requires macOS 12 Monterey or later. Every installer is Developer ID signed, Apple-notarized, and stapled.

## Not just an answer—the rest of the workflow

General-purpose AI is good at answering a question. Investment work needs scattered inputs to become durable records, decisions, and next actions. domi combines Codex, investment-specific Skills, a local knowledge base, and optional external connections into one verifiable execution chain:

> **Capture → Research and judgment → Structured records → Continuous monitoring → Action**

Give domi a recording of a company meeting, for example, and it can continue from the transcript to structured notes, key takeaways, an initial investment view, follow-ups, and filing the result under the right company—instead of returning text that has nowhere to go. External writes still require an explicit instruction from the user in the current request.

## What makes domi valuable

### 1. It advances an end-to-end workflow like an analyst

Within one task, domi can read materials, use tools, form a view, update the local knowledge base, and propose the next step. Context, attachments, execution history, and results stay with the task, reducing handoffs and copy-paste between tools.

### 2. It is built for investment work, not as a generic chat wrapper

The desktop app automatically installs a compatible version of the [domi plugin](https://github.com/1DeepSheep/domi-plugin), which provides workflows for company and people research, investment reviews, IC memos, fundamental and financial analysis, sector scans, meeting notes, project filing, and follow-up management.

### 3. It turns fragmented information into institutional memory

Companies, people, market events, meeting notes, and follow-ups accumulate as structured indexes and Markdown documents. Within the local workspace selected by the user, domi can find existing material and connect new research with prior knowledge instead of starting every task from a blank chat.

### 4. Local-first, with user-owned data

SQLite + Markdown is the single source of truth. Documents, images, and attachments remain in the local workspace chosen by the user. App updates replace only the application; they preserve tasks, source lists, historical content, and connection settings, and database upgrades are preceded by backups.

### 5. Feishu is an optional knowledge extension and publishing surface

domi's local knowledge base, document library, market radar, and research workflows work without Feishu. After connecting a Feishu account, the user can explicitly ask domi to search Base/Wiki/Docs/Drive, create or edit documents, publish a local Markdown copy, or send a message. Feishu never silently replaces the local source of truth.

### 6. It scales from one company to an entire field

The market radar can maintain news sites, RSS feeds, priority WeChat official accounts, and public podcasts, then organize news, financings, technology, policy, market, and company developments by field. Research tasks can also map companies, teams, and relationship signals across a sector and turn promising leads into follow-ups.

## Work you can hand to domi

| Input | What domi can continue to do |
| --- | --- |
| A recording, audio file, or transcript | Produce or refine a transcript, create structured notes, extract key takeaways and follow-ups, and continue to an initial review and filing for company-related meetings |
| A company name, URL, pitch deck, screenshot, or datapack | Perform desk research and source checks, build a company profile, analyze fundamentals and financials, rate the opportunity, and file the results |
| A sector or research question | Map companies and people, analyze technology and the value chain, identify information gaps, and produce structured research or a slide report |
| A prospectus, financial statements, or company materials | Extract operating and financial metrics, assess the business model and key risks, and produce traceable conclusions |
| An opportunity under consideration | Write an investment review, recommend whether to advance, prepare an IC memo, and support deal-negotiation preparation |
| A set of themes and sources | Scan market developments, normalize and deduplicate events, assess importance, and track financings and company updates |
| A local Markdown document | Continue editing locally, associate it with a company, or publish a read-back-verified Feishu copy when explicitly requested |
| A meeting topic, time, place, and attendees | Send a calendar invitation to explicitly selected attendees through the optional Outlook connection |

These capabilities are delivered jointly by the desktop app, its installed domi plugin, Codex, and services the user chooses to connect. Features that require an account or external login are available only after that connection is configured.

## Example requests

```text
Turn this founder-meeting recording into structured notes, give me the key judgments and follow-ups, and file it under the right company.

Research this company: verify public sources and our existing materials, analyze the business model and financial performance, and tell me whether it is worth advancing.

Map the embodied-intelligence landscape and key people. Highlight the people we should prioritize meeting and create a research document.

Track the most important AI-for-Science developments from the past week. Deduplicate them and keep only events that could change an investment view.

Write an IC memo from the pitch deck, datapack, and past conversations. Attach evidence to every conclusion and identify what still needs verification.

Publish this local Markdown document to my Feishu knowledge base, then verify the headings, lists, tables, links, and images.
```

## What is in the workspace

- **Persistent tasks:** streaming execution, stop and resume, context recovery, attachments, queues, and an operation timeline; a message remains in the task from which it was sent.
- **Structured database:** view and edit fields for companies, people, and market events, with automatic local SQLite and Markdown persistence.
- **Document library:** browse, search, and edit local Markdown; preview PDFs; manage images and attachments.
- **Market radar:** browse developments by field; manage news sites, priority WeChat accounts, and podcast sources; bulk-import priority accounts from pasted text or a List file.
- **Follow-ups:** maintain key dates, research gaps, and next actions in the local `0.待办事项.md` ledger and the in-app board.
- **Optional PLAUD:** read the user's own PLAUD recording queue, then continue from transcription to notes, judgment, filing, and follow-ups.
- **Optional Feishu:** use Feishu as an external reference and publishing platform with Base, Wiki, Docs, Drive, IM, and Contact capabilities.
- **Optional Outlook:** send calendar invitations to one or more attendees selected by the user.
- **Optional Weixin bridge:** assign isolated Codex tasks from the owner's Weixin account and receive progress updates, long results, and real file attachments while the Mac remains online.
- **Safe updates:** download a new release in the app, wait for active tasks to finish and state to flush safely, then restart to install.

## Local source of truth and external connections

domi has one authoritative knowledge base: SQLite stores companies, people, market events, follow-ups, and runtime state; Markdown, images, and attachments live in the user-selected `domi工作区` workspace. Feishu, PLAUD, and Outlook are optional connections.

When the user explicitly asks to publish a local Markdown document to Feishu, domi checks supported content and local resources before writing, uploads local images, and reads the remote document back to verify text and structure. If compatibility cannot be established, publishing stops instead of silently dropping content. The remote copy never replaces the local original.

For users upgrading from an older Feishu-primary setup, the existing Base, Wiki, and local materials continue to operate in compatibility mode until a deliberate local import has been completed and verified item by item. domi does not silently switch to an empty local database or automatically delete or overwrite older Feishu content.

## Installation

### 1. Download the right build for this Mac

1. Open [domi Releases](https://github.com/1DeepSheep/domi/releases/latest).
2. On an M-series Mac, download the installer ending in `arm64.dmg`. On an Intel Mac, download the installer ending in `x64.dmg`.
3. Open the DMG, drag “domi” into Applications, and launch it. You can also open domi directly inside the DMG and choose “安装并打开” (Install and open) in the one-time prompt.

The same prompt appears when a release build starts from Downloads or another location outside Applications. Choosing “继续使用” (Continue using) dismisses it permanently; macOS handles any installation authorization. If Applications already contains domi, the guide preserves that copy. Open the installed version and use its in-app update to avoid replacing an app with active tasks. Cancellation or installation failure still lets you use the current copy, and you can install it later by dragging it in Finder.

arm64 and x64 builds remain separate. The guide uses Electron's built-in installation support and requires no additional installer download.

### 2. Confirm the existing connection and start

On first launch, domi first reuses an existing Codex Runtime, sign-in, and configured provider on this Mac. There is no need to enter that connection again. If a usable Runtime is missing, domi verifies and extracts the bundled official OpenAI standalone distribution, without requiring Terminal or a fresh GitHub download. If no usable identity is available, choose “登录并继续” (Sign in and continue); domi checks the status automatically after you complete the official sign-in flow.

When you choose “开始使用” (Start using domi), setup first checks availability of `gpt-5.6-terra / medium` for market radar and follow-ups, and `gpt-5.6-sol / max` for meeting notes and research. It then runs one temporary task with no saved history through the same App Server channel used for real tasks, using the notes and research configuration to verify the actual model response and a Shell tool call. A program separately checks local file writing and reading. Setup completes only after verification; missing capabilities produce a useful error rather than an automatic reduction in task settings.

Open Advanced settings when you need to change the connection method, configure a Responses gateway, or specify a Codex path. A gateway must support the OpenAI Responses API and the models and tools above; its key is stored in macOS Keychain. See the [official Codex CLI documentation](https://developers.openai.com/codex/cli) and [Codex configuration reference](https://developers.openai.com/codex/config-reference).

For VPNs and proxies, domi attempts to apply the proxy routes macOS resolves for the relevant services to Codex, preserving explicit proxy environment settings first. Complex PAC routing or rules requiring multiple proxies may not translate automatically. In that case, enable your VPN's mode that covers all applications, then check the connection again. Connectivity still depends on the network and routing configuration; support is not guaranteed for a particular VPN brand or mode.

### 3. Use the default workspace and add optional connections later

New users default to `domi工作区` inside Documents, with no extra configuration required. Completing setup creates or reuses the document directories, initializes local indexing and `0.待办事项.md`, and preserves existing workspace locations. Choose “更改位置” (Change location) during setup if you prefer another folder.

Feishu, PLAUD, and Outlook are optional and can be configured in Settings after entering the app. First use requires no Base token, table ID, or Wiki space ID, and does not enable PLAUD automatically. domi prepares the plugin version matched to the desktop release; users do not need to install Skills or the plugin separately.

## Where data is stored

Production data is separate from the application bundle:

```text
~/Library/Application Support/domi/domi.sqlite3
~/Library/Application Support/domi/backups/
~/Documents/domi/
```

The local workspace can be placed elsewhere during setup. Reinstalling or auto-updating replaces only the application; tasks, directory mappings, source lists, historical content, and connection settings remain. Source development builds use `~/Library/Application Support/domi-dev/` and do not share production data.

## Privacy and safety boundaries

- The repository and installers contain no maintainer or user task history, recordings, company materials, Feishu identifiers, or connection credentials.
- ChatGPT/Codex authentication is managed by the local Codex runtime. Gateway API keys stay in macOS Keychain.
- Feishu tokens are managed by local Feishu tooling and Keychain. PLAUD uses a domi-managed browser profile and never reads the user's everyday browser profile.
- With PLAUD disconnected, domi does not inspect its recording queue. Without an explicit instruction, domi does not publish local material to Feishu or send messages.
- App updates wait for tasks to become idle and state to flush safely. The three most recent backups are preserved before database schema changes.
- Keychain, SQLite, the workspace, and Codex App Server can be checked through redacted system diagnostics.

See [PRIVACY.md](PRIVACY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for more detail.

## Updates

When a new GitHub Release is available, domi shows an update entry in the lower-left corner. A click downloads the release; active tasks are allowed to finish and state is flushed before the app restarts to install it. The Codex Runtime can be checked and updated separately under Settings → Software Update, and the current version remains available if that update fails.

You can also install the latest release manually from [domi Releases](https://github.com/1DeepSheep/domi/releases/latest).

## Run from source

```bash
git clone https://github.com/1DeepSheep/domi.git
cd domi
npm install
npm run dev
```

The personal Weixin bridge is maintained in the same repository. To enable it from source:

```bash
npm run wechat:login
npm run wechat:install
```

Credentials, tasks, and transferred media stay under `~/Library/Application Support/domi/wechat-bridge/` and never enter the repository. See [services/wechat-bridge/README.md](services/wechat-bridge/README.md) for details.

`npm run dev` reads the domi plugin source from `~/plugins/domi` by default. Set `DOMI_PLUGIN_SOURCE=/absolute/path npm run dev` to use another plugin directory.

Before committing or packaging:

```bash
npm run privacy:check
npm run privacy:history
npm run check
```

See [docs/RELEASE.md](docs/RELEASE.md) for the build, signing, notarization, and release process.

## Related repositories

- [domi](https://github.com/1DeepSheep/domi): Mac desktop source, issue tracking, and signed/notarized macOS releases
- [domi-plugin](https://github.com/1DeepSheep/domi-plugin): investment workflows, routing, and Skills

## License

[Apache License 2.0](LICENSE)
