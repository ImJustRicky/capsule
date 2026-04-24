#!/bin/bash
#
# Build a distributable Capsule.dmg from the staged Capsule.app.
#
# If APPLE_DEVELOPER_ID, APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_PASSWORD are
# set in the environment, the .app and .dmg are codesigned and notarized.
# Otherwise an unsigned DMG is produced (Gatekeeper will warn end users).
#
# Usage:
#   ./installers/macos/build.sh                        # build the .app
#   ./installers/macos/dmg.sh                          # then build the .dmg
#
# Output:  installers/macos/build/Capsule-<version>.dmg

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$REPO_ROOT/installers/macos/build"
APP="$BUILD_DIR/Capsule.app"
VERSION="${CAPSULE_VERSION:-$(grep -m1 '"version"' "$REPO_ROOT/packages/capsule-cli/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')}"
DMG="$BUILD_DIR/Capsule-${VERSION}.dmg"
STAGING="$BUILD_DIR/dmg-staging"

if [ ! -d "$APP" ]; then
    echo "Capsule.app not found. Run installers/macos/build.sh first."
    exit 1
fi

# --- Optional codesigning ---
if [ -n "${APPLE_DEVELOPER_ID:-}" ]; then
    echo "==> Codesigning .app with Developer ID: $APPLE_DEVELOPER_ID"
    # Sign every binary inside Resources/runtime/node_modules first (deep),
    # then sign the app itself with hardened runtime.
    codesign --force --options runtime --timestamp --deep \
        --sign "$APPLE_DEVELOPER_ID" "$APP"
    codesign --verify --deep --strict --verbose=2 "$APP"
else
    echo "==> APPLE_DEVELOPER_ID not set — skipping codesign (output will be unsigned)"
fi

# --- Stage DMG contents ---
echo "==> Staging DMG"
rm -rf "$STAGING" "$DMG"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/Capsule.app"
ln -s /Applications "$STAGING/Applications"

# Optional background image / volume icon
if [ -f "$REPO_ROOT/installers/macos/dmg-background.png" ]; then
    mkdir -p "$STAGING/.background"
    cp "$REPO_ROOT/installers/macos/dmg-background.png" "$STAGING/.background/background.png"
fi

# --- Build DMG ---
echo "==> Creating $DMG"
hdiutil create \
    -volname "Capsule $VERSION" \
    -srcfolder "$STAGING" \
    -ov -format UDZO \
    "$DMG"

rm -rf "$STAGING"

# --- Optional notarization ---
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ]; then
    echo "==> Notarizing DMG (this can take a few minutes)"
    xcrun notarytool submit "$DMG" \
        --apple-id "$APPLE_ID" \
        --team-id "$APPLE_TEAM_ID" \
        --password "$APPLE_APP_PASSWORD" \
        --wait
    echo "==> Stapling notarization ticket"
    xcrun stapler staple "$DMG"
    xcrun stapler validate "$DMG"
else
    echo "==> Notarization secrets not set — skipping notarization"
fi

# --- Provenance: sha256 + minisign-style signature if MINISIGN_KEY is set ---
SHA="$(shasum -a 256 "$DMG" | awk '{print $1}')"
echo "$SHA  $(basename "$DMG")" > "$DMG.sha256"
echo "==> sha256: $SHA"

if [ -n "${MINISIGN_SECRET_KEY_FILE:-}" ] && command -v minisign >/dev/null 2>&1; then
    echo "==> Producing minisign signature"
    MINISIGN_ARGS=()
    if [ -n "${MINISIGN_PASSWORD:-}" ]; then
        MINISIGN_ARGS=(-W "$MINISIGN_PASSWORD")
    fi
    minisign -S -s "$MINISIGN_SECRET_KEY_FILE" \
        -m "$DMG" \
        "${MINISIGN_ARGS[@]}"
fi

echo
echo "Built: $DMG"
ls -lh "$DMG"*
