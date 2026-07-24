# Privacy and public distribution

The Domi application bundle contains application code, public assets, and a reviewed snapshot of the Domi plugin. User state lives outside the application and is preserved when the app is replaced or updated.

## Data kept on the user’s Mac

```text
~/Library/Application Support/豆米/
~/Documents/豆米/
~/.domi/
```

These locations can contain settings, SQLite databases, task history, Markdown documents, attachments, backups, recordings, and workflow state. They are not release inputs and must never be copied into the repository or application bundle.

ChatGPT authentication is managed by the locally installed Codex runtime. External connection identifiers are entered by each user and saved only in local Application Support. Credentials and signing material belong in macOS Keychain or the release environment, never in source files.

## Required release gates

Before any source or binary publication:

```bash
npm run privacy:check
npm run privacy:history
npm run check
node scripts/privacy-check.cjs --artifact /absolute/path/to/Domi-version-arm64.dmg
```

The corresponding Domi plugin commit must separately pass:

```bash
node scripts/public-release-check.cjs
node scripts/public-release-check.cjs --history
```

A normal revert does not remove sensitive Git history. If a history check fails, publish from a new root commit or use a reviewed history-rewrite procedure before making the repository public.

Code-signing identity is visible in a distributed macOS application. Public binaries should therefore be signed with an organization or brand identity approved for public disclosure.
