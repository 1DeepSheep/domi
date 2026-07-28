# Privacy and public distribution

The domi application bundle contains application code, public assets, and a reviewed snapshot of the domi plugin. User state lives outside the application and is preserved when the app is replaced or updated.

## Data kept on the user’s Mac

```text
~/Library/Application Support/domi/
~/Documents/domi/
~/.domi/
```

Source development builds use the separate `~/Library/Application Support/domi-dev/` directory and never reuse the installed application’s database, settings, logs, or managed browser profile. Because Codex marketplaces are registered globally for the current macOS user, development and production share only the code-only `~/Library/Application Support/domi/runtime/domi-marketplace/` directory; it contains no user records, credentials, recordings, or browser profile.

These locations can contain settings, SQLite databases, task history, Markdown documents, attachments, backups, recordings, workflow state, and the optional `plaud-browser` profile. PLAUD authentication is created only when the user signs into their own account in this domi-managed Chrome or Tabbit profile; domi does not read or copy the user’s everyday browser profile. The private `1.待办事项` document locator, last verified Outlook sender address and verification time, common calendar attendees, and default calendar timezone are stored in the local `domi-plugin-config.json` with user-only file permissions. Outlook profile checks use ephemeral private output that is not archived as a task result or published to the workbench event stream. These values are not release inputs and must never be copied into the repository or application bundle.

ChatGPT authentication is managed by the locally installed Codex runtime. Outlook authorization is managed by the installed Outlook Calendar connector; domi does not persist its OAuth tokens. External connection identifiers are entered by each user and saved only in local Application Support. Credentials and signing material belong in macOS Keychain or the release environment, never in source files.

## Required release gates

Before any source or binary publication:

```bash
npm run privacy:check
npm run privacy:history
npm run check
node scripts/privacy-check.cjs --artifact /absolute/path/to/domi-version-arm64.dmg
```

The corresponding domi plugin commit must separately pass:

```bash
node scripts/public-release-check.cjs
node scripts/public-release-check.cjs --history
```

A normal revert does not remove sensitive Git history. If a history check fails, publish from a new root commit or use a reviewed history-rewrite procedure before making the repository public.

Code-signing identity is visible in a distributed macOS application. Public binaries should therefore be signed with an organization or brand identity approved for public disclosure.
