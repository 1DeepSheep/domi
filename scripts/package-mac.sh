#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-dir}"
OUTPUT_DIR="${DOMI_BUILD_OUTPUT:-$HOME/Library/Caches/com.domi.workbench/build}"
BUILDER="$ROOT_DIR/node_modules/.bin/electron-builder"
PACKAGE_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
ELECTRON_VERSION="$(node -p "require('$ROOT_DIR/node_modules/electron/package.json').version")"
HOST_ARCH="$(node -p 'process.arch')"
DEFAULT_ELECTRON_DIST="$ROOT_DIR/node_modules/electron/dist"
RELEASE_DIR="$ROOT_DIR/release/$PACKAGE_VERSION"
NOTARY_PROFILE="${APPLE_KEYCHAIN_PROFILE:-domi-notary}"
RELEASE_ARCHES=(arm64 x64)

if [[ "$OUTPUT_DIR" == "/" || "$OUTPUT_DIR" == "$HOME" || -z "$OUTPUT_DIR" ]]; then
  echo "Unsafe build output directory: $OUTPUT_DIR" >&2
  exit 1
fi

if [[ -n "$NOTARY_PROFILE" && -z "${APPLE_KEYCHAIN:-}" ]]; then
  export APPLE_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
fi

if [[ "$MODE" != "dir" && "$MODE" != "dist" && "$MODE" != "resume" ]]; then
  echo "Usage: $0 [dir|dist|resume]" >&2
  exit 2
fi

assert_supported_arch() {
  case "$1" in
    arm64|x64) ;;
    *)
      echo "Unsupported macOS architecture: $1" >&2
      exit 2
      ;;
  esac
}

app_path_for_arch() {
  case "$1" in
    arm64) printf '%s\n' "$OUTPUT_DIR/mac-arm64/domi.app" ;;
    x64) printf '%s\n' "$OUTPUT_DIR/mac/domi.app" ;;
  esac
}

expected_macho_arch() {
  case "$1" in
    arm64) printf '%s\n' "arm64" ;;
    x64) printf '%s\n' "x86_64" ;;
  esac
}

expected_codex_target() {
  case "$1" in
    arm64) printf '%s\n' "aarch64-apple-darwin" ;;
    x64) printf '%s\n' "x86_64-apple-darwin" ;;
  esac
}

verify_macho_arch() {
  local binary_path="$1"
  local arch="$2"
  local expected
  local actual
  expected="$(expected_macho_arch "$arch")"
  if [[ ! -f "$binary_path" ]]; then
    echo "Mach-O binary is missing: $binary_path" >&2
    exit 1
  fi
  actual="$(xcrun lipo -archs "$binary_path" 2>/dev/null || true)"
  if [[ "$actual" != "$expected" ]]; then
    echo "Binary architecture mismatch for $binary_path: expected $expected, received ${actual:-unknown}." >&2
    exit 1
  fi
}

configured_electron_dist_for_arch() {
  local arch="$1"
  local configured=""
  case "$arch" in
    arm64) configured="${DOMI_ELECTRON_DIST_ARM64:-}" ;;
    x64) configured="${DOMI_ELECTRON_DIST_X64:-}" ;;
  esac
  if [[ -n "$configured" ]]; then
    printf '%s\n' "$configured"
    return
  fi
  # DOMI_ELECTRON_DIST is the legacy current-host override. A non-host target
  # deliberately omits electronDist so electron-builder downloads and verifies
  # the matching official Electron archive instead of reusing the wrong slice.
  if [[ "$arch" == "$HOST_ARCH" ]]; then
    printf '%s\n' "${DOMI_ELECTRON_DIST:-$DEFAULT_ELECTRON_DIST}"
    return
  fi
  printf '%s\n' ""
}

verify_electron_dist() {
  local electron_dist="$1"
  local arch="$2"
  local electron_binary="$electron_dist/Electron.app/Contents/MacOS/Electron"
  if [[ ! -d "$electron_dist" ]]; then
    echo "Configured Electron distribution not found for $arch: $electron_dist" >&2
    exit 1
  fi
  if [[ "$(cat "$electron_dist/version" 2>/dev/null || true)" != "$ELECTRON_VERSION" ]]; then
    echo "Electron distribution for $arch does not match package version $ELECTRON_VERSION." >&2
    exit 1
  fi
  verify_macho_arch "$electron_binary" "$arch"
}

verify_app_update_config() {
  local app_path="$1"
  local update_config="$app_path/Contents/Resources/app-update.yml"
  if [[ ! -f "$update_config" ]]; then
    echo "Packaged app update config is missing: $update_config" >&2
    exit 1
  fi
  if ! grep -q '^provider: github$' "$update_config" \
    || ! grep -q '^owner: 1DeepSheep$' "$update_config" \
    || ! grep -q '^repo: domi$' "$update_config"; then
    echo "Packaged app update config is invalid: $update_config" >&2
    exit 1
  fi
}

verify_bundled_runtime_arch() {
  local app_path="$1"
  local arch="$2"
  local codex_manifest="$app_path/Contents/Resources/codex-runtime/manifest.json"
  local media_manifest="$app_path/Contents/Resources/media-runtime/manifest.json"
  local expected_target
  expected_target="$(expected_codex_target "$arch")"
  node - "$codex_manifest" "$expected_target" <<'NODE'
const fs = require("node:fs");
const [manifestPath, expectedTarget] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.target !== expectedTarget) {
  throw new Error(`Codex runtime target mismatch: expected ${expectedTarget}, received ${manifest.target || "missing"}.`);
}
NODE
  node - "$media_manifest" "$arch" <<'NODE'
const fs = require("node:fs");
const [manifestPath, expectedArch] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.targetArch !== expectedArch) {
  throw new Error(`Media runtime target mismatch: expected ${expectedArch}, received ${manifest.targetArch || "missing"}.`);
}
NODE
  verify_macho_arch "$app_path/Contents/Resources/media-runtime/bin/ffmpeg" "$arch"
  verify_macho_arch "$app_path/Contents/Resources/media-runtime/bin/ffprobe" "$arch"
}

verify_packaged_app() {
  local app_path="$1"
  local arch="$2"
  if [[ ! -d "$app_path" ]]; then
    echo "Packaged app not found for $arch: $app_path" >&2
    exit 1
  fi
  verify_macho_arch "$app_path/Contents/MacOS/domi" "$arch"
  verify_app_update_config "$app_path"
  verify_bundled_runtime_arch "$app_path" "$arch"
}

verify_release_signature() {
  local app_path="$1"
  local signature_details
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$app_path"
  signature_details="$(/usr/bin/codesign -d --verbose=4 "$app_path" 2>&1)"
  if ! grep -F 'Authority=Developer ID Application:' <<<"$signature_details" >/dev/null; then
    echo "Developer ID Application signature is missing: $app_path" >&2
    exit 1
  fi
}

build_app_for_arch() {
  local arch="$1"
  local electron_dist
  local builder_args=(
    --mac dir "--$arch"
    "--config.directories.output=$OUTPUT_DIR"
  )
  electron_dist="$(configured_electron_dist_for_arch "$arch")"
  if [[ -n "$electron_dist" ]]; then
    verify_electron_dist "$electron_dist" "$arch"
    builder_args+=("--config.electronDist=$electron_dist")
  else
    echo "Using electron-builder's verified official Electron download for $arch."
  fi
  "$BUILDER" "${builder_args[@]}"
  verify_packaged_app "$(app_path_for_arch "$arch")" "$arch"
}

ensure_notary_profile() {
  if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    echo "Apple notarization profile '$NOTARY_PROFILE' is unavailable." >&2
    echo "Create it with xcrun notarytool store-credentials or set APPLE_KEYCHAIN_PROFILE." >&2
    exit 1
  fi
}

notarize_release_app() {
  local arch="$1"
  local app_path
  local notary_zip="$OUTPUT_DIR/domi-$PACKAGE_VERSION-$arch-notary.zip"
  app_path="$(app_path_for_arch "$arch")"
  verify_release_signature "$app_path"
  rm -f "$notary_zip"
  ditto -c -k --keepParent "$app_path" "$notary_zip"
  xcrun notarytool submit "$notary_zip" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait
  rm -f "$notary_zip"
  xcrun stapler staple -v "$app_path"
  xcrun stapler validate "$app_path"
}

staple_existing_app() {
  local arch="$1"
  local app_path
  app_path="$(app_path_for_arch "$arch")"
  verify_release_signature "$app_path"
  if ! xcrun stapler validate "$app_path" >/dev/null 2>&1; then
    xcrun stapler staple -v "$app_path"
  fi
  xcrun stapler validate "$app_path"
}

clear_release_artifacts() {
  find "$OUTPUT_DIR" -maxdepth 1 -type f \
    \( -name "domi-$PACKAGE_VERSION-*" -o -name 'latest-mac.yml' \) \
    -delete
}

package_release_arch() {
  local arch="$1"
  local app_path
  app_path="$(app_path_for_arch "$arch")"
  "$BUILDER" --mac dmg zip "--$arch" --prepackaged "$app_path" \
    "--config.directories.output=$OUTPUT_DIR"
}

verify_release_artifacts() {
  local arch="$1"
  local extension
  local artifact
  for extension in dmg zip; do
    artifact="$OUTPUT_DIR/domi-$PACKAGE_VERSION-$arch.$extension"
    if [[ ! -s "$artifact" || ! -s "$artifact.blockmap" ]]; then
      echo "Release artifact or blockmap is missing for $arch: $artifact" >&2
      exit 1
    fi
  done
  node "$ROOT_DIR/scripts/privacy-check.cjs" \
    --artifact "$OUTPUT_DIR/domi-$PACKAGE_VERSION-$arch.dmg"
}

merge_release_metadata() {
  node "$ROOT_DIR/scripts/merge-mac-update-info.cjs" \
    --input "$OUTPUT_DIR" \
    --output "$OUTPUT_DIR/latest-mac.yml" \
    --version "$PACKAGE_VERSION"
}

copy_release_artifacts() {
  local arch
  local extension
  mkdir -p "$RELEASE_DIR"
  find "$RELEASE_DIR" -maxdepth 1 -type f \
    \( -name "domi-$PACKAGE_VERSION-*" -o -name 'latest-mac.yml' \) \
    -delete
  for arch in "${RELEASE_ARCHES[@]}"; do
    for extension in dmg zip; do
      cp -f "$OUTPUT_DIR/domi-$PACKAGE_VERSION-$arch.$extension" "$RELEASE_DIR/"
      cp -f "$OUTPUT_DIR/domi-$PACKAGE_VERSION-$arch.$extension.blockmap" "$RELEASE_DIR/"
    done
  done
  cp -f "$OUTPUT_DIR/latest-mac.yml" "$RELEASE_DIR/"
}

finish_release() {
  local arch
  clear_release_artifacts
  for arch in "${RELEASE_ARCHES[@]}"; do
    package_release_arch "$arch"
    verify_release_artifacts "$arch"
  done
  merge_release_metadata
  copy_release_artifacts
  echo "Release artifacts: $RELEASE_DIR"
}

case "$MODE" in
  dir)
    DIR_ARCH="${DOMI_MAC_DIR_ARCH:-$HOST_ARCH}"
    assert_supported_arch "$DIR_ARCH"
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    build_app_for_arch "$DIR_ARCH"
    echo "Packaged app: $(app_path_for_arch "$DIR_ARCH")"
    ;;
  dist)
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    for arch in "${RELEASE_ARCHES[@]}"; do
      build_app_for_arch "$arch"
      verify_release_signature "$(app_path_for_arch "$arch")"
    done
    ensure_notary_profile
    for arch in "${RELEASE_ARCHES[@]}"; do
      notarize_release_app "$arch"
    done
    finish_release
    ;;
  resume)
    for arch in "${RELEASE_ARCHES[@]}"; do
      verify_packaged_app "$(app_path_for_arch "$arch")" "$arch"
      staple_existing_app "$arch"
    done
    finish_release
    ;;
esac
