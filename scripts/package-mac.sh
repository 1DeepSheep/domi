#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-dir}"
OUTPUT_DIR="${DOMI_BUILD_OUTPUT:-$HOME/Library/Caches/com.domi.workbench/build}"
BUILDER="$ROOT_DIR/node_modules/.bin/electron-builder"
PACKAGE_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
RELEASE_DIR="$ROOT_DIR/release/$PACKAGE_VERSION"

if [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" && -z "${APPLE_KEYCHAIN:-}" ]]; then
  export APPLE_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
fi

if [[ "$MODE" != "dir" && "$MODE" != "dist" && "$MODE" != "resume" ]]; then
  echo "Usage: $0 [dir|dist|resume]" >&2
  exit 2
fi

copy_release_artifacts() {
  mkdir -p "$RELEASE_DIR"
  find "$OUTPUT_DIR" -maxdepth 1 -type f \
    \( -name 'Domi-*' -o -name '*-mac.yml' \) \
    -exec cp -f {} "$RELEASE_DIR/" \;
}

verify_release_dmg() {
  local dmg_path
  dmg_path="$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'Domi-*-arm64.dmg' -print -quit)"
  if [[ -z "$dmg_path" ]]; then
    echo "Release DMG not found in $OUTPUT_DIR" >&2
    exit 1
  fi
  node "$ROOT_DIR/scripts/privacy-check.cjs" --artifact "$dmg_path"
}

case "$MODE" in
  dir)
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    "$BUILDER" --mac dir --arm64 --config.directories.output="$OUTPUT_DIR"
    echo "Signed app: $OUTPUT_DIR/mac-arm64/豆米.app"
    ;;
  dist)
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    "$BUILDER" --mac dmg zip --arm64 --config.directories.output="$OUTPUT_DIR"
    verify_release_dmg
    copy_release_artifacts
    echo "Release artifacts: $RELEASE_DIR"
    ;;
  resume)
    APP_PATH="$OUTPUT_DIR/mac-arm64/豆米.app"
    if [[ ! -d "$APP_PATH" ]]; then
      echo "Prepackaged app not found: $APP_PATH" >&2
      exit 1
    fi
    xcrun stapler staple -v "$APP_PATH"
    xcrun stapler validate "$APP_PATH"
    find "$OUTPUT_DIR" -maxdepth 1 -type f \
      \( -name 'Domi-*' -o -name '*-mac.yml' \) -delete
    "$BUILDER" --mac dmg zip --arm64 --prepackaged "$APP_PATH" \
      --config.directories.output="$OUTPUT_DIR"
    verify_release_dmg
    copy_release_artifacts
    echo "Release artifacts: $RELEASE_DIR"
    ;;
esac
