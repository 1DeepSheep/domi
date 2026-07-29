#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-dir}"
OUTPUT_DIR="${DOMI_BUILD_OUTPUT:-$HOME/Library/Caches/com.domi.workbench/build}"
BUILDER="$ROOT_DIR/node_modules/.bin/electron-builder"
PACKAGE_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
ELECTRON_VERSION="$(node -p "require('$ROOT_DIR/node_modules/electron/package.json').version")"
ELECTRON_DIST="${DOMI_ELECTRON_DIST:-$ROOT_DIR/node_modules/electron/dist}"
RELEASE_DIR="$ROOT_DIR/release/$PACKAGE_VERSION"
NOTARY_PROFILE="${APPLE_KEYCHAIN_PROFILE:-domi-notary}"

if [[ ! -d "$ELECTRON_DIST" ]]; then
  echo "Local Electron distribution not found: $ELECTRON_DIST" >&2
  echo "Run npm install or set DOMI_ELECTRON_DIST to a verified Electron distribution." >&2
  exit 1
fi
if [[ "$(cat "$ELECTRON_DIST/version" 2>/dev/null || true)" != "$ELECTRON_VERSION" ]]; then
  echo "Local Electron distribution does not match package version $ELECTRON_VERSION." >&2
  exit 1
fi

if [[ -n "$NOTARY_PROFILE" && -z "${APPLE_KEYCHAIN:-}" ]]; then
  export APPLE_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
fi

if [[ "$MODE" != "dir" && "$MODE" != "dist" && "$MODE" != "resume" ]]; then
  echo "Usage: $0 [dir|dist|resume]" >&2
  exit 2
fi

copy_release_artifacts() {
  mkdir -p "$RELEASE_DIR"
  find "$OUTPUT_DIR" -maxdepth 1 -type f \
    \( -name 'domi-*' -o -name '*-mac.yml' \) \
    -exec cp -f {} "$RELEASE_DIR/" \;
}

verify_release_dmg() {
  local dmg_path
  dmg_path="$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'domi-*-arm64.dmg' -print -quit)"
  if [[ -z "$dmg_path" ]]; then
    echo "Release DMG not found in $OUTPUT_DIR" >&2
    exit 1
  fi
  node "$ROOT_DIR/scripts/privacy-check.cjs" --artifact "$dmg_path"
}

notarize_release_app() {
  local app_path="$OUTPUT_DIR/mac-arm64/domi.app"
  local notary_zip="$OUTPUT_DIR/domi-$PACKAGE_VERSION-notary.zip"
  if [[ ! -d "$app_path" ]]; then
    echo "Signed app not found: $app_path" >&2
    exit 1
  fi
  if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    echo "Apple notarization profile '$NOTARY_PROFILE' is unavailable." >&2
    echo "Create it with xcrun notarytool store-credentials or set APPLE_KEYCHAIN_PROFILE." >&2
    exit 1
  fi
  rm -f "$notary_zip"
  ditto -c -k --keepParent "$app_path" "$notary_zip"
  xcrun notarytool submit "$notary_zip" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait
  rm -f "$notary_zip"
  xcrun stapler staple -v "$app_path"
  xcrun stapler validate "$app_path"
}

case "$MODE" in
  dir)
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    "$BUILDER" --mac dir --arm64 \
      --config.electronDist="$ELECTRON_DIST" \
      --config.directories.output="$OUTPUT_DIR"
    echo "Signed app: $OUTPUT_DIR/mac-arm64/domi.app"
    ;;
  dist)
    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"
    "$BUILDER" --mac dir --arm64 \
      --config.electronDist="$ELECTRON_DIST" \
      --config.directories.output="$OUTPUT_DIR"
    notarize_release_app
    "$BUILDER" --mac dmg zip --arm64 --prepackaged "$OUTPUT_DIR/mac-arm64/domi.app" \
      --config.directories.output="$OUTPUT_DIR"
    verify_release_dmg
    copy_release_artifacts
    echo "Release artifacts: $RELEASE_DIR"
    ;;
  resume)
    APP_PATH="$OUTPUT_DIR/mac-arm64/domi.app"
    if [[ ! -d "$APP_PATH" ]]; then
      echo "Prepackaged app not found: $APP_PATH" >&2
      exit 1
    fi
    xcrun stapler staple -v "$APP_PATH"
    xcrun stapler validate "$APP_PATH"
    find "$OUTPUT_DIR" -maxdepth 1 -type f \
      \( -name 'domi-*' -o -name '*-mac.yml' \) -delete
    "$BUILDER" --mac dmg zip --arm64 --prepackaged "$APP_PATH" \
      --config.directories.output="$OUTPUT_DIR"
    verify_release_dmg
    copy_release_artifacts
    echo "Release artifacts: $RELEASE_DIR"
    ;;
esac
