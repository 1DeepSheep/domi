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
