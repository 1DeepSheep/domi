# Third-party notices

## OpenAI Codex CLI

domi includes the official standalone distribution of OpenAI Codex CLI so the
required local runtime is available during first-run setup without a network
download.

- Source: https://github.com/openai/codex
- License: Apache License 2.0
- Copyright: OpenAI

The bundled version and official release digest are recorded in
`resources/codex-runtime.json`. The Apache License 2.0 text is included in
domi's `LICENSE` file.

For Apple notarization, the release build applies domi's Developer ID
signature, secure timestamp, and hardened-runtime option to the standalone
package's bundled `rg` and `zsh` helper executables. The Codex and
`codex-code-mode-host` executables retain their original OpenAI signatures.
The packaged manifest records both the original upstream digest and the digest
of the notarization-ready archive.

## Lark CLI

domi includes the official standalone Lark CLI so each installation can
connect to the current user's Feishu/Lark account without requiring Node.js,
Homebrew, or a separately installed command-line tool.

- Source: https://github.com/larksuite/cli
- Version: 1.0.60
- License: MIT
- Copyright: Copyright (c) 2026 Lark Technologies Pte. Ltd.

The official release URL and SHA-256 digest for each supported macOS
architecture are pinned in `resources/lark-runtime.json`. The complete MIT
license text is included beside the executable under
`Contents/Resources/lark-runtime/LICENSE`.

## FFmpeg and ffprobe

domi includes separate `ffmpeg` and `ffprobe` command-line executables for
offline conversion of user-selected local audio before PLAUD upload.

- Source: https://ffmpeg.org/
- Release source: https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz
- License: GNU Lesser General Public License, version 2.1 or later
- Copyright: the FFmpeg developers

The executables are built by domi directly from the pinned official source
archive without `--enable-gpl` or `--enable-nonfree`, without external codec
libraries, and with FFmpeg network protocols disabled. domi launches them as
separate processes and does not link domi code against FFmpeg libraries.

The installed application includes the exact corresponding FFmpeg source
archive, FFmpeg license texts, build configuration, source checksum, and binary
checksums under `Contents/Resources/media-runtime/`. The source and build
configuration are therefore available offline to every recipient of the
binary distribution.
